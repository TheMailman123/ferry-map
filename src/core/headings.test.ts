import { HeadingLike, headingTrail } from "./headings";

/** A heading as the metadata cache reports one. */
function heading(text: string, level: number, line: number): HeadingLike {
    return { heading: text, level, position: { start: { line } } };
}

/** A trip note: a day per section, with the afternoon split out under one. */
const NOTE = [
    heading("Skye", 1, 0),
    heading("Day 1", 2, 4),
    heading("Day 2", 2, 12),
    heading("Morning", 3, 14),
    heading("Afternoon", 3, 20),
    heading("Day 3", 2, 30),
];

describe("headingTrail", () => {
    it("is empty for a property geotag, which has no line", () => {
        expect(headingTrail(null, NOTE)).toEqual([]);
    });

    it("is empty in a note with no headings", () => {
        expect(headingTrail(7, [])).toEqual([]);
    });

    it("is empty above the first heading", () => {
        // An intro paragraph written before any heading is in no section.
        const note = [heading("Skye", 1, 3)];

        expect(headingTrail(1, note)).toEqual([]);
    });

    it("names the section a geotag sits in", () => {
        expect(headingTrail(6, NOTE)).toEqual(["Skye", "Day 1"]);
    });

    it("names every enclosing section, outermost first", () => {
        expect(headingTrail(16, NOTE)).toEqual(["Skye", "Day 2", "Morning"]);
    });

    it("leaves out a sibling section the line is not in", () => {
        // "Morning" ends where "Afternoon" begins; a geotag in the afternoon is
        // in neither the morning nor, later, in Day 3.
        expect(headingTrail(22, NOTE)).toEqual(["Skye", "Day 2", "Afternoon"]);
    });

    it("drops back out of a subsection at the next section", () => {
        expect(headingTrail(31, NOTE)).toEqual(["Skye", "Day 3"]);
    });

    it("puts a geotag on a heading's own line in that heading", () => {
        // "## [[58.6276, -4.9997]]" is a section named by where it is.
        expect(headingTrail(12, NOTE)).toEqual(["Skye", "Day 2"]);
    });

    it("takes the line before a heading as still in the previous section", () => {
        expect(headingTrail(11, NOTE)).toEqual(["Skye", "Day 1"]);
    });

    it("stays in the last section to the end of the note", () => {
        expect(headingTrail(9999, NOTE)).toEqual(["Skye", "Day 3"]);
    });

    it("handles a note whose sections start deeper than level one", () => {
        const deep = [heading("Stops", 3, 0), heading("Uig", 4, 5)];

        expect(headingTrail(6, deep)).toEqual(["Stops", "Uig"]);
    });

    it("skips a level that was never used", () => {
        const skipped = [heading("Skye", 1, 0), heading("Elgol", 4, 3)];

        expect(headingTrail(4, skipped)).toEqual(["Skye", "Elgol"]);
    });

    it("does not treat a shallower later heading as an ancestor", () => {
        const note = [heading("Morning", 3, 0), heading("Day 2", 2, 5)];

        expect(headingTrail(6, note)).toEqual(["Day 2"]);
    });

    it("leaves an empty heading out of the path", () => {
        const note = [heading("Day 2", 2, 0), heading("", 3, 4)];

        expect(headingTrail(5, note)).toEqual(["Day 2"]);
    });

    it("still breaks sections at an empty heading", () => {
        // The blank "###" ends "Morning", so a geotag after it is in neither.
        const note = [
            heading("Day 2", 2, 0),
            heading("Morning", 3, 2),
            heading("   ", 3, 6),
        ];

        expect(headingTrail(7, note)).toEqual(["Day 2"]);
    });

    it("defaults to a note with no headings when none are given", () => {
        // The cache omits the array entirely in a note that has none.
        expect(headingTrail(3)).toEqual([]);
    });
});
