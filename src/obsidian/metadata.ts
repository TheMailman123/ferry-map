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

import type { CachedMetadata } from "obsidian";
import {
    GeoTagExtraction,
    MetadataLike,
    extractGeoTags,
} from "../core/geotags";

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
