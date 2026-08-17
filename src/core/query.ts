/**
 * The query language behind the filter box and the colour groups.
 *
 * This is a deliberately small subset of Obsidian's search syntax — the
 * metadata-backed part of it: `path:`, `file:`, `tag:`, quoted phrases, `-`
 * negation, implicit AND, `OR`, and parentheses. Content matching is absent by
 * design (see VISION.md): it would mean reading every note in the vault rather
 * than consulting the cache Obsidian already maintains. It slots in later as
 * one more predicate and one more case in {@link matches}.
 *
 * ## Why parsing is lenient
 *
 * These queries are typed live into a box, so every prefix of a valid query is
 * something a user is momentarily holding — `path:` on the way to `path:TRIPS`,
 * an opening quote on the way to a phrase. Rejecting those would make the map
 * blink out mid-keystroke, and throwing on them would turn ordinary typing into
 * an error. So an incomplete term contributes nothing and the rest of the query
 * still applies. The recovery rules are not accidental fallbacks: each one is
 * stated in {@link parseQuery} and tested, and none of them can turn a query
 * into a *different* query — the worst case is a term that says nothing yet
 * being ignored until it says something.
 */

/**
 * A note as a query sees it.
 *
 * Assembled from Obsidian's metadata cache. Deliberately not the note's text:
 * nothing here requires reading a file.
 */
export interface NoteDoc {
    /** Full vault path, e.g. `TRIPS/Isle of Skye.md`. */
    path: string;
    /** File name without its extension, e.g. `Isle of Skye`. */
    basename: string;
    /** Every tag on the note, body and frontmatter alike, each with its `#`. */
    tags: string[];
}

/** A parsed query. `null` anywhere below means "nothing was asked". */
export type Query =
    | { kind: "and"; operands: Query[] }
    | { kind: "or"; operands: Query[] }
    | { kind: "not"; operand: Query }
    /** A bare word or quoted phrase: matched against the note's path. */
    | { kind: "text"; value: string }
    | { kind: "path"; value: string }
    | { kind: "file"; value: string }
    | { kind: "tag"; value: string };

/** The `key:` prefixes this subset understands. */
type Field = "path" | "file" | "tag";

const FIELDS: Field[] = ["path", "file", "tag"];

type Token =
    | { kind: "term"; field: Field | null; value: string }
    | { kind: "not" }
    | { kind: "or" }
    | { kind: "open" }
    | { kind: "close" };

/**
 * Parse a query string.
 *
 * Values are lowercased here rather than at match time, so a query is
 * case-folded once instead of once per note.
 *
 * Recovery rules, for input that is incomplete rather than wrong:
 *
 * - An empty or whitespace-only query is `null`.
 * - A `key:` with no value, and a `-` with nothing to negate, are dropped.
 * - An unterminated quote runs to the end of the input.
 * - An unclosed `(` closes at the end of the input; an unmatched `)` is ignored.
 * - `OR` missing a side is the side it has.
 * - A query left with no terms at all by the above is `null`.
 *
 * @returns the query, or null when nothing was asked. What "nothing" means is
 *   the caller's decision: an empty *filter* shows every note, while an empty
 *   *group* colours none, so this function does not presume either.
 */
export function parseQuery(text: string): Query | null {
    const tokens = balance(tokenize(text));
    const cursor = { at: 0 };
    return parseAlternation(tokens, cursor);
}

/** Whether a note satisfies a query. */
export function matches(query: Query, doc: NoteDoc): boolean {
    switch (query.kind) {
        case "and":
            return query.operands.every((operand) => matches(operand, doc));
        case "or":
            return query.operands.some((operand) => matches(operand, doc));
        case "not":
            return !matches(query.operand, doc);
        // A bare word searches the path, which ends in the file name, so a word
        // matching the note's name matches through the path too. The two stay
        // separate cases because only `text` gains content matching later.
        case "text":
        case "path":
            return doc.path.toLowerCase().includes(query.value);
        case "file":
            return doc.basename.toLowerCase().includes(query.value);
        case "tag":
            return doc.tags.some((tag) => tagMatches(tag, query.value));
    }
}

/**
 * Whether a note carries a tag.
 *
 * `tag:#trip` matches `#trip` and its subtags `#trip/2024`, but not `#trips` —
 * the same rule Obsidian's search follows, and the reason this is a prefix test
 * on a path separator rather than a plain `startsWith`.
 *
 * @param raw a tag as the cache reports it, with its leading `#`
 * @param value the query's tag, already lowercased and stripped of any `#`
 */
function tagMatches(raw: string, value: string): boolean {
    const tag = normaliseTag(raw);
    return tag === value || tag.startsWith(`${value}/`);
}

function normaliseTag(tag: string): string {
    const trimmed = tag.trim().toLowerCase();
    return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

// --- Tokenising -----------------------------------------------------------

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let at = 0;

    while (at < text.length) {
        const char = text[at];

        if (isSpace(char)) {
            at++;
            continue;
        }

        if (char === "(" || char === ")") {
            tokens.push({ kind: char === "(" ? "open" : "close" });
            at++;
            continue;
        }

        // A `-` negates only where it begins a term. Inside one it is an
        // ordinary character, so `sub-folder` is a single word and not a
        // negation of `folder`.
        if (char === "-") {
            at++;
            if (at < text.length && !isSpace(text[at]) && text[at] !== ")") {
                tokens.push({ kind: "not" });
            }
            continue;
        }

        const field = readField(text, at);
        if (field) {
            const value = readValue(text, field.end);
            at = value.end;
            if (value.text) {
                tokens.push({
                    kind: "term",
                    field: field.name,
                    value: value.text.toLowerCase(),
                });
            }
            continue;
        }

        const value = readValue(text, at);
        at = value.end;

        // `OR` is an operator only unquoted and in capitals, as in Obsidian's
        // search, so a note about a place called Or stays findable.
        if (!value.quoted && value.text === "OR") {
            tokens.push({ kind: "or" });
            continue;
        }

        if (value.text) {
            tokens.push({
                kind: "term",
                field: null,
                value: value.text.toLowerCase(),
            });
        }
    }

    return tokens;
}

/** A `path:`, `file:` or `tag:` prefix at `at`, if there is one. */
function readField(
    text: string,
    at: number
): { name: Field; end: number } | null {
    for (const name of FIELDS) {
        const prefix = `${name}:`;
        if (text.slice(at, at + prefix.length).toLowerCase() === prefix) {
            return { name, end: at + prefix.length };
        }
    }

    return null;
}

/**
 * Read a term's value: a quoted phrase, or a run up to the next space or
 * bracket.
 *
 * @returns the text, where it ended, and whether it was quoted — which decides
 *   whether an `OR` is the operator or the word
 */
function readValue(
    text: string,
    at: number
): { text: string; end: number; quoted: boolean } {
    if (text[at] === '"') {
        const close = text.indexOf('"', at + 1);
        // An unterminated quote is a phrase still being typed, so it runs to
        // the end rather than swallowing the query.
        const end = close === -1 ? text.length : close;
        return {
            text: text.slice(at + 1, end),
            end: close === -1 ? text.length : close + 1,
            quoted: true,
        };
    }

    let end = at;
    while (end < text.length && !isSpace(text[end]) && !isBracket(text[end])) {
        end++;
    }

    return { text: text.slice(at, end), end, quoted: false };
}

/**
 * Drop `)` that closes nothing.
 *
 * Done here rather than in the parser so the grammar below can assume brackets
 * nest properly and treat the end of input as closing whatever is still open.
 */
function balance(tokens: Token[]): Token[] {
    const kept: Token[] = [];
    let depth = 0;

    for (const token of tokens) {
        if (token.kind === "close") {
            if (depth === 0) continue;
            depth--;
        } else if (token.kind === "open") {
            depth++;
        }

        kept.push(token);
    }

    return kept;
}

// --- Parsing --------------------------------------------------------------
//
// alternation := conjunction ( "OR" conjunction )*
// conjunction := unary+
// unary       := "-" unary | "(" alternation ")" | term
//
// `OR` binds more loosely than the implicit AND between adjacent terms, so
// `a b OR c` is `(a AND b) OR c` — Obsidian's precedence.

interface Cursor {
    at: number;
}

function parseAlternation(tokens: Token[], cursor: Cursor): Query | null {
    const operands = collect(tokens, cursor, () => {
        const operand = parseConjunction(tokens, cursor);
        // Step over the `OR` so a missing operand cannot spin here.
        if (tokens[cursor.at]?.kind === "or") cursor.at++;
        return operand;
    });

    return combine("or", operands);
}

function parseConjunction(tokens: Token[], cursor: Cursor): Query | null {
    const operands: Query[] = [];

    while (cursor.at < tokens.length) {
        const kind = tokens[cursor.at].kind;
        if (kind === "or" || kind === "close") break;

        const operand = parseUnary(tokens, cursor);
        if (operand) operands.push(operand);
    }

    return combine("and", operands);
}

function parseUnary(tokens: Token[], cursor: Cursor): Query | null {
    const token = tokens[cursor.at];
    cursor.at++;

    // A `-` can end the token stream even though the tokeniser only emits one
    // when something follows it, because what followed may itself have been
    // dropped — `-path:` is a negation of a value not yet typed.
    if (!token) return null;

    if (token.kind === "not") {
        const operand = parseUnary(tokens, cursor);
        // Nothing to negate: `-` on its own says nothing yet, and negating
        // "nothing" would otherwise match nothing at all.
        return operand ? { kind: "not", operand } : null;
    }

    if (token.kind === "open") {
        const inner = parseAlternation(tokens, cursor);
        if (tokens[cursor.at]?.kind === "close") cursor.at++;
        return inner;
    }

    // `or` and `close` are handled by the caller; only a term reaches here.
    return token.kind === "term" ? predicate(token) : null;
}

/**
 * Run `parse` until it stops making progress, keeping what it produced.
 *
 * The progress check is what makes recovery safe: a dropped term must not leave
 * the cursor where it was, or the loop would never end.
 */
function collect(
    tokens: Token[],
    cursor: Cursor,
    parse: () => Query | null
): Query[] {
    const operands: Query[] = [];

    while (cursor.at < tokens.length) {
        const before = cursor.at;
        const operand = parse();
        if (operand) operands.push(operand);
        if (cursor.at === before) break;
    }

    return operands;
}

function combine(kind: "and" | "or", operands: Query[]): Query | null {
    if (operands.length === 0) return null;
    if (operands.length === 1) return operands[0];
    return { kind, operands };
}

function predicate(token: {
    field: Field | null;
    value: string;
}): Query | null {
    switch (token.field) {
        case null:
            return { kind: "text", value: token.value };
        case "path":
            return { kind: "path", value: token.value };
        case "file":
            return { kind: "file", value: token.value };
        case "tag":
            return { kind: "tag", value: normaliseTag(token.value) };
    }
}

function isSpace(char: string): boolean {
    return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isBracket(char: string): boolean {
    return char === "(" || char === ")";
}
