import { GeoTag } from "./geotags";
import { buildMarkers } from "./markers";

function tag(
    path: string,
    lat: number,
    lon: number,
    alias: string | null = null,
    line: number | null = 0
): GeoTag {
    return {
        coordinate: { lat, lon },
        alias,
        path,
        source: "body",
        key: null,
        line,
    };
}

const noop = () => undefined;

describe("buildMarkers", () => {
    it("builds one marker per geotag", () => {
        const markers = buildMarkers(
            [tag("a.md", 58, -4), tag("b.md", 51, 0)],
            noop
        );

        expect(markers).toHaveLength(2);
        expect(markers.map((m) => m.coordinate)).toEqual([
            { lat: 58, lon: -4 },
            { lat: 51, lon: 0 },
        ]);
    });

    it("labels a pin by its note when the geotag has no alias", () => {
        const [marker] = buildMarkers(
            [tag("TRIPS/20240612_COASTPATH.md", 0, 0)],
            noop
        );

        expect(marker.label).toBe("20240612_COASTPATH");
        expect(marker.noteName).toBe("20240612_COASTPATH");
    });

    it("labels a pin by its alias, keeping the note name alongside", () => {
        const [marker] = buildMarkers(
            [tag("TRIPS/20240612_COASTPATH.md", 0, 0, "Seal Cove")],
            noop
        );

        expect(marker.label).toBe("Seal Cove");
        expect(marker.noteName).toBe("20240612_COASTPATH");
    });

    it("numbers several geotags within one note", () => {
        const markers = buildMarkers(
            [tag("a.md", 58, -4), tag("a.md", 51, 0), tag("a.md", 40, 10)],
            noop
        );

        expect(markers.map((m) => m.id)).toEqual([
            "a.md#0",
            "a.md#1",
            "a.md#2",
        ]);
    });

    it("numbers each note independently", () => {
        // One note's edits must not renumber another note's pins.
        const markers = buildMarkers(
            [tag("a.md", 58, -4), tag("b.md", 51, 0), tag("a.md", 40, 10)],
            noop
        );

        expect(markers.map((m) => m.id)).toEqual([
            "a.md#0",
            "b.md#0",
            "a.md#1",
        ]);
    });

    it("keeps a pin's id when its coordinate is edited", () => {
        // The whole point of the id: moving a pin must move it, not destroy and
        // recreate it.
        const before = buildMarkers([tag("a.md", 58, -4)], noop);
        const after = buildMarkers([tag("a.md", 12, 34)], noop);

        expect(after[0].id).toBe(before[0].id);
    });

    it("keeps a pin's id when its line or alias changes", () => {
        const before = buildMarkers([tag("a.md", 58, -4, null, 3)], noop);
        const after = buildMarkers([tag("a.md", 58, -4, "Renamed", 40)], noop);

        expect(after[0].id).toBe(before[0].id);
    });

    it("keeps other notes' ids stable when one note gains a geotag", () => {
        const before = buildMarkers(
            [tag("a.md", 58, -4), tag("b.md", 51, 0)],
            noop
        );
        const after = buildMarkers(
            [tag("a.md", 58, -4), tag("a.md", 1, 1), tag("b.md", 51, 0)],
            noop
        );

        const idOf = (markers: { id: string }[], index: number) =>
            markers[index].id;
        expect(idOf(after, 0)).toBe(idOf(before, 0));
        expect(after.find((m) => m.id === idOf(before, 1))).toBeDefined();
    });

    it("passes the originating geotag to the select callback", () => {
        const selected: GeoTag[] = [];
        const source = tag("a.md", 58, -4, null, 7);

        const [marker] = buildMarkers([source], (t) => selected.push(t));
        marker.onSelect();

        expect(selected).toEqual([source]);
    });

    it("gives each pin its own callback", () => {
        const selected: string[] = [];
        const markers = buildMarkers(
            [tag("a.md", 58, -4), tag("b.md", 51, 0)],
            (t) => selected.push(t.path)
        );

        markers[1].onSelect();

        expect(selected).toEqual(["b.md"]);
    });
});
