/**
 * Deciding what a note's pins look like: shown or hidden, and in what colour.
 *
 * The filter and the colour groups are separate questions with separate
 * queries, but they are asked about the same note at the same moment, so they
 * are answered together here.
 */

import { NoteDoc, Query, matches, parseQuery } from "./query";

/** A colour group as it is stored in settings and edited in the panel. */
export interface ColourGroup {
    query: string;
    /** Any CSS colour. Written straight into a custom property on the pin. */
    colour: string;
}

/** A colour group with its query parsed, ready to be asked about many notes. */
export interface CompiledGroup {
    /** Null for a group whose query is empty, which colours nothing. */
    query: Query | null;
    colour: string;
}

/** How a note's pins should be drawn. */
export interface NoteStyle {
    /** True when the filter excludes the note, so its pins are not drawn. */
    hidden: boolean;
    /** The colour of the first group that matched, or null for the default. */
    colour: string | null;
}

const VISIBLE: NoteStyle = { hidden: false, colour: null };

/** Parse each group's query once, rather than once per note. */
export function compileGroups(groups: readonly ColourGroup[]): CompiledGroup[] {
    return groups.map((group) => ({
        query: parseQuery(group.query),
        colour: group.colour,
    }));
}

/**
 * The colour a note takes from the group list.
 *
 * Where several groups match, the **topmost wins** and the rest are ignored —
 * the list is a priority order, not a series of overrides. This is the
 * behaviour the user asked for and graph view's own.
 *
 * A group with an empty query colours nothing. An empty *filter* means "no
 * filter", but an empty *group* is one the user has only just added and not yet
 * told what to match, and painting the whole map in its colour would be a
 * surprising answer to having pressed a button.
 *
 * @returns the winning group's colour, or null when none matched
 */
export function colourFor(
    doc: NoteDoc,
    groups: readonly CompiledGroup[]
): string | null {
    for (const group of groups) {
        if (group.query && matches(group.query, doc)) return group.colour;
    }

    return null;
}

/**
 * Build the function the marker layer uses to style one note's pins.
 *
 * Answers are memoised by path because a note carrying ten geotags asks the
 * same question ten times, and the answer cannot change within one draw. The
 * memo lives for that draw only, so an edited query is never answered from a
 * stale cache.
 *
 * @param docFor the note at a path. Called at most once per path.
 * @param filter the filter query, or null to show every note
 * @param groups the colour groups, in priority order
 */
export function noteStyler(
    docFor: (path: string) => NoteDoc,
    filter: Query | null,
    groups: readonly CompiledGroup[]
): (path: string) => NoteStyle {
    // Nothing to ask: skip the lookups entirely, which is the common case of a
    // map with no controls set.
    if (filter === null && groups.length === 0) return () => VISIBLE;

    const seen = new Map<string, NoteStyle>();

    return (path: string): NoteStyle => {
        const known = seen.get(path);
        if (known) return known;

        const doc = docFor(path);
        const hidden = filter !== null && !matches(filter, doc);
        // A hidden note is not drawn, so its colour is never asked for.
        const style: NoteStyle = {
            hidden,
            colour: hidden ? null : colourFor(doc, groups),
        };

        seen.set(path, style);
        return style;
    };
}
