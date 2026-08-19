import { GeoIndex } from "./geo_index";
import { GeoTagExtraction } from "./geotags";

/** An extraction holding one geotag, as if found in a note's body. */
function oneTag(path: string, lat: number, lon: number): GeoTagExtraction {
    return {
        tags: [
            {
                coordinate: { lat, lon },
                alias: null,
                path,
                source: "body",
                key: null,
                line: 0,
                headingTrail: [],
            },
        ],
        problems: [],
    };
}

function oneProblem(path: string): GeoTagExtraction {
    return {
        tags: [],
        problems: [
            {
                path,
                raw: "95.0, 0",
                reason: "latitude 95 is outside -90 to 90",
                source: "body",
                key: null,
                line: 3,
            },
        ],
    };
}

const EMPTY: GeoTagExtraction = { tags: [], problems: [] };

describe("GeoIndex", () => {
    it("holds and returns a note's geotags", () => {
        const index = new GeoIndex();

        index.set("a.md", oneTag("a.md", 58, -4));

        expect(index.tags()).toHaveLength(1);
        expect(index.noteCount).toBe(1);
    });

    it("collects geotags across notes", () => {
        const index = new GeoIndex();

        index.set("a.md", oneTag("a.md", 58, -4));
        index.set("b.md", oneTag("b.md", 51, 0));

        expect(index.tags().map((t) => t.path)).toEqual(["a.md", "b.md"]);
    });

    it("replaces a note's previous geotags rather than appending", () => {
        const index = new GeoIndex();

        index.set("a.md", oneTag("a.md", 58, -4));
        index.set("a.md", oneTag("a.md", 51, 0));

        expect(index.tags()).toHaveLength(1);
        expect(index.tags()[0].coordinate).toEqual({ lat: 51, lon: 0 });
    });

    it("drops a note whose geotags have all been removed", () => {
        const index = new GeoIndex();
        index.set("a.md", oneTag("a.md", 58, -4));

        index.set("a.md", EMPTY);

        expect(index.tags()).toEqual([]);
        expect(index.noteCount).toBe(0);
    });

    it("never stores an entry for a note with nothing to record", () => {
        const index = new GeoIndex();

        index.set("a.md", EMPTY);

        expect(index.noteCount).toBe(0);
    });

    it("keeps problems as well as geotags", () => {
        const index = new GeoIndex();

        index.set("a.md", oneProblem("a.md"));

        expect(index.tags()).toEqual([]);
        expect(index.problems()).toHaveLength(1);
        expect(index.noteCount).toBe(1);
    });

    it("forgets a removed note", () => {
        const index = new GeoIndex();
        index.set("a.md", oneTag("a.md", 58, -4));

        index.remove("a.md");

        expect(index.tags()).toEqual([]);
    });

    it("removing an untracked note is not an error", () => {
        const index = new GeoIndex();

        expect(() => index.remove("never-seen.md")).not.toThrow();
    });

    it("clears everything", () => {
        const index = new GeoIndex();
        index.set("a.md", oneTag("a.md", 58, -4));
        index.set("b.md", oneTag("b.md", 51, 0));

        index.clear();

        expect(index.noteCount).toBe(0);
    });
});

describe("GeoIndex.rename", () => {
    it("re-keys the entry and restamps the path on its geotags", () => {
        const index = new GeoIndex();
        index.set("old.md", oneTag("old.md", 58, -4));

        index.rename("old.md", "new/place.md");

        expect(index.get("old.md")).toBeUndefined();
        expect(index.get("new/place.md")).toBeDefined();
        expect(index.tags()[0].path).toBe("new/place.md");
    });

    it("restamps the path on problems too", () => {
        const index = new GeoIndex();
        index.set("old.md", oneProblem("old.md"));

        index.rename("old.md", "new.md");

        expect(index.problems()[0].path).toBe("new.md");
    });

    it("preserves everything else about a geotag", () => {
        const index = new GeoIndex();
        const before = oneTag("old.md", 58.6276, -4.9997);
        index.set("old.md", before);

        index.rename("old.md", "new.md");

        expect(index.tags()[0]).toEqual({ ...before.tags[0], path: "new.md" });
    });

    it("renaming an untracked note is not an error", () => {
        // Most notes carry no geotags, so this is the common case.
        const index = new GeoIndex();

        expect(() => index.rename("plain.md", "still-plain.md")).not.toThrow();
        expect(index.noteCount).toBe(0);
    });
});

describe("GeoIndex: invalid state", () => {
    it.each(["set", "remove"] as const)(
        "rejects an empty path in %s",
        (method) => {
            const index = new GeoIndex();

            const call =
                method === "set"
                    ? () => index.set("", EMPTY)
                    : () => index.remove("");

            expect(call).toThrow(/non-empty note path/);
        }
    );

    it("rejects an empty path on either side of a rename", () => {
        const index = new GeoIndex();

        expect(() => index.rename("", "a.md")).toThrow(/non-empty note path/);
        expect(() => index.rename("a.md", "")).toThrow(/non-empty note path/);
    });
});
