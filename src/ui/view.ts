import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { Cluster } from "../core/clustering";
import { Coordinate } from "../core/coordinates";
import { GeoTag } from "../core/geotags";
import { MapMarker, buildMarkers } from "../core/markers";
import type FerryMapPlugin from "../main";
import { MapSurface } from "./map";
import { SavedMapView } from "./settings";
import "./styles.css";

export const FERRY_MAP_VIEW_TYPE = "ferry-map-view";

/** How long panning must settle before the view position is written to disk. */
const VIEW_SAVE_DELAY_MS = 500;

export class FerryMapView extends ItemView {
    private readonly plugin: FerryMapPlugin;
    private surface: MapSurface | null = null;
    private unsubscribe: (() => void) | null = null;
    private saveTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: FerryMapPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return FERRY_MAP_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Ferry Map";
    }

    getIcon(): string {
        return "globe";
    }

    async onOpen(): Promise<void> {
        // children[1] is the view content area; children[0] is the view header.
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("ferry-map-view");

        const surfaceEl = container.createDiv({
            cls: "ferry-map-container",
        });

        this.surface = new MapSurface(surfaceEl, {
            tiles: this.plugin.settings.tiles,
            initial: this.plugin.settings.view,
            onViewChange: (view) => this.rememberView(view),
            onSelect: (cluster, event) => this.selectPin(cluster, event),
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

    /** Centre the map on a point. Used when a geotag link is followed. */
    focusOn(coordinate: Coordinate): void {
        this.surface?.focus(coordinate);
    }

    /**
     * Handle a click on a pin.
     *
     * A lone pin opens its note. A pin standing for several offers a choice,
     * because zooming is not always a way out: geotags at identical or
     * near-identical coordinates stay merged at every zoom level, and without a
     * picker none of them could be opened at all.
     */
    private selectPin(cluster: Cluster, event: MouseEvent): void {
        if (cluster.members.length === 1) {
            cluster.members[0].onSelect();
            return;
        }

        const menu = new Menu();

        if (this.surface?.canZoomIn()) {
            menu.addItem((item) =>
                item
                    .setTitle("Zoom in here")
                    .setIcon("zoom-in")
                    .onClick(() => this.surface?.zoomIn(cluster.coordinate))
            );
            menu.addSeparator();
        }

        for (const member of cluster.members) {
            menu.addItem((item) =>
                item
                    .setTitle(memberTitle(member))
                    .setIcon("map-pin")
                    .onClick(() => member.onSelect())
            );
        }

        menu.showAtMouseEvent(event);
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

/**
 * How one option reads in the picker.
 *
 * Aliased geotags are named by their alias, which alone would not say which
 * note opening it leads to, so the note is appended where the two differ.
 */
function memberTitle(member: MapMarker): string {
    return member.label === member.noteName
        ? member.label
        : `${member.label} — ${member.noteName}`;
}
