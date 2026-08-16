import { GeoTag } from "./geotags";
import { noteName, pinLabel } from "./labels";

function tag(path: string, alias: string | null): GeoTag {
    return {
        coordinate: { lat: 0, lon: 0 },
        alias,
        path,
        source: "body",
        key: null,
        line: 0,
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
