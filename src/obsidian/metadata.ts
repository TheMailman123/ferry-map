/**
 * The seam between Obsidian's metadata cache and the Obsidian-free extraction
 * in `core/`.
 *
 * `core/geotags.ts` describes the cache shape it needs structurally
 * (`MetadataLike`) rather than importing Obsidian, so it can be unit-tested
 * outside the app. That leaves a gap: nothing would notice if Obsidian's
 * typings drifted away from that structural description, and the mismatch would
 * surface as a runtime failure in the app rather than a compile error here.
 *
 * The assignment below closes it. It is erased at build time and exists purely
 * so `tsc` fails if a real `CachedMetadata` ever stops satisfying
 * `MetadataLike`.
 */

import { CachedMetadata, getAllTags } from "obsidian";
import {
    GeoTagExtraction,
    MetadataLike,
    extractGeoTags,
} from "../core/geotags";
import { noteName } from "../core/labels";
import { NoteDoc } from "../core/query";

/** Compile-time guard. See the module comment. */
const _cacheSatisfiesMetadataLike: (c: CachedMetadata) => MetadataLike = (c) =>
    c;
void _cacheSatisfiesMetadataLike;

/**
 * Extract a note's geotags from its cached metadata.
 *
 * @param path vault path of the note
 * @param cache the note's metadata, or null when Obsidian has not indexed it yet
 */
export function extractFromCache(
    path: string,
    cache: CachedMetadata | null
): GeoTagExtraction {
    return extractGeoTags(path, cache);
}

/**
 * Describe a note the way the filter and group queries need to see it.
 *
 * Tags come from `getAllTags`, which is Obsidian's own union of body tags and
 * the frontmatter `tags` property — the latter of which has several accepted
 * spellings that are not worth reimplementing.
 *
 * @param path vault path of the note
 * @param cache the note's metadata, or null when Obsidian has not indexed it
 *   yet, which yields a note with no tags rather than an error
 */
export function docFromCache(
    path: string,
    cache: CachedMetadata | null
): NoteDoc {
    return {
        path,
        basename: noteName(path),
        tags: cache ? getAllTags(cache) ?? [] : [],
    };
}
