import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { GeoTag } from "../core/geotags";
import { buildMarkers } from "../core/markers";
import type MapPlugin from "../main";
import { MapSurface } from "./map";
import { SavedMapView } from "./settings";
import "./styles.css";

export const MAP_VIEW_TYPE = "obsidian-map-view";

/** How long panning must settle before the view position is written to disk. */
const VIEW_SAVE_DELAY_MS = 500;

export class MapView extends ItemView {
    private readonly plugin: MapPlugin;
    private surface: MapSurface | null = null;
    private unsubscribe: (() => void) | null = null;
    private saveTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: MapPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return MAP_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Map";
    }

    getIcon(): string {
        return "globe";
    }

    async onOpen(): Promise<void> {
        // children[1] is the view content area; children[0] is the view header.
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("obsidian-map-view");

        const surfaceEl = container.createDiv({
            cls: "obsidian-map-container",
        });

        this.surface = new MapSurface(surfaceEl, {
            tiles: this.plugin.settings.tiles,
            initial: this.plugin.settings.view,
            onViewChange: (view) => this.rememberView(view),
        });

        // Subscribing before the first draw matters: the view can be restored
        // at startup before the vault scan has run, and would otherwise sit
        // empty until something else happened to change.
        this.unsubscribe = this.plugin.store.onChange(() => this.drawMarkers());
        this.drawMarkers();
    }

    onResize(): void {
        this.surface?.resize();
    }

    async onClose(): Promise<void> {
        this.clearSaveTimer();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.surface?.destroy();
        this.surface = null;
        this.containerEl.children[1].empty();
    }

    private drawMarkers(): void {
        this.surface?.setMarkers(
            buildMarkers(this.plugin.store.tags(), (tag) => this.openNote(tag))
        );
    }

    private openNote(tag: GeoTag): void {
        this.plugin.obsidian
            .openNote(tag.path, tag.line)
            .catch((error: Error) => {
                // Surfaced rather than swallowed: a pin that silently does nothing
                // when clicked is worse than one that says why.
                new Notice(error.message);
                console.error(error);
            });
    }

    /**
     * Persist the map position, debounced.
     *
     * Leaflet fires `moveend` once per gesture, but a zoom is a move too, so a
     * quick pan-and-zoom would otherwise write data.json several times in a
     * second for something the user is still in the middle of doing.
     */
    private rememberView(view: SavedMapView): void {
        this.plugin.settings.view = view;

        this.clearSaveTimer();
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.plugin.saveSettings();
        }, VIEW_SAVE_DELAY_MS);
    }

    private clearSaveTimer(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
    }
}
