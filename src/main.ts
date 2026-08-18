import { Plugin } from "obsidian";
import { Coordinate, parseCoordinate } from "./core/coordinates";
import { linkTarget } from "./core/links";
import { ObsidianIO, ObsidianInterface } from "./obsidian/adapter";
import { GeoStore } from "./obsidian/store";
import { watchVault } from "./obsidian/watcher";
import { FERRY_MAP_VIEW_TYPE, FerryMapView } from "./ui/view";
import {
    DEFAULT_SETTINGS,
    FerryMapSettingTab,
    FerryMapSettings,
    SavedMapView,
} from "./ui/settings";

/**
 * Plugin entry point: owns settings and the geotag store, registers the map
 * view, and provides the commands and ribbon entry that open it.
 */
export default class FerryMapPlugin extends Plugin {
    settings: FerryMapSettings = DEFAULT_SETTINGS;
    obsidian!: ObsidianInterface;
    store!: GeoStore;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.obsidian = new ObsidianIO(this.app);
        this.store = new GeoStore(this.obsidian);

        this.registerView(
            FERRY_MAP_VIEW_TYPE,
            (leaf) => new FerryMapView(leaf, this)
        );

        this.addRibbonIcon("globe", "Open Ferry Map", () =>
            this.activateView()
        );

        this.addCommand({
            id: "open-ferry-map-view",
            name: "Open Ferry Map",
            callback: () => this.activateView(),
        });

        this.addCommand({
            id: "ferry-map-default-view",
            name: "Go to default view",
            callback: () => void this.goHome(),
        });

        this.addSettingTab(new FerryMapSettingTab(this.app, this));

        // Capture phase, so this runs before Obsidian's own link handling and
        // can stop a geotag from being treated as a missing note.
        this.registerDomEvent(
            document,
            "click",
            (event) => this.interceptGeotagLink(event),
            { capture: true }
        );

        for (const subscription of watchVault(this.app, this.store)) {
            this.registerEvent(subscription);
        }

        // The metadata cache is still filling during onload, so notes scanned
        // now come back with no links at all.
        this.app.workspace.onLayoutReady(() => this.store.scanVault());
    }

    /**
     * Reveals the map view, reusing an existing leaf if one is already open so
     * repeated invocations do not stack duplicate tabs.
     */
    async activateView(): Promise<FerryMapView | null> {
        const existing =
            this.app.workspace.getLeavesOfType(FERRY_MAP_VIEW_TYPE);

        if (existing.length === 0) {
            const leaf = this.app.workspace.getLeaf("tab");
            await leaf.setViewState({
                type: FERRY_MAP_VIEW_TYPE,
                active: true,
            });
        } else {
            await this.app.workspace.revealLeaf(existing[0]);
        }

        return this.mapView();
    }

    async loadSettings(): Promise<void> {
        // The defaults are cloned, not merged from: settings are edited in
        // place — a tile URL, a group's colour — and a shallow merge would hand
        // out the default objects themselves to be mutated.
        this.settings = Object.assign(
            structuredClone(DEFAULT_SETTINGS),
            await this.loadData()
        );
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    /**
     * The map's current position, for the settings tab to capture as a default.
     *
     * Falls back to the last saved view when no map is open, which is the same
     * place a map would open at, so the answer is never a surprise.
     */
    currentView(): SavedMapView {
        return this.mapView()?.currentView() ?? this.settings.view;
    }

    /**
     * Push changed settings into every open map view.
     *
     * Called by the settings tab, which can be open beside the map. Without
     * this a change would appear to do nothing until the map was reopened.
     */
    applySettings(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(
            FERRY_MAP_VIEW_TYPE
        )) {
            if (leaf.view instanceof FerryMapView) leaf.view.applySettings();
        }
    }

    /** Open the map if needed, and return it to its default view. */
    private async goHome(): Promise<void> {
        const view = await this.activateView();
        view?.goHome();
    }

    /**
     * Send a click on a geotag link to the map instead of to Obsidian.
     *
     * Geotags are links to notes that do not exist, so without this Obsidian
     * would offer to create a note called `58.6276, -4.9997`. Ordinary links,
     * including note names that merely contain a comma, are left entirely
     * alone — the coordinate parser decides which is which.
     */
    private interceptGeotagLink(event: MouseEvent): void {
        if (event.button !== 0 || event.defaultPrevented) return;

        const target = geotagLinkUnder(event.target);
        if (target === null) return;

        const parsed = parseCoordinate(target);
        if (parsed.kind !== "coordinate") return;

        event.preventDefault();
        event.stopPropagation();
        void this.showOnMap(parsed.coordinate);
    }

    /** Open the map, if needed, and centre it on a point. */
    private async showOnMap(coordinate: Coordinate): Promise<void> {
        const view = await this.activateView();
        view?.focusOn(coordinate);
    }

    private mapView(): FerryMapView | null {
        const leaf = this.app.workspace.getLeavesOfType(FERRY_MAP_VIEW_TYPE)[0];
        return leaf?.view instanceof FerryMapView ? leaf.view : null;
    }
}

/**
 * The link target under a clicked element, or null if it was not a link.
 *
 * Rendered links — reading view and live preview alike — are anchors carrying
 * the target in `data-href`. When the editor is showing raw link syntax there
 * is no anchor, so the element's own text is read and unwrapped instead.
 */
function geotagLinkUnder(clicked: EventTarget | null): string | null {
    if (!(clicked instanceof HTMLElement)) return null;

    const anchor = clicked.closest("a");
    if (anchor) {
        const href =
            anchor.getAttribute("data-href") ?? anchor.getAttribute("href");
        return href === null ? null : linkTarget(href);
    }

    const raw = clicked.closest(".cm-hmd-internal-link");
    if (raw?.textContent) return linkTarget(raw.textContent);

    return null;
}
