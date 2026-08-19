/**
 * Reading a link's target out of the various forms Obsidian renders it in.
 *
 * A geotag clicked in a note can be reached as an anchor's `data-href` (already
 * just the target), or as raw `[[...]]` text when the editor is showing link
 * syntax. Both funnel through here so the click handler deals in one shape.
 *
 * The awkward form is the second one. CodeMirror does not give a link one
 * element: it splits `[[58.6, -4.9|Here]]` into a run of sibling spans — the
 * brackets, the target, the pipe, the alias — each carrying the same class. So
 * the element under the pointer is only ever *part* of a link, and reading its
 * text alone yields the alias when the alias is what was clicked. That is the
 * whole reason {@link linkTargetUnder} rebuilds the run before parsing it.
 */

/**
 * Strip wikilink brackets and any alias from a link, leaving its target.
 *
 * @param text an href, or the raw text of a link such as `[[58.6, -4.9|Here]]`
 * @returns the target, e.g. `58.6, -4.9`
 */
export function linkTarget(text: string): string {
    let target = text.trim();

    if (target.startsWith("[[") && target.endsWith("]]")) {
        target = target.slice(2, -2);
    }

    // An alias follows a pipe. Coordinates never contain one, so anything after
    // the first pipe is display text.
    const pipe = target.indexOf("|");
    if (pipe !== -1) target = target.slice(0, pipe);

    return target.trim();
}

/** The class CodeMirror puts on every span making up an internal link. */
const LINK_PART_CLASS = "cm-hmd-internal-link";

/** Closes a wikilink. Ends a run of parts, so two adjacent links stay apart. */
const CLOSE = "]]";

/**
 * The link target under a clicked element, or null if it was not a link.
 *
 * Two shapes, in order of trust:
 *
 * 1. Anything carrying the target outright — a rendered link is an anchor with
 *    `data-href`, which is already just the target and needs no reassembly.
 * 2. The raw `[[...]]` spans the editor shows. Here the clicked element is one
 *    part of a link, so the whole run of parts is rebuilt around it. Without
 *    that, clicking the alias of `[[58.6, -4.9|Here]]` reads as `Here`, fails
 *    to parse as a coordinate, and the click falls through to Obsidian, which
 *    offers to create a note called Here.
 *
 * @param clicked the event target of a click
 * @returns the link's target, or null when the click was not on a link. A
 *   target is returned for ordinary note links too — deciding which targets are
 *   geotags is the coordinate parser's job, not this one's.
 */
export function linkTargetUnder(clicked: EventTarget | null): string | null {
    if (!(clicked instanceof HTMLElement)) return null;

    const carrier = clicked.closest("[data-href], a[href]");
    if (carrier) {
        const href =
            carrier.getAttribute("data-href") ?? carrier.getAttribute("href");
        if (href !== null) return linkTarget(href);
    }

    const part = clicked.closest(`.${LINK_PART_CLASS}`);
    return part === null ? null : linkTarget(wholeLink(part));
}

/**
 * Rebuild a link's raw text from the run of spans CodeMirror split it into.
 *
 * The run is bounded by the closing `]]` rather than simply running to the end
 * of its parent, so two links written back to back are not read as one.
 */
function wholeLink(part: Element): string {
    let first = part;
    while (
        isLinkPart(first.previousElementSibling) &&
        !closes(first.previousElementSibling)
    ) {
        first = first.previousElementSibling;
    }

    let text = "";
    for (
        let node: Element | null = first;
        isLinkPart(node);
        node = node.nextElementSibling
    ) {
        text += node.textContent ?? "";
        if (closes(node)) break;
    }

    return text;
}

function isLinkPart(el: Element | null): el is Element {
    return el !== null && el.classList.contains(LINK_PART_CLASS);
}

function closes(el: Element): boolean {
    return (el.textContent ?? "").includes(CLOSE);
}
