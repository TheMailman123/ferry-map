import { App, PluginSettingTab } from "obsidian";
import type MapPlugin from "../main";

export interface MapSettings {
    /** Schema version, so stored settings can be migrated across releases. */
    version: number;
}

export const DEFAULT_SETTINGS: MapSettings = {
    version: 1,
};

export class MapSettingTab extends PluginSettingTab {
    private plugin: MapPlugin;

    constructor(app: App, plugin: MapPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Map" });
    }
}
