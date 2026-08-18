import { GeoTagProblem } from "./geotags";
import { groupProblems, problemLocation } from "./problems";

function problem(
    path: string,
    raw: string,
    line: number | null = 0,
    key: string | null = null
): GeoTagProblem {
    return {
        path,
        raw,
        reason: "not a coordinate",
        source: line === null ? "property" : "body",
        key,
        line,
    };
}

describe("groupProblems", () => {
    it("returns nothing for no problems", () => {
        expect(groupProblems([])).toEqual([]);
    });

    it("gathers a note's problems under its name", () => {
        // Six rows repeating one note name read as six faults rather than one
        // note to go and fix.
        const groups = groupProblems([
            problem("MAP_TEST/Broken.md", "a", 1),
            problem("MAP_TEST/Broken.md", "b", 2),
        ]);

        expect(groups).toHaveLength(1);
        expect(groups[0].path).toBe("MAP_TEST/Broken.md");
        expect(groups[0].noteName).toBe("Broken");
        expect(groups[0].problems.map((p) => p.raw)).toEqual(["a", "b"]);
    });

    it("keeps separate notes separate", () => {
        const groups = groupProblems([
            problem("a.md", "x"),
            problem("b.md", "y"),
        ]);

        expect(groups.map((group) => group.path)).toEqual(["a.md", "b.md"]);
    });

    it("orders notes by name, not by the order problems arrived", () => {
        const groups = groupProblems([
            problem("Zulu.md", "x"),
            problem("alpha.md", "y"),
        ]);

        expect(groups.map((group) => group.noteName)).toEqual([
            "alpha",
            "Zulu",
        ]);
    });

    it("falls back to the path when two notes share a name", () => {
        // Otherwise the list reshuffles between renders for no visible reason.
        const groups = groupProblems([
            problem("TRIPS/Skye.md", "x"),
            problem("ADMIN/Skye.md", "y"),
        ]);

        expect(groups.map((group) => group.path)).toEqual([
            "ADMIN/Skye.md",
            "TRIPS/Skye.md",
        ]);
    });

    it("treats names differing only in case as the same name", () => {
        // So the path decides, rather than the arbitrary question of which
        // note happens to be capitalised.
        const groups = groupProblems([
            problem("TRIPS/skye.md", "x"),
            problem("ADMIN/Skye.md", "y"),
        ]);

        expect(groups.map((group) => group.path)).toEqual([
            "ADMIN/Skye.md",
            "TRIPS/skye.md",
        ]);
    });

    it("orders a note's problems down the page", () => {
        const [group] = groupProblems([
            problem("a.md", "third", 9),
            problem("a.md", "first", 1),
            problem("a.md", "second", 4),
        ]);

        expect(group.problems.map((p) => p.raw)).toEqual([
            "first",
            "second",
            "third",
        ]);
    });

    it("puts property problems above body lines", () => {
        // Frontmatter sits above the body, so the list reads in file order.
        const [group] = groupProblems([
            problem("a.md", "body", 0),
            problem("a.md", "property", null, "location"),
        ]);

        expect(group.problems.map((p) => p.raw)).toEqual(["property", "body"]);
    });

    it("keeps two problems on the same line in the order given", () => {
        const [group] = groupProblems([
            problem("a.md", "left", 3),
            problem("a.md", "right", 3),
        ]);

        expect(group.problems.map((p) => p.raw)).toEqual(["left", "right"]);
    });

    it("does not disturb the problems it was given", () => {
        const problems = [problem("a.md", "b", 2), problem("a.md", "a", 1)];
        groupProblems(problems);

        expect(problems.map((p) => p.raw)).toEqual(["b", "a"]);
    });
});

describe("problemLocation", () => {
    it("reports a line one-based, as an editor shows it", () => {
        expect(problemLocation(problem("a.md", "x", 0))).toBe("line 1");
        expect(problemLocation(problem("a.md", "x", 41))).toBe("line 42");
    });

    it("names the property a geotag was written in", () => {
        expect(problemLocation(problem("a.md", "x", null, "location"))).toBe(
            "property: location"
        );
    });

    it("falls back when the property is not known", () => {
        expect(problemLocation(problem("a.md", "x", null, null))).toBe(
            "properties"
        );
    });
});
