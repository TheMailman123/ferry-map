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
import { ProblemGroup, problemLocation } from "../core/problems";
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
    /** Called to reveal the note a listed problem came from. */
    onOpenProblem: (path: string, line: number | null) => void;
}

/** A section of the panel, in the pieces its owner needs to reach. */
interface Section {
    root: HTMLElement;
    /** The section's title, which the problems count is appended to. */
    label: HTMLElement;
    body: HTMLElement;
}

export class MapControls {
    private readonly app: App;
    private readonly vocabulary: () => QueryVocabulary;
    private readonly root: HTMLElement;
    private readonly panel: HTMLElement;
    private readonly toggle: HTMLElement;
    private readonly groupList: HTMLElement;
    /** Badge on the toggle, so a problem is visible with the panel shut. */
    private readonly badge: HTMLElement;
    private readonly problems: Section;
    private readonly problemList: HTMLElement;
    private readonly onChange: (state: ControlsState) => void;
    private readonly onOpenProblem: (path: string, line: number | null) => void;
    private readonly state: ControlsState;
    private settleTimer: number | null = null;

    constructor(container: HTMLElement, options: MapControlsOptions) {
        this.app = options.app;
        this.vocabulary = options.vocabulary;
        this.onChange = options.onChange;
        this.onOpenProblem = options.onOpenProblem;
        this.state = structuredClone(options.state);

        this.root = container.createDiv({ cls: "ferry-map-controls" });

        this.toggle = this.root.createEl("button", {
            cls: "ferry-map-controls-toggle clickable-icon",
            attr: { "aria-label": "Filters and groups", type: "button" },
        });
        setIcon(this.toggle, "settings");
        // Added after setIcon, which replaces the button's contents.
        this.badge = this.toggle.createSpan({
            cls: "ferry-map-controls-badge",
        });
        this.toggle.addEventListener("click", () =>
            this.setOpen(!this.state.open)
        );

        this.panel = this.root.createDiv({ cls: "ferry-map-controls-panel" });

        this.filterSection();
        this.groupList = this.groupSection();
        this.problems = this.section("Problems");
        this.problemList = this.problems.body;

        this.renderGroups();
        this.setProblems([]);
        this.showPanel();
    }

    destroy(): void {
        this.flush();
        this.root.remove();
    }

    /** The filter query, as one search box. */
    private filterSection(): void {
        const { body } = this.section("Filters");

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
        const { body } = this.section("Groups");
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
     * Show the geotags the index could not read.
     *
     * The section disappears entirely when there is nothing wrong, rather than
     * standing empty: a permanent "Problems" heading trains the eye to skip it,
     * which is the one thing it must not do.
     *
     * The count is also put on the panel's toggle, because the panel is closed
     * by default and a problem nobody opens the panel to find is no better
     * surfaced than it was before.
     *
     * @param groups the problems, gathered by note. Empty hides the section.
     */
    setProblems(groups: readonly ProblemGroup[]): void {
        const total = groups.reduce(
            (count, group) => count + group.problems.length,
            0
        );

        this.problems.root.toggleClass("is-hidden", total === 0);
        this.problems.label.setText(
            total === 0 ? "Problems" : `Problems (${total})`
        );

        this.badge.toggleClass("is-hidden", total === 0);
        this.badge.setText(String(total));
        this.toggle.setAttribute(
            "aria-label",
            total === 0
                ? "Filters and groups"
                : `Filters and groups — ${total} unreadable ${
                      total === 1 ? "geotag" : "geotags"
                  }`
        );

        this.problemList.empty();
        for (const group of groups) this.problemGroup(group);
    }

    /** One note's block: its name, then a row per unreadable geotag. */
    private problemGroup(group: ProblemGroup): void {
        const block = this.problemList.createDiv({
            cls: "ferry-map-problem-note",
        });

        // Note names, raw link targets and reasons are all arbitrary user text,
        // so every one of these is set as text and never parsed as markup.
        block
            .createDiv({ cls: "ferry-map-problem-note-name" })
            .setText(group.noteName);

        for (const problem of group.problems) {
            const row = block.createEl("button", {
                cls: "ferry-map-problem",
                attr: { type: "button" },
            });

            row.createDiv({ cls: "ferry-map-problem-raw" }).setText(
                problem.raw
            );
            row.createDiv({ cls: "ferry-map-problem-reason" }).setText(
                `${problem.reason} — ${problemLocation(problem)}`
            );

            row.addEventListener("click", () =>
                this.onOpenProblem(group.path, problem.line)
            );
        }
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
     * @returns the section's parts: the root to hide it by, the label to
     *   retitle it by, and the body for the caller to fill
     */
    private section(title: string): Section {
        const root = this.panel.createDiv({ cls: "ferry-map-section" });

        const header = root.createEl("button", {
            cls: "ferry-map-section-header",
            attr: { type: "button", "aria-expanded": "true" },
        });
        const chevron = header.createSpan({ cls: "ferry-map-section-chevron" });
        setIcon(chevron, "chevron-down");
        const label = header.createSpan({ text: title });

        const body = root.createDiv({ cls: "ferry-map-section-body" });

        header.addEventListener("click", () => {
            const open = root.hasClass("is-collapsed");
            root.toggleClass("is-collapsed", !open);
            header.setAttribute("aria-expanded", String(open));
        });

        return { root, label, body };
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
