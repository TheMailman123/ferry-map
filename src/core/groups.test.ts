import { ColourGroup, colourFor, compileGroups, noteStyler } from "./groups";
import { NoteDoc, parseQuery } from "./query";

function doc(path: string, ...tags: string[]): NoteDoc {
    const filename = path.slice(path.lastIndexOf("/") + 1);
    return { path, basename: filename.replace(/\.md$/, ""), tags };
}

function groups(...pairs: [string, string][]): ColourGroup[] {
    return pairs.map(([query, colour]) => ({ query, colour }));
}

const skye = doc("TRIPS/Isle of Skye.md", "#trip", "#ferry");
const recipe = doc("Recipes/Cullen Skink.md", "#food");

describe("colourFor", () => {
    it("returns the colour of the group that matches", () => {
        const compiled = compileGroups(groups(["tag:#ferry", "red"]));
        expect(colourFor(skye, compiled)).toBe("red");
        expect(colourFor(recipe, compiled)).toBeNull();
    });

    it("gives the topmost matching group priority", () => {
        // Settled with the user: the list is a priority order, and a group
        // lower down never overrides one above it.
        const compiled = compileGroups(
            groups(["path:TRIPS", "red"], ["tag:#ferry", "blue"])
        );

        expect(colourFor(skye, compiled)).toBe("red");
    });

    it("falls through to a later group when earlier ones do not match", () => {
        const compiled = compileGroups(
            groups(["tag:#food", "red"], ["tag:#ferry", "blue"])
        );

        expect(colourFor(skye, compiled)).toBe("blue");
    });

    it("colours nothing for a group whose query is empty", () => {
        // A group added but not yet given a query must not paint the vault.
        const compiled = compileGroups(groups(["", "red"], ["  ", "green"]));

        expect(colourFor(skye, compiled)).toBeNull();
        expect(colourFor(recipe, compiled)).toBeNull();
    });

    it("skips an empty group to reach a later one that matches", () => {
        const compiled = compileGroups(
            groups(["", "red"], ["path:TRIPS", "blue"])
        );

        expect(colourFor(skye, compiled)).toBe("blue");
    });

    it("returns null when there are no groups at all", () => {
        expect(colourFor(skye, [])).toBeNull();
    });
});

describe("noteStyler", () => {
    const docs = new Map([
        [skye.path, skye],
        [recipe.path, recipe],
    ]);

    function styler(filter: string, ...pairs: [string, string][]) {
        const lookups: string[] = [];
        const docFor = (path: string) => {
            lookups.push(path);
            const found = docs.get(path);
            if (!found) throw new Error(`no doc for ${path}`);
            return found;
        };

        return {
            lookups,
            style: noteStyler(
                docFor,
                parseQuery(filter),
                compileGroups(groups(...pairs))
            ),
        };
    }

    it("hides notes the filter excludes", () => {
        const { style } = styler("path:TRIPS");

        expect(style(skye.path).hidden).toBe(false);
        expect(style(recipe.path).hidden).toBe(true);
    });

    it("shows everything when the filter is empty", () => {
        const { style } = styler("");

        expect(style(skye.path).hidden).toBe(false);
        expect(style(recipe.path).hidden).toBe(false);
    });

    it("colours and filters independently", () => {
        const { style } = styler("path:TRIPS", ["tag:#ferry", "red"]);

        expect(style(skye.path)).toEqual({ hidden: false, colour: "red" });
    });

    it("does not colour a note it has hidden", () => {
        const { style } = styler("path:TRIPS", ["tag:#food", "red"]);

        expect(style(recipe.path)).toEqual({ hidden: true, colour: null });
    });

    it("asks for a note once however many geotags it carries", () => {
        const { lookups, style } = styler("path:TRIPS");

        style(skye.path);
        style(skye.path);
        style(skye.path);

        expect(lookups).toEqual([skye.path]);
    });

    it("does not look a note up at all when nothing is set", () => {
        // The common case: no filter, no groups, and no reason to touch the
        // metadata cache while drawing.
        const { lookups, style } = styler("");

        expect(style(skye.path)).toEqual({ hidden: false, colour: null });
        expect(lookups).toEqual([]);
    });
});
