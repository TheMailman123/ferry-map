/**
 * Reading a link's target out of the various forms Obsidian renders it in.
 *
 * A geotag clicked in a note can be reached as an anchor's `data-href` (already
 * just the target), or as raw `[[...]]` text when the editor is showing link
 * syntax. Both funnel through here so the click handler deals in one shape.
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
