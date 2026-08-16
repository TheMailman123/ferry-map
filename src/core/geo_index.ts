/**
 * The vault's geotags, held by note path.
 *
 * The map renders from this index rather than from the vault directly, so a
 * single note changing costs one re-extraction and not a full rescan.
 */

import { GeoTag, GeoTagExtraction, GeoTagProblem, isEmpty } from "./geotags";

export class GeoIndex {
    /**
     * Only notes that actually carry a geotag or a problem get an entry.
     * Keeping empty entries would make the index grow with the vault rather
     * than with its geotags, for no benefit.
     */
    private readonly entries = new Map<string, GeoTagExtraction>();

    /**
     * Record a note's extraction, replacing anything previously held for it.
     * An extraction with nothing in it removes the note from the index.
     */
    set(path: string, extraction: GeoTagExtraction): void {
        assertPath(path);

        if (isEmpty(extraction)) {
            this.entries.delete(path);
            return;
        }

        this.entries.set(path, extraction);
    }

    /** Forget a note. Deleting a note that holds no geotags is not an error. */
    remove(path: string): void {
        assertPath(path);
        this.entries.delete(path);
    }

    /**
     * Move a note's entry to a new path, rewriting the `path` stamped on its
     * tags and problems.
     *
     * Renaming re-keys rather than re-extracting because a note's geotags do
     * not depend on its filename. Obsidian does not fire a metadata `changed`
     * event on rename, so without this the index would silently keep pointing
     * at the old path.
     */
    rename(from: string, to: string): void {
        assertPath(from);
        assertPath(to);

        const extraction = this.entries.get(from);
        // Untracked notes are the common case — most notes carry no geotags.
        if (!extraction) return;

        this.entries.delete(from);
        this.entries.set(to, {
            tags: extraction.tags.map((tag) => ({ ...tag, path: to })),
            problems: extraction.problems.map((problem) => ({
                ...problem,
                path: to,
            })),
        });
    }

    /** What is held for one note, if anything. */
    get(path: string): GeoTagExtraction | undefined {
        return this.entries.get(path);
    }

    /** Every geotag in the vault, grouped by note in insertion order. */
    tags(): GeoTag[] {
        return this.flatten((entry) => entry.tags);
    }

    /** Every unusable geotag in the vault. */
    problems(): GeoTagProblem[] {
        return this.flatten((entry) => entry.problems);
    }

    /** Number of notes holding at least one geotag or problem. */
    get noteCount(): number {
        return this.entries.size;
    }

    clear(): void {
        this.entries.clear();
    }

    private flatten<T>(pick: (entry: GeoTagExtraction) => T[]): T[] {
        const all: T[] = [];
        for (const entry of this.entries.values()) all.push(...pick(entry));
        return all;
    }
}

function assertPath(path: string): void {
    if (!path) throw new Error("GeoIndex requires a non-empty note path.");
}
