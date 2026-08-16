/**
 * Deriving what a pin is called.
 *
 * Labels are computed at render time rather than stored on a geotag, so
 * renaming a note relabels its pins without re-extracting anything.
 */

import { GeoTag } from "./geotags";

/** A note's display name: its filename without directory or extension. */
export function noteName(path: string): string {
    const filename = path.slice(path.lastIndexOf("/") + 1);
    // Only a trailing extension is stripped, so "Chapter 3.2.md" keeps its dot.
    const dot = filename.lastIndexOf(".");
    return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * The label for a pin: the geotag's alias where it has one, otherwise the name
 * of the note it came from.
 *
 * The alias matters most in notes carrying several geotags, where every pin
 * would otherwise share the note's name and be indistinguishable.
 */
export function pinLabel(tag: GeoTag): string {
    return tag.alias ?? noteName(tag.path);
}
