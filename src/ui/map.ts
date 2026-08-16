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
import { BaseLayerId, SavedMapView, TileLayerSettings } from "./settings";

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

    /** Re-measure after the containing leaf changes size. */
    resize(): void {
        this.map.invalidateSize();
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
}

function tileLayer(settings: TileLayerSettings): L.TileLayer {
    return L.tileLayer(settings.url, {
        attribution: settings.attribution,
        maxZoom: settings.maxZoom,
    });
}
