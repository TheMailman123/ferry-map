/**
 * Minimal stand-in for the `obsidian` module, which only exists inside the app.
 *
 * Jest picks this up automatically for every test (root-level __mocks__ beside
 * node_modules), so no jest.mock("obsidian") call is needed. Implement members
 * here only as tests come to need them.
 */
import * as path from "path";

export abstract class TAbstractFile {
    name = "";
    parent: TFolder | null = null;

    get path(): string {
        const full = path.join(this.parent?.path ?? "", this.name);
        return full.startsWith("/") ? full.slice(1) : full;
    }
}

export class TFile extends TAbstractFile {
    get basename(): string {
        return path.basename(this.name, path.extname(this.name));
    }

    get extension(): string {
        return path.extname(this.name).slice(1);
    }
}

export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];

    isRoot(): boolean {
        return this.parent === null;
    }
}

/**
 * Every tag on a note, body and frontmatter alike, each with a leading `#`.
 *
 * Obsidian's own version accepts the several spellings the `tags` property
 * allows — a list, a single string, or a comma-separated one — so this stands
 * in for all of them. Returns null for a note with no tags, as the real one
 * does, which is why callers have to cope with null.
 */
export function getAllTags(cache: {
    tags?: { tag: string }[];
    frontmatter?: Record<string, unknown>;
}): string[] | null {
    const tags = (cache.tags ?? []).map((entry) => entry.tag);

    const declared = cache.frontmatter?.tags;
    const listed = Array.isArray(declared)
        ? declared
        : typeof declared === "string"
        ? declared.split(",")
        : [];

    for (const tag of listed) {
        const trimmed = String(tag).trim();
        if (trimmed)
            tags.push(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
    }

    return tags.length > 0 ? tags : null;
}

/** Records user-facing messages so tests can assert on them. */
export class Notice {
    static notices: string[] = [];

    constructor(message: string) {
        Notice.notices.push(message);
    }
}
