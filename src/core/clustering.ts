/**
 * Grouping pins that are too close together to tell apart.
 *
 * At a low zoom several geotags collapse onto the same few pixels and the map
 * silently under-reports how much is there. Grouping them into one pin carrying
 * a count makes the hidden ones visible.
 *
 * Grouping is done in *projected* pixel space rather than in degrees, because
 * whether two pins overlap is a question about the screen: a tenth of a degree
 * of longitude is a wide gap at the equator and nothing near the poles.
 */

import { Coordinate } from "./coordinates";
import { MapMarker } from "./markers";

/** A point in the map's projected pixel space at some zoom level. */
export interface ProjectedPoint {
    x: number;
    y: number;
}

/** One or more pins drawn as a single marker. */
export interface Cluster {
    /** Stable given the same membership, so unchanged clusters are left alone. */
    id: string;
    /** Where the cluster is drawn. */
    coordinate: Coordinate;
    /** Members, ordered by id. A cluster of one is an ordinary pin. */
    members: MapMarker[];
    /**
     * What colours are underneath, and how much of each. Never empty.
     *
     * Deliberately not part of {@link id}: a recoloured cluster is the same
     * cluster and should be restyled where it stands, not rebuilt.
     */
    colours: ColourSlice[];
}

/** A run of a cluster's members sharing one colour. */
export interface ColourSlice {
    /** The group's colour, or null for members no group claimed. */
    colour: string | null;
    /** How many of the cluster's members have it. */
    count: number;
}

/**
 * Group markers that fall within `radiusPx` of one another.
 *
 * The algorithm is greedy: each unassigned marker in turn seeds a cluster and
 * claims its unassigned neighbours. This means a chain of markers each just
 * within the radius of the next does not all collapse into one cluster — which
 * is the desired behaviour, since a chain can be arbitrarily long and its ends
 * arbitrarily far apart.
 *
 * @param project maps a coordinate to pixel space at the current zoom. Supplied
 *   by the caller so this module stays independent of the map renderer.
 * @param radiusPx how close two pins must be to be treated as overlapping
 */
export function clusterMarkers(
    markers: MapMarker[],
    project: (coordinate: Coordinate) => ProjectedPoint,
    radiusPx: number
): Cluster[] {
    if (!(radiusPx > 0)) {
        throw new Error(`Cluster radius must be positive, got ${radiusPx}.`);
    }

    const points = markers.map((marker) => ({
        marker,
        point: project(marker.coordinate),
    }));

    // Buckets are exactly one radius across, so every marker within the radius
    // of a given point lies in that point's cell or one of the eight around it.
    const grid = new Map<string, number[]>();
    points.forEach((entry, index) => {
        const key = cellKey(
            cell(entry.point.x, radiusPx),
            cell(entry.point.y, radiusPx)
        );
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
    });

    const claimed = new Array<boolean>(points.length).fill(false);
    const clusters: Cluster[] = [];

    for (let seed = 0; seed < points.length; seed++) {
        if (claimed[seed]) continue;

        claimed[seed] = true;
        const members = [points[seed].marker];
        const cx = cell(points[seed].point.x, radiusPx);
        const cy = cell(points[seed].point.y, radiusPx);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (const other of grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
                    if (claimed[other]) continue;
                    if (
                        !within(
                            points[seed].point,
                            points[other].point,
                            radiusPx
                        )
                    ) {
                        continue;
                    }

                    claimed[other] = true;
                    members.push(points[other].marker);
                }
            }
        }

        clusters.push(makeCluster(members));
    }

    return clusters;
}

function makeCluster(members: MapMarker[]): Cluster {
    // Ordered so a cluster's id and tooltip do not depend on which member
    // happened to seed it.
    const ordered = [...members].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );

    return {
        id: `${ordered[0].id}+${ordered.length}`,
        coordinate: centre(ordered),
        members: ordered,
        colours: colourSlices(ordered),
    };
}

/**
 * Break a cluster down by colour, so a pin can show what is under it.
 *
 * A pin standing for notes in two colour groups cannot honestly wear one of
 * them, and picking either would misreport what is there — but it can wear
 * both, in proportion, which is what the map draws. A uniform cluster comes
 * back as a single slice and is drawn as a plain pin.
 *
 * Slices are ordered by where each colour first appears among the members,
 * which are themselves ordered by id. So the same membership always yields the
 * same order, and a pin's segments do not rearrange themselves when an
 * unrelated note changes.
 *
 * @param members a cluster's members, already ordered by id
 * @returns one slice per distinct colour, never empty
 */
export function colourSlices(members: readonly MapMarker[]): ColourSlice[] {
    const slices: ColourSlice[] = [];
    // Small enough that a linear scan beats a map keyed on a nullable colour:
    // a cluster is a handful of pins and rarely more than two or three groups.
    for (const member of members) {
        const existing = slices.find((slice) => slice.colour === member.colour);
        if (existing) existing.count++;
        else slices.push({ colour: member.colour, count: 1 });
    }

    return slices;
}

/**
 * The mean position of a cluster's members.
 *
 * Averaging degrees would be wrong for a group straddling the antimeridian —
 * 179 and -179 would average to 0 — but no cluster can straddle it: members are
 * within a few pixels of each other, and the two sides of the seam are a whole
 * world's width apart in projected space.
 */
function centre(members: MapMarker[]): Coordinate {
    if (members.length === 1) return members[0].coordinate;

    let lat = 0;
    let lon = 0;
    for (const member of members) {
        lat += member.coordinate.lat;
        lon += member.coordinate.lon;
    }

    return { lat: lat / members.length, lon: lon / members.length };
}

function within(
    a: ProjectedPoint,
    b: ProjectedPoint,
    radiusPx: number
): boolean {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy <= radiusPx * radiusPx;
}

function cell(value: number, size: number): number {
    return Math.floor(value / size);
}

function cellKey(x: number, y: number): string {
    return `${x},${y}`;
}
