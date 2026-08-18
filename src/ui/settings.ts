import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_PRECISION, formatCoordinate } from "../core/coordinates";
import { ColourGroup } from "../core/groups";
import type FerryMapPlugin from "../main";

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

/** State of the control panel. Persisted so the map reopens as it was left. */
export interface ControlsState {
    /** Query hiding non-matching pins. Empty shows everything. */
    filter: string;
    /** Colour groups in priority order: where several match, the first wins. */
    groups: ColourGroup[];
    /** Whether the panel is expanded rather than collapsed to its button. */
    open: boolean;
}

export interface FerryMapSettings {
    /** Schema version, so stored settings can be migrated across releases. */
    version: number;
    tiles: Record<BaseLayerId, TileLayerSettings>;
    /** Where the map was left. Restored when it reopens. */
    view: SavedMapView;
    /**
     * Where "Go to default view" returns the map to.
     *
     * Separate from {@link view}, which is overwritten by every pan: a home to
     * come back to is no use if wandering away from it moves it too.
     */
    home: SavedMapView;
    /** Decimal places used when a coordinate is copied. */
    precision: number;
    /** Diameter of an ordinary pin, in pixels. */
    markerSize: number;
    controls: ControlsState;
}

/** Widest a pin may be set. Beyond this pins hide the map behind them. */
export const MAX_MARKER_SIZE = 40;

/** Narrowest a pin may be set, below which it is hard to hit with a pointer. */
export const MIN_MARKER_SIZE = 10;

/** The pin size the map has always used, and the default. */
export const DEFAULT_MARKER_SIZE = 18;

/**
 * Most decimal places a copied coordinate may carry.
 *
 * Eight places is under a millimetre. More would be writing noise into notes
 * and implying a precision no map click has.
 */
export const MAX_PRECISION = 8;

/**
 * Colours offered to successive new groups.
 *
 * Cycled rather than picked at random so two groups added in a row are always
 * told apart, and taken from Obsidian's own accent range so they sit in a
 * vault's theme rather than fighting it.
 */
export const GROUP_COLOURS = [
    "#e05252",
    "#e0a352",
    "#3fae6a",
    "#4f8fe0",
    "#a35ce0",
    "#d95fa8",
];

/** The colour a group added to an existing list should take. */
export function nextGroupColour(existing: readonly ColourGroup[]): string {
    return GROUP_COLOURS[existing.length % GROUP_COLOURS.length];
}

export const DEFAULT_SETTINGS: FerryMapSettings = {
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
    home: { lat: 20, lon: 0, zoom: 2, layer: "map" },
    precision: DEFAULT_PRECISION,
    markerSize: DEFAULT_MARKER_SIZE,
    controls: { filter: "", groups: [], open: false },
};

export class FerryMapSettingTab extends PluginSettingTab {
    private plugin: FerryMapPlugin;

    constructor(app: App, plugin: FerryMapPlugin) {
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

        containerEl.createEl("h2", { text: "Map" });

        this.defaultViewSetting();
        this.markerSizeSetting();

        containerEl.createEl("h2", { text: "Copying" });

        this.precisionSetting();
    }

    /**
     * The view "Go to default view" returns to.
     *
     * Captured from the map rather than typed, because nobody knows their
     * preferred zoom as a number, and a latitude typed by hand is a way to end
     * up somewhere in the Atlantic.
     */
    private defaultViewSetting(): void {
        const { home } = this.plugin.settings;

        new Setting(this.containerEl)
            .setName("Default view")
            .setDesc(
                `${formatCoordinate(home, 2)} at zoom ${home.zoom}, on the ` +
                    `${this.plugin.settings.tiles[home.layer].name} layer. ` +
                    "The \u201cGo to default view\u201d command returns here."
            )
            .addButton((button) =>
                button
                    .setButtonText("Use current map view")
                    .onClick(async () => {
                        this.plugin.settings.home = {
                            ...this.plugin.currentView(),
                        };
                        await this.plugin.saveSettings();
                        // Redrawn so the description above shows what was captured;
                        // a button that reports nothing gives no way to tell it
                        // worked.
                        this.display();
                    })
            );
    }

    private markerSizeSetting(): void {
        new Setting(this.containerEl)
            .setName("Marker size")
            .setDesc(
                "Diameter of a pin in pixels. Clustered pins scale with it."
            )
            .addSlider((slider) =>
                slider
                    .setLimits(MIN_MARKER_SIZE, MAX_MARKER_SIZE, 1)
                    .setValue(this.plugin.settings.markerSize)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.markerSize = value;
                        await this.plugin.saveSettings();
                        this.plugin.applySettings();
                    })
            );
    }

    /**
     * How precise a copied coordinate is.
     *
     * A slider rather than a text box: the value has to be a whole number in a
     * narrow range, and a control that cannot express anything else is better
     * than one that validates after the fact.
     */
    private precisionSetting(): void {
        new Setting(this.containerEl)
            .setName("Coordinate precision")
            .setDesc(
                "Decimal places used by \u201cCopy geotag\u201d and " +
                    "\u201cCopy coordinates\u201d. Four places is about 11 m."
            )
            .addSlider((slider) =>
                slider
                    .setLimits(0, MAX_PRECISION, 1)
                    .setValue(this.plugin.settings.precision)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.precision = value;
                        await this.plugin.saveSettings();
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
