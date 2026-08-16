import { Coordinate } from "./coordinates";
import { clusterMarkers } from "./clustering";
import { MapMarker } from "./markers";

/**
 * A projection that treats one degree as one pixel, so test coordinates read as
 * screen positions directly.
 */
const project = (coordinate: Coordinate) => ({
    x: coordinate.lon,
    y: coordinate.lat,
});

function marker(id: string, lat: number, lon: number): MapMarker {
    return {
        id,
        coordinate: { lat, lon },
        label: id,
        noteName: id,
        onSelect: () => undefined,
    };
}

const RADIUS = 10;

describe("clusterMarkers", () => {
    it("returns nothing for no markers", () => {
        expect(clusterMarkers([], project, RADIUS)).toEqual([]);
    });

    it("leaves a lone marker as a cluster of one, at its own position", () => {
        const [cluster] = clusterMarkers(
            [marker("a", 58, -4)],
            project,
            RADIUS
        );

        expect(cluster.members).toHaveLength(1);
        expect(cluster.coordinate).toEqual({ lat: 58, lon: -4 });
    });

    it("keeps well-separated markers apart", () => {
        const clusters = clusterMarkers(
            [marker("a", 0, 0), marker("b", 0, 100), marker("c", 100, 0)],
            project,
            RADIUS
        );

        expect(clusters).toHaveLength(3);
        expect(clusters.every((c) => c.members.length === 1)).toBe(true);
    });

    it("groups markers that overlap on screen", () => {
        const clusters = clusterMarkers(
            [marker("a", 0, 0), marker("b", 3, 4)],
            project,
            RADIUS
        );

        expect(clusters).toHaveLength(1);
        expect(clusters[0].members.map((m) => m.id)).toEqual(["a", "b"]);
    });

    it("groups markers sharing an exact position", () => {
        const clusters = clusterMarkers(
            [marker("a", 58, -4), marker("b", 58, -4), marker("c", 58, -4)],
            project,
            RADIUS
        );

        expect(clusters).toHaveLength(1);
        expect(clusters[0].members).toHaveLength(3);
        expect(clusters[0].coordinate).toEqual({ lat: 58, lon: -4 });
    });

    it("measures distance, not axis separation", () => {
        // 8 apart on each axis is 11.3 apart, beyond a radius of 10.
        const clusters = clusterMarkers(
            [marker("a", 0, 0), marker("b", 8, 8)],
            project,
            RADIUS
        );

        expect(clusters).toHaveLength(2);
    });

    it("splits a chain rather than collapsing it into one cluster", () => {
        // Each is within the radius of the next, but the ends are 18 apart.
        const clusters = clusterMarkers(
            [marker("a", 0, 0), marker("b", 0, 9), marker("c", 0, 18)],
            project,
            RADIUS
        );

        expect(clusters).toHaveLength(2);
        expect(clusters[0].members.map((m) => m.id)).toEqual(["a", "b"]);
        expect(clusters[1].members.map((m) => m.id)).toEqual(["c"]);
    });

    it("finds neighbours across grid cell boundaries", () => {
        // Straddles the boundary at x = 10 with cells one radius wide.
        const clusters = clusterMarkers(
            [marker("a", 0, 9.5), marker("b", 0, 10.5)],
            project,
            RADIUS
        );

        expect(clusters).toHaveLength(1);
    });

    it("places a cluster at the mean of its members", () => {
        const [cluster] = clusterMarkers(
            [marker("a", 0, 0), marker("b", 4, 8)],
            project,
            RADIUS
        );

        expect(cluster.coordinate).toEqual({ lat: 2, lon: 4 });
    });

    it("orders members by id, whatever order they arrived in", () => {
        const forward = clusterMarkers(
            [marker("a", 0, 0), marker("b", 0, 1)],
            project,
            RADIUS
        );
        const reversed = clusterMarkers(
            [marker("b", 0, 1), marker("a", 0, 0)],
            project,
            RADIUS
        );

        expect(forward[0].members.map((m) => m.id)).toEqual(["a", "b"]);
        expect(reversed[0].members.map((m) => m.id)).toEqual(["a", "b"]);
    });

    it("gives the same cluster the same id regardless of input order", () => {
        // Identity must depend on membership alone, or panning would rebuild
        // every pin on the map.
        const forward = clusterMarkers(
            [marker("a", 0, 0), marker("b", 0, 1)],
            project,
            RADIUS
        );
        const reversed = clusterMarkers(
            [marker("b", 0, 1), marker("a", 0, 0)],
            project,
            RADIUS
        );

        expect(forward[0].id).toBe(reversed[0].id);
    });

    it("changes a cluster's id when its membership changes", () => {
        const pair = clusterMarkers(
            [marker("a", 0, 0), marker("b", 0, 1)],
            project,
            RADIUS
        );
        const trio = clusterMarkers(
            [marker("a", 0, 0), marker("b", 0, 1), marker("c", 0, 2)],
            project,
            RADIUS
        );

        expect(trio[0].id).not.toBe(pair[0].id);
    });

    it("separates markers as the projection zooms in", () => {
        const markers = [marker("a", 0, 0), marker("b", 0, 5)];
        const zoomedIn = (coordinate: Coordinate) => ({
            x: coordinate.lon * 4,
            y: coordinate.lat * 4,
        });

        expect(clusterMarkers(markers, project, RADIUS)).toHaveLength(1);
        expect(clusterMarkers(markers, zoomedIn, RADIUS)).toHaveLength(2);
    });

    it("rejects a non-positive radius", () => {
        expect(() => clusterMarkers([], project, 0)).toThrow(
            /must be positive/
        );
        expect(() => clusterMarkers([], project, -5)).toThrow(
            /must be positive/
        );
    });
});
