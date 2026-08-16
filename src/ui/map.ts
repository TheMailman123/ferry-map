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
import { Cluster, clusterMarkers } from "../core/clustering";
import { MapMarker } from "../core/markers";
import { BaseLayerId, SavedMapView, TileLayerSettings } from "./settings";

export type { MapMarker };

/** Zoom used when following a geotag link, unless already closer in. */
const FOCUS_ZOOM = 13;

/**
 * How close two pins must be, in pixels, before they are drawn as one with a
 * count. A shade wider than a pin, so pins that visibly touch are merged.
 */
const CLUSTER_RADIUS_PX = 26;

/** Zoom levels gained by clicking a cluster. */
const CLUSTER_ZOOM_STEP = 2;

/** How many member names a cluster's tooltip lists before summarising. */
const TOOLTIP_MEMBER_LIMIT = 8;

export interface MapSurfaceOptions {
    tiles: Record<BaseLayerId, TileLayerSettings>;
    /** Where to open. Restored from settings. */
    initial: SavedMapView;
    /** Called when the user pans, zooms, or switches base layer. */
    onViewChange: (view: SavedMapView) => void;
}

export class MapSurface {
    private readonly map: L.Map;
    private readonly layers: Record<BaseLayerId, L.TileLayer>;
    private readonly onViewChange: (view: SavedMapView) => void;
    private readonly pins: L.LayerGroup;
    /** Drawn clusters, by cluster id. */
    private readonly markers = new Map<string, L.Marker>();
    /** The markers to draw, before clustering for the current zoom. */
    private pending: MapMarker[] = [];
    private activeLayer: BaseLayerId;

    constructor(container: HTMLElement, options: MapSurfaceOptions) {
        this.onViewChange = options.onViewChange;
        this.activeLayer = options.initial.layer;

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
            CLUSTER_RADIUS_PX
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
        const centre = this.map.getCenter();
        return {
            lat: clampLatitude(centre.lat),
            lon: normaliseLongitude(centre.lng),
            zoom: this.map.getZoom(),
            layer: this.activeLayer,
        };
    }

    /** The point under a mouse event, normalised. Used by the copy menu. */
    coordinateAt(event: MouseEvent): Coordinate {
        const point = this.map.mouseEventToLatLng(event);
        return {
            lat: clampLatitude(point.lat),
            lon: normaliseLongitude(point.lng),
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
                icon: pinIcon(cluster),
                title: label,
                keyboard: true,
                alt: label,
            }
        );

        created.bindTooltip(tooltipContent(cluster), { direction: "top" });
        created.on("click", () => this.selectCluster(cluster));
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

        existing.setTooltipContent(tooltipContent(cluster));

        // The click handler closes over the previous cluster, whose members may
        // now point at stale lines, so it is always replaced.
        existing.off("click");
        existing.on("click", () => this.selectCluster(cluster));
    }

    /**
     * A single pin opens its note; a cluster zooms in instead, since there is no
     * one note it could sensibly open.
     */
    private selectCluster(cluster: Cluster): void {
        if (cluster.members.length === 1) {
            cluster.members[0].onSelect();
            return;
        }

        this.map.setView(
            [cluster.coordinate.lat, cluster.coordinate.lon],
            this.map.getZoom() + CLUSTER_ZOOM_STEP
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
function pinIcon(cluster: Cluster): L.DivIcon {
    const count = cluster.members.length;
    const size = count > 1 ? 26 : 18;

    const el = document.createElement("div");
    el.addClass("obsidian-map-pin");
    if (count > 1) {
        el.addClass("obsidian-map-pin-cluster");
        el.setText(String(count));
    }

    return L.divIcon({
        className: "obsidian-map-marker",
        html: el,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        tooltipAnchor: [0, -size / 2],
    });
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
    el.addClass("obsidian-map-tooltip");

    if (cluster.members.length === 1) {
        const [marker] = cluster.members;

        el.createDiv({ cls: "obsidian-map-tooltip-label" }).setText(
            marker.label
        );

        // Redundant when the pin is labelled by its note; useful when it is not.
        if (marker.label !== marker.noteName) {
            el.createDiv({ cls: "obsidian-map-tooltip-note" }).setText(
                marker.noteName
            );
        }

        return el;
    }

    el.createDiv({ cls: "obsidian-map-tooltip-label" }).setText(
        `${cluster.members.length} geotags here`
    );

    const list = el.createDiv({ cls: "obsidian-map-tooltip-note" });
    for (const marker of cluster.members.slice(0, TOOLTIP_MEMBER_LIMIT)) {
        list.createDiv().setText(marker.label);
    }

    const hidden = cluster.members.length - TOOLTIP_MEMBER_LIMIT;
    if (hidden > 0) list.createDiv().setText(`and ${hidden} more`);

    return el;
}

function tileLayer(settings: TileLayerSettings): L.TileLayer {
    return L.tileLayer(settings.url, {
        attribution: settings.attribution,
        maxZoom: settings.maxZoom,
    });
}
