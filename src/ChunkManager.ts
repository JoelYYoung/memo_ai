import { Notice } from 'obsidian';
import { SM2Algorithm, SM2Params } from './SM2Algorithm';
import { LLMService } from './LLMService';
import type MemoAIPlugin from '../main';

export type ChunkType = 'knowledge';

export interface Chunk {
	id: string;
	notePath: string;
	content: string;
	chunkType: ChunkType;
	importanceLevel: 'low' | 'medium' | 'high';
	needsReview: boolean;
	sm2Ef: number;
	sm2Repetitions: number;
	sm2IntervalDays: number;
	familiarScore: number; // 0.0 ~ 1.0
	dueAt: number; // timestamp
	createdAt: number;
	lastReviewedAt: number | null;
	chunkScore?: number; // Push recommendation score
}

export class ChunkManager {
	private plugin: MemoAIPlugin;
	private chunks: Map<string, Chunk> = new Map();

	constructor(plugin: MemoAIPlugin) {
		this.plugin = plugin;
		void this.loadChunks();
	}

	async loadChunks() {
		const chunksArray = this.plugin.getStoredChunkEntries() ?? [];
		for (const [id, chunk] of chunksArray) {
			if (chunk.needsReview === undefined) {
				chunk.needsReview = true;
			}
			if ((chunk as any).chunkType !== 'knowledge') {
				(chunk as any).chunkType = 'knowledge';
			}
			if (!chunk.createdAt) {
				chunk.createdAt = chunk.lastReviewedAt || chunk.dueAt || Date.now();
			}
			// chunkScore is optional, old data may not have it
			this.chunks.set(id, {
				...chunk,
				chunkType: 'knowledge'
			});
		}
	}

	async cleanupDeletedNotes() {
		const chunksToDelete: string[] = [];
		
		// Check all loaded chunks to see if their note files still exist
		for (const [id, chunk] of this.chunks.entries()) {
			if (chunk.notePath) {
				const file = this.app.vault.getAbstractFileByPath(chunk.notePath);
				if (!file) {
					// Note file doesn't exist, mark chunk for deletion
					chunksToDelete.push(id);
				}
			}
		}
		
		// Delete chunks for non-existent notes and their associated pushes
		if (chunksToDelete.length > 0) {
			// Delete associated pushes first
			if (this.plugin.pushManager) {
				for (const chunkId of chunksToDelete) {
					await this.plugin.pushManager.deletePushesForChunk(chunkId);
				}
			}
			
			// Delete chunks from memory
			for (const chunkId of chunksToDelete) {
				this.chunks.delete(chunkId);
			}
			
			// Save chunks to persist the deletion
			await this.saveChunks();
		}
	}

	async saveChunks() {
		await this.plugin.persistChunks(this.chunks);
	}

	async extractChunksFromActiveNote(incremental: boolean = true) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active note');
			return;
		}

		const content = await this.app.vault.read(activeFile);
		const settings = (this.plugin as any).settings;

		// Check if LLM API key is configured
		if (!settings?.llmApiKey) {
			new Notice('LLM API key not configured. Please set it in settings.');
			return;
		}

		let created = 0;
		let updated = 0;
		let deleted = 0;

		// Always use LLM extraction
		try {
			new Notice('Extracting chunks using LLM...');
			const llmService = new LLMService({
				apiKey: settings.llmApiKey || '',
				apiBase: settings.llmApiBase || 'https://api.openai.com/v1',
				model: settings.llmModel || 'gpt-3.5-turbo',
				timeout: (settings.llmTimeout || 60) * 1000 // Convert seconds to milliseconds
			});
			
			// Get existing chunks for this note if incremental
			const existingChunks = incremental ? this.getChunksByNotePath(activeFile.path) : [];
			
			// If no existing chunks, use non-incremental extraction
			if (existingChunks.length === 0) {
				const llmChunks = await llmService.extractChunks(
					activeFile.basename,
					content
				);
				
				// Process new chunks
				for (const llmChunk of llmChunks) {
					if (!llmChunk.content || !llmChunk.content.trim()) {
						continue; // Skip empty chunks
					}
					const newChunk = this.createNewChunk(
						llmChunk.content,
						activeFile.path
					);
					this.addChunk(newChunk);
					created++;
				}

				await this.saveChunks();
				if (created > 0) {
					new Notice(`Extracted ${created} chunks from ${activeFile.name}`);
				} else {
					new Notice('No chunks extracted. The note may be empty or too short.');
				}
			} else {
				// Use incremental extraction when there are existing chunks
				const result = await llmService.extractChunksIncremental(
					activeFile.basename,
					content,
					existingChunks.map(c => ({
						id: c.id,
						content: c.content,
						importance_level: c.importanceLevel,
						needs_review: c.needsReview
					}))
				);
				
				// Process existing chunk decisions
				for (const decision of result.existing_chunks || []) {
					const existingChunk = existingChunks.find(c => c.id === decision.id);
					if (!existingChunk) continue;

					if (decision.action === 'delete') {
						this.chunks.delete(decision.id);
						deleted++;
					} else if (decision.action === 'modify' && decision.modified_content) {
						existingChunk.content = decision.modified_content.trim();
						
						// Adjust learning state based on update level instead of full reset
						const updateLevel = decision.update_level || 'moderate'; // Default to moderate if not provided
						
						// Adjust familiarity score based on update level
						// Minor: 90% retention, Moderate: 70% retention, Major: 40% retention
						const familiarityRetention = updateLevel === 'minor' ? 0.9 : 
							updateLevel === 'moderate' ? 0.7 : 0.4;
						existingChunk.familiarScore = Math.max(0, existingChunk.familiarScore * familiarityRetention);
						
						// Adjust EF based on update level
						// Minor: slight decrease, Moderate: moderate decrease, Major: significant decrease
						if (updateLevel === 'minor') {
							existingChunk.sm2Ef = Math.max(1.3, existingChunk.sm2Ef - 0.1);
						} else if (updateLevel === 'moderate') {
							existingChunk.sm2Ef = Math.max(1.3, existingChunk.sm2Ef - 0.3);
							// Reduce repetitions slightly
							existingChunk.sm2Repetitions = Math.max(0, existingChunk.sm2Repetitions - 1);
						} else { // major
							existingChunk.sm2Ef = Math.max(1.3, existingChunk.sm2Ef * 0.7);
							// Reset repetitions to 0 for major updates
							existingChunk.sm2Repetitions = 0;
						}
						
						// Adjust interval based on new repetitions and EF
						// If repetitions were reset, use initial interval
						if (existingChunk.sm2Repetitions === 0) {
							const importanceMultiplier = SM2Algorithm.getImportanceMultiplier(existingChunk.importanceLevel);
							const initialIntervalDays = 1;
							existingChunk.sm2IntervalDays = Math.max(1, Math.round(initialIntervalDays * importanceMultiplier));
						} else {
							// Recalculate interval based on current EF and previous interval
							// Use a conservative approach: reduce interval by 50% to account for content change
							existingChunk.sm2IntervalDays = Math.max(1, Math.round(existingChunk.sm2IntervalDays * 0.5));
						}
						
						// Update dueAt based on new interval
						existingChunk.dueAt = Date.now() + (existingChunk.sm2IntervalDays * 24 * 60 * 60 * 1000);
						
						// Keep lastReviewedAt unchanged (content was updated, but review history is still relevant)
						
						// Recalculate chunkScore after adjustment
						existingChunk.chunkScore = this.computeChunkScore(existingChunk);
						updated++;
					}
					// 'keep' action - do nothing
				}

				// Process new chunks
				for (const llmChunk of result.new_chunks || []) {
					if (!llmChunk.content || !llmChunk.content.trim()) {
						continue; // Skip empty chunks
					}
					const newChunk = this.createNewChunk(
						llmChunk.content,
						activeFile.path
					);
					this.addChunk(newChunk);
					created++;
				}

				await this.saveChunks();
				new Notice(`Extracted: ${created} new, ${updated} updated, ${deleted} deleted`);
			}
		} catch (error: any) {
			new Notice(`LLM extraction failed: ${error.message}`);
			console.error('LLM extraction error:', error);
			return;
		}
	}

	private createNewChunk(content: string, notePath: string): Chunk {
		const now = Date.now();
		const importanceLevel: 'low' | 'medium' | 'high' = 'medium';
		const familiarScore = 0.0;
		
		// Calculate initial SM2 interval for new chunk
		// For a new chunk (repetitions = 0), the first review should be after 1 day
		// But we also consider importance level
		const initialIntervalDays = 1; // First review is always 1 day for new chunks
		const importanceMultiplier = SM2Algorithm.getImportanceMultiplier(importanceLevel);
		const adjustedIntervalDays = Math.max(1, Math.round(initialIntervalDays * importanceMultiplier));
		
		// Calculate initial dueAt based on SM2 interval
		const dueAt = now + (adjustedIntervalDays * 24 * 60 * 60 * 1000);
		
		// Create chunk object
		const chunk: Chunk = {
			id: `${notePath}-${now}-${Math.random().toString(36).substr(2, 9)}`,
			notePath,
			content: content.trim(),
			chunkType: 'knowledge',
			importanceLevel,
			needsReview: true,
			sm2Ef: 2.5,
			sm2Repetitions: 0,
			sm2IntervalDays: adjustedIntervalDays,
			familiarScore,
			dueAt,
			createdAt: now,
			lastReviewedAt: null
		};
		
		// Calculate and set initial chunkScore
		chunk.chunkScore = this.computeChunkScore(chunk);
		
		return chunk;
	}


	addChunk(chunk: Chunk) {
		this.chunks.set(chunk.id, chunk);
	}

	getChunk(id: string): Chunk | undefined {
		return this.chunks.get(id);
	}

	getAllChunks(): Chunk[] {
		return Array.from(this.chunks.values());
	}

	getDueChunks(): Chunk[] {
		const now = Date.now();
		return this.getAllChunks().filter(chunk => 
			chunk.dueAt <= now && chunk.needsReview
		);
	}

	getChunksByNotePath(notePath: string): Chunk[] {
		return this.getAllChunks().filter(chunk => chunk.notePath === notePath);
	}

	async reviewChunk(chunkId: string, grade: number): Promise<Chunk | undefined> {
		const chunk = this.chunks.get(chunkId);
		if (!chunk) return;

		const params: SM2Params = {
			ef: chunk.sm2Ef,
			repetitions: chunk.sm2Repetitions,
			intervalDays: chunk.sm2IntervalDays,
			importanceLevel: chunk.importanceLevel
		};

		const result = SM2Algorithm.update(grade, params);
		
		chunk.sm2Ef = result.newEf;
		chunk.sm2Repetitions = result.newRepetitions;
		chunk.sm2IntervalDays = result.newIntervalDays;
		chunk.familiarScore = SM2Algorithm.calculateFamiliarScore(
			chunk.familiarScore,
			grade
		);
		chunk.lastReviewedAt = Date.now();
		chunk.dueAt = Date.now() + (result.newIntervalDays * 24 * 60 * 60 * 1000);
		
		// Recalculate chunkScore after review (familiarity and dueAt changed)
		chunk.chunkScore = this.computeChunkScore(chunk);

		await this.saveChunks();
		return chunk;
	}

	async updateChunk(chunkId: string, updates: Partial<Chunk>) {
		const chunk = this.chunks.get(chunkId);
		if (!chunk) return;

		// Check if any field that affects chunkScore is being updated and actually changed
		const importanceChanged = updates.importanceLevel !== undefined && updates.importanceLevel !== chunk.importanceLevel;
		const familiarityChanged = updates.familiarScore !== undefined && updates.familiarScore !== chunk.familiarScore;
		const dueAtChanged = updates.dueAt !== undefined && updates.dueAt !== chunk.dueAt;
		const affectsScore = importanceChanged || familiarityChanged || dueAtChanged;
		const chunkScoreExplicitlySet = updates.chunkScore !== undefined;

		Object.assign(chunk, updates);
		
		// Recalculate chunkScore if relevant fields changed (and chunkScore wasn't explicitly set)
		if (affectsScore && !chunkScoreExplicitlySet) {
			chunk.chunkScore = this.computeChunkScore(chunk);
		}

		await this.saveChunks();
	}

	async deleteChunk(chunkId: string) {
		this.chunks.delete(chunkId);
		await this.saveChunks();
		
		// Delete all pushes associated with this chunk
		if (this.plugin.pushManager) {
			await this.plugin.pushManager.deletePushesForChunk(chunkId);
		}
	}

	computeChunkScore(chunk: Chunk): number {
		const importance =
			chunk.importanceLevel === 'high' ? 2 :
				chunk.importanceLevel === 'medium' ? 1 : 0;
		const familiarity = 1 - (chunk.familiarScore ?? 0);
		const now = Date.now();
		// Consider dueAt: if dueAt exists and is in the past, add boost
		// If dueAt doesn't exist or is in the future, use a base score
		// Use a sigmoid function to calculate the boost, value table:
		// | now - dueAt | | boost |
		// | -infinity   | | 0     |
		// | -0.5 days   | | 1     |
		// | 0    days   | | 2     |
		// | 0.5 days    | | 3     |
		// | +infinity   | | 4     |
		const dueBoost = chunk.dueAt 
			? 4 / (1 + Math.exp(-(now - chunk.dueAt) / (1000 * 60 * 60 * 24)))
			: 0;
		return importance + familiarity + dueBoost;
	}

	private get app() {
		return this.plugin.app;
	}
}

