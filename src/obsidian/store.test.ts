import type { CachedMetadata, TFile } from "obsidian";
import { MetadataLike } from "../core/geotags";
import type { ObsidianInterface } from "./adapter";
import { GeoStore } from "./store";

/** A body link as Obsidian caches it. */
function geotag(target: string, line = 0) {
    return {
        link: target,
        displayText: target,
        position: { start: { line }, end: { line } },
    };
}

function asFile(path: string): TFile {
    return { path } as TFile;
}

/**
 * A stand-in vault: a map of note path to the metadata Obsidian would report.
 */
class FakeVault implements ObsidianInterface {
    readonly notes = new Map<string, MetadataLike>();

    put(path: string, ...targets: string[]): void {
        this.notes.set(path, { links: targets.map((t) => geotag(t)) });
    }

    markdownFiles(): TFile[] {
        return [...this.notes.keys()].map(asFile);
    }

    metadata(file: TFile): CachedMetadata | null {
        const found = this.notes.get(file.path);
        return (found ?? null) as CachedMetadata | null;
    }

    async openNote(): Promise<void> {
        throw new Error("not used in these tests");
    }
}

/** Runs scheduled work on demand, standing in for requestAnimationFrame. */
function manualScheduler() {
    const queue: (() => void)[] = [];
    return {
        schedule: (run: () => void) => queue.push(run),
        flush: () => {
            const pending = queue.splice(0);
            for (const run of pending) run();
        },
        get depth() {
            return queue.length;
        },
    };
}

function setup() {
    const vault = new FakeVault();
    const clock = manualScheduler();
    const store = new GeoStore(vault, clock.schedule);
    return { vault, clock, store };
}

const paths = (store: GeoStore) => store.tags().map((tag) => tag.path);

describe("GeoStore.scanVault", () => {
    it("indexes every geotagged note", () => {
        const { vault, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        vault.put("b.md", "51.5, 0");
        vault.put("plain.md");

        store.scanVault();

        expect(paths(store)).toEqual(["a.md", "b.md"]);
    });

    it("replaces anything held from a previous scan", () => {
        const { vault, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        store.scanVault();

        vault.notes.clear();
        vault.put("b.md", "51.5, 0");
        store.scanVault();

        expect(paths(store)).toEqual(["b.md"]);
    });

    it("collects problems alongside geotags", () => {
        const { vault, store } = setup();
        vault.put("a.md", "95.0, 0");

        store.scanVault();

        expect(store.tags()).toEqual([]);
        expect(store.problems()).toHaveLength(1);
    });
});

describe("GeoStore.updateNote", () => {
    it("picks up a geotag added to a note", () => {
        const { vault, store } = setup();
        vault.put("a.md");
        store.scanVault();

        vault.put("a.md", "58.6276, -4.9997");
        store.updateNote(asFile("a.md"));

        expect(paths(store)).toEqual(["a.md"]);
    });

    it("drops a geotag removed from a note", () => {
        const { vault, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        store.scanVault();

        vault.put("a.md");
        store.updateNote(asFile("a.md"));

        expect(store.tags()).toEqual([]);
    });

    it("moves a pin when its coordinate is edited", () => {
        const { vault, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        store.scanVault();

        vault.put("a.md", "51.5, 0");
        store.updateNote(asFile("a.md"));

        expect(store.tags()).toHaveLength(1);
        expect(store.tags()[0].coordinate).toEqual({ lat: 51.5, lon: 0 });
    });

    it("leaves other notes alone", () => {
        const { vault, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        vault.put("b.md", "51.5, 0");
        store.scanVault();

        vault.put("a.md");
        store.updateNote(asFile("a.md"));

        expect(paths(store)).toEqual(["b.md"]);
    });
});

describe("GeoStore.removeNote and removeUnder", () => {
    it("forgets a deleted note", () => {
        const { vault, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        vault.put("b.md", "51.5, 0");
        store.scanVault();

        store.removeNote("a.md");

        expect(paths(store)).toEqual(["b.md"]);
    });

    it("forgets every note under a deleted folder", () => {
        const { vault, store } = setup();
        vault.put("TRIPS/a.md", "58.6276, -4.9997");
        vault.put("TRIPS/nested/b.md", "51.5, 0");
        vault.put("OTHER/c.md", "40, 10");
        store.scanVault();

        store.removeUnder("TRIPS");

        expect(paths(store)).toEqual(["OTHER/c.md"]);
    });

    it("does not treat a folder name as a prefix of a sibling", () => {
        // "TRIPS2/a.md" starts with "TRIPS" but is not inside it.
        const { vault, store } = setup();
        vault.put("TRIPS/a.md", "58.6276, -4.9997");
        vault.put("TRIPS2/b.md", "51.5, 0");
        store.scanVault();

        store.removeUnder("TRIPS");

        expect(paths(store)).toEqual(["TRIPS2/b.md"]);
    });
});

describe("GeoStore.renamePath", () => {
    it("re-stamps a renamed note's geotags", () => {
        const { vault, store } = setup();
        vault.put("old.md", "58.6276, -4.9997");
        store.scanVault();

        store.renamePath("old.md", "new.md");

        expect(paths(store)).toEqual(["new.md"]);
    });

    it("moves every note beneath a renamed folder", () => {
        // Obsidian does not re-index notes when their folder is renamed, so
        // without this their pins would point at paths that no longer exist.
        const { vault, store } = setup();
        vault.put("TRIPS/a.md", "58.6276, -4.9997");
        vault.put("TRIPS/nested/b.md", "51.5, 0");
        store.scanVault();

        store.renamePath("TRIPS", "JOURNEYS");

        expect(paths(store).sort()).toEqual([
            "JOURNEYS/a.md",
            "JOURNEYS/nested/b.md",
        ]);
    });

    it("leaves a sibling folder with a shared prefix alone", () => {
        const { vault, store } = setup();
        vault.put("TRIPS/a.md", "58.6276, -4.9997");
        vault.put("TRIPS2/b.md", "51.5, 0");
        store.scanVault();

        store.renamePath("TRIPS", "JOURNEYS");

        expect(paths(store).sort()).toEqual(["JOURNEYS/a.md", "TRIPS2/b.md"]);
    });

    it("renaming an untracked path changes nothing", () => {
        const { vault, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        store.scanVault();

        store.renamePath("plain.md", "still-plain.md");

        expect(paths(store)).toEqual(["a.md"]);
    });
});

describe("GeoStore notifications", () => {
    it("tells listeners once the scheduled work runs", () => {
        const { vault, clock, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        let calls = 0;
        store.onChange(() => calls++);

        store.scanVault();
        expect(calls).toBe(0);

        clock.flush();
        expect(calls).toBe(1);
    });

    it("coalesces a burst of changes into one notification", () => {
        // A note being typed into fires a metadata change repeatedly, and each
        // would otherwise re-cluster and redraw every pin on the map.
        const { vault, clock, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        let calls = 0;
        store.onChange(() => calls++);

        store.updateNote(asFile("a.md"));
        store.updateNote(asFile("a.md"));
        store.removeNote("a.md");
        expect(clock.depth).toBe(1);

        clock.flush();
        expect(calls).toBe(1);
    });

    it("notifies again after the previous batch has run", () => {
        const { vault, clock, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        let calls = 0;
        store.onChange(() => calls++);

        store.updateNote(asFile("a.md"));
        clock.flush();
        store.updateNote(asFile("a.md"));
        clock.flush();

        expect(calls).toBe(2);
    });

    it("stops notifying an unsubscribed listener", () => {
        const { vault, clock, store } = setup();
        vault.put("a.md", "58.6276, -4.9997");
        let calls = 0;
        const unsubscribe = store.onChange(() => calls++);

        unsubscribe();
        store.updateNote(asFile("a.md"));
        clock.flush();

        expect(calls).toBe(0);
    });
});
