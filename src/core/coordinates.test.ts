import {
    Coordinate,
    formatCoordinate,
    formatGeotag,
    parseCoordinate,
} from "./coordinates";

/** Assert a target parses to a coordinate, returning it. */
function expectCoordinate(text: string): Coordinate {
    const parsed = parseCoordinate(text);
    if (parsed.kind !== "coordinate") {
        throw new Error(`expected "${text}" to parse, got ${parsed.kind}`);
    }
    return parsed.coordinate;
}

/** Assert a target is geotag-shaped but rejected, returning the reason. */
function expectMalformed(text: string): string {
    const parsed = parseCoordinate(text);
    if (parsed.kind !== "malformed") {
        throw new Error(
            `expected "${text}" to be malformed, got ${parsed.kind}`
        );
    }
    return parsed.reason;
}

function expectNotAGeotag(text: string): void {
    expect(parseCoordinate(text).kind).toBe("not-a-geotag");
}

describe("parseCoordinate: valid coordinates", () => {
    it("parses a signed decimal pair", () => {
        expect(expectCoordinate("58.6276, -4.9997")).toEqual({
            lat: 58.6276,
            lon: -4.9997,
        });
    });

    it("tolerates absent and generous whitespace", () => {
        const expected = { lat: 58.6276, lon: -4.9997 };
        expect(expectCoordinate("58.6276,-4.9997")).toEqual(expected);
        expect(expectCoordinate("  58.6276 ,   -4.9997  ")).toEqual(expected);
    });

    it("accepts integers, a leading plus, and a bare decimal point", () => {
        expect(expectCoordinate("54, -4")).toEqual({ lat: 54, lon: -4 });
        expect(expectCoordinate("+58.6276, +4.9997")).toEqual({
            lat: 58.6276,
            lon: 4.9997,
        });
        expect(expectCoordinate(".5, -.25")).toEqual({ lat: 0.5, lon: -0.25 });
    });

    it("accepts null island and both poles", () => {
        expect(expectCoordinate("0, 0")).toEqual({ lat: 0, lon: 0 });
        expect(expectCoordinate("90, 0")).toEqual({ lat: 90, lon: 0 });
        expect(expectCoordinate("-90, 0")).toEqual({ lat: -90, lon: 0 });
    });

    it("accepts both sides of the antimeridian", () => {
        expect(expectCoordinate("0, 180")).toEqual({ lat: 0, lon: 180 });
        expect(expectCoordinate("0, -180")).toEqual({ lat: 0, lon: -180 });
    });
});

describe("parseCoordinate: ordinary note links are left alone", () => {
    it("ignores a note name containing a comma", () => {
        expectNotAGeotag("Chapter 3, Part 2");
    });

    it("ignores a note name that starts with a number", () => {
        // The discriminating case: the first part is numeric, the second is not.
        expectNotAGeotag("2024, notes from the field");
    });

    it("ignores links with no comma at all", () => {
        expectNotAGeotag("Cape Wrath");
        expectNotAGeotag("58.6276");
        expectNotAGeotag("");
    });

    it("ignores a trailing comma rather than reading it as a second value", () => {
        expectNotAGeotag("Some note,");
        expectNotAGeotag("58.6276,");
    });

    it("ignores a multi-part name where some part is non-numeric", () => {
        expectNotAGeotag("Chapter 3, Part 2, Section 1");
    });
});

describe("parseCoordinate: geotag-shaped but unusable", () => {
    it("reports latitude beyond the poles", () => {
        expect(expectMalformed("95.0, -4.9997")).toMatch(
            /latitude 95 is outside/
        );
    });

    it("reports longitude beyond the antimeridian", () => {
        expect(expectMalformed("58.6276, -185.2")).toMatch(
            /longitude -185.2 is outside/
        );
    });

    it("reports a third value", () => {
        expect(expectMalformed("58.6276, -4.9997, 12")).toMatch(
            /expected 2 values .*found 3/
        );
    });

    it("reports text trailing a value, the likely typo for a missing pipe", () => {
        expect(expectMalformed("58.6276, -4.9997 lighthouse")).toMatch(
            /"-4.9997 lighthouse" is not a number/
        );
    });

    it("reports a heading subpath appended to a geotag", () => {
        expect(expectMalformed("58.6276, -4.9997#Notes")).toMatch(
            /is not a number/
        );
    });
});

describe("formatCoordinate", () => {
    it("rounds to four decimal places by default", () => {
        expect(formatCoordinate({ lat: 58.62761234, lon: -4.99973456 })).toBe(
            "58.6276, -4.9997"
        );
    });

    it("pads to the requested precision", () => {
        expect(formatCoordinate({ lat: 54, lon: -4 })).toBe("54.0000, -4.0000");
        expect(formatCoordinate({ lat: 54, lon: -4 }, 1)).toBe("54.0, -4.0");
    });

    it("does not emit negative zero", () => {
        // toFixed keeps the sign, which would otherwise produce "-0.0000".
        expect(formatCoordinate({ lat: -0.00001, lon: -0.00002 })).toBe(
            "0.0000, 0.0000"
        );
    });
});

describe("formatGeotag", () => {
    it("wraps the coordinate in link brackets", () => {
        expect(formatGeotag({ lat: 58.6276, lon: -4.9997 })).toBe(
            "[[58.6276, -4.9997]]"
        );
    });

    it("emits only geotags it can read back", () => {
        // The plugin must never write a geotag its own parser rejects.
        const points: Coordinate[] = [
            { lat: 0, lon: 0 },
            { lat: 90, lon: 180 },
            { lat: -90, lon: -180 },
            { lat: 58.62761234, lon: -4.99973456 },
            { lat: -0.00001, lon: -0.00002 },
        ];

        for (const point of points) {
            const target = formatCoordinate(point);
            expect(parseCoordinate(target).kind).toBe("coordinate");
        }
    });
});
