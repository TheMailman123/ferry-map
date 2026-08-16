import { Plugin } from "obsidian";
import { ObsidianIO, ObsidianInterface } from "./obsidian/adapter";
import { GeoStore } from "./obsidian/store";
import { MAP_VIEW_TYPE, MapView } from "./ui/view";
import { DEFAULT_SETTINGS, MapSettingTab, MapSettings } from "./ui/settings";

/**
 * Plugin entry point: owns settings and the geotag store, registers the map
 * view, and provides the commands and ribbon entry that open it.
 */
export default class MapPlugin extends Plugin {
    settings: MapSettings = DEFAULT_SETTINGS;
    obsidian!: ObsidianInterface;
    store!: GeoStore;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.obsidian = new ObsidianIO(this.app);
        this.store = new GeoStore(this.obsidian);

        this.registerView(MAP_VIEW_TYPE, (leaf) => new MapView(leaf, this));

        this.addRibbonIcon("globe", "Open map", () => this.activateView());

        this.addCommand({
            id: "open-map-view",
            name: "Open map view",
            callback: () => this.activateView(),
        });

        this.addSettingTab(new MapSettingTab(this.app, this));

        // The metadata cache is still filling during onload, so notes scanned
        // now come back with no links at all.
        this.app.workspace.onLayoutReady(() => this.store.scanVault());
    }

    /**
     * Reveals the map view, reusing an existing leaf if one is already open so
     * repeated invocations do not stack duplicate tabs.
     */
    async activateView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);
        if (existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0]);
            return;
        }

        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: MAP_VIEW_TYPE, active: true });
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
