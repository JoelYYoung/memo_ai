import { ItemView, WorkspaceLeaf } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import { StrictMode, ReactElement } from 'react';

export abstract class ReactView extends ItemView {
	protected reactRoot: Root | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('ai-notebook-react-view');
		
		// Create React root
		this.reactRoot = createRoot(container);
		this.renderReact();
	}

	async onClose(): Promise<void> {
		if (this.reactRoot) {
			this.reactRoot.unmount();
			this.reactRoot = null;
		}
	}

	abstract renderReact(): void;

	protected renderComponent(element: ReactElement) {
		if (this.reactRoot) {
			this.reactRoot.render(
				<StrictMode>
					{element}
				</StrictMode>
			);
		}
	}
}

