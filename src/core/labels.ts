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

/** Between a note and its sections, and between one section and the next. */
const TRAIL_SEPARATOR = " › ";

/** Between a pin's own name and where it came from. */
const NAME_SEPARATOR = " — ";

/** What a pin points at: its note, and the sections within it. */
export interface PinOrigin {
    noteName: string;
    /** Enclosing headings, outermost first. Empty where there are none. */
    headingTrail: readonly string[];
}

/**
 * Where a pin came from, written out: `Skye › Day 2 › Morning`.
 *
 * The note comes first because it is what the sections belong to — a heading
 * called "Morning" means nothing until you know which note wrote it.
 */
export function originPath(origin: PinOrigin): string {
    return [origin.noteName, ...origin.headingTrail].join(TRAIL_SEPARATOR);
}

/**
 * A pin named and placed in one line: `Elgol — Skye › Day 2`.
 *
 * An unaliased pin is labelled by its note, so repeating the note after it
 * would read `Skye — Skye`; there the origin stands alone.
 */
export function pinDescription(pin: PinOrigin & { label: string }): string {
    const origin = originPath(pin);
    return pin.label === pin.noteName
        ? origin
        : `${pin.label}${NAME_SEPARATOR}${origin}`;
}
