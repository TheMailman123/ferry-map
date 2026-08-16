/**
 * The narrow surface this plugin uses to talk to Obsidian.
 *
 * Everything that touches `App` lives here, so the rest of the plugin can be
 * reasoned about — and tested — without the app being present.
 */

import { App, CachedMetadata, TFile, WorkspaceLeaf } from "obsidian";

export interface ObsidianInterface {
    /** Every markdown note in the vault. */
    markdownFiles(): TFile[];
    /** A note's cached metadata, or null if Obsidian has not indexed it yet. */
    metadata(file: TFile): CachedMetadata | null;
    /** Reveal a note, scrolling to a line where one is given. */
    openNote(path: string, line: number | null): Promise<void>;
}

export class ObsidianIO implements ObsidianInterface {
    constructor(private readonly app: App) {}

    markdownFiles(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    metadata(file: TFile): CachedMetadata | null {
        return this.app.metadataCache.getFileCache(file);
    }

    /**
     * Open a note from a pin.
     *
     * @param line zero-based line to scroll to, or null for the top of the note
     * @throws if the path no longer resolves to a note — a pin pointing at a
     *   file that has been deleted is a bug in the index, not something to
     *   paper over by doing nothing
     */
    async openNote(path: string, line: number | null): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            throw new Error(`Map pin refers to a missing note: ${path}`);
        }

        const leaf = this.leafForNotes();
        // eState is how Obsidian's own link handling scrolls to a line.
        await leaf.openFile(
            file,
            line !== null ? { eState: { line } } : undefined
        );
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }

    /**
     * Where a note opened from the map should go.
     *
     * Reuses an existing markdown tab so repeatedly clicking pins does not bury
     * the workspace in tabs, and never returns the map's own leaf — opening a
     * note into it would replace the map the user just clicked.
     */
    private leafForNotes(): WorkspaceLeaf {
        const existing = this.app.workspace.getLeavesOfType("markdown");
        return existing.length > 0
            ? existing[0]
            : this.app.workspace.getLeaf("tab");
    }
}
