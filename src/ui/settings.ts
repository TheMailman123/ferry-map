import { App, PluginSettingTab, Setting } from "obsidian";
import type MapPlugin from "../main";

/** Which of the two base layers is showing. */
export type BaseLayerId = "map" | "satellite";

/** A tile source. Configurable so a local tile server can be pointed at. */
export interface TileLayerSettings {
    /** Label for the layer switcher. */
    name: string;
    /** Leaflet URL template, e.g. `https://host/{z}/{x}/{y}.png`. */
    url: string;
    /** Credit line shown on the map. Most tile terms require one. */
    attribution: string;
    maxZoom: number;
}

/** Where the map was last looking. Restored when the view reopens. */
export interface SavedMapView {
    lat: number;
    lon: number;
    zoom: number;
    layer: BaseLayerId;
}

export interface MapSettings {
    /** Schema version, so stored settings can be migrated across releases. */
    version: number;
    tiles: Record<BaseLayerId, TileLayerSettings>;
    view: SavedMapView;
}

export const DEFAULT_SETTINGS: MapSettings = {
    version: 1,
    tiles: {
        map: {
            name: "Map",
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
        },
        satellite: {
            name: "Satellite",
            // Esri orders this template {z}/{y}/{x}, not the usual {z}/{x}/{y}.
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            attribution:
                "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
            maxZoom: 19,
        },
    },
    view: { lat: 20, lon: 0, zoom: 2, layer: "map" },
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

        containerEl.createEl("h2", { text: "Tile sources" });
        containerEl.createEl("p", {
            text:
                "Tiles are fetched over the network while the map is open, so the " +
                "configured providers will see requests. Point these at a local " +
                "tile server to avoid that.",
            cls: "setting-item-description",
        });

        this.tileSettings("map");
        this.tileSettings("satellite");

        new Setting(containerEl)
            .setName("Reset tile sources")
            .setDesc("Restore the default OpenStreetMap and Esri providers.")
            .addButton((button) =>
                button.setButtonText("Reset").onClick(async () => {
                    this.plugin.settings.tiles = structuredClone(
                        DEFAULT_SETTINGS.tiles
                    );
                    await this.plugin.saveSettings();
                    this.display();
                })
            );
    }

    private tileSettings(id: BaseLayerId): void {
        const layer = this.plugin.settings.tiles[id];

        new Setting(this.containerEl).setName(layer.name).setHeading();

        new Setting(this.containerEl)
            .setName("URL template")
            .setDesc(
                "Leaflet tile template, using {z}, {x} and {y} placeholders."
            )
            .addText((text) =>
                text.setValue(layer.url).onChange(async (value) => {
                    layer.url = value.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(this.containerEl)
            .setName("Attribution")
            .setDesc(
                "Credit line shown on the map. Usually required by the provider."
            )
            .addText((text) =>
                text.setValue(layer.attribution).onChange(async (value) => {
                    layer.attribution = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}
