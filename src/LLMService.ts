import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';

export interface LLMConfig {
	apiKey: string;
	apiBase?: string;
	model?: string;
	timeout?: number; // Timeout in milliseconds
	requestUrl: (param: RequestUrlParam) => Promise<RequestUrlResponse>;
}

export interface LLMChunk {
	content: string;
}

export interface LLMResponse {
	chunks: LLMChunk[];
}

export interface ExistingChunk {
	id: string;
	content: string;
	importance_level: 'low' | 'medium' | 'high';
	needs_review: boolean;
}

export interface IncrementalChunkDecision {
	id: string;
	action: 'keep' | 'modify' | 'delete';
	modified_content?: string;
	update_level?: 'minor' | 'moderate' | 'major'; // Level of content change for modify action
}

export interface IncrementalLLMResponse {
	existing_chunks: IncrementalChunkDecision[];
	new_chunks: LLMChunk[];
}

export interface PushQuestionParams {
	chunkContent: string;
	familiarScore: number;
	language?: 'zh' | 'en';
}

export interface PushConversationHistory {
	sender: 'system' | 'user';
	content: string;
}

export interface PushResponseParams extends PushQuestionParams {
	history: PushConversationHistory[];
	forceEvaluate?: boolean;
}

export interface JsonPromptResult {
	question?: string;
	response?: string;
	grade?: number;
	[key: string]: unknown; // Allow other properties from LLM response
}

export interface PushEvaluationResult {
	grade: number;
	recommendation: string;
	confidence?: number;
}

export interface PushResponseResult {
	response: string;
	shouldEnd: boolean;
	evaluation?: PushEvaluationResult;
}

export class LLMService {
	private config: LLMConfig;

	constructor(config: LLMConfig) {
		this.config = config;
	}

	async extractChunks(noteTitle: string, noteContent: string): Promise<LLMChunk[]> {
		if (!this.config.apiKey) {
			throw new Error('LLM API key not configured');
		}

		const prompt = this.buildPrompt(noteTitle, noteContent);
		let apiBase = this.config.apiBase || 'https://api.openai.com/v1';
		const model = this.config.model || 'gpt-3.5-turbo';

		// Normalize API base URL - remove trailing slash and /chat/completions if present
		apiBase = apiBase.trim().replace(/\/+$/, '').replace(/\/chat\/completions\/?$/, '');
		
		// Build the full URL
		const apiUrl = `${apiBase}/chat/completions`;

		const timeoutMs = this.config.timeout || 60000; // Default 60 seconds

		try {
			const response = await this.config.requestUrl({
				url: apiUrl,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.config.apiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{
							role: 'user',
							content: prompt
						}
					],
					temperature: 0.3,
					response_format: { type: 'json_object' }
				}),
				throw: false
			});

			if (response.status < 200 || response.status >= 300) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const error = typeof response.json === 'object' && response.json !== null
						? response.json as { error?: { message?: string }; message?: string }
						: null;
					errorMessage = error?.error?.message || error?.message || response.text || errorMessage;
				} catch {
					errorMessage = response.text || errorMessage;
				}
				throw new Error(`LLM API error: ${errorMessage}`);
			}

			const data = typeof response.json === 'object' && response.json !== null
				? response.json as { choices?: Array<{ message?: { content?: string } }> }
				: null;
			if (!data.choices || !data.choices[0] || !data.choices[0].message) {
				throw new Error('Invalid response format from LLM API');
			}

			const content = data.choices[0].message.content;
			if (!content) {
				throw new Error('Empty response from LLM API');
			}

			let parsed: LLMResponse;
			try {
				parsed = JSON.parse(content) as LLMResponse;
			} catch (parseError: unknown) {
				const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
				console.error('Failed to parse LLM response:', content);
				throw new Error(`Failed to parse LLM response as JSON: ${errorMessage}`);
			}

			const chunks = parsed.chunks || [];
			if (!Array.isArray(chunks)) {
				console.error('LLM response chunks is not an array:', parsed);
				throw new Error('LLM response chunks is not an array');
			}

			return chunks;
		} catch (error: unknown) {
			console.error('LLM extraction error:', error);
			console.error('API URL:', apiUrl);
			console.error('Model:', model);
			
			if (error instanceof Error) {
				if (error.name === 'AbortError' || error.name === 'TimeoutError') {
					throw new Error('Request timeout. Please check your network connection or try again.');
				} else if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION')) {
					throw new Error(`Network error: Cannot connect to ${apiBase}. Please check your network connection and API endpoint.`);
				}
				throw new Error(`Failed to extract chunks: ${error.message}`);
			}
			throw new Error(`Failed to extract chunks: ${String(error)}`);
		}
	}

	async extractChunksIncremental(
		noteTitle: string,
		noteContent: string,
		existingChunks: ExistingChunk[]
	): Promise<IncrementalLLMResponse> {
		if (!this.config.apiKey) {
			throw new Error('LLM API key not configured');
		}

		const prompt = this.buildIncrementalPrompt(noteTitle, noteContent, existingChunks);
		let apiBase = this.config.apiBase || 'https://api.openai.com/v1';
		const model = this.config.model || 'gpt-3.5-turbo';

		// Normalize API base URL - remove trailing slash and /chat/completions if present
		apiBase = apiBase.trim().replace(/\/+$/, '').replace(/\/chat\/completions\/?$/, '');
		
		// Build the full URL
		const apiUrl = `${apiBase}/chat/completions`;

		const timeoutMs = this.config.timeout || 60000; // Default 60 seconds

		try {
			const response = await this.config.requestUrl({
				url: apiUrl,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.config.apiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{
							role: 'user',
							content: prompt
						}
					],
					temperature: 0.3,
					response_format: { type: 'json_object' }
				}),
				throw: false
			});

			if (response.status < 200 || response.status >= 300) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const error = typeof response.json === 'object' && response.json !== null
						? response.json as { error?: { message?: string }; message?: string }
						: null;
					errorMessage = error?.error?.message || error?.message || response.text || errorMessage;
				} catch {
					errorMessage = response.text || errorMessage;
				}
				throw new Error(`LLM API error: ${errorMessage}`);
			}

			const data = typeof response.json === 'object' && response.json !== null
				? response.json as { choices?: Array<{ message?: { content?: string } }> }
				: null;
			if (!data.choices || !data.choices[0] || !data.choices[0].message) {
				throw new Error('Invalid response format from LLM API');
			}

			const content = data.choices[0].message.content;
			if (!content) {
				throw new Error('Empty response from LLM API');
			}

			let parsed: IncrementalLLMResponse;
			try {
				parsed = JSON.parse(content) as IncrementalLLMResponse;
			} catch (parseError: unknown) {
				const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
				console.error('Failed to parse LLM response:', content);
				throw new Error(`Failed to parse LLM response as JSON: ${errorMessage}`);
			}

			const existingChunks = parsed.existing_chunks || [];
			const newChunks = parsed.new_chunks || [];

			if (!Array.isArray(existingChunks) || !Array.isArray(newChunks)) {
				console.error('LLM response format invalid:', parsed);
				throw new Error('LLM response format invalid: existing_chunks and new_chunks must be arrays');
			}
			
			return {
				existing_chunks: existingChunks,
				new_chunks: newChunks
			};
		} catch (error: unknown) {
			console.error('LLM incremental extraction error:', error);
			console.error('API URL:', apiUrl);
			console.error('Model:', model);
			
			if (error instanceof Error) {
				if (error.name === 'AbortError' || error.name === 'TimeoutError') {
					throw new Error('Request timeout. Please check your network connection or try again.');
				} else if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION')) {
					throw new Error(`Network error: Cannot connect to ${apiBase}. Please check your network connection and API endpoint.`);
				}
				throw new Error(`Failed to extract chunks incrementally: ${error.message}`);
			}
			throw new Error(`Failed to extract chunks incrementally: ${String(error)}`);
		}
	}

	async generatePushQuestion(params: PushQuestionParams): Promise<string> {
		const prompt = this.buildPushQuestionPrompt(params);
		const result = await this.callJsonPrompt(prompt);
		if (!result.question || typeof result.question !== 'string') {
			throw new Error('LLM did not return a valid question');
		}
		return result.question.trim();
	}

	async generatePushResponse(params: PushResponseParams): Promise<PushResponseResult> {
		const prompt = this.buildPushResponsePrompt(params);
		const result = await this.callJsonPrompt(prompt);
		if (!result.response) {
			throw new Error('LLM response missing answer text');
		}

		// Parse and validate grade
		let grade = 3; // Default
		const evaluation = result.evaluation && typeof result.evaluation === 'object' && result.evaluation !== null
			? result.evaluation as { grade?: unknown; recommendation?: string; confidence?: unknown }
			: null;
		
		if (evaluation && evaluation.grade !== undefined && evaluation.grade !== null) {
			const parsedGrade = Number(evaluation.grade);
			if (!isNaN(parsedGrade)) {
				grade = Math.max(0, Math.min(5, Math.round(parsedGrade)));
			}
		}

		return {
			response: String(result.response).trim(),
			shouldEnd: Boolean(result.should_end),
			evaluation: evaluation ? {
				grade: grade,
				recommendation: evaluation.recommendation || '',
				confidence: evaluation.confidence !== undefined ? Number(evaluation.confidence) : undefined
			} : undefined
		};
	}

	private buildPrompt(noteTitle: string, noteContent: string): string {
		return `Please analyze the following note content and decompose it into knowledge chunks. Each chunk should be a substantial, coherent knowledge unit that covers a complete topic or theme.

Note title: ${noteTitle}

Note content:
${noteContent}

Please decompose the content into knowledge chunks and return structured data in JSON format. Each chunk should:
1. Represent a single, coherent knowledge idea or concept.
2. Include the necessary explanation, context, and supporting details.
3. Favor larger, meaningful sections (roughly 200-1500 characters) rather than single sentences.

Please strictly follow the JSON format below:
{
  "chunks": [
    {
      "content": "Specific content of the chunk"
    }
  ]
}

Requirements:
- If the content is empty or no valid chunks can be extracted, return {"chunks": []}
- Ensure the JSON format is correct and can be directly parsed
- Chunk content should maintain the integrity of the original text
- Prefer fewer, larger chunks over many small chunks
- Combine related sentences, paragraphs, examples, and explanations into single chunks when they belong to the same topic`;
	}

	private buildIncrementalPrompt(noteTitle: string, noteContent: string, existingChunks: ExistingChunk[]): string {
		const existingChunksText = existingChunks.length > 0
			? "\n\nExisting knowledge chunks (database chunk_id shown for each entry):\n" +
			  existingChunks.map(chunk =>
				  `- Chunk ID ${chunk.id} | Importance: ${chunk.importance_level} | ` +
				  `Needs review: ${chunk.needs_review}\n` +
				  `  Content preview: ${chunk.content.substring(0, 500)}${chunk.content.length > 500 ? '...' : ''}`
			  ).join('\n')
			: '';

		return `You are performing an INCREMENTAL UPDATE of knowledge chunks for a note. The note content has been modified, and you need to analyze what changes are needed.

Note title: ${noteTitle}

Note content:
${noteContent}${existingChunksText}

For incremental updates, analyze the current note content and compare it with existing chunks. You need to decide for each existing chunk whether to:
1. KEEP it unchanged (if it still accurately represents part of the content)
2. MODIFY it (if the content has changed but the core topic remains)
3. DELETE it (if the topic/concept is no longer in the note)

Also identify any NEW topics/concepts that need to be added as new chunks.

Please return structured data in JSON format with the following structure:
{
  "existing_chunks": [
    {
      "id": "chunk_id_string",
      "action": "keep" | "modify" | "delete",
      "modified_content": "new content if modified, empty otherwise",
      "update_level": "minor" | "moderate" | "major" (required if action is "modify")
    }
  ],
  "new_chunks": [
    {
      "content": "content of new chunk"
    }
  ]
}

Requirements for incremental updates:
- Carefully analyze which existing chunks are still relevant and accurate (consider semantic similarity, not only exact wording)
- Use the database chunk_id exactly as provided above when returning results (do NOT renumber or invent new IDs)
- Keep a chunk only when it still fully matches a section of the note with minimal differences
- Modify a chunk when the underlying topic remains but explanations, details, or emphasis have changed; include the full updated content when modifying
- When modifying, assess the update_level:
  * "minor": Only wording, formatting, or minor clarifications changed (e.g., rephrasing, typo fixes, minor additions)
  * "moderate": Some content changes, additions, or partial rewrites, but core concept remains (e.g., added examples, expanded explanations)
  * "major": Significant content changes or core concept modifications (e.g., fundamental concept changed, major restructuring)
- Delete a chunk only when its topic/concept no longer appears in the note
- Create new chunks strictly for genuinely new topics that are not covered by existing chunks
- Preserve the user's importance level and needs_review settings for kept/modified chunks (do not attempt to change them)
- Prefer fewer, comprehensive chunks over many fragmented ones
- Err on the side of modifying instead of deleting when the topic still partially overlaps`;
	}

	private buildPushQuestionPrompt(params: PushQuestionParams): string {
		const langInstruction = params.language === 'en'
			? 'Please respond in English.'
			: '请使用中文回答。';

		return `${langInstruction}

You are acting as a tutor preparing a quick knowledge check question for spaced repetition review.

Knowledge chunk content:
${params.chunkContent}
Learner familiarity score (0-1): ${params.familiarScore.toFixed(2)}

Please generate ONE open-ended question that:
1. Targets the most important concept in the chunk
2. Adjusts difficulty based on familiarity (more supportive if score low, more challenging if high)
3. Encourages the learner to recall or explain the concept

Return JSON with the following shape:
{
  "question": "..."
}
`;
	}

	private buildPushResponsePrompt(params: PushResponseParams): string {
		const langInstruction = params.language === 'en'
			? 'Please continue the conversation in English.'
			: '请用中文继续和学员对话。';

		const historyText = params.history.map(entry => {
			const label = entry.sender === 'user' ? 'User' : 'Tutor';
			return `${label}: ${entry.content}`;
		}).join('\n');

		const evaluationInstruction = params.forceEvaluate
			? 'The learner has requested to end the session now. Provide a concise closing response and immediately return an evaluation with grade/recommendation.'
			: 'If the learner has demonstrated sufficient understanding, you may end the session and provide an evaluation; otherwise, continue the dialogue.';

		return `${langInstruction}

You are a tutor helping a learner review the following knowledge chunk:
Familiarity score: ${params.familiarScore.toFixed(2)}
Content:
${params.chunkContent}

Conversation so far:
${historyText}

${evaluationInstruction}

Return JSON exactly in this structure:
{
  "response": "Tutor's next reply text",
  "should_end": true or false,
  "evaluation": {
    "grade": 0-5,
    "recommendation": "short actionable advice",
    "confidence": 0-1 (optional)
  }
}

If you decide the session is over (or the learner requests an immediate evaluation), set "should_end" to true and fill the evaluation object. Otherwise, set "should_end" to false and set "evaluation" to null.`;
	}

	private async callJsonPrompt(prompt: string): Promise<JsonPromptResult> {
		if (!this.config.apiKey) {
			throw new Error('LLM API key not configured');
		}

		let apiBase = this.config.apiBase || 'https://api.openai.com/v1';
		const model = this.config.model || 'gpt-3.5-turbo';
		apiBase = apiBase.trim().replace(/\/+$/, '').replace(/\/chat\/completions\/?$/, '');
		const apiUrl = `${apiBase}/chat/completions`;

		const response = await this.config.requestUrl({
			url: apiUrl,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.config.apiKey}`
			},
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: prompt }],
				temperature: 0.4,
				response_format: { type: 'json_object' }
			}),
			throw: false
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(response.text || `HTTP ${response.status}`);
		}

		const data = typeof response.json === 'object' && response.json !== null
			? response.json as { choices?: Array<{ message?: { content?: string } }> }
			: null;
		const content = data?.choices?.[0]?.message?.content;
		if (!content) {
			throw new Error('Empty response from LLM API');
		}
		return JSON.parse(content) as JsonPromptResult;
	}
}

