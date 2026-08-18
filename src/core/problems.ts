/**
 * Presenting the geotags the index could not read.
 *
 * Extraction has collected these since M1 — a link that looks like a geotag but
 * does not parse — and nothing has ever shown them. A pin that silently fails
 * to appear is the worst outcome the plugin has: the note looks tagged, the map
 * looks complete, and nothing says otherwise.
 *
 * The list itself is presentation and lives in `ui/controls.ts`. What lives here
 * is the part with rules in it: which order problems are read in, and how a
 * position in a note is described.
 */

import { GeoTagProblem } from "./geotags";
import { noteName } from "./labels";

/** One note's unreadable geotags, ready to render as a block. */
export interface ProblemGroup {
    path: string;
    /** The note's name, which is what the list is headed by. */
    noteName: string;
    /** In the order they appear in the note. Never empty. */
    problems: GeoTagProblem[];
}

/**
 * Gather problems by the note they came from.
 *
 * Grouped because a single note with a broken convention tends to produce
 * several at once — `MAP_TEST/Malformed geotags.md` produces six — and six rows
 * repeating one note name reads as six separate faults rather than one note to
 * go and fix.
 *
 * Notes are ordered by name and problems within a note by position, so the list
 * is read in the same order as the vault and the note. Position order puts
 * properties before body lines because that is where frontmatter sits.
 *
 * @param problems every problem the index holds, in no particular order
 */
export function groupProblems(
    problems: readonly GeoTagProblem[]
): ProblemGroup[] {
    const byPath = new Map<string, GeoTagProblem[]>();

    for (const problem of problems) {
        const existing = byPath.get(problem.path);
        if (existing) existing.push(problem);
        else byPath.set(problem.path, [problem]);
    }

    return [...byPath.entries()]
        .map(([path, found]) => ({
            path,
            noteName: noteName(path),
            // Safe to sort in place: the loop above built this array, so it is
            // never the one the caller passed in.
            problems: found.sort(byPosition),
        }))
        .sort(
            (a, b) =>
                a.noteName.localeCompare(b.noteName, undefined, {
                    sensitivity: "base",
                }) ||
                // Two notes in different folders can share a name, and a list
                // that ordered them arbitrarily would reshuffle itself between
                // renders for no reason the reader could see.
                a.path.localeCompare(b.path)
        );
}

/**
 * Where in its note a problem sits, as the list labels it.
 *
 * Lines are reported one-based, because that is what every editor shows and
 * what the user will be looking at. They are held zero-based everywhere else,
 * which is what Obsidian's cache and its navigation both want.
 */
export function problemLocation(problem: GeoTagProblem): string {
    if (problem.line !== null) return `line ${problem.line + 1}`;

    return problem.key ? `property: ${problem.key}` : "properties";
}

/** Order within one note: properties first, then body lines top to bottom. */
function byPosition(a: GeoTagProblem, b: GeoTagProblem): number {
    if (a.line === null && b.line === null) return 0;
    if (a.line === null) return -1;
    if (b.line === null) return 1;
    return a.line - b.line;
}
