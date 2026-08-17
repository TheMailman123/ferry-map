import { NoteDoc, Query, matches, parseQuery } from "./query";

/** A note as the query engine sees it. */
function doc(path: string, ...tags: string[]): NoteDoc {
    const filename = path.slice(path.lastIndexOf("/") + 1);
    return { path, basename: filename.replace(/\.md$/, ""), tags };
}

/** Parse and match in one step, since that is how the map uses this. */
function hits(query: string, note: NoteDoc): boolean {
    const parsed = parseQuery(query);
    if (parsed === null) {
        throw new Error(`"${query}" parsed to nothing; use expectEmpty.`);
    }
    return matches(parsed, note);
}

const skye = doc("TRIPS/Isle of Skye.md", "#trip", "#trip/2024", "#ferry");
const wrath = doc("TRIPS/2023/Cape Wrath.md", "#trip", "#walking");
const recipe = doc("Recipes/Cullen Skink.md", "#food");

describe("bare words", () => {
    it("match anywhere in the path", () => {
        expect(hits("skye", skye)).toBe(true);
        expect(hits("trips", skye)).toBe(true);
    });

    it("ignore case in both the query and the note", () => {
        expect(hits("SKYE", skye)).toBe(true);
        expect(hits("iSlE", skye)).toBe(true);
        expect(hits("trips/isle", skye)).toBe(true);
    });

    it("do not match a note they have nothing to do with", () => {
        expect(hits("skye", wrath)).toBe(false);
        expect(hits("lighthouse", skye)).toBe(false);
    });

    it("are substrings, not whole words", () => {
        expect(hits("sky", skye)).toBe(true);
    });

    it("treat an unknown operator as ordinary text", () => {
        // Only path:, file: and tag: are operators. Anything else is a word,
        // and must not silently match everything.
        expect(hits("line:12", skye)).toBe(false);
    });
});

describe("quoted phrases", () => {
    it("match a run containing spaces", () => {
        expect(hits('"isle of skye"', skye)).toBe(true);
        expect(hits('"of skye"', skye)).toBe(true);
    });

    it("require the words in order, unlike separate terms", () => {
        // Separate terms are ANDed and may appear in any order; a phrase may
        // not. This is the whole reason quoting exists.
        expect(hits("skye isle", skye)).toBe(true);
        expect(hits('"skye isle"', skye)).toBe(false);
    });

    it("keep an operator prefix as literal text when quoted", () => {
        expect(hits('"path:TRIPS"', skye)).toBe(false);
    });

    it("run to the end of the input when the closing quote is missing", () => {
        // A half-typed phrase should narrow the map, not blank it.
        expect(hits('"isle of', skye)).toBe(true);
        expect(hits('"isle of', wrath)).toBe(false);
    });
});

describe("path:", () => {
    it("matches a folder in the path", () => {
        expect(hits("path:TRIPS", skye)).toBe(true);
        expect(hits("path:TRIPS", recipe)).toBe(false);
    });

    it("matches a nested folder", () => {
        expect(hits("path:TRIPS/2023", wrath)).toBe(true);
        expect(hits("path:TRIPS/2023", skye)).toBe(false);
    });

    it("includes the file name, as Obsidian's does", () => {
        expect(hits("path:Skye", skye)).toBe(true);
    });

    it("takes a quoted value with spaces", () => {
        expect(hits('path:"Isle of"', skye)).toBe(true);
        expect(hits('path:"Isle of"', wrath)).toBe(false);
    });
});

describe("file:", () => {
    it("matches the note's own name", () => {
        expect(hits("file:Skye", skye)).toBe(true);
        expect(hits("file:Skink", recipe)).toBe(true);
    });

    it("does not match a folder the note merely sits in", () => {
        // The distinction from path: is the point of having both.
        expect(hits("file:TRIPS", skye)).toBe(false);
        expect(hits("path:TRIPS", skye)).toBe(true);
    });

    it("does not match the extension", () => {
        // Every note is .md, so matching it would match the whole vault.
        expect(hits("file:md", skye)).toBe(false);
    });
});

describe("tag:", () => {
    it("matches a tag on the note, with or without the #", () => {
        expect(hits("tag:#ferry", skye)).toBe(true);
        expect(hits("tag:ferry", skye)).toBe(true);
        expect(hits("tag:#ferry", wrath)).toBe(false);
    });

    it("ignores case", () => {
        expect(hits("tag:#FERRY", skye)).toBe(true);
        expect(hits("tag:#trip", doc("a.md", "#TRIP"))).toBe(true);
    });

    it("matches subtags of the tag asked for", () => {
        expect(hits("tag:#trip", doc("a.md", "#trip/2024"))).toBe(true);
    });

    it("does not match a tag that merely starts with the same letters", () => {
        // #trips is a different tag from #trip, and this is the case a plain
        // startsWith would get wrong.
        expect(hits("tag:#trip", doc("a.md", "#trips"))).toBe(false);
        expect(hits("tag:#trip", doc("a.md", "#tripoli"))).toBe(false);
    });

    it("does not match a parent tag when a subtag was asked for", () => {
        expect(hits("tag:#trip/2024", doc("a.md", "#trip"))).toBe(false);
    });

    it("does not match a note with no tags at all", () => {
        expect(hits("tag:#trip", doc("a.md"))).toBe(false);
    });

    it("does not match the tag's text appearing in the path", () => {
        expect(hits("tag:#recipes", recipe)).toBe(false);
    });
});

describe("negation", () => {
    it("excludes matching notes", () => {
        expect(hits("-path:TRIPS", skye)).toBe(false);
        expect(hits("-path:TRIPS", recipe)).toBe(true);
    });

    it("applies to bare words and tags alike", () => {
        expect(hits("-skye", skye)).toBe(false);
        expect(hits("-tag:#trip", skye)).toBe(false);
        expect(hits("-tag:#trip", recipe)).toBe(true);
    });

    it("combines with other terms", () => {
        expect(hits("path:TRIPS -tag:#walking", skye)).toBe(true);
        expect(hits("path:TRIPS -tag:#walking", wrath)).toBe(false);
    });

    it("is not triggered by a hyphen inside a word", () => {
        const hyphenated = doc("Trips/sub-folder/Note.md");
        expect(hits("sub-folder", hyphenated)).toBe(true);
        expect(hits("sub-folder", skye)).toBe(false);
    });

    it("negates a whole bracketed group", () => {
        expect(hits("-(skye OR wrath)", skye)).toBe(false);
        expect(hits("-(skye OR wrath)", recipe)).toBe(true);
    });
});

describe("combining terms", () => {
    it("ANDs adjacent terms", () => {
        expect(hits("path:TRIPS tag:#ferry", skye)).toBe(true);
        expect(hits("path:TRIPS tag:#ferry", wrath)).toBe(false);
        expect(hits("path:Recipes tag:#ferry", skye)).toBe(false);
    });

    it("ORs across an OR", () => {
        expect(hits("tag:#ferry OR tag:#walking", skye)).toBe(true);
        expect(hits("tag:#ferry OR tag:#walking", wrath)).toBe(true);
        expect(hits("tag:#ferry OR tag:#walking", recipe)).toBe(false);
    });

    it("binds AND tighter than OR", () => {
        // "a b OR c" is "(a AND b) OR c", not "a AND (b OR c)".
        expect(parseQuery("path:TRIPS tag:#ferry OR tag:#food")).toEqual({
            kind: "or",
            operands: [
                {
                    kind: "and",
                    operands: [
                        { kind: "path", value: "trips" },
                        { kind: "tag", value: "ferry" },
                    ],
                },
                { kind: "tag", value: "food" },
            ],
        });

        expect(hits("path:TRIPS tag:#ferry OR tag:#food", recipe)).toBe(true);
    });

    it("groups with brackets against that precedence", () => {
        expect(hits("path:TRIPS (tag:#ferry OR tag:#food)", skye)).toBe(true);
        expect(hits("path:TRIPS (tag:#ferry OR tag:#food)", recipe)).toBe(
            false
        );
    });

    it("nests brackets", () => {
        expect(hits("(path:TRIPS (tag:#food OR tag:#ferry))", skye)).toBe(true);
    });

    it("treats a lowercase or as an ordinary word", () => {
        // Obsidian's OR is capitals-only, so a note about Orkney stays findable.
        expect(parseQuery("skye or wrath")).toEqual({
            kind: "and",
            operands: [
                { kind: "text", value: "skye" },
                { kind: "text", value: "or" },
                { kind: "text", value: "wrath" },
            ],
        });
    });

    it("treats a quoted OR as an ordinary word", () => {
        expect(parseQuery('"OR"')).toEqual({ kind: "text", value: "or" });
    });
});

describe("queries that ask nothing", () => {
    const empty = ["", "   ", "\t\n", "-", " - ", "path:", "tag:", "file:"];

    it.each(empty)("%p parses to null", (query) => {
        expect(parseQuery(query)).toBeNull();
    });

    it("drops a half-typed operator but keeps the rest of the query", () => {
        // Typing "path:" mid-query must not blank the map.
        expect(hits("skye path:", skye)).toBe(true);
        expect(hits("skye path:", wrath)).toBe(false);
    });

    it("does not let a detached hyphen negate the next term", () => {
        // "- skye" is a hyphen the user has not attached to anything yet, not
        // an exclusion of Skye. Attaching it is the space being deleted.
        expect(hits("- skye", skye)).toBe(true);
        expect(hits("- skye", wrath)).toBe(false);
        expect(hits("-skye", skye)).toBe(false);
    });

    it("drops a negation with nothing to negate", () => {
        // Not "match nothing": a dangling "-" has not said anything yet, so it
        // leaves the rest of the query — or the whole map — alone.
        expect(hits("skye -", skye)).toBe(true);
        expect(hits("skye -", wrath)).toBe(false);
        expect(parseQuery("-path:")).toBeNull();
    });
});

describe("recovering from unbalanced input", () => {
    it("closes an unclosed bracket at the end", () => {
        expect(hits("(tag:#ferry OR tag:#food", skye)).toBe(true);
        expect(hits("(tag:#ferry OR tag:#food", wrath)).toBe(false);
    });

    it("ignores a bracket that closes nothing", () => {
        expect(hits("skye)", skye)).toBe(true);
        expect(hits(")skye", skye)).toBe(true);
        expect(hits("skye) wrath", skye)).toBe(false);
    });

    it("uses the side it has when OR is missing one", () => {
        expect(hits("skye OR", skye)).toBe(true);
        expect(hits("OR skye", skye)).toBe(true);
        expect(hits("skye OR OR wrath", wrath)).toBe(true);
    });

    it("terminates on adversarial bracket soup", () => {
        // Guards the parser's progress check: recovery must always consume a
        // token, or a query like this would hang the map.
        expect(parseQuery(")))")).toBeNull();
        expect(parseQuery("((((")).toBeNull();
        expect(parseQuery("-(-(-(")).toBeNull();
        expect(hits("()skye()", skye)).toBe(true);
    });
});

describe("the AST", () => {
    it("keeps operators distinct so each can match differently", () => {
        const parsed = parseQuery('path:a file:b tag:#c d "e f"') as Query;

        expect(parsed).toEqual({
            kind: "and",
            operands: [
                { kind: "path", value: "a" },
                { kind: "file", value: "b" },
                { kind: "tag", value: "c" },
                { kind: "text", value: "d" },
                { kind: "text", value: "e f" },
            ],
        });
    });

    it("does not wrap a lone term in a conjunction", () => {
        expect(parseQuery("skye")).toEqual({ kind: "text", value: "skye" });
    });

    it("strips a leading # from a tag once, at parse time", () => {
        expect(parseQuery("tag:#trip")).toEqual({
            kind: "tag",
            value: "trip",
        });
    });
});
