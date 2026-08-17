/**
 * Keeping the store in step with the vault.
 *
 * Nothing here decides anything; it maps Obsidian's events onto store calls.
 * The subtlety is which events to listen to, and it is documented below.
 */

import { App, EventRef, TAbstractFile, TFile } from "obsidian";
import { GeoStore } from "./store";

/**
 * Subscribe the store to vault changes.
 *
 * @returns the subscriptions, for the caller to hand to `Plugin.registerEvent`
 *   so they are torn down with the plugin
 */
export function watchVault(app: App, store: GeoStore): EventRef[] {
    return [
        // Fires once a changed file has been re-indexed, which is exactly when
        // its geotags can be re-read. Also covers newly created notes, so there
        // is no need to listen for `vault.on("create")`.
        app.metadataCache.on("changed", (file) => store.updateNote(file)),

        // The metadata cache does not fire `changed` on rename — the Obsidian
        // typings say so explicitly — so without this the index would keep
        // pointing at the old path. Folders are included: renaming one moves
        // every note beneath it, and those notes are not re-indexed either.
        app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
            store.renamePath(oldPath, file.path)
        ),

        // Both deletion events are handled because they cover different things:
        // the cache reports notes it had indexed, the vault reports anything at
        // all, including a folder taking its notes with it. Removal is
        // idempotent, so the overlap is harmless.
        app.metadataCache.on("deleted", (file) => store.removeNote(file.path)),
        app.vault.on("delete", (file: TAbstractFile) => remove(store, file)),
    ];
}

/** Forget a deleted note, or every note beneath a deleted folder. */
function remove(store: GeoStore, file: TAbstractFile): void {
    if (file instanceof TFile) store.removeNote(file.path);
    else store.removeUnder(file.path);
}
