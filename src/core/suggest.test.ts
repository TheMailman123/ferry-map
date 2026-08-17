import { NoteDoc } from "./query";
import {
    QueryVocabulary,
    activeToken,
    applySuggestion,
    buildVocabulary,
    suggestFor,
} from "./suggest";

function doc(path: string, tags: string[] = []): NoteDoc {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return { path, basename: name.replace(/\.md$/, ""), tags };
}

const VOCABULARY: QueryVocabulary = {
    tags: ["ferry", "trip", "trip/2024"],
    folders: ["MAP_TEST", "TRIPS", "TRIPS/Old notes"],
    files: ["Isle of Skye", "Oban"],
};

/** The values a query box would offer, for terser assertions. */
function offers(text: string, cursor = text.length): string[] {
    return suggestFor(activeToken(text, cursor).text, VOCABULARY).map(
        (suggestion) => suggestion.value
    );
}

describe("activeToken", () => {
    it("is empty for an empty box", () => {
        expect(activeToken("", 0)).toEqual({ start: 0, end: 0, text: "" });
    });

    it("finds the word the caret is in", () => {
        expect(activeToken("path:TRI file:x", 8)).toEqual({
            start: 0,
            end: 8,
            text: "path:TRI",
        });
    });

    it("takes the whole word, not just what precedes the caret", () => {
        // Editing the middle of a finished term still completes that term.
        expect(activeToken("tag:ferry", 6).text).toBe("tag:ferry");
    });

    it("starts a new token after a space", () => {
        expect(activeToken("tag:ferry ", 10)).toEqual({
            start: 10,
            end: 10,
            text: "",
        });
    });

    it("treats brackets as boundaries", () => {
        expect(activeToken("(tag:fer", 8).text).toBe("tag:fer");
        expect(activeToken("(tag:fer)", 8).text).toBe("tag:fer");
    });

    it("keeps an unclosed quoted phrase together", () => {
        // Completing only "Old" would leave the rest of the phrase behind.
        expect(activeToken('path:"Old no', 12)).toEqual({
            start: 0,
            end: 12,
            text: 'path:"Old no',
        });
    });

    it("takes in the closing quote of a finished phrase", () => {
        expect(activeToken('path:"Old notes"', 12).text).toBe(
            'path:"Old notes"'
        );
    });

    it("clamps a cursor outside the text", () => {
        expect(activeToken("tag:fer", 99).text).toBe("tag:fer");
        expect(activeToken("tag:fer", -1).text).toBe("tag:fer");
    });
});

describe("suggestFor", () => {
    it("offers the keys when nothing has been typed", () => {
        expect(offers("")).toEqual(["path:", "file:", "tag:"]);
    });

    it("does not offer every value when nothing has been typed", () => {
        // An empty box offering the whole vocabulary is a list to scroll past,
        // not a suggestion.
        expect(offers("")).toHaveLength(3);
    });

    it("narrows the keys to the one being typed", () => {
        expect(offers("ta")).toContain("tag:");
        expect(offers("ta")).not.toContain("file:");
    });

    it("completes a tag from the tag list alone", () => {
        expect(offers("tag:tr")).toEqual(["tag:trip", "tag:trip/2024"]);
    });

    it("completes a folder for path:", () => {
        expect(offers("path:TRIPS")).toEqual([
            "path:TRIPS",
            'path:"TRIPS/Old notes"',
        ]);
    });

    it("completes a note name for file:", () => {
        expect(offers("file:sky")).toEqual(['file:"Isle of Skye"']);
    });

    it("ignores case", () => {
        expect(offers("tag:FER")).toEqual(["tag:ferry"]);
        expect(offers("TAG:fer")).toEqual(["tag:ferry"]);
    });

    it("qualifies a bare word with the key it matched", () => {
        // Accepting a suggestion should leave a term that says what it means,
        // not a bare word that happens to match a path today.
        expect(offers("Oban")).toEqual(["file:Oban"]);
    });

    it("searches every key for a bare word", () => {
        expect(offers("tr")).toEqual([
            "path:TRIPS",
            'path:"TRIPS/Old notes"',
            "tag:trip",
            "tag:trip/2024",
        ]);
    });

    it("ranks prefix matches above substring matches", () => {
        const vocabulary: QueryVocabulary = {
            tags: [],
            folders: [],
            files: ["Old Oban", "Oban"],
        };

        expect(suggestFor("file:oban", vocabulary).map((s) => s.label)).toEqual(
            ["Oban", "Old Oban"]
        );
    });

    it("quotes a value the tokeniser would otherwise split", () => {
        expect(offers("path:Old")).toEqual(['path:"TRIPS/Old notes"']);
    });

    it("completes inside a quoted phrase", () => {
        expect(offers('path:"Old no')).toEqual(['path:"TRIPS/Old notes"']);
    });

    it("completes a negated term", () => {
        expect(offers("-tag:fer")).toEqual(["tag:ferry"]);
    });

    it("offers nothing for a key it does not know", () => {
        expect(offers("line:12")).toEqual([]);
    });

    it("offers nothing when nothing matches", () => {
        expect(offers("tag:zzz")).toEqual([]);
    });

    it("labels a value by the value alone", () => {
        expect(suggestFor("tag:tr", VOCABULARY)[0]).toEqual({
            kind: "tag",
            value: "tag:trip",
            label: "trip",
        });
    });
});

describe("applySuggestion", () => {
    function apply(text: string, cursor = text.length) {
        const span = activeToken(text, cursor);
        const [suggestion] = suggestFor(span.text, VOCABULARY);
        return applySuggestion(text, span, suggestion);
    }

    it("replaces the term under the caret", () => {
        expect(apply("tag:tr")).toEqual({ text: "tag:trip ", cursor: 9 });
    });

    it("leaves the caret after a key, ready for its value", () => {
        expect(apply("ta")).toEqual({ text: "tag:", cursor: 4 });
    });

    it("keeps the rest of the query", () => {
        expect(apply("file:Oban tag:fer").text).toBe("file:Oban tag:ferry ");
    });

    it("replaces only the term the caret is in", () => {
        expect(apply("tag:fer file:Oban", 7).text).toBe("tag:ferry file:Oban");
    });

    it("does not double a space that is already there", () => {
        expect(apply("tag:fer file:Oban", 7).text).not.toContain("  ");
    });

    it("puts the negation back", () => {
        expect(apply("-tag:fer").text).toBe("-tag:ferry ");
    });

    it("appends to an empty box", () => {
        const span = activeToken("", 0);
        const [key] = suggestFor("", VOCABULARY);
        expect(applySuggestion("", span, key)).toEqual({
            text: "path:",
            cursor: 5,
        });
    });

    it("replaces a whole quoted phrase", () => {
        expect(apply('path:"Old no').text).toBe('path:"TRIPS/Old notes" ');
    });
});

describe("buildVocabulary", () => {
    it("is empty for no notes", () => {
        expect(buildVocabulary([])).toEqual({
            tags: [],
            folders: [],
            files: [],
        });
    });

    it("collects folders, names and tags", () => {
        expect(buildVocabulary([doc("TRIPS/Oban.md", ["#ferry"])])).toEqual({
            tags: ["ferry"],
            folders: ["TRIPS"],
            files: ["Oban"],
        });
    });

    it("offers every folder on the way down", () => {
        // `path:TRIPS` matches everything under it, so it is worth offering
        // even though no note sits directly in it.
        expect(buildVocabulary([doc("TRIPS/2024/Oban.md")]).folders).toEqual([
            "TRIPS",
            "TRIPS/2024",
        ]);
    });

    it("offers a nested tag's ancestors", () => {
        expect(buildVocabulary([doc("a.md", ["#trip/2024"])]).tags).toEqual([
            "trip",
            "trip/2024",
        ]);
    });

    it("gives a note at the vault root no folder", () => {
        expect(buildVocabulary([doc("Oban.md")]).folders).toEqual([]);
    });

    it("strips the leading hash", () => {
        expect(buildVocabulary([doc("a.md", ["#ferry"])]).tags).toEqual([
            "ferry",
        ]);
    });

    it("does not repeat a value two notes share", () => {
        expect(
            buildVocabulary([
                doc("TRIPS/a.md", ["#ferry"]),
                doc("TRIPS/b.md", ["#ferry"]),
            ])
        ).toEqual({
            tags: ["ferry"],
            folders: ["TRIPS"],
            files: ["a", "b"],
        });
    });

    it("sorts without regard to case", () => {
        // Names that a plain code-point sort would put the other way round: a
        // capital letter sorts before every lower-case one.
        expect(
            buildVocabulary([doc("Zebra.md"), doc("apple.md")]).files
        ).toEqual(["apple", "Zebra"]);
    });

    it("omits values the query language cannot express", () => {
        // A `"` has no spelling inside a quoted phrase, so suggesting one would
        // hand back a query meaning something other than what was clicked.
        expect(buildVocabulary([doc('He said "no".md')]).files).toEqual([]);
    });
});
