/**
 * The type-ahead popover under a query box.
 *
 * All the deciding is done by `core/suggest.ts`; this is the part that has to
 * be an Obsidian widget. It extends `AbstractInputSuggest` so the popover
 * looks, positions and keyboard-navigates like every other suggester in the
 * app — arrows to move, enter to accept, escape to dismiss — rather than being
 * a second thing the user has to learn.
 */

import { AbstractInputSuggest, App } from "obsidian";
import {
    QueryVocabulary,
    Suggestion,
    activeToken,
    applySuggestion,
    suggestFor,
} from "../core/suggest";

/** How each kind of suggestion is described beside its value. */
const KIND_LABELS: Record<Suggestion["kind"], string> = {
    field: "key",
    tag: "tag",
    path: "folder",
    file: "note",
};

export class QuerySuggest extends AbstractInputSuggest<Suggestion> {
    private readonly input: HTMLInputElement;
    private readonly vocabulary: () => QueryVocabulary;

    /**
     * @param input the query box to attach to
     * @param vocabulary called for the current values each time the popover
     *   opens, since notes are indexed and edited while the panel is open
     */
    constructor(
        app: App,
        input: HTMLInputElement,
        vocabulary: () => QueryVocabulary
    ) {
        super(app, input);
        this.input = input;
        this.vocabulary = vocabulary;
    }

    /**
     * The offers for whatever term the caret is in.
     *
     * The base class hands over the input's whole value, which is not enough: a
     * query is several terms and only the one under the caret is being typed.
     * So the value is ignored and the element is read directly, for the caret
     * position it also carries.
     */
    protected getSuggestions(): Suggestion[] {
        const cursor = this.input.selectionStart ?? this.input.value.length;
        const token = activeToken(this.input.value, cursor);
        return suggestFor(token.text, this.vocabulary());
    }

    renderSuggestion(suggestion: Suggestion, el: HTMLElement): void {
        el.addClass("ferry-map-suggestion");
        // Set as text, never markup: these are note names and tags, which is
        // whatever the user happened to call things.
        el.createSpan({ cls: "ferry-map-suggestion-value" }).setText(
            suggestion.label
        );
        el.createSpan({ cls: "ferry-map-suggestion-kind" }).setText(
            KIND_LABELS[suggestion.kind]
        );
    }

    /**
     * Put the accepted suggestion in the box.
     *
     * The caret is placed where typing should continue — after the `:` of a
     * key, after the space of a completed value — and an `input` event is
     * dispatched by hand, because setting `value` from script does not fire
     * one and the panel is listening for it to know the query changed.
     *
     * That same event is what the popover itself listens to, so accepting a key
     * immediately re-offers that key's values, which is the point of leaving
     * the caret there. A completed term has nothing left to offer, so the
     * popover is closed after the event rather than instead of it.
     */
    selectSuggestion(suggestion: Suggestion): void {
        const cursor = this.input.selectionStart ?? this.input.value.length;
        const span = activeToken(this.input.value, cursor);
        const applied = applySuggestion(this.input.value, span, suggestion);

        this.input.value = applied.text;
        this.input.setSelectionRange(applied.cursor, applied.cursor);
        this.input.dispatchEvent(new Event("input"));

        if (suggestion.kind !== "field") this.close();

        this.input.focus();
    }
}
