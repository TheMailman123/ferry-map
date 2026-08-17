/**
 * The vault's geotags, kept current and observable.
 *
 * Owns the index, does the initial scan, applies incremental updates as notes
 * change, and tells the view when anything moved. The view never reads the
 * vault itself.
 */

import type { TFile } from "obsidian";
import { GeoIndex } from "../core/geo_index";
import { GeoTag, GeoTagProblem, isEmpty } from "../core/geotags";
import { noteName } from "../core/labels";
import { NoteDoc } from "../core/query";
import type { ObsidianInterface } from "./adapter";
import { docFromCache, extractFromCache } from "./metadata";

export type StoreListener = () => void;

/** Defers work to the next frame. Replaceable so tests can drive it directly. */
export type Scheduler = (run: () => void) => void;

const nextFrame: Scheduler = (run) => window.requestAnimationFrame(run);

export class GeoStore {
    private readonly index = new GeoIndex();
    /**
     * What the filter and group queries need to know about each indexed note,
     * captured from the same metadata read that produced its geotags.
     *
     * Only notes the index holds get an entry, and the two are updated
     * together, so a path with pins always has a doc to match against.
     */
    private readonly docs = new Map<string, NoteDoc>();
    private readonly listeners = new Set<StoreListener>();
    private notifyScheduled = false;

    constructor(
        private readonly obsidian: ObsidianInterface,
        private readonly schedule: Scheduler = nextFrame
    ) {}

    /**
     * Index every note in the vault, replacing whatever was held before.
     *
     * Callers should defer this until the workspace is ready: during `onload`
     * the metadata cache is still filling, and notes read too early come back
     * with no links at all.
     */
    scanVault(): void {
        this.index.clear();
        this.docs.clear();

        for (const file of this.obsidian.markdownFiles()) {
            this.ingest(file);
        }

        this.notify();
    }

    /** Re-read one note. Used when Obsidian reports its metadata changed. */
    updateNote(file: TFile): void {
        this.ingest(file);
        this.notify();
    }

    /** Forget a note. Harmless for notes that held no geotags. */
    removeNote(path: string): void {
        this.index.remove(path);
        this.docs.delete(path);
        this.notify();
    }

    /**
     * Forget every note beneath a folder.
     *
     * Obsidian does not reliably raise a separate event per note when a folder
     * is deleted, so the folder's contents are swept here rather than assumed
     * to arrive one by one.
     */
    removeUnder(folder: string): void {
        const prefix = `${folder}/`;
        for (const path of this.index.paths()) {
            if (!path.startsWith(prefix)) continue;

            this.index.remove(path);
            this.docs.delete(path);
        }

        this.notify();
    }

    /**
     * Move everything indexed under `from` to `to`.
     *
     * Handles a renamed note and a renamed *folder* with the same code: a
     * folder rename moves every note beneath it, and Obsidian does not
     * re-index those notes, so without the prefix sweep every pin under that
     * folder would keep pointing at a path that no longer exists and fail on
     * click.
     */
    renamePath(from: string, to: string): void {
        this.index.rename(from, to);
        this.moveDoc(from, to);

        const prefix = `${from}/`;
        for (const path of this.index.paths()) {
            if (path.startsWith(prefix)) {
                const moved = `${to}/${path.slice(prefix.length)}`;
                this.index.rename(path, moved);
                this.moveDoc(path, moved);
            }
        }

        this.notify();
    }

    tags(): GeoTag[] {
        return this.index.tags();
    }

    problems(): GeoTagProblem[] {
        return this.index.problems();
    }

    /**
     * The note behind a path, for the filter and group queries to match.
     *
     * @throws if the path is not indexed. Every pin comes from an indexed note,
     *   so being asked about one that is not is a bug in the index rather than
     *   a note that happens to have no tags — and a note silently treated as
     *   untagged would be filtered out with no way to tell why.
     */
    doc(path: string): NoteDoc {
        const doc = this.docs.get(path);
        if (!doc) throw new Error(`No note is indexed at ${path}.`);
        return doc;
    }

    /** Subscribe to changes. Returns the unsubscribe function. */
    onChange(listener: StoreListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Read one note into the index and the doc map.
     *
     * The cache is read once and used for both, so a note's geotags and the
     * tags it is filtered by can never come from different moments in time.
     */
    private ingest(file: TFile): void {
        const cache = this.obsidian.metadata(file);
        const extraction = extractFromCache(file.path, cache);

        this.index.set(file.path, extraction);

        // The index drops notes with nothing in them, and the docs follow it:
        // a note with no geotags has no pins to filter or colour.
        if (isEmpty(extraction)) this.docs.delete(file.path);
        else this.docs.set(file.path, docFromCache(file.path, cache));
    }

    /**
     * Move a doc to a new path.
     *
     * The tags are carried over rather than re-read: a rename does not change
     * them, and Obsidian does not re-index the note to let us read them again.
     * The name, on the other hand, is part of the path and has to be re-derived
     * or `file:` queries would keep matching the old one.
     */
    private moveDoc(from: string, to: string): void {
        const doc = this.docs.get(from);
        if (!doc) return;

        this.docs.delete(from);
        this.docs.set(to, { ...doc, path: to, basename: noteName(to) });
    }

    /**
     * Tell listeners something changed, at most once per frame.
     *
     * Typing into a note fires a metadata change per keystroke pause, and each
     * would otherwise re-cluster and redraw every pin on the map.
     */
    private notify(): void {
        if (this.notifyScheduled) return;
        this.notifyScheduled = true;

        this.schedule(() => {
            this.notifyScheduled = false;
            for (const listener of this.listeners) listener();
        });
    }
}
