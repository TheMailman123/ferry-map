/**
 * @jest-environment jsdom
 *
 * Reading a link's target out of the DOM Obsidian actually renders.
 *
 * These need a real DOM rather than a stand-in: the bug they exist to prevent
 * was a misreading of `closest` and sibling traversal, which a hand-rolled fake
 * would have reproduced rather than caught.
 */

import { parseCoordinate } from "./coordinates";
import { linkTargetUnder } from "./links";

const GEOTAG = "58.6276, -4.9997";

/** A rendered link, as reading view and live preview produce one. */
function anchor(href: string, text: string, attribute = "data-href"): Element {
    const el = document.createElement("a");
    el.setAttribute(attribute, href);
    el.textContent = text;
    document.body.appendChild(el);
    return el;
}

/**
 * Raw wikilink syntax, as CodeMirror renders it while the editor shows link
 * markup: one span per part, every part carrying the same class.
 *
 * @returns the parts, so a test can click whichever one it means to
 */
function rawLink(target: string, alias: string | null = null): Element[] {
    const line = document.createElement("div");
    document.body.appendChild(line);

    const texts =
        alias === null
            ? ["[[", target, "]]"]
            : ["[[", target, "|", alias, "]]"];

    return texts.map((text) => {
        const span = document.createElement("span");
        span.className = "cm-hmd-internal-link";
        span.textContent = text;
        line.appendChild(span);
        return span;
    });
}

beforeEach(() => document.body.replaceChildren());

describe("linkTargetUnder", () => {
    it("is null off any link", () => {
        const el = document.createElement("p");
        el.textContent = "ordinary prose";
        document.body.appendChild(el);

        expect(linkTargetUnder(el)).toBeNull();
    });

    it("is null for a non-element target", () => {
        expect(linkTargetUnder(null)).toBeNull();
    });

    describe("rendered links", () => {
        it("reads a plain anchor's data-href", () => {
            expect(linkTargetUnder(anchor(GEOTAG, GEOTAG))).toBe(GEOTAG);
        });

        it("reads an aliased anchor's data-href, not its text", () => {
            expect(linkTargetUnder(anchor(GEOTAG, "Cape Wrath"))).toBe(GEOTAG);
        });

        it("falls back to href where there is no data-href", () => {
            expect(linkTargetUnder(anchor(GEOTAG, "Cape Wrath", "href"))).toBe(
                GEOTAG
            );
        });

        it("reads through an element nested inside the anchor", () => {
            const link = anchor(GEOTAG, "");
            const inner = document.createElement("span");
            inner.textContent = "Cape Wrath";
            link.appendChild(inner);

            expect(linkTargetUnder(inner)).toBe(GEOTAG);
        });
    });

    describe("raw wikilink syntax in the editor", () => {
        it("reads a plain link from its target span", () => {
            const [, target] = rawLink(GEOTAG);

            expect(linkTargetUnder(target)).toBe(GEOTAG);
        });

        it("reads an aliased link from its target span", () => {
            const [, target] = rawLink(GEOTAG, "Cape Wrath");

            expect(linkTargetUnder(target)).toBe(GEOTAG);
        });

        it("reads an aliased link from its ALIAS span", () => {
            // The bug: the alias is its own span carrying the same class, so
            // reading that span alone yielded "Cape Wrath", which is not a
            // coordinate, and the click fell through to Obsidian — which
            // offered to create a note called Cape Wrath.
            const [, , , alias] = rawLink(GEOTAG, "Cape Wrath");

            expect(linkTargetUnder(alias)).toBe(GEOTAG);
        });

        it("reads an aliased link from its pipe", () => {
            const [, , pipe] = rawLink(GEOTAG, "Cape Wrath");

            expect(linkTargetUnder(pipe)).toBe(GEOTAG);
        });

        it("reads an aliased link from either bracket", () => {
            const parts = rawLink(GEOTAG, "Cape Wrath");

            expect(linkTargetUnder(parts[0])).toBe(GEOTAG);
            expect(linkTargetUnder(parts[4])).toBe(GEOTAG);
        });

        it("reads through an element nested inside a part", () => {
            const [, target] = rawLink(GEOTAG, "Cape Wrath");
            const inner = document.createElement("span");
            inner.className = "cm-underline";
            inner.textContent = target.textContent;
            target.replaceChildren(inner);

            expect(linkTargetUnder(inner)).toBe(GEOTAG);
        });

        it("does not run two adjacent links together", () => {
            // Written back to back with nothing between them, the parts are all
            // siblings; only the closing brackets say where one link ends.
            const line = document.createElement("div");
            document.body.appendChild(line);

            const parts: Element[] = [];
            for (const text of ["[[", GEOTAG, "]]", "[[", "51.5, -0.1", "]]"]) {
                const span = document.createElement("span");
                span.className = "cm-hmd-internal-link";
                span.textContent = text;
                line.appendChild(span);
                parts.push(span);
            }

            expect(linkTargetUnder(parts[1])).toBe(GEOTAG);
            expect(linkTargetUnder(parts[4])).toBe("51.5, -0.1");
        });

        it("stops at a sibling that is not part of a link", () => {
            const [, target] = rawLink(GEOTAG, "Cape Wrath");
            const prose = document.createElement("span");
            prose.textContent = "we camped at ";
            target.parentElement?.prepend(prose);

            expect(linkTargetUnder(target)).toBe(GEOTAG);
        });
    });

    describe("ordinary note links", () => {
        it("returns a note name rather than claiming it is not a link", () => {
            // Deciding what is a geotag belongs to the coordinate parser, so
            // this returns the target and lets the caller decline it.
            expect(
                linkTargetUnder(anchor("Chapter 3, Part 2", "Chapter 3"))
            ).toBe("Chapter 3, Part 2");
        });

        it("leaves an aliased note link for Obsidian to handle", () => {
            const [, , , alias] = rawLink("Chapter 3, Part 2", "the bit");
            const target = linkTargetUnder(alias);

            expect(target).toBe("Chapter 3, Part 2");
            expect(parseCoordinate(target ?? "").kind).toBe("not-a-geotag");
        });
    });

    it("produces targets the coordinate parser accepts, in every shape", () => {
        const shapes = [
            anchor(GEOTAG, "Cape Wrath"),
            rawLink(GEOTAG)[1],
            rawLink(GEOTAG, "Cape Wrath")[3],
        ];

        for (const shape of shapes) {
            const target = linkTargetUnder(shape);
            expect(parseCoordinate(target ?? "").kind).toBe("coordinate");
        }
    });
});
