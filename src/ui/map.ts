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
import { MapMarker } from "../core/markers";
import { BaseLayerId, SavedMapView, TileLayerSettings } from "./settings";

export type { MapMarker };

/** Zoom used when following a geotag link, unless already closer in. */
const FOCUS_ZOOM = 13;

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
    private readonly markers = new Map<string, L.Marker>();
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

        // Leaflet measures its container on construction. In an Obsidian leaf
        // that has not been laid out yet the container is zero-sized, which
        // leaves the map blank until something forces a re-measure.
        window.requestAnimationFrame(() => this.map.invalidateSize());
    }

    /**
     * Bring the displayed pins in line with `markers`.
     *
     * Pins are reconciled by id rather than cleared and rebuilt, so editing one
     * note does not make every other pin on the map flicker.
     */
    setMarkers(markers: MapMarker[]): void {
        const wanted = new Map(markers.map((marker) => [marker.id, marker]));

        for (const [id, existing] of this.markers) {
            if (!wanted.has(id)) {
                existing.remove();
                this.markers.delete(id);
            }
        }

        for (const marker of markers) {
            const existing = this.markers.get(marker.id);
            if (existing) {
                this.updateMarker(existing, marker);
            } else {
                this.markers.set(marker.id, this.createMarker(marker));
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

    private createMarker(marker: MapMarker): L.Marker {
        const created = L.marker(
            [marker.coordinate.lat, marker.coordinate.lon],
            {
                icon: pinIcon(),
                title: marker.label,
                keyboard: true,
                alt: marker.label,
            }
        );

        created.bindTooltip(tooltipContent(marker), { direction: "top" });
        created.on("click", () => marker.onSelect());
        created.addTo(this.pins);

        return created;
    }

    private updateMarker(existing: L.Marker, marker: MapMarker): void {
        const current = existing.getLatLng();
        if (
            current.lat !== marker.coordinate.lat ||
            current.lng !== marker.coordinate.lon
        ) {
            existing.setLatLng([marker.coordinate.lat, marker.coordinate.lon]);
        }

        existing.setTooltipContent(tooltipContent(marker));

        // The click handler closes over the previous marker's onSelect, which
        // may now point at a stale line, so it is always replaced.
        existing.off("click");
        existing.on("click", () => marker.onSelect());
    }
}

/**
 * A pin.
 *
 * A `divIcon` rather than Leaflet's default marker: the default resolves its
 * images from a runtime script path that does not exist inside Obsidian, and a
 * div can be recoloured from CSS, which is what the colour groups need.
 */
function pinIcon(): L.DivIcon {
    return L.divIcon({
        className: "obsidian-map-marker",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        tooltipAnchor: [0, -9],
    });
}

/**
 * Tooltip contents, built as DOM rather than an HTML string.
 *
 * Labels come from note names and link aliases — arbitrary user text — so they
 * are set as `textContent` and never parsed as markup.
 */
function tooltipContent(marker: MapMarker): HTMLElement {
    const el = document.createElement("div");
    el.addClass("obsidian-map-tooltip");

    const label = el.createDiv({ cls: "obsidian-map-tooltip-label" });
    label.setText(marker.label);

    // Redundant when the pin is labelled by its note; useful when it is not.
    if (marker.label !== marker.noteName) {
        const note = el.createDiv({ cls: "obsidian-map-tooltip-note" });
        note.setText(marker.noteName);
    }

    return el;
}

function tileLayer(settings: TileLayerSettings): L.TileLayer {
    return L.tileLayer(settings.url, {
        attribution: settings.attribution,
        maxZoom: settings.maxZoom,
    });
}
