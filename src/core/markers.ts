/**
 * Turning geotags into the pins the map draws.
 *
 * Lives outside the Leaflet bridge because the interesting part — giving each
 * pin an identity that survives a re-render — is ordinary logic worth testing.
 */

import { Coordinate } from "./coordinates";
import { GeoTag } from "./geotags";
import { NoteStyle } from "./groups";
import { noteName, pinLabel } from "./labels";

/** One pin, as the map needs it. */
export interface MapMarker {
    /** Stable across re-renders, so unchanged pins are left in place. */
    id: string;
    coordinate: Coordinate;
    /** Hover label: the geotag's alias, or its note's name. */
    label: string;
    /** The note the pin came from. Shown when it differs from the label. */
    noteName: string;
    /** Colour from the first matching group, or null for the default pin. */
    colour: string | null;
    /** Called when the pin is selected. */
    onSelect: () => void;
}

const DEFAULT_STYLE: NoteStyle = { hidden: false, colour: null };

/**
 * Build the pins for a set of geotags.
 *
 * Identity is the note's path plus the geotag's ordinal within that note, and
 * deliberately not its coordinate, line or colour: those are exactly what an
 * edit changes, and a pin whose id changed would be destroyed and recreated
 * rather than moved or restyled. Numbering per note rather than across the
 * vault keeps one note's edits from renumbering — and so rebuilding — every
 * other note's pins.
 *
 * Filtered-out notes are dropped here, before anything is clustered, so a
 * cluster's count reports what is actually on the map.
 *
 * @param tags geotags grouped by note, as the index returns them
 * @param onSelect invoked with the geotag behind a pin when it is selected
 * @param styleFor how a note's pins should look. Omitted when no filter or
 *   colour group is set, which is the plain case of every pin in the default
 *   colour.
 */
export function buildMarkers(
    tags: GeoTag[],
    onSelect: (tag: GeoTag) => void,
    styleFor: (path: string) => NoteStyle = () => DEFAULT_STYLE
): MapMarker[] {
    const ordinals = new Map<string, number>();
    const markers: MapMarker[] = [];

    for (const tag of tags) {
        const style = styleFor(tag.path);
        if (style.hidden) continue;

        // Numbering what is left cannot disturb a pin's identity, because a
        // note is styled as a whole: every one of its geotags is hidden or
        // shown together, and the count restarts at each note.
        const ordinal = ordinals.get(tag.path) ?? 0;
        ordinals.set(tag.path, ordinal + 1);

        markers.push({
            id: `${tag.path}#${ordinal}`,
            coordinate: tag.coordinate,
            label: pinLabel(tag),
            noteName: noteName(tag.path),
            colour: style.colour,
            onSelect: () => onSelect(tag),
        });
    }

    return markers;
}
