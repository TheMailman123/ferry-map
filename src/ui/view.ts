import { ItemView, WorkspaceLeaf } from "obsidian";
import type MapPlugin from "../main";
import "./styles.css";

export const MAP_VIEW_TYPE = "obsidian-map-view";

/**
 * The map tab. Currently a placeholder shell; the map surface and marker layer
 * are added on top of this container.
 */
export class MapView extends ItemView {
    private plugin: MapPlugin;

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
        container.createDiv({ cls: "obsidian-map-container" });
    }

    async onClose(): Promise<void> {
        this.containerEl.children[1].empty();
    }
}
