/**
 * Type-ahead for the filter and group query boxes.
 *
 * Graph view completes searches as you type and these boxes speak a subset of
 * the same language, so typing one here should feel the same. The work splits
 * in two: finding what the user is in the middle of typing and what could
 * finish it, which is ordinary string logic and lives here, and showing a
 * popover under an input, which is Obsidian's and lives in `ui/suggest.ts`.
 *
 * ## What is suggested, and from where
 *
 * The vocabulary is built from the **geotagged** notes alone, not the whole
 * vault. These queries only ever decide which pins are drawn, so a tag no
 * geotagged note carries is not a useful completion — accepting it would empty
 * the map, which is the opposite of what reaching for a suggestion is for.
 */

import { NoteDoc } from "./query";

/** The values worth completing to, each sorted and free of duplicates. */
export interface QueryVocabulary {
    /** Tags without their `#`, including the ancestors of nested tags. */
    tags: string[];
    /** Every folder containing a geotagged note, and their ancestors. */
    folders: string[];
    /** Note names, without the extension. */
    files: string[];
}

/** Which part of the query language a suggestion completes. */
export type SuggestionKind = "field" | "tag" | "path" | "file";

/** One offer in the popover. */
export interface Suggestion {
    kind: SuggestionKind;
    /**
     * The term to put in the box, quoted where it has to be, and including its
     * `key:`. A `field` suggestion is the bare `key:` with no value yet.
     */
    value: string;
    /** The part of the term worth reading: the value, or the key on its own. */
    label: string;
}

/** Where in the query string a suggestion would be inserted. */
export interface TokenSpan {
    start: number;
    end: number;
    /** The text currently occupying the span. */
    text: string;
}

/** The result of accepting a suggestion. */
export interface AppliedSuggestion {
    text: string;
    /** Where the caret should end up, so typing can continue from there. */
    cursor: number;
}

const FIELDS = ["path", "file", "tag"] as const;

type FieldName = (typeof FIELDS)[number];

/** How many offers to put in the popover at once. */
const LIMIT = 20;

/**
 * Find the term the caret is sitting in.
 *
 * Terms are separated by whitespace and brackets, which is how the tokeniser
 * splits them too — with one exception. A quoted phrase is a single term that
 * contains spaces, so when the caret is inside an unclosed quote the span is
 * widened to the whole phrase, along with any `key:` and `-` in front of it.
 * Without that, completing `path:"Old |` would replace only the last word and
 * leave a stray fragment behind.
 *
 * @param text the whole query box
 * @param cursor caret position, as a string index
 */
export function activeToken(text: string, cursor: number): TokenSpan {
    const at = Math.max(0, Math.min(cursor, text.length));
    const before = text.slice(0, at);
    const inQuotes = count(before, '"') % 2 === 1;

    let start = inQuotes ? before.lastIndexOf('"') : at;
    while (start > 0 && !isBoundary(text[start - 1])) start--;

    let end = at;
    if (inQuotes) {
        const close = text.indexOf('"', at);
        end = close === -1 ? text.length : close + 1;
    } else {
        while (end < text.length && !isBoundary(text[end])) end++;
    }

    return { start, end, text: text.slice(start, end) };
}

/**
 * What could finish the term in `token`.
 *
 * A term already carrying a `key:` is completed from that key's values alone. A
 * bare word is ambiguous, so it offers the keys it could be starting, then the
 * values it matches across all three — which is also how an empty box offers
 * the three keys as a way in.
 *
 * Every value suggestion carries its `key:`, so accepting one always leaves a
 * term that says what it means rather than a bare word that happens to match a
 * path today.
 *
 * @param token the term under the caret, as {@link activeToken} returns it
 * @param vocabulary what the geotagged notes offer
 */
export function suggestFor(
    token: string,
    vocabulary: QueryVocabulary
): Suggestion[] {
    // A `-` in front is the user's, not part of what is being completed, and is
    // put back by applySuggestion.
    const body = token.startsWith("-") ? token.slice(1) : token;

    const field = splitField(body);
    if (field) {
        return field.name
            ? values(field.name, field.value, vocabulary).slice(0, LIMIT)
            : [];
    }

    const typed = unquote(body);

    return [
        ...FIELDS.filter((name) => startsWith(`${name}:`, typed)).map(
            (name): Suggestion => ({
                kind: "field",
                value: `${name}:`,
                label: `${name}:`,
            })
        ),
        // Nothing typed yet means every value in the vault would qualify, which
        // is a list to scroll rather than read. The keys alone are the offer.
        ...(typed
            ? FIELDS.flatMap((name) => values(name, typed, vocabulary))
            : []),
    ].slice(0, LIMIT);
}

/**
 * Put a suggestion into the query, replacing the term it completes.
 *
 * A key is inserted without a trailing space, because the caret is then exactly
 * where its value goes. A completed value gets one, because the term is
 * finished and the next one starts after a space — unless there is already a
 * space there, since a query full of double spaces reads as though something
 * went wrong even though the parser does not mind.
 *
 * @param text the whole query box
 * @param span where the term sits, from {@link activeToken}
 */
export function applySuggestion(
    text: string,
    span: TokenSpan,
    suggestion: Suggestion
): AppliedSuggestion {
    const negation = span.text.startsWith("-") ? "-" : "";
    const spaced =
        suggestion.kind !== "field" && text[span.end] !== " " ? " " : "";
    const inserted = `${negation}${suggestion.value}${spaced}`;

    return {
        text: text.slice(0, span.start) + inserted + text.slice(span.end),
        cursor: span.start + inserted.length,
    };
}

/**
 * Collect what the geotagged notes offer to complete to.
 *
 * Nested tags and nested folders contribute their ancestors as well as
 * themselves: `tag:trip` matches `#trip/2024`, and `path:TRIPS` matches
 * everything under it, so both are worth offering even where no note names them
 * exactly.
 *
 * @param docs the indexed notes, as the store holds them
 */
export function buildVocabulary(docs: Iterable<NoteDoc>): QueryVocabulary {
    const tags = new Set<string>();
    const folders = new Set<string>();
    const files = new Set<string>();

    for (const doc of docs) {
        for (const tag of doc.tags) {
            for (const part of ancestry(strip(tag), "/")) tags.add(part);
        }

        // A note at the vault root has no folder to offer, and slicing to a
        // lastIndexOf of -1 would otherwise offer its name minus a character.
        const cut = doc.path.lastIndexOf("/");
        const folder = cut === -1 ? "" : doc.path.slice(0, cut);
        for (const part of ancestry(folder, "/")) folders.add(part);

        files.add(doc.basename);
    }

    return {
        tags: sorted(tags),
        folders: sorted(folders),
        files: sorted(files),
    };
}

/** A path and each of its prefixes, longest last. Empty in, nothing out. */
function ancestry(path: string, separator: string): string[] {
    if (!path) return [];

    const parts = path.split(separator);
    return parts.map((_, index) => parts.slice(0, index + 1).join(separator));
}

/**
 * Sort case-insensitively, and drop anything the query language cannot express.
 *
 * A value containing a `"` has no spelling in this grammar — quoting it would
 * end the phrase early and silently produce a different query — so it is not
 * offered. Suggesting only what can actually be typed is better than offering
 * something that would quietly mean something else.
 */
function sorted(values: Set<string>): string[] {
    return [...values]
        .filter((value) => value && !value.includes('"'))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Split `key:value`, or null when the term carries no key. */
function splitField(
    body: string
): { name: FieldName | null; value: string } | null {
    // A leading quote means the whole term is a phrase, colons and all.
    if (body.startsWith('"')) return null;

    const colon = body.indexOf(":");
    if (colon === -1) return null;

    const name = body.slice(0, colon).toLowerCase();
    return {
        name: FIELDS.find((field) => field === name) ?? null,
        value: unquote(body.slice(colon + 1)),
    };
}

/** The suggestions for one key, matching what has been typed of its value. */
function values(
    name: FieldName,
    typed: string,
    vocabulary: QueryVocabulary
): Suggestion[] {
    const candidates =
        name === "tag"
            ? vocabulary.tags
            : name === "path"
            ? vocabulary.folders
            : vocabulary.files;

    // Prefix matches first: they are what the user is most likely reaching for,
    // and a substring match on a long path is otherwise hard to spot.
    const prefixed = candidates.filter((value) => startsWith(value, typed));
    const rest = candidates.filter(
        (value) => !startsWith(value, typed) && contains(value, typed)
    );

    return [...prefixed, ...rest].map((value) => ({
        kind: name,
        value: `${name}:${quote(value)}`,
        label: value,
    }));
}

/** Wrap a value in quotes where the tokeniser would otherwise split it. */
function quote(value: string): string {
    return /[\s()]/.test(value) ? `"${value}"` : value;
}

function unquote(value: string): string {
    const inner = value.startsWith('"') ? value.slice(1) : value;
    return inner.endsWith('"') ? inner.slice(0, -1) : inner;
}

function strip(tag: string): string {
    return tag.startsWith("#") ? tag.slice(1) : tag;
}

function startsWith(value: string, typed: string): boolean {
    return value.toLowerCase().startsWith(typed.toLowerCase());
}

function contains(value: string, typed: string): boolean {
    return value.toLowerCase().includes(typed.toLowerCase());
}

function isBoundary(char: string): boolean {
    return /\s/.test(char) || char === "(" || char === ")";
}

function count(text: string, char: string): number {
    let found = 0;
    for (const candidate of text) if (candidate === char) found++;
    return found;
}
