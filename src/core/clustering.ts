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
    };
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
