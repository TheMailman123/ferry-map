import { GeoTag } from "./geotags";
import { noteName, originPath, pinDescription, pinLabel } from "./labels";

function tag(path: string, alias: string | null): GeoTag {
    return {
        coordinate: { lat: 0, lon: 0 },
        alias,
        path,
        source: "body",
        key: null,
        line: 0,
        headingTrail: [],
    };
}

describe("noteName", () => {
    it("strips the folder and the extension", () => {
        expect(noteName("TRIPS/20240612_COASTPATH.md")).toBe(
            "20240612_COASTPATH"
        );
    });

    it("handles a note at the vault root", () => {
        expect(noteName("Cape Wrath.md")).toBe("Cape Wrath");
    });

    it("handles nested folders", () => {
        expect(noteName("a/b/c/Note.md")).toBe("Note");
    });

    it("strips only the trailing extension", () => {
        expect(noteName("Chapter 3.2.md")).toBe("Chapter 3.2");
    });

    it("leaves a name with no extension alone", () => {
        expect(noteName("README")).toBe("README");
    });

    it("does not mistake a leading dot for an extension", () => {
        expect(noteName(".hidden")).toBe(".hidden");
    });
});

describe("pinLabel", () => {
    it("uses the note name when the geotag has no alias", () => {
        expect(pinLabel(tag("TRIPS/20240612_COASTPATH.md", null))).toBe(
            "20240612_COASTPATH"
        );
    });

    it("prefers the alias when there is one", () => {
        expect(pinLabel(tag("TRIPS/20240612_COASTPATH.md", "Seal Cove"))).toBe(
            "Seal Cove"
        );
    });
});

describe("originPath", () => {
    it("is the note alone where the geotag is under no heading", () => {
        expect(originPath({ noteName: "Skye", headingTrail: [] })).toBe("Skye");
    });

    it("puts the note before the section it contains", () => {
        expect(originPath({ noteName: "Skye", headingTrail: ["Day 2"] })).toBe(
            "Skye › Day 2"
        );
    });

    it("keeps nested sections in order, outermost first", () => {
        expect(
            originPath({
                noteName: "Skye",
                headingTrail: ["Day 2", "Morning"],
            })
        ).toBe("Skye › Day 2 › Morning");
    });
});

describe("pinDescription", () => {
    it("names an aliased pin, then where it came from", () => {
        expect(
            pinDescription({
                label: "Elgol",
                noteName: "Skye",
                headingTrail: ["Day 2"],
            })
        ).toBe("Elgol — Skye › Day 2");
    });

    it("does not repeat a note that is already the pin's label", () => {
        expect(
            pinDescription({
                label: "Skye",
                noteName: "Skye",
                headingTrail: ["Day 2"],
            })
        ).toBe("Skye › Day 2");
    });

    it("is the note alone for an unaliased pin under no heading", () => {
        expect(
            pinDescription({
                label: "Skye",
                noteName: "Skye",
                headingTrail: [],
            })
        ).toBe("Skye");
    });

    it("still names the note for an aliased pin under no heading", () => {
        expect(
            pinDescription({
                label: "Elgol",
                noteName: "Skye",
                headingTrail: [],
            })
        ).toBe("Elgol — Skye");
    });
});
