/**
 * The filter and colour-group panel.
 *
 * Laid out after Obsidian's graph view — a button that opens a floating card of
 * collapsible sections — because this is the same job and the user asked for
 * the same system. Everything it knows how to do is edit a {@link
 * ControlsState}; what that state then means to the map is the view's business.
 *
 * The panel is a sibling of the Leaflet container rather than a child, so a
 * drag inside it is never also a drag of the map, and no Leaflet event
 * plumbing is needed to keep the two apart.
 */

import { App, setIcon } from "obsidian";
import { ColourGroup } from "../core/groups";
import { QueryVocabulary } from "../core/suggest";
import { ControlsState, nextGroupColour } from "./settings";
import { QuerySuggest } from "./suggest";

/**
 * How long typing must settle before the map is redrawn.
 *
 * Long enough that a query is not re-run on every keystroke, short enough that
 * the map still feels like it is answering as you type.
 */
const TYPING_SETTLE_MS = 200;

export interface MapControlsOptions {
    /** Needed only to hang Obsidian's suggestion popover off the query boxes. */
    app: App;
    /** Where the panel starts, as the last session left it. */
    state: ControlsState;
    /**
     * What the query boxes offer to complete to. Called afresh each time a
     * popover opens, since notes are indexed while the panel is open.
     */
    vocabulary: () => QueryVocabulary;
    /**
     * Called when the filter, the groups or the panel's openness changes,
     * debounced while the user is still typing. The state is the caller's to
     * keep: it is a fresh copy each time, not the panel's own.
     */
    onChange: (state: ControlsState) => void;
}

export class MapControls {
    private readonly app: App;
    private readonly vocabulary: () => QueryVocabulary;
    private readonly root: HTMLElement;
    private readonly panel: HTMLElement;
    private readonly toggle: HTMLElement;
    private readonly groupList: HTMLElement;
    private readonly onChange: (state: ControlsState) => void;
    private readonly state: ControlsState;
    private settleTimer: number | null = null;

    constructor(container: HTMLElement, options: MapControlsOptions) {
        this.app = options.app;
        this.vocabulary = options.vocabulary;
        this.onChange = options.onChange;
        this.state = structuredClone(options.state);

        this.root = container.createDiv({ cls: "ferry-map-controls" });

        this.toggle = this.root.createEl("button", {
            cls: "ferry-map-controls-toggle clickable-icon",
            attr: { "aria-label": "Filters and groups", type: "button" },
        });
        setIcon(this.toggle, "settings");
        this.toggle.addEventListener("click", () =>
            this.setOpen(!this.state.open)
        );

        this.panel = this.root.createDiv({ cls: "ferry-map-controls-panel" });

        this.filterSection();
        this.groupList = this.groupSection();

        this.renderGroups();
        this.showPanel();
    }

    destroy(): void {
        this.flush();
        this.root.remove();
    }

    /** The filter query, as one search box. */
    private filterSection(): void {
        const body = this.section("Filters");

        const input = this.queryBox(
            body,
            "path:, file:, tag:, -, OR",
            "Filter query"
        );
        input.value = this.state.filter;

        input.addEventListener("input", () => {
            this.state.filter = input.value;
            this.changedWhileTyping();
        });
    }

    /** The ordered group list, and the button that adds to it. */
    private groupSection(): HTMLElement {
        const body = this.section("Groups");
        const list = body.createDiv({ cls: "ferry-map-groups" });

        const add = body.createEl("button", {
            cls: "ferry-map-group-add",
            text: "New group",
            attr: { type: "button" },
        });

        add.addEventListener("click", () => {
            this.state.groups.push({
                query: "",
                colour: nextGroupColour(this.state.groups),
            });
            this.renderGroups();
            // A group with no query colours nothing, so the map does not change
            // yet — but the group is saved, and the new row wants focus.
            this.changed();
            const inputs = list.querySelectorAll("input[type=search]");
            (inputs[inputs.length - 1] as HTMLElement | undefined)?.focus();
        });

        return list;
    }

    /**
     * Draw the group rows.
     *
     * Called only when a group is added or removed, never on a keystroke:
     * rebuilding a row the user is typing into would take the focus out of it.
     */
    private renderGroups(): void {
        this.groupList.empty();
        this.state.groups.forEach((group, index) =>
            this.groupRow(group, index)
        );
    }

    private groupRow(group: ColourGroup, index: number): void {
        const row = this.groupList.createDiv({ cls: "ferry-map-group" });

        const query = this.queryBox(row, "Query", `Group ${index + 1} query`);
        query.value = group.query;
        query.addEventListener("input", () => {
            group.query = query.value;
            this.changedWhileTyping();
        });

        const colour = row.createEl("input", {
            type: "color",
            cls: "ferry-map-group-colour",
            attr: { "aria-label": `Group ${index + 1} colour` },
        });
        colour.value = group.colour;
        // "input" rather than "change" so the map follows the colour picker
        // while it is open, which is the only way to judge a colour on a map.
        colour.addEventListener("input", () => {
            group.colour = colour.value;
            this.changedWhileTyping();
        });

        const remove = row.createEl("button", {
            cls: "ferry-map-group-remove clickable-icon",
            attr: { "aria-label": `Remove group ${index + 1}`, type: "button" },
        });
        setIcon(remove, "x");
        remove.addEventListener("click", () => {
            this.state.groups.splice(index, 1);
            this.renderGroups();
            this.changed();
        });
    }

    /**
     * A query box, with the type-ahead popover attached.
     *
     * Both the filter and every group query are the same widget answering the
     * same language, so they are built in one place — including the suggester,
     * which would otherwise be easy to add to one and forget on the other.
     *
     * @param parent where the box goes
     * @param placeholder shown while the box is empty
     * @param label the accessible name, which differs per box
     */
    private queryBox(
        parent: HTMLElement,
        placeholder: string,
        label: string
    ): HTMLInputElement {
        const search = parent.createDiv({ cls: "search-input-container" });
        const input = search.createEl("input", {
            type: "search",
            cls: "ferry-map-controls-query",
            attr: {
                placeholder,
                spellcheck: "false",
                "aria-label": label,
            },
        });

        new QuerySuggest(this.app, input, this.vocabulary);

        return input;
    }

    /**
     * A collapsible section, as graph view has.
     *
     * Whether a section is open is not persisted: it costs nothing to reopen,
     * and writing settings for it would put a disk write behind a disclosure
     * triangle.
     *
     * @returns the section's body, for the caller to fill
     */
    private section(title: string): HTMLElement {
        const section = this.panel.createDiv({ cls: "ferry-map-section" });

        const header = section.createEl("button", {
            cls: "ferry-map-section-header",
            attr: { type: "button", "aria-expanded": "true" },
        });
        const chevron = header.createSpan({ cls: "ferry-map-section-chevron" });
        setIcon(chevron, "chevron-down");
        header.createSpan({ text: title });

        const body = section.createDiv({ cls: "ferry-map-section-body" });

        header.addEventListener("click", () => {
            const open = section.hasClass("is-collapsed");
            section.toggleClass("is-collapsed", !open);
            header.setAttribute("aria-expanded", String(open));
        });

        return body;
    }

    private setOpen(open: boolean): void {
        this.state.open = open;
        this.showPanel();
        this.changed();
    }

    private showPanel(): void {
        this.root.toggleClass("is-open", this.state.open);
        this.toggle.setAttribute("aria-expanded", String(this.state.open));
    }

    /**
     * Report a change once typing has settled.
     *
     * Every keystroke would otherwise re-run the query over every note and
     * redraw every pin — the same reason the store coalesces its own
     * notifications.
     */
    private changedWhileTyping(): void {
        this.clearTimer();
        this.settleTimer = window.setTimeout(() => {
            this.settleTimer = null;
            this.changed();
        }, TYPING_SETTLE_MS);
    }

    /** Report a change now, cancelling anything still waiting to settle. */
    private changed(): void {
        this.clearTimer();
        this.onChange(structuredClone(this.state));
    }

    /** Report a pending change before it is lost, e.g. on close. */
    private flush(): void {
        if (this.settleTimer !== null) this.changed();
    }

    private clearTimer(): void {
        if (this.settleTimer !== null) {
            window.clearTimeout(this.settleTimer);
            this.settleTimer = null;
        }
    }
}
