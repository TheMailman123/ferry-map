/**
 * Recognising and rendering the coordinate pair at the heart of a geotag.
 *
 * A geotag is an ordinary Obsidian internal link whose target is a coordinate
 * pair, so this module's hard problem is not arithmetic but discrimination:
 * telling `[[58.6276, -4.9997]]` apart from a real note called
 * `[[Chapter 3, Part 2]]`, without either inventing pins for ordinary links or
 * silently swallowing a geotag its author fat-fingered.
 */

/** A geographic point in decimal degrees. */
export interface Coordinate {
    lat: number;
    lon: number;
}

/**
 * The result of examining a link target.
 *
 * The distinction between `malformed` and `not-a-geotag` is the whole point of
 * this type: a malformed geotag is reported to the user, an ordinary link is
 * ignored in silence. Collapsing the two would either spam the problems list
 * with every comma-containing note name or hide genuine mistakes.
 */
export type CoordinateParse =
    | { kind: "coordinate"; coordinate: Coordinate }
    | { kind: "malformed"; reason: string }
    | { kind: "not-a-geotag" };

/** Decimal places used when the plugin writes a coordinate. ~11 m of precision. */
export const DEFAULT_PRECISION = 4;

export const MAX_LATITUDE = 90;
export const MAX_LONGITUDE = 180;

/** A signed decimal number occupying the entire string. */
const WHOLE_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** A signed decimal number at the start of the string, whatever follows it. */
const LEADING_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/;

const NOT_A_GEOTAG: CoordinateParse = { kind: "not-a-geotag" };

/**
 * Parse a link target as a coordinate pair.
 *
 * A target is treated as *geotag-shaped* — and so worth complaining about when
 * invalid — when it splits on commas into two or more parts that each begin
 * with a number. That rule is what separates `58.6276, -4.9997 lighthouse`
 * (a geotag whose author typed a space instead of a `|`, worth reporting) from
 * `2024, notes from the field` (a note name, to be left alone).
 *
 * @param text the link's target, e.g. the `58.6276, -4.9997` of
 *   `[[58.6276, -4.9997|Cape Wrath]]`
 * @returns a coordinate, a reason it is unusable, or a signal that this was
 *   never a geotag at all
 */
export function parseCoordinate(text: string): CoordinateParse {
    const parts = text.split(",").map((part) => part.trim());

    if (parts.length < 2) return NOT_A_GEOTAG;
    if (!parts.every((part) => LEADING_NUMBER.test(part))) return NOT_A_GEOTAG;

    if (parts.length > 2) {
        return malformed(
            `expected 2 values (latitude, longitude), found ${parts.length}`
        );
    }

    const [latText, lonText] = parts;

    // Geotag-shaped but not fully numeric: the leading-number test passed on
    // something like "-4.9997 lighthouse".
    if (!WHOLE_NUMBER.test(latText))
        return malformed(`"${latText}" is not a number`);
    if (!WHOLE_NUMBER.test(lonText))
        return malformed(`"${lonText}" is not a number`);

    const lat = Number.parseFloat(latText);
    const lon = Number.parseFloat(lonText);

    if (Math.abs(lat) > MAX_LATITUDE) {
        return malformed(
            `latitude ${lat} is outside -${MAX_LATITUDE} to ${MAX_LATITUDE}`
        );
    }
    if (Math.abs(lon) > MAX_LONGITUDE) {
        return malformed(
            `longitude ${lon} is outside -${MAX_LONGITUDE} to ${MAX_LONGITUDE}`
        );
    }

    return { kind: "coordinate", coordinate: { lat, lon } };
}

/**
 * Render a coordinate as the bare `lat, lon` text that forms a geotag's link
 * target.
 *
 * @param places decimal places to round to
 */
export function formatCoordinate(
    coordinate: Coordinate,
    places: number = DEFAULT_PRECISION
): string {
    return `${round(coordinate.lat, places)}, ${round(coordinate.lon, places)}`;
}

/**
 * Render a coordinate as a complete geotag, ready to paste into a note.
 *
 * The output is guaranteed to parse back through {@link parseCoordinate}: the
 * plugin must never emit a geotag it would then refuse to read.
 */
export function formatGeotag(
    coordinate: Coordinate,
    places: number = DEFAULT_PRECISION
): string {
    return `[[${formatCoordinate(coordinate, places)}]]`;
}

/**
 * Wrap a longitude into -180..180.
 *
 * Leaflet reports longitudes outside that range once the map has been panned
 * across the antimeridian — pan far enough east and a point reads as 185.2
 * rather than -174.8. Both describe the same place, but only one is a
 * coordinate this plugin will read back, so anything sourced from the map is
 * normalised before it is stored or written.
 */
export function normaliseLongitude(lon: number): number {
    // Left alone when already in range, so an exact 180 is not flipped to -180.
    if (lon >= -MAX_LONGITUDE && lon <= MAX_LONGITUDE) return lon;

    return ((((lon + MAX_LONGITUDE) % 360) + 360) % 360) - MAX_LONGITUDE;
}

/** Clamp a latitude to the poles. Counterpart to {@link normaliseLongitude}. */
export function clampLatitude(lat: number): number {
    return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

function malformed(reason: string): CoordinateParse {
    return { kind: "malformed", reason };
}

function round(value: number, places: number): string {
    const fixed = value.toFixed(places);
    // toFixed keeps the sign of values that round to zero, yielding "-0.0000".
    return Number.parseFloat(fixed) === 0 ? (0).toFixed(places) : fixed;
}
