/**
 * The vault's geotags, kept current and observable.
 *
 * Owns the index, does the initial scan, and tells the view when anything
 * changed. The view never reads the vault itself.
 */

import { GeoIndex } from "../core/geo_index";
import { GeoTag, GeoTagProblem } from "../core/geotags";
import { ObsidianInterface } from "./adapter";
import { extractFromCache } from "./metadata";

export type StoreListener = () => void;

export class GeoStore {
    private readonly index = new GeoIndex();
    private readonly listeners = new Set<StoreListener>();

    constructor(private readonly obsidian: ObsidianInterface) {}

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
            this.index.set(
                file.path,
                extractFromCache(file.path, this.obsidian.metadata(file))
            );
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

    private notify(): void {
        for (const listener of this.listeners) listener();
    }
}
