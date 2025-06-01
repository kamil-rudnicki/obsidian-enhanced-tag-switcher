import { App, Editor, MarkdownView, Plugin, EditorPosition, SuggestModal, PluginSettingTab, Setting } from 'obsidian';

interface MyPluginSettings {
	recentlyChosenTags: string[];
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	recentlyChosenTags: []
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new EnhancedTagSwitcherSettingTab(this.app, this));

		// Custom tag click handler - intercepts tag clicks to show tag selector
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			
			// Check if the clicked element is a tag
			if (this.isTagElement(target)) {
				evt.preventDefault();
				evt.stopPropagation();
				
				this.handleTagClick(target);
				return;
			}
		});
	}

	/**
	 * Check if an element is a tag
	 */
	private isTagElement(element: HTMLElement): boolean {
		// Check for various ways tags can be represented in Obsidian
		const isTag = element.classList.contains('tag') || 
					  element.classList.contains('cm-hashtag') ||
					  (element.tagName === 'A' && element.getAttribute('href')?.startsWith('#')) ||
					  element.hasAttribute('data-tag');
		
		return isTag;
	}

	/**
	 * Handle tag click to show tag selector dropdown
	 */
	private handleTagClick(tagElement: HTMLElement): void {
		// Get the current active editor
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		
		// Find the tag text in the editor
		const line = editor.getLine(cursor.line);
		const tagMatch = line.match(/#[\w\/-]+/g);
		
		if (tagMatch) {
			// Find which tag was clicked by position
			let tagStart = -1;
			let tagEnd = -1;
			let searchFrom = 0;
			
			for (const tag of tagMatch) {
				const tagIndex = line.indexOf(tag, searchFrom);
				if (tagIndex !== -1) {
					const tagStartPos = tagIndex;
					const tagEndPos = tagIndex + tag.length;
					
					// Check if cursor is within this tag range
					if (cursor.ch >= tagStartPos && cursor.ch <= tagEndPos) {
						tagStart = tagStartPos;
						tagEnd = tagEndPos;
						break;
					}
					searchFrom = tagEndPos;
				}
			}
			
			// If we found the tag, show tag selector
			if (tagStart !== -1 && tagEnd !== -1) {
				const tagPosition = {
					from: { line: cursor.line, ch: tagStart },
					to: { line: cursor.line, ch: tagEnd }
				};
				
				// Show tag selector modal
				new TagSelectorModal(this.app, editor, tagPosition, this).open();
			}
		} else {
			// Fallback: try to find tag pattern around cursor
			const tagPattern = /#[\w\/-]*/;
			const match = line.match(tagPattern);
			
			if (match && match.index !== undefined) {
				const tagPosition = {
					from: { line: cursor.line, ch: match.index },
					to: { line: cursor.line, ch: match.index + match[0].length }
				};
				
				// Show tag selector modal
				new TagSelectorModal(this.app, editor, tagPosition, this).open();
			}
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

interface TagPosition {
	from: EditorPosition;
	to: EditorPosition;
}

class TagSelectorModal extends SuggestModal<string> {
	private editor: Editor;
	private tagPosition: TagPosition;
	private allTags: string[];
	private plugin: MyPlugin;

	constructor(app: App, editor: Editor, tagPosition: TagPosition, plugin: MyPlugin) {
		super(app);
		this.editor = editor;
		this.tagPosition = tagPosition;
		this.allTags = [];
		this.plugin = plugin;
		this.loadAllTags();
		
		// Set placeholder text
		this.setPlaceholder('Type to search tags...');
	}

	/**
	 * Load all tags from the vault using getTags API
	 */
	private loadAllTags(): void {
		// Get all tags from the vault using getTags (undocumented but working method)
		const allTagsObject = (this.app.metadataCache as any).getTags();
		
		// Convert object to array
		const allVaultTags = allTagsObject ? Object.keys(allTagsObject)
			.map(tag => tag.startsWith('#') ? tag : `#${tag}`) : [];
		
		// Get recently chosen tags
		const recentTags = this.plugin.settings.recentlyChosenTags.slice().reverse(); // Most recent first
		
		// Create set of all vault tags for quick lookup
		const vaultTagSet = new Set(allVaultTags);
		
		// Filter recent tags to only include those that still exist in vault
		const validRecentTags = recentTags.filter(tag => vaultTagSet.has(tag));
		
		// Get remaining tags (not in recent) and sort alphabetically
		const remainingTags = allVaultTags
			.filter(tag => !validRecentTags.includes(tag))
			.sort((a, b) => a.localeCompare(b));
		
		// Combine: recent tags first, then alphabetical
		this.allTags = [...validRecentTags, ...remainingTags];
		
		// Add clear option at the beginning
		this.allTags.unshift('CLEAR_TAG');
	}

	getSuggestions(query: string): string[] {
		const queryLower = query.toLowerCase();
		
		// If query is empty, return all tags
		if (!query) {
			return this.allTags;
		}
		
		// Filter tags based on query (excluding CLEAR_TAG from search)
		const filteredTags = this.allTags.filter(tag => 
			tag !== 'CLEAR_TAG' && tag.toLowerCase().includes(queryLower)
		);
		
		// If query matches "clear" or similar, include CLEAR_TAG option
		if ('clear'.includes(queryLower) || 'remove'.includes(queryLower) || 'delete'.includes(queryLower)) {
			return ['CLEAR_TAG', ...filteredTags];
		}
		
		return filteredTags;
	}

	renderSuggestion(tag: string, el: HTMLElement) {
		if (tag === 'CLEAR_TAG') {
			el.createEl("div", { text: "🗑️ Clear tag" });
		} else {
			// Show recent indicator for recently chosen tags
			const isRecent = this.plugin.settings.recentlyChosenTags.includes(tag);
			const displayText = isRecent ? `⭐ ${tag}` : tag;
			el.createEl("div", { text: displayText });
		}
	}

	onChooseSuggestion(tag: string, evt: MouseEvent | KeyboardEvent) {
		if (tag === 'CLEAR_TAG') {
			// Completely remove the tag (no # left behind)
			this.editor.replaceRange('', this.tagPosition.from, this.tagPosition.to);
			
			// Position cursor at the start of where the tag was
			this.editor.setCursor(this.tagPosition.from);
		} else {
			// Replace the tag at the specified position
			this.editor.replaceRange(tag, this.tagPosition.from, this.tagPosition.to);
			
			// Position cursor after the new tag
			const newCursorPos = { 
				line: this.tagPosition.from.line, 
				ch: this.tagPosition.from.ch + tag.length 
			};
			this.editor.setCursor(newCursorPos);
			
			// Update recently chosen tags
			this.updateRecentlyChosenTags(tag);
		}
	}

	/**
	 * Update the recently chosen tags list
	 */
	private updateRecentlyChosenTags(tag: string): void {
		const recentTags = this.plugin.settings.recentlyChosenTags;
		
		// Remove tag if it already exists (to avoid duplicates)
		const existingIndex = recentTags.indexOf(tag);
		if (existingIndex > -1) {
			recentTags.splice(existingIndex, 1);
		}
		
		// Add tag to the end (most recent)
		recentTags.push(tag);
		
		// Keep only last 20 tags to prevent unlimited growth
		if (recentTags.length > 20) {
			recentTags.shift();
		}
		
		// Save settings immediately to persist across restarts
		this.plugin.saveSettings();
	}
}

class EnhancedTagSwitcherSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Enhanced Tag Switcher Settings' });

		// Recently used tags count display
		new Setting(containerEl)
			.setName('Recently used tags')
			.setDesc(`Currently tracking ${this.plugin.settings.recentlyChosenTags.length} recently used tags`)
			.addButton(button => button
				.setButtonText('Clear recently used tags')
				.setTooltip('Clear the list of recently used tags')
				.onClick(async () => {
					this.plugin.settings.recentlyChosenTags = [];
					await this.plugin.saveSettings();
					this.display(); // Refresh the settings display
				}));
	}
}
