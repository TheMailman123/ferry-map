/**
 * Finding the section of a note a geotag was written in.
 *
 * A note's name says which trip a pin belongs to; the heading above it says
 * which part of that trip. Obsidian's cache already lists every heading with
 * the line it starts on, and every body geotag knows its own line, so the
 * enclosing section is a lookup rather than anything that needs the file read.
 */

/**
 * The subset of Obsidian's `HeadingCache` this needs.
 *
 * Declared structurally for the same reason as `MetadataLike`: `core/` stays
 * free of the `obsidian` module. A real `HeadingCache` is assignable to it.
 */
export interface HeadingLike {
    /** The heading's text, without its leading hashes. */
    heading: string;
    /** 1 for `#`, 2 for `##`, and so on. */
    level: number;
    position: { start: { line: number } };
}

/**
 * The headings enclosing a line, outermost first.
 *
 * A geotag written under `### Morning`, itself under `## Day 2`, is in both
 * sections, so both are reported: naming only the nearest would leave "Morning"
 * to stand alone, which says nothing.
 *
 * A geotag on a heading's own line — `## [[58.6276, -4.9997]]` — belongs to
 * that heading rather than to the section above it.
 *
 * Empty headings (`##` with no text) are dropped from the trail after the
 * enclosing sections are worked out, so they still break up the levels around
 * them but never appear as a blank step in the path.
 *
 * @param line zero-based line the geotag sits on, or null for a property
 *   geotag, which is frontmatter and so above every heading
 * @param headings the note's headings in document order, as the cache reports
 *   them
 */
export function headingTrail(
    line: number | null,
    headings: readonly HeadingLike[] = []
): string[] {
    if (line === null) return [];

    let innermost = -1;
    for (let i = 0; i < headings.length; i++) {
        if (headings[i].position.start.line <= line) innermost = i;
    }

    if (innermost === -1) return [];

    // Walk back from the enclosing heading, taking each heading shallower than
    // everything taken so far. Those are its ancestors; anything at the same or
    // a deeper level is a sibling section, or inside one, and encloses nothing.
    const trail = [headings[innermost]];
    for (let i = innermost - 1; i >= 0; i--) {
        if (headings[i].level < trail[trail.length - 1].level) {
            trail.push(headings[i]);
        }
    }

    return trail
        .reverse()
        .map((entry) => entry.heading)
        .filter((heading) => heading.trim() !== "");
}
