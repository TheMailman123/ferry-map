import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { Cluster } from "../core/clustering";
import {
    Coordinate,
    formatCoordinate,
    formatGeotag,
} from "../core/coordinates";
import { GeoTag } from "../core/geotags";
import { compileGroups, noteStyler } from "../core/groups";
import { MapMarker, buildMarkers } from "../core/markers";
import { groupProblems } from "../core/problems";
import { parseQuery } from "../core/query";
import { buildRoutes } from "../core/routes";
import type FerryMapPlugin from "../main";
import { MapControls } from "./controls";
import { MapSurface } from "./map";
import { ControlsState, SavedMapView } from "./settings";
import "./styles.css";

export const FERRY_MAP_VIEW_TYPE = "ferry-map-view";

/** How long a change must settle before settings are written to disk. */
const SAVE_DELAY_MS = 500;

export class FerryMapView extends ItemView {
    private readonly plugin: FerryMapPlugin;
    private surface: MapSurface | null = null;
    private controls: MapControls | null = null;
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
            markerSize: this.plugin.settings.markerSize,
            onViewChange: (view) => this.rememberView(view),
            onSelect: (cluster, event) => this.selectPin(cluster, event),
            onContextMenu: (coordinate, event) =>
                this.showCopyMenu(coordinate, event),
        });

        // Deliberately a sibling of the map container, not a child of it: a
        // drag or a right-click inside the panel is then never also one on the
        // map, without any Leaflet event plumbing to keep them apart.
        this.controls = new MapControls(container, {
            app: this.app,
            state: this.plugin.settings.controls,
            vocabulary: () => this.plugin.store.vocabulary(),
            onChange: (state) => this.applyControls(state),
            onOpenProblem: (path, line) => this.openPath(path, line),
        });

        // Subscribing before the first draw matters: the view can be restored
        // at startup before the vault scan has run, and would otherwise sit
        // empty until something else happened to change.
        this.unsubscribe = this.plugin.store.onChange(() => this.refresh());
        this.refresh();
    }

    onResize(): void {
        this.surface?.resize();
    }

    async onClose(): Promise<void> {
        // Destroyed first, so that a keystroke it is still holding is reported
        // in time for the flush below to write it. Closing the tab should not
        // discard the query the user has just typed into it.
        this.controls?.destroy();
        this.controls = null;

        this.flushSave();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.surface?.destroy();
        this.surface = null;
        this.containerEl.children[1].empty();
    }

    /**
     * Take on everything the index currently holds.
     *
     * Separate from {@link drawMarkers} because the two have different
     * triggers: the pins are redrawn on every settled keystroke in the filter
     * box, while the problems change only when a note does.
     */
    private refresh(): void {
        this.drawMarkers();
        this.controls?.setProblems(groupProblems(this.plugin.store.problems()));
    }

    /**
     * Draw the pins for the current geotags, filtered and coloured.
     *
     * The queries are parsed here, on each draw, rather than kept compiled
     * alongside the settings. A draw happens at most once per frame and a query
     * is a handful of tokens, so the cost is nothing next to the certainty that
     * what is drawn matches what the panel currently says.
     */
    private drawMarkers(): void {
        const { filter, groups } = this.plugin.settings.controls;

        const styleFor = noteStyler(
            (path) => this.plugin.store.doc(path),
            parseQuery(filter),
            compileGroups(groups)
        );

        const tags = this.plugin.store.tags();

        this.surface?.setMarkers(
            buildMarkers(tags, (tag) => this.openNote(tag), styleFor)
        );
        // Built from the same tags and the same styler, so a filter can never
        // hide a note's pins while leaving its journey behind.
        this.surface?.setRoutes(buildRoutes(tags, styleFor));
    }

    /** Take on a change from the control panel: redraw, and remember it. */
    private applyControls(state: ControlsState): void {
        this.plugin.settings.controls = state;
        this.drawMarkers();
        this.scheduleSave();
    }

    /** Centre the map on a point. Used when a geotag link is followed. */
    focusOn(coordinate: Coordinate): void {
        this.surface?.focus(coordinate);
    }

    /** Return the map to the view saved as the default. */
    goHome(): void {
        this.surface?.showView(this.plugin.settings.home);
    }

    /**
     * Where the map is now, or null if it has not been built yet.
     *
     * Read by the settings tab when capturing a default view. Taken live rather
     * than from the saved settings, which lag a pan by half a second.
     */
    currentView(): SavedMapView | null {
        return this.surface?.view() ?? null;
    }

    /** Take on settings changed from the settings tab while the map is open. */
    applySettings(): void {
        this.surface?.setMarkerSize(this.plugin.settings.markerSize);
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

    /**
     * Offer to put the clicked point on the clipboard.
     *
     * The clipboard is the only bridge from map to note: the plugin never
     * writes to a file, so authoring a geotag stays an explicit paste.
     */
    private showCopyMenu(coordinate: Coordinate, event: MouseEvent): void {
        const menu = new Menu();

        menu.addItem((item) =>
            item
                .setTitle("Copy geotag")
                .setIcon("link")
                .onClick(() =>
                    this.copy(
                        formatGeotag(coordinate, this.plugin.settings.precision)
                    )
                )
        );

        menu.addItem((item) =>
            item
                .setTitle("Copy coordinates")
                .setIcon("clipboard-copy")
                .onClick(() =>
                    this.copy(
                        formatCoordinate(
                            coordinate,
                            this.plugin.settings.precision
                        )
                    )
                )
        );

        menu.showAtMouseEvent(event);
    }

    private copy(text: string): void {
        navigator.clipboard.writeText(text).then(
            // Echo what was copied, so it is obvious the precision is limited.
            () => {
                new Notice(`Copied ${text}`);
            },
            (error: Error) => {
                new Notice(`Could not copy: ${error.message}`);
                console.error(error);
            }
        );
    }

    private openNote(tag: GeoTag): void {
        this.openPath(tag.path, tag.line);
    }

    /** Reveal a note, reporting rather than swallowing a failure to do so. */
    private openPath(path: string, line: number | null): void {
        this.plugin.obsidian.openNote(path, line).catch((error: Error) => {
            // Surfaced rather than swallowed: a pin that silently does nothing
            // when clicked is worse than one that says why.
            new Notice(error.message);
            console.error(error);
        });
    }

    private rememberView(view: SavedMapView): void {
        this.plugin.settings.view = view;
        this.scheduleSave();
    }

    /**
     * Write settings to disk once the user stops changing them.
     *
     * Leaflet fires `moveend` once per gesture, but a zoom is a move too, so a
     * quick pan-and-zoom would otherwise write data.json several times in a
     * second for something the user is still in the middle of doing. The
     * control panel has the same shape of problem.
     */
    private scheduleSave(): void {
        this.clearSaveTimer();
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.plugin.saveSettings();
        }, SAVE_DELAY_MS);
    }

    /**
     * Write a pending change now rather than waiting for it to settle. Used
     * when the view closes, since the timer would otherwise be thrown away
     * along with everything the user did in the last half second.
     */
    private flushSave(): void {
        if (this.saveTimer === null) return;

        this.clearSaveTimer();
        void this.plugin.saveSettings();
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
