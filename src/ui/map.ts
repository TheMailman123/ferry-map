/**
 * The Leaflet map surface.
 *
 * This is the only module that imports Leaflet, so the rest of the plugin talks
 * about coordinates and view state rather than about `L.Map`. Swapping the
 * renderer would mean rewriting this file and nothing else.
 */

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
    Coordinate,
    clampLatitude,
    normaliseLongitude,
} from "../core/coordinates";
import { Cluster, ColourSlice, clusterMarkers } from "../core/clustering";
import { MapMarker } from "../core/markers";
import { BaseLayerId, SavedMapView, TileLayerSettings } from "./settings";

export type { MapMarker };

/** Zoom used when following a geotag link, unless already closer in. */
const FOCUS_ZOOM = 13;

/**
 * How much wider a clustered pin is than a lone one, so a count fits inside it.
 *
 * The same figure sets the clustering radius: two pins are merged once they are
 * closer than the width of the pin that would replace them, which is the point
 * at which they visibly touch.
 */
const CLUSTER_SCALE = 26 / 18;

/** Zoom levels gained by clicking a cluster. */
const CLUSTER_ZOOM_STEP = 2;

/** How many member names a cluster's tooltip lists before summarising. */
const TOOLTIP_MEMBER_LIMIT = 8;

/** The pin element inside a marker's icon. Styled by `styles.css`. */
const PIN_CLASS = "ferry-map-pin";

/** Set on a pin standing for more than one colour. */
const MIXED_CLASS = "is-mixed";

/** Custom property the stylesheet reads a group's colour from. */
const MARKER_COLOUR_PROPERTY = "--ferry-map-marker-colour";

/**
 * Custom property carrying the pin's drawn diameter.
 *
 * The stylesheet sizes the count off it, so a pin scaled by the marker-size
 * setting keeps its proportions instead of holding a fixed-size number that
 * overflows a small pin and rattles around a large one.
 */
const MARKER_SIZE_PROPERTY = "--ferry-map-marker-size";

/**
 * Custom property the stylesheet reads a mixed pin's segments from: the stop
 * list of a `conic-gradient`, without the surrounding function call.
 */
const MARKER_SEGMENTS_PROPERTY = "--ferry-map-marker-segments";

/**
 * What an uncoloured slice is drawn in, as CSS the gradient can name.
 *
 * A `var()` rather than a literal so the actual colour stays a decision of the
 * stylesheet, alongside the one it makes for an ordinary uncoloured pin.
 */
const DEFAULT_SLICE_COLOUR = "var(--ferry-map-marker-default)";

export interface MapSurfaceOptions {
    tiles: Record<BaseLayerId, TileLayerSettings>;
    /** Where to open. Restored from settings. */
    initial: SavedMapView;
    /** Diameter of a lone pin, in pixels. */
    markerSize: number;
    /** Called when the user pans, zooms, or switches base layer. */
    onViewChange: (view: SavedMapView) => void;
    /**
     * Called when a pin is clicked. Handled outside this module because what
     * should happen — open a note, or offer a choice of them — is an Obsidian
     * question rather than a map one.
     */
    onSelect: (cluster: Cluster, event: MouseEvent) => void;
    /** Called on a right-click, with the point under the pointer. */
    onContextMenu: (coordinate: Coordinate, event: MouseEvent) => void;
}

export class MapSurface {
    private readonly map: L.Map;
    private readonly layers: Record<BaseLayerId, L.TileLayer>;
    private readonly onViewChange: (view: SavedMapView) => void;
    private readonly onSelect: (cluster: Cluster, event: MouseEvent) => void;
    private readonly onContextMenu: (
        coordinate: Coordinate,
        event: MouseEvent
    ) => void;
    private readonly pins: L.LayerGroup;
    /** Drawn clusters, by cluster id. */
    private readonly markers = new Map<string, L.Marker>();
    /** The markers to draw, before clustering for the current zoom. */
    private pending: MapMarker[] = [];
    private activeLayer: BaseLayerId;
    private markerSize: number;

    constructor(container: HTMLElement, options: MapSurfaceOptions) {
        this.onViewChange = options.onViewChange;
        this.onSelect = options.onSelect;
        this.onContextMenu = options.onContextMenu;
        this.activeLayer = options.initial.layer;
        this.markerSize = options.markerSize;

        this.layers = {
            map: tileLayer(options.tiles.map),
            satellite: tileLayer(options.tiles.satellite),
        };

        this.map = L.map(container, {
            center: [options.initial.lat, options.initial.lon],
            zoom: options.initial.zoom,
            // Keeps the centre near the prime meridian's copy of the world when
            // panning across the antimeridian, rather than drifting to ±540.
            worldCopyJump: true,
            layers: [this.layers[this.activeLayer]],
        });

        this.pins = L.layerGroup().addTo(this.map);

        L.control
            .layers({
                [options.tiles.map.name]: this.layers.map,
                [options.tiles.satellite.name]: this.layers.satellite,
            })
            .addTo(this.map);

        this.map.on("baselayerchange", (event: L.LayersControlEvent) => {
            this.activeLayer =
                event.layer === this.layers.satellite ? "satellite" : "map";
            this.reportView();
        });

        this.map.on("moveend", () => this.reportView());

        // Which pins overlap depends on zoom alone: projected positions scale
        // together, so panning cannot change what clusters with what.
        this.map.on("zoomend", () => this.drawPins());

        this.map.on("contextmenu", (event: L.LeafletMouseEvent) => {
            // Otherwise Obsidian's own context menu opens on top of ours.
            event.originalEvent.preventDefault();
            this.onContextMenu(normalise(event.latlng), event.originalEvent);
        });

        // Leaflet measures its container on construction. In an Obsidian leaf
        // that has not been laid out yet the container is zero-sized, which
        // leaves the map blank until something forces a re-measure.
        window.requestAnimationFrame(() => this.map.invalidateSize());
    }

    /** Bring the displayed pins in line with `markers`. */
    setMarkers(markers: MapMarker[]): void {
        this.pending = markers;
        this.drawPins();
    }

    /**
     * Cluster the current markers for the current zoom and reconcile what is on
     * the map with the result.
     *
     * Clusters are matched by id rather than cleared and rebuilt, so an edit to
     * one note does not make every other pin on the map flicker.
     */
    private drawPins(): void {
        const clusters = clusterMarkers(
            this.pending,
            (coordinate) =>
                this.map.project(
                    [coordinate.lat, coordinate.lon],
                    this.map.getZoom()
                ),
            this.markerSize * CLUSTER_SCALE
        );

        const wanted = new Map(
            clusters.map((cluster) => [cluster.id, cluster])
        );

        for (const [id, existing] of this.markers) {
            if (!wanted.has(id)) {
                existing.remove();
                this.markers.delete(id);
            }
        }

        for (const cluster of clusters) {
            const existing = this.markers.get(cluster.id);
            if (existing) {
                this.updateMarker(existing, cluster);
            } else {
                this.markers.set(cluster.id, this.createMarker(cluster));
            }
        }
    }

    /** Re-measure after the containing leaf changes size. */
    resize(): void {
        this.map.invalidateSize();
    }

    /**
     * Redraw every pin at a new size.
     *
     * Unlike a recolour this cannot be done in place — the icon carries the
     * size, and Leaflet anchors the element by it — so the pins are torn down
     * and rebuilt. That is a visible flicker, but this runs only when the
     * slider in the settings tab moves, not while the map is in use.
     */
    setMarkerSize(size: number): void {
        if (size === this.markerSize) return;

        this.markerSize = size;
        for (const marker of this.markers.values()) marker.remove();
        this.markers.clear();
        this.drawPins();
    }

    /**
     * Jump to a stored view, base layer included.
     *
     * Used by "Go to default view". The layer is swapped through the map rather
     * than the layers control, which notices the add and updates its own radio
     * buttons.
     */
    showView(view: SavedMapView): void {
        if (view.layer !== this.activeLayer) {
            this.map.removeLayer(this.layers[this.activeLayer]);
            this.map.addLayer(this.layers[view.layer]);
            this.activeLayer = view.layer;
        }

        this.map.setView([view.lat, view.lon], view.zoom);
    }

    /** Whether there is any zoom left to gain. */
    canZoomIn(): boolean {
        return this.map.getZoom() < this.map.getMaxZoom();
    }

    /** Zoom in on a point, to help separate pins drawn on top of each other. */
    zoomIn(coordinate: Coordinate): void {
        this.map.setView(
            [coordinate.lat, coordinate.lon],
            Math.min(
                this.map.getZoom() + CLUSTER_ZOOM_STEP,
                this.map.getMaxZoom()
            )
        );
    }

    /**
     * Centre the map on a point, zooming in if the map is further out than
     * {@link FOCUS_ZOOM}. An existing closer zoom is left alone, so following a
     * geotag link does not throw away the detail the user was already at.
     */
    focus(coordinate: Coordinate): void {
        // The map may have been created moments ago, in a leaf that has not been
        // laid out yet; centring a zero-sized map puts the point off-screen.
        this.map.invalidateSize();
        this.map.setView(
            [coordinate.lat, coordinate.lon],
            Math.max(this.map.getZoom(), FOCUS_ZOOM)
        );
    }

    /** The current view, normalised into ranges the coordinate parser accepts. */
    view(): SavedMapView {
        return {
            ...normalise(this.map.getCenter()),
            zoom: this.map.getZoom(),
            layer: this.activeLayer,
        };
    }

    destroy(): void {
        this.map.remove();
    }

    private reportView(): void {
        this.onViewChange(this.view());
    }

    private createMarker(cluster: Cluster): L.Marker {
        const label = clusterLabel(cluster);

        const created = L.marker(
            [cluster.coordinate.lat, cluster.coordinate.lon],
            {
                icon: pinIcon(cluster, this.markerSize),
                title: label,
                keyboard: true,
                alt: label,
            }
        );

        created.bindTooltip(tooltipContent(cluster), { direction: "top" });
        created.on("click", (event) =>
            this.onSelect(cluster, event.originalEvent)
        );
        created.addTo(this.pins);

        return created;
    }

    private updateMarker(existing: L.Marker, cluster: Cluster): void {
        const current = existing.getLatLng();
        if (
            current.lat !== cluster.coordinate.lat ||
            current.lng !== cluster.coordinate.lon
        ) {
            existing.setLatLng([
                cluster.coordinate.lat,
                cluster.coordinate.lon,
            ]);
        }

        // Restyled in place rather than given a new icon: replacing the icon
        // would tear the pin's element out of the DOM and rebuild it, which is
        // a visible flicker for what is only a change of colour.
        paint(
            existing.getElement()?.querySelector(`.${PIN_CLASS}`),
            cluster.colours
        );

        existing.setTooltipContent(tooltipContent(cluster));

        // The click handler closes over the previous cluster, whose members may
        // now point at stale lines, so it is always replaced.
        existing.off("click");
        existing.on("click", (event) =>
            this.onSelect(cluster, event.originalEvent)
        );
    }
}

/**
 * A pin, carrying a count when it stands for more than one geotag.
 *
 * A `divIcon` rather than Leaflet's default marker: the default resolves its
 * images from a runtime script path that does not exist inside Obsidian, and a
 * div can be recoloured from CSS, which is what the colour groups need.
 */
function pinIcon(cluster: Cluster, markerSize: number): L.DivIcon {
    const count = cluster.members.length;
    const size = Math.round(
        count > 1 ? markerSize * CLUSTER_SCALE : markerSize
    );

    const el = document.createElement("div");
    el.addClass(PIN_CLASS);
    el.style.setProperty(MARKER_SIZE_PROPERTY, `${size}px`);
    if (count > 1) {
        el.addClass("ferry-map-pin-cluster");
        // The count is its own element rather than a bare text node so a mixed
        // pin can draw its segments behind it and still have it readable.
        el.createSpan({ cls: "ferry-map-pin-count" }).setText(String(count));
    }
    paint(el, cluster.colours);

    return L.divIcon({
        className: "ferry-map-marker",
        html: el,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        tooltipAnchor: [0, -size / 2],
    });
}

/**
 * Colour a pin from its cluster's colour breakdown.
 *
 * Colours are set as custom properties rather than as a background so the
 * stylesheet keeps control of how a pin is drawn — the properties are inputs to
 * that, and hover and cluster styling still work off them.
 *
 * A pin with one colour is painted flat, which covers every single-note pin and
 * every cluster whose notes all fall in the same group. More than one and it
 * becomes a ring of segments, sized by how many notes each colour stands for.
 *
 * @param el the pin element, or null if the marker is not on the map right now
 * @param slices the cluster's colours, in the order they should be drawn
 */
function paint(
    el: Element | null | undefined,
    slices: readonly ColourSlice[]
): void {
    if (!(el instanceof HTMLElement)) return;

    const [only] = slices;
    const mixed = slices.length > 1;

    el.toggleClass(MIXED_CLASS, mixed);

    if (mixed) el.style.setProperty(MARKER_SEGMENTS_PROPERTY, stops(slices));
    else el.style.removeProperty(MARKER_SEGMENTS_PROPERTY);

    if (!mixed && only?.colour) {
        el.style.setProperty(MARKER_COLOUR_PROPERTY, only.colour);
    } else {
        el.style.removeProperty(MARKER_COLOUR_PROPERTY);
    }
}

/**
 * The stop list of the `conic-gradient` that draws a mixed pin's ring.
 *
 * Each stop is given both its start and end angle, so the gradient steps
 * between colours instead of blending them — a blend would invent colours no
 * group has. Angles are accumulated as exact fractions of the total rather than
 * summed per slice, so rounding cannot leave a hairline gap or overshoot 360.
 */
function stops(slices: readonly ColourSlice[]): string {
    const total = slices.reduce((sum, slice) => sum + slice.count, 0);

    let counted = 0;
    return slices
        .map((slice) => {
            const from = (360 * counted) / total;
            counted += slice.count;
            const to = (360 * counted) / total;
            const colour = slice.colour ?? DEFAULT_SLICE_COLOUR;
            return `${colour} ${from}deg ${to}deg`;
        })
        .join(", ");
}

/** Plain-text label, for the marker's title and accessible name. */
function clusterLabel(cluster: Cluster): string {
    return cluster.members.length === 1
        ? cluster.members[0].label
        : `${cluster.members.length} geotags`;
}

/**
 * Tooltip contents, built as DOM rather than an HTML string.
 *
 * Labels come from note names and link aliases — arbitrary user text — so they
 * are set as `textContent` and never parsed as markup.
 */
function tooltipContent(cluster: Cluster): HTMLElement {
    const el = document.createElement("div");
    el.addClass("ferry-map-tooltip");

    if (cluster.members.length === 1) {
        const [marker] = cluster.members;

        el.createDiv({ cls: "ferry-map-tooltip-label" }).setText(marker.label);

        // Redundant when the pin is labelled by its note; useful when it is not.
        if (marker.label !== marker.noteName) {
            el.createDiv({ cls: "ferry-map-tooltip-note" }).setText(
                marker.noteName
            );
        }

        return el;
    }

    el.createDiv({ cls: "ferry-map-tooltip-label" }).setText(
        `${cluster.members.length} geotags here`
    );

    const list = el.createDiv({ cls: "ferry-map-tooltip-note" });
    for (const marker of cluster.members.slice(0, TOOLTIP_MEMBER_LIMIT)) {
        list.createDiv().setText(marker.label);
    }

    const hidden = cluster.members.length - TOOLTIP_MEMBER_LIMIT;
    if (hidden > 0) list.createDiv().setText(`and ${hidden} more`);

    return el;
}

/**
 * A Leaflet position as a coordinate the rest of the plugin will accept.
 *
 * Leaflet reports longitudes beyond ±180 once the map has been panned across
 * the antimeridian, and those describe real places but are not coordinates this
 * plugin would read back, so nothing leaves this module un-normalised.
 */
function normalise(point: L.LatLng): Coordinate {
    return {
        lat: clampLatitude(point.lat),
        lon: normaliseLongitude(point.lng),
    };
}

function tileLayer(settings: TileLayerSettings): L.TileLayer {
    return L.tileLayer(settings.url, {
        attribution: settings.attribution,
        maxZoom: settings.maxZoom,
    });
}
