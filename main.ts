import { Plugin, PluginSettingTab, Setting, App, Notice, TFile } from 'obsidian';
import { NoteChunksView, VIEW_TYPE_NOTE_CHUNKS } from './src/ui/NoteChunksView';
import { Chunk, ChunkManager } from './src/ChunkManager';
import { PushManager } from './src/PushManager';
import { PushCenterView, VIEW_TYPE_PUSH_CENTER } from './src/ui/PushCenterView';
import { StoredPush, StoredPushMessage } from './src/pushTypes';

interface MemoAISettings {
	llmApiKey: string;
	llmApiBase: string;
	llmModel: string;
	llmTimeout: number; // Timeout in seconds
	pushMaxActive: number;
	pushDueHours: number;
	pushScoreThreshold: number;
}

interface PluginData {
	settings?: Partial<MemoAISettings>;
	chunks?: [string, Chunk][];
	pushes?: Record<string, StoredPush>;
	pushMessages?: StoredPushMessage[];
}

const DEFAULT_SETTINGS: MemoAISettings = {
	llmApiKey: '',
	llmApiBase: 'https://api.openai.com/v1',
	llmModel: 'gpt-3.5-turbo',
	llmTimeout: 60, // Default 60 seconds
	pushMaxActive: 5,
	pushDueHours: 24,
	pushScoreThreshold: 2
}

export default class MemoAIPlugin extends Plugin {
	settings: MemoAISettings;
	private dataStore: PluginData = {};
	chunkManager: ChunkManager;
	pushManager: PushManager;

	async onload() {
		await this.loadSettings();

		// Initialize managers
		this.chunkManager = new ChunkManager(this);
		this.pushManager = new PushManager(this, this.chunkManager);
		
		// Clean up chunks for deleted notes after pushManager is initialized
		await this.chunkManager.cleanupDeletedNotes();

		// Register views
		this.registerView(
			VIEW_TYPE_NOTE_CHUNKS,
			(leaf) => new NoteChunksView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_PUSH_CENTER,
			(leaf) => new PushCenterView(leaf, this)
		);

		// Add commands
		this.addCommand({
			id: 'extract-chunks',
			name: 'Extract chunks from current note',
			callback: () => {
				void this.chunkManager.extractChunksFromActiveNote();
			}
		});

		this.addCommand({
			id: 'open-note-chunks',
			name: 'View chunks for current note',
			callback: () => {
				void this.activateNoteChunksView();
			}
		});

		this.addCommand({
			id: 'open-push-center',
			name: 'Open push center',
			callback: () => {
				void this.activatePushCenterView();
			}
		});

		// Add settings tab
		this.addSettingTab(new MemoAISettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			void this.activatePushCenterView();
		});
	}

	onunload() {
		// Don't detach leaves here, as that would reset their positions
		// when the plugin is reloaded, even if the user has moved them.
	}

	async loadSettings() {
		const stored = await this.loadData();
		this.dataStore = stored || {};

		const legacySettings = (this.dataStore.settings)
			? this.dataStore.settings
			: stored || {};

		this.settings = Object.assign({}, DEFAULT_SETTINGS, legacySettings);
		this.dataStore.settings = this.settings;
		await this.saveData(this.dataStore);
	}

	async saveSettings() {
		this.dataStore.settings = this.settings;
		await this.saveData(this.dataStore);
	}

	async activateNoteChunksView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_NOTE_CHUNKS)[0];
		
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE_NOTE_CHUNKS, active: true });
		}
		
		void workspace.revealLeaf(leaf);
	}

	async activatePushCenterView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_PUSH_CENTER)[0];
		
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE_PUSH_CENTER, active: true });
		}
		
		await workspace.revealLeaf(leaf);
	}

	async openFileAtPath(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf(true).openFile(file);
		} else {
			new Notice(`File not found: ${path}`);
		}
	}

	getStoredChunkEntries(): [string, Chunk][] {
		return this.dataStore.chunks ?? [];
	}

	async persistChunks(chunks: Map<string, Chunk>) {
		this.dataStore.chunks = Array.from(chunks.entries());
		await this.saveData(this.dataStore);
	}

	getStoredPushes(): Record<string, StoredPush> {
		return this.dataStore.pushes ?? {};
	}

	getStoredPushMessages(): StoredPushMessage[] {
		return this.dataStore.pushMessages ?? [];
	}

	async persistPushes(pushes: Record<string, StoredPush>, messages: StoredPushMessage[]) {
		this.dataStore.pushes = pushes;
		this.dataStore.pushMessages = messages;
		await this.saveData(this.dataStore);
	}
}

class MemoAISettingTab extends PluginSettingTab {
	plugin: MemoAIPlugin;

	constructor(app: App, plugin: MemoAIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('LLM Settings')
			.setHeading();
		
		new Setting(containerEl)
			.setName('')
			.setDesc('Chunks are extracted using LLM (AI). Configure your LLM API settings below.');

		new Setting(containerEl)
			.setName('LLM API Key')
			.setDesc('Your OpenAI API key (or compatible API key)')
			.addText(text => {
				text.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.llmApiKey);
				text.inputEl.type = 'password';
				text.onChange(async (value) => {
					this.plugin.settings.llmApiKey = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('LLM API Base URL')
			.setDesc('API base URL (default: OpenAI)')
			.addText(text => text
				.setPlaceholder('https://api.openai.com/v1')
				.setValue(this.plugin.settings.llmApiBase)
				.onChange(async (value) => {
					this.plugin.settings.llmApiBase = value || 'https://api.openai.com/v1';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('LLM Model')
			.setDesc('Model name to use (e.g., gpt-3.5-turbo, gpt-4)')
			.addText(text => text
				.setPlaceholder('gpt-3.5-turbo')
				.setValue(this.plugin.settings.llmModel)
				.onChange(async (value) => {
					this.plugin.settings.llmModel = value || 'gpt-3.5-turbo';
					await this.plugin.saveSettings();
				}));
				new Setting(containerEl)
				.setName('LLM request timeout (seconds)')
				.setDesc('Timeout for LLM API requests in seconds')
				.addSlider(slider => slider
					.setLimits(10, 300, 10)
					.setValue(this.plugin.settings.llmTimeout || 60)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.llmTimeout = value;
						await this.plugin.saveSettings();
					}));

		new Setting(containerEl)
			.setName('Push Settings')
			.setHeading();

		new Setting(containerEl)
			.setName('Max active pushes')
			.setDesc('How many pushes is allowed to be active at the same time')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.pushMaxActive || 5)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.pushMaxActive = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Push due window (hours)')
			.setDesc('The duration of a push in hours, after which it will be expired and deleted when refreshing pushes')
			.addSlider(slider => slider
				.setLimits(1, 168, 1)
				.setValue(this.plugin.settings.pushDueHours || 24)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.pushDueHours = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Push score threshold')
			.setDesc('Minimum score required for a chunk to be recommended, which corresponds to the chunk score required for a chunk to be recommended')
			.addSlider(slider => slider
				.setLimits(2, 6, 0.5)
				.setValue(this.plugin.settings.pushScoreThreshold || 2)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.pushScoreThreshold = value;
					await this.plugin.saveSettings();
				}));

		
	}
}

