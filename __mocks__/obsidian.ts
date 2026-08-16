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

/** Records user-facing messages so tests can assert on them. */
export class Notice {
    static notices: string[] = [];

    constructor(message: string) {
        Notice.notices.push(message);
    }
}
