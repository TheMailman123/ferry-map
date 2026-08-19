/**
 * Joining a note's geotags into the journey they describe.
 *
 * A note carrying several geotags is usually a trip — places visited in the
 * order they were written down. Drawing them as loose pins loses that: the map
 * shows where you went but not that it was one journey, nor in what order.
 *
 * Lives beside `markers.ts` and for the same reason. The interesting parts —
 * what counts as file order, and which notes get a line at all — are ordinary
 * logic worth testing away from Leaflet.
 */

import { Coordinate } from "./coordinates";
import { GeoTag } from "./geotags";
import { NoteStyle } from "./groups";
import { noteName } from "./labels";

/** One note's geotags, in the order they appear in it. */
export interface Route {
    /**
     * The note's path, which is the whole identity.
     *
     * A note has at most one route, so nothing else is needed to tell two
     * apart — and deliberately nothing else is in it, so editing a journey
     * moves the line rather than replacing it.
     */
    id: string;
    path: string;
    /** The note's name, which is what hovering the line reports. */
    noteName: string;
    /** Two or more points. A note with fewer is not a journey and has no route. */
    points: Coordinate[];
    /** Colour from the first matching group, or null for the default. */
    colour: string | null;
}

const DEFAULT_STYLE: NoteStyle = { hidden: false, colour: null };

/** Fewest geotags a note needs before its geotags describe a journey. */
const MIN_POINTS = 2;

/**
 * Build the journey lines for a set of geotags.
 *
 * Notes are considered whole: a note contributes one route through all of its
 * geotags, or none at all. A note with a single geotag has nowhere to go and
 * gets no line.
 *
 * Points are the geotags' own coordinates, not the clustered positions the pins
 * are drawn at. A journey is between the places, and a line that snapped to
 * cluster centres would move as the map zoomed.
 *
 * Hidden notes are dropped, on the same reasoning as `buildMarkers`: a filter
 * that hides a note's pins but leaves its line behind is showing the note.
 *
 * @param tags every geotag, in extraction order
 * @param styleFor how a note's pins should look. Omitted when no filter or
 *   colour group is set.
 */
export function buildRoutes(
    tags: GeoTag[],
    styleFor: (path: string) => NoteStyle = () => DEFAULT_STYLE
): Route[] {
    const byPath = new Map<string, GeoTag[]>();

    for (const tag of tags) {
        const existing = byPath.get(tag.path);
        if (existing) existing.push(tag);
        else byPath.set(tag.path, [tag]);
    }

    const routes: Route[] = [];

    for (const [path, found] of byPath) {
        if (found.length < MIN_POINTS) continue;

        const style = styleFor(path);
        if (style.hidden) continue;

        routes.push({
            id: path,
            path,
            noteName: noteName(path),
            // Safe to sort in place: the loop above built this array, so it is
            // never the one the caller passed in.
            points: found.sort(byFilePosition).map((tag) => tag.coordinate),
            colour: style.colour,
        });
    }

    return routes;
}

/**
 * Order a note's geotags as they are written in it.
 *
 * Body geotags carry the line they sit on. Property geotags carry no line, and
 * are placed first: properties are frontmatter, which is the top of the file.
 *
 * Ties — two geotags on one line, or two in the same property list — are left
 * in the order they arrived, which is the order Obsidian's cache reports links
 * and so the order they appear across the line. That relies on the sort being
 * stable, which it has been required to be since ES2019.
 */
function byFilePosition(a: GeoTag, b: GeoTag): number {
    return (a.line ?? -1) - (b.line ?? -1);
}
