/**
 * Turning a note's cached link metadata into geotags.
 *
 * Obsidian already parses every internal link in every note, in the body
 * (`CachedMetadata.links`) and in properties (`CachedMetadata.frontmatterLinks`).
 * Both are the same `Reference` shape, so extraction is one loop over two
 * arrays — no markdown parsing and no file reads anywhere in this plugin.
 */

import { Coordinate, parseCoordinate } from "./coordinates";

/** Where in a note a geotag was written. */
export type GeoTagSource = "body" | "property";

/** A usable geotag found in a note. */
export interface GeoTag {
    coordinate: Coordinate;
    /**
     * The link's alias, when it had one. Supersedes the note name as the pin's
     * label. The label itself is not stored: deriving it at render time means a
     * note rename does not require re-extracting anything.
     */
    alias: string | null;
    /** Vault path of the note the geotag was found in. */
    path: string;
    source: GeoTagSource;
    /** Property key, when {@link source} is `"property"`. */
    key: string | null;
    /** Zero-based line in the body, for navigation. Null for properties. */
    line: number | null;
}

/** A link that was geotag-shaped but unusable. Surfaced, never dropped. */
export interface GeoTagProblem {
    path: string;
    /** The link target exactly as written, so the user can find it. */
    raw: string;
    reason: string;
    source: GeoTagSource;
    key: string | null;
    line: number | null;
}

export interface GeoTagExtraction {
    tags: GeoTag[];
    problems: GeoTagProblem[];
}

/**
 * The subset of Obsidian's `CachedMetadata` that extraction reads.
 *
 * Declared structurally rather than imported so this module — and its tests —
 * stay free of the `obsidian` module, which only exists inside the app. A real
 * `CachedMetadata` is assignable to it.
 */
export interface MetadataLike {
    links?: ReadonlyArray<{
        link: string;
        displayText?: string;
        position?: { start: { line: number } };
    }>;
    frontmatterLinks?: ReadonlyArray<{
        link: string;
        displayText?: string;
        key?: string;
    }>;
}

/**
 * Extract every geotag, and every failed attempt at one, from a note's cache.
 *
 * @param path vault path of the note, stamped onto each result
 * @param metadata the note's cached metadata; null when Obsidian has not
 *   indexed the file yet, which yields an empty result rather than an error
 */
export function extractGeoTags(
    path: string,
    metadata: MetadataLike | null | undefined
): GeoTagExtraction {
    const tags: GeoTag[] = [];
    const problems: GeoTagProblem[] = [];

    if (!metadata) return { tags, problems };

    const consider = (
        link: string,
        alias: string | null,
        source: GeoTagSource,
        key: string | null,
        line: number | null
    ): void => {
        const parsed = parseCoordinate(link);

        if (parsed.kind === "coordinate") {
            tags.push({
                coordinate: parsed.coordinate,
                alias,
                path,
                source,
                key,
                line,
            });
        } else if (parsed.kind === "malformed") {
            problems.push({
                path,
                raw: link,
                reason: parsed.reason,
                source,
                key,
                line,
            });
        }
        // "not-a-geotag" is an ordinary note link. Nothing to record.
    };

    for (const ref of metadata.links ?? []) {
        consider(
            ref.link,
            aliasOf(ref),
            "body",
            null,
            ref.position?.start.line ?? null
        );
    }

    for (const ref of metadata.frontmatterLinks ?? []) {
        consider(ref.link, aliasOf(ref), "property", ref.key ?? null, null);
    }

    return { tags, problems };
}

/** True when an extraction found nothing worth remembering about a note. */
export function isEmpty(extraction: GeoTagExtraction): boolean {
    return extraction.tags.length === 0 && extraction.problems.length === 0;
}

/**
 * A link's alias, or null when it has none.
 *
 * Obsidian populates `displayText` for unaliased links too, setting it equal to
 * the link target, so presence alone does not imply an alias.
 */
function aliasOf(ref: { link: string; displayText?: string }): string | null {
    const { displayText, link } = ref;
    return displayText && displayText !== link ? displayText : null;
}
