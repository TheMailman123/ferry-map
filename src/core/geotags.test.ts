import { MetadataLike, extractGeoTags, isEmpty } from "./geotags";

/** A body link as Obsidian caches it. Unaliased links carry displayText === link. */
function bodyLink(link: string, line: number, displayText: string = link) {
    return { link, displayText, position: { start: { line }, end: { line } } };
}

/** A property link as Obsidian caches it: no position, but a key. */
function propertyLink(link: string, key: string, displayText: string = link) {
    return { link, displayText, key };
}

describe("extractGeoTags: body links", () => {
    it("extracts an unaliased geotag with its line", () => {
        const cache: MetadataLike = {
            links: [bodyLink("58.6276, -4.9997", 12)],
        };

        const { tags, problems } = extractGeoTags("places/wrath.md", cache);

        expect(problems).toEqual([]);
        expect(tags).toEqual([
            {
                coordinate: { lat: 58.6276, lon: -4.9997 },
                alias: null,
                path: "places/wrath.md",
                source: "body",
                key: null,
                line: 12,
            },
        ]);
    });

    it("keeps the alias when the link has one", () => {
        const cache: MetadataLike = {
            links: [bodyLink("58.6276, -4.9997", 3, "Cape Wrath Lighthouse")],
        };

        expect(extractGeoTags("a.md", cache).tags[0].alias).toBe(
            "Cape Wrath Lighthouse"
        );
    });

    it("treats displayText equal to the link as no alias", () => {
        // Obsidian populates displayText even for unaliased links.
        const cache: MetadataLike = {
            links: [bodyLink("58.6276, -4.9997", 0)],
        };

        expect(extractGeoTags("a.md", cache).tags[0].alias).toBeNull();
    });

    it("extracts several geotags from one note, in order", () => {
        const cache: MetadataLike = {
            links: [
                bodyLink("58.6276, -4.9997", 1, "Lighthouse"),
                bodyLink("58.5901, -4.8812", 4, "Bothy"),
                bodyLink("58.5533, -4.712", 9),
            ],
        };

        const { tags } = extractGeoTags("trip.md", cache);

        expect(tags).toHaveLength(3);
        expect(tags.map((t) => t.alias)).toEqual(["Lighthouse", "Bothy", null]);
        expect(tags.map((t) => t.line)).toEqual([1, 4, 9]);
    });

    it("ignores ordinary note links alongside geotags", () => {
        const cache: MetadataLike = {
            links: [
                bodyLink("Chapter 3, Part 2", 0),
                bodyLink("58.6276, -4.9997", 1),
                bodyLink("Some Other Note", 2),
            ],
        };

        const { tags, problems } = extractGeoTags("a.md", cache);

        expect(tags).toHaveLength(1);
        expect(problems).toEqual([]);
    });

    it("copes with a link that has no cached position", () => {
        const cache: MetadataLike = { links: [{ link: "58.6276, -4.9997" }] };

        expect(extractGeoTags("a.md", cache).tags[0].line).toBeNull();
    });
});

describe("extractGeoTags: property links", () => {
    it("extracts a geotag from a property, recording its key", () => {
        const cache: MetadataLike = {
            frontmatterLinks: [propertyLink("58.6276, -4.9997", "location")],
        };

        const { tags } = extractGeoTags("places/wrath.md", cache);

        expect(tags).toEqual([
            {
                coordinate: { lat: 58.6276, lon: -4.9997 },
                alias: null,
                path: "places/wrath.md",
                source: "property",
                key: "location",
                line: null,
            },
        ]);
    });

    it("extracts each entry of a list-valued property", () => {
        // Obsidian keys list entries by index.
        const cache: MetadataLike = {
            frontmatterLinks: [
                propertyLink("58.6276, -4.9997", "location.0", "Lighthouse"),
                propertyLink("58.5901, -4.8812", "location.1", "Bothy"),
            ],
        };

        const { tags } = extractGeoTags("a.md", cache);

        expect(tags.map((t) => t.key)).toEqual(["location.0", "location.1"]);
        expect(tags.map((t) => t.alias)).toEqual(["Lighthouse", "Bothy"]);
    });

    it("recognises a geotag under any property key", () => {
        const cache: MetadataLike = {
            frontmatterLinks: [propertyLink("58.6276, -4.9997", "camp")],
        };

        expect(extractGeoTags("a.md", cache).tags).toHaveLength(1);
    });

    it("reads body and property geotags together", () => {
        const cache: MetadataLike = {
            links: [bodyLink("58.5901, -4.8812", 7)],
            frontmatterLinks: [propertyLink("58.6276, -4.9997", "location")],
        };

        const { tags } = extractGeoTags("a.md", cache);

        expect(tags.map((t) => t.source)).toEqual(["body", "property"]);
    });
});

describe("extractGeoTags: problems", () => {
    it("reports a malformed geotag with the text as written", () => {
        const cache: MetadataLike = { links: [bodyLink("95.0, -4.9997", 5)] };

        const { tags, problems } = extractGeoTags("a.md", cache);

        expect(tags).toEqual([]);
        expect(problems).toEqual([
            {
                path: "a.md",
                raw: "95.0, -4.9997",
                reason: expect.stringMatching(/latitude 95 is outside/),
                source: "body",
                key: null,
                line: 5,
            },
        ]);
    });

    it("reports a malformed geotag in a property", () => {
        const cache: MetadataLike = {
            frontmatterLinks: [
                propertyLink("58.6276, -4.9997, 12", "location"),
            ],
        };

        const { problems } = extractGeoTags("a.md", cache);

        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({
            source: "property",
            key: "location",
        });
    });

    it("keeps good geotags from a note that also holds a bad one", () => {
        const cache: MetadataLike = {
            links: [bodyLink("58.6276, -4.9997", 1), bodyLink("95.0, 0", 2)],
        };

        const { tags, problems } = extractGeoTags("a.md", cache);

        expect(tags).toHaveLength(1);
        expect(problems).toHaveLength(1);
    });
});

describe("extractGeoTags: empty inputs", () => {
    it("returns nothing for an unindexed note", () => {
        expect(extractGeoTags("a.md", null)).toEqual({
            tags: [],
            problems: [],
        });
        expect(extractGeoTags("a.md", undefined)).toEqual({
            tags: [],
            problems: [],
        });
    });

    it("returns nothing for a note with no links", () => {
        expect(isEmpty(extractGeoTags("a.md", {}))).toBe(true);
    });

    it("reports a note with only ordinary links as empty", () => {
        const cache: MetadataLike = { links: [bodyLink("Some Note", 0)] };

        expect(isEmpty(extractGeoTags("a.md", cache))).toBe(true);
    });
});
