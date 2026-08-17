/**
 * The vault's geotags, kept current and observable.
 *
 * Owns the index, does the initial scan, applies incremental updates as notes
 * change, and tells the view when anything moved. The view never reads the
 * vault itself.
 */

import type { TFile } from "obsidian";
import { GeoIndex } from "../core/geo_index";
import { GeoTag, GeoTagProblem } from "../core/geotags";
import type { ObsidianInterface } from "./adapter";
import { extractFromCache } from "./metadata";

export type StoreListener = () => void;

/** Defers work to the next frame. Replaceable so tests can drive it directly. */
export type Scheduler = (run: () => void) => void;

const nextFrame: Scheduler = (run) => window.requestAnimationFrame(run);

export class GeoStore {
    private readonly index = new GeoIndex();
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

        for (const file of this.obsidian.markdownFiles()) {
            this.index.set(file.path, this.extract(file));
        }

        this.notify();
    }

    /** Re-read one note. Used when Obsidian reports its metadata changed. */
    updateNote(file: TFile): void {
        this.index.set(file.path, this.extract(file));
        this.notify();
    }

    /** Forget a note. Harmless for notes that held no geotags. */
    removeNote(path: string): void {
        this.index.remove(path);
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
            if (path.startsWith(prefix)) this.index.remove(path);
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

        const prefix = `${from}/`;
        for (const path of this.index.paths()) {
            if (path.startsWith(prefix)) {
                this.index.rename(path, `${to}/${path.slice(prefix.length)}`);
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

    /** Subscribe to changes. Returns the unsubscribe function. */
    onChange(listener: StoreListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private extract(file: TFile) {
        return extractFromCache(file.path, this.obsidian.metadata(file));
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
