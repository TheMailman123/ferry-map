/**
 * Turning geotags into the pins the map draws.
 *
 * Lives outside the Leaflet bridge because the interesting part — giving each
 * pin an identity that survives a re-render — is ordinary logic worth testing.
 */

import { Coordinate } from "./coordinates";
import { GeoTag } from "./geotags";
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
    /** Called when the pin is selected. */
    onSelect: () => void;
}

/**
 * Build the pins for a set of geotags.
 *
 * Identity is the note's path plus the geotag's ordinal within that note, and
 * deliberately not its coordinate or line: those are exactly what an edit
 * changes, and a pin whose id changed would be destroyed and recreated rather
 * than moved. Numbering per note rather than across the vault keeps one note's
 * edits from renumbering — and so rebuilding — every other note's pins.
 *
 * @param tags geotags grouped by note, as the index returns them
 * @param onSelect invoked with the geotag behind a pin when it is selected
 */
export function buildMarkers(
    tags: GeoTag[],
    onSelect: (tag: GeoTag) => void
): MapMarker[] {
    const ordinals = new Map<string, number>();

    return tags.map((tag) => {
        const ordinal = ordinals.get(tag.path) ?? 0;
        ordinals.set(tag.path, ordinal + 1);

        return {
            id: `${tag.path}#${ordinal}`,
            coordinate: tag.coordinate,
            label: pinLabel(tag),
            noteName: noteName(tag.path),
            onSelect: () => onSelect(tag),
        };
    });
}
