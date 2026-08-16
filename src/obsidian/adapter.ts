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
    /**
     * Reveal a note, scrolling to a line where one is given.
     *
     * @param beside the leaf the request came from; the note opens next to it
     */
    openNote(
        path: string,
        line: number | null,
        beside: WorkspaceLeaf | null
    ): Promise<void>;
}

export class ObsidianIO implements ObsidianInterface {
    /** The pane notes opened from the map are shown in, reused across clicks. */
    private noteLeaf: WorkspaceLeaf | null = null;

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
    async openNote(
        path: string,
        line: number | null,
        beside: WorkspaceLeaf | null
    ): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            throw new Error(`Map pin refers to a missing note: ${path}`);
        }

        const leaf = this.leafForNotes(beside);
        // eState is how Obsidian's own link handling scrolls to a line.
        await leaf.openFile(
            file,
            line !== null ? { eState: { line } } : undefined
        );
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }

    /**
     * Where a note opened from the map should go: immediately to the right of
     * the map, never in whichever markdown pane happens to be open elsewhere.
     *
     * The pane is created once and reused, so clicking pin after pin does not
     * bury the workspace in tabs. Reuse is conditional on the leaf still being
     * in the workspace, since the user may have closed it since.
     */
    private leafForNotes(beside: WorkspaceLeaf | null): WorkspaceLeaf {
        if (this.noteLeaf && this.isOpen(this.noteLeaf)) return this.noteLeaf;

        this.noteLeaf = beside
            ? this.app.workspace.createLeafBySplit(beside, "vertical", false)
            : this.app.workspace.getLeaf("tab");

        return this.noteLeaf;
    }

    private isOpen(leaf: WorkspaceLeaf): boolean {
        let open = false;
        this.app.workspace.iterateAllLeaves((candidate) => {
            if (candidate === leaf) open = true;
        });
        return open;
    }
}
