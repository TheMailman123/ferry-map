import { GeoTag } from "./geotags";
import { NoteStyle } from "./groups";
import { buildRoutes } from "./routes";

function tag(
    path: string,
    lat: number,
    lon: number,
    line: number | null = 0
): GeoTag {
    return {
        coordinate: { lat, lon },
        alias: null,
        path,
        source: line === null ? "property" : "body",
        key: null,
        line,
    };
}

const HIDDEN: NoteStyle = { hidden: true, colour: null };
const VISIBLE: NoteStyle = { hidden: false, colour: null };

describe("buildRoutes", () => {
    it("returns nothing for no geotags", () => {
        expect(buildRoutes([])).toEqual([]);
    });

    it("gives a lone geotag no route", () => {
        // One place is not a journey.
        expect(buildRoutes([tag("a.md", 1, 1)])).toEqual([]);
    });

    it("joins a note's geotags into one line", () => {
        const routes = buildRoutes([
            tag("a.md", 1, 1, 0),
            tag("a.md", 2, 2, 1),
            tag("a.md", 3, 3, 2),
        ]);

        expect(routes).toHaveLength(1);
        expect(routes[0].points).toEqual([
            { lat: 1, lon: 1 },
            { lat: 2, lon: 2 },
            { lat: 3, lon: 3 },
        ]);
    });

    it("identifies a route by its note's path alone", () => {
        // Editing a journey must move the line, not replace it.
        const routes = buildRoutes([
            tag("TRIPS/Skye.md", 1, 1, 0),
            tag("TRIPS/Skye.md", 2, 2, 1),
        ]);

        expect(routes[0].id).toBe("TRIPS/Skye.md");
        expect(routes[0].path).toBe("TRIPS/Skye.md");
    });

    it("keeps one note's journey separate from another's", () => {
        const routes = buildRoutes([
            tag("a.md", 1, 1, 0),
            tag("b.md", 5, 5, 0),
            tag("a.md", 2, 2, 1),
            tag("b.md", 6, 6, 1),
        ]);

        expect(routes.map((route) => route.path)).toEqual(["a.md", "b.md"]);
        expect(routes[0].points).toEqual([
            { lat: 1, lon: 1 },
            { lat: 2, lon: 2 },
        ]);
        expect(routes[1].points).toEqual([
            { lat: 5, lon: 5 },
            { lat: 6, lon: 6 },
        ]);
    });

    it("orders points down the note, not by arrival", () => {
        const routes = buildRoutes([
            tag("a.md", 3, 3, 9),
            tag("a.md", 1, 1, 2),
            tag("a.md", 2, 2, 5),
        ]);

        expect(routes[0].points.map((point) => point.lat)).toEqual([1, 2, 3]);
    });

    it("puts property geotags before body ones", () => {
        // Properties are frontmatter, which is the top of the file.
        const routes = buildRoutes([
            tag("a.md", 2, 2, 0),
            tag("a.md", 1, 1, null),
        ]);

        expect(routes[0].points.map((point) => point.lat)).toEqual([1, 2]);
    });

    it("keeps two geotags on one line in the order written", () => {
        const routes = buildRoutes([
            tag("a.md", 1, 1, 4),
            tag("a.md", 2, 2, 4),
        ]);

        expect(routes[0].points.map((point) => point.lat)).toEqual([1, 2]);
    });

    it("keeps two geotags in one property list in the order written", () => {
        const routes = buildRoutes([
            tag("a.md", 1, 1, null),
            tag("a.md", 2, 2, null),
        ]);

        expect(routes[0].points.map((point) => point.lat)).toEqual([1, 2]);
    });

    it("does not disturb the geotags it was given", () => {
        const tags = [tag("a.md", 2, 2, 9), tag("a.md", 1, 1, 1)];
        buildRoutes(tags);

        expect(tags.map((t) => t.coordinate.lat)).toEqual([2, 1]);
    });

    it("names the note it came from, for the line's tooltip", () => {
        const routes = buildRoutes([
            tag("TRIPS/Isle of Skye.md", 1, 1, 0),
            tag("TRIPS/Isle of Skye.md", 2, 2, 1),
        ]);

        expect(routes[0].noteName).toBe("Isle of Skye");
    });

    it("takes the note's group colour", () => {
        const routes = buildRoutes(
            [tag("a.md", 1, 1, 0), tag("a.md", 2, 2, 1)],
            () => ({ hidden: false, colour: "#e05252" })
        );

        expect(routes[0].colour).toBe("#e05252");
    });

    it("has no colour when no group claimed the note", () => {
        const routes = buildRoutes([
            tag("a.md", 1, 1, 0),
            tag("a.md", 2, 2, 1),
        ]);

        expect(routes[0].colour).toBeNull();
    });

    it("drops a hidden note's journey", () => {
        // A filter that hides the pins but leaves the line is showing the note.
        const routes = buildRoutes(
            [tag("a.md", 1, 1, 0), tag("a.md", 2, 2, 1)],
            () => HIDDEN
        );

        expect(routes).toEqual([]);
    });

    it("keeps a visible note's journey when another is hidden", () => {
        const routes = buildRoutes(
            [
                tag("a.md", 1, 1, 0),
                tag("a.md", 2, 2, 1),
                tag("b.md", 5, 5, 0),
                tag("b.md", 6, 6, 1),
            ],
            (path): NoteStyle => (path === "a.md" ? HIDDEN : VISIBLE)
        );

        expect(routes.map((route) => route.path)).toEqual(["b.md"]);
    });

    it("asks about a note's style only once", () => {
        // The styler memoises per draw, but a route should not lean on that.
        const asked: string[] = [];
        buildRoutes([tag("a.md", 1, 1, 0), tag("a.md", 2, 2, 1)], (path) => {
            asked.push(path);
            return VISIBLE;
        });

        expect(asked).toEqual(["a.md"]);
    });
});
