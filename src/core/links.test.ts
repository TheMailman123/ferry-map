import { parseCoordinate } from "./coordinates";
import { linkTarget } from "./links";

describe("linkTarget", () => {
    it("returns a bare href unchanged", () => {
        expect(linkTarget("58.6276, -4.9997")).toBe("58.6276, -4.9997");
    });

    it("strips wikilink brackets", () => {
        expect(linkTarget("[[58.6276, -4.9997]]")).toBe("58.6276, -4.9997");
    });

    it("drops an alias", () => {
        expect(linkTarget("58.6276, -4.9997|Cape Wrath")).toBe(
            "58.6276, -4.9997"
        );
        expect(linkTarget("[[58.6276, -4.9997|Cape Wrath]]")).toBe(
            "58.6276, -4.9997"
        );
    });

    it("trims surrounding whitespace", () => {
        expect(linkTarget("  [[58.6276, -4.9997]]  ")).toBe("58.6276, -4.9997");
    });

    it("leaves an ordinary note link alone", () => {
        expect(linkTarget("[[Chapter 3, Part 2]]")).toBe("Chapter 3, Part 2");
    });

    it("produces targets the coordinate parser accepts", () => {
        const forms = [
            "58.6276, -4.9997",
            "[[58.6276, -4.9997]]",
            "[[58.6276, -4.9997|Cape Wrath]]",
        ];

        for (const form of forms) {
            expect(parseCoordinate(linkTarget(form)).kind).toBe("coordinate");
        }
    });

    it("does not turn an ordinary link into a geotag", () => {
        expect(parseCoordinate(linkTarget("[[Chapter 3, Part 2]]")).kind).toBe(
            "not-a-geotag"
        );
    });
});
