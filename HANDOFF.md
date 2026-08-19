# Handoff — v1 is built; what is left is judgement

Brief for whoever picks this up next. [VISION.md](VISION.md) is the what,
[PLANNING.md](PLANNING.md) is the how; this file records the state of play and
the things you would otherwise have to rediscover.

## Where things stand

**M0–M7 are done — everything PLANNING.md scoped for v1 — plus M8, journeys.**
278 tests; `npm test`, `npm run build` and `npm run lint` all clean.

What has **not** been exercised in the real vault yet: the marker-size slider
across its range, the "Go to default view" command, the problems list against
`MAP_TEST/Malformed geotags.md`, and all of M8. That note's six broken geotags
are the fixture M7 was defined by, and `TRIPS/` is where journey lines will
first be seen in anger, so those two are the first things to check.

The repo directory is still `obsidian-map` although the plugin was renamed to
Ferry Map (id `ferry-map`). Renaming the directory is a bare `mv` — nothing in
the repo refers to it.

There is **no git remote**. That is why `.github/workflows/check.yml` was not
added: it would never run. Worth adding the day this is pushed anywhere.

## What is left

Nothing is outstanding against v1. What remains is a decision about where this
goes next, and the honest answers are:

-   **Use it for a while.** Every deviation found so far came from using it, not
    from reading it. Two rounds of that have already paid for themselves.
-   **Beyond v1**, VISION.md's out-of-scope list is the place to look. Content
    matching in queries is the cheapest of them: `core/query.ts` is built to take
    one more predicate and `matches` one more case, but it means reading files
    rather than consulting the cache, which is the line v1 deliberately holds.
-   **Publishing** would mean a remote, CI, and a look at the tile providers'
    usage policies — the defaults are fine for personal use, not redistribution.

## Conventions this codebase holds to

These are consistent throughout and should not be broken casually.

-   **`src/core/` never imports `obsidian`.** Not even for types — where a shape
    from the app is needed it is declared structurally (see `MetadataLike` in
    `core/geotags.ts`) and a compile-time guard in `obsidian/metadata.ts` fails
    the build if the real type stops satisfying it. This is what makes the core
    testable in a `node` jest environment.
-   **`src/ui/map.ts` is the only module that imports Leaflet**, and it does not
    import `obsidian`. It emits events and the view decides what they mean. Keep
    Obsidian `Menu`s and notices in `view.ts`.
-   **Logic worth testing goes in `core/`, even when it is UI-adjacent.**
    `clustering.ts`, `markers.ts`, `query.ts`, `groups.ts`, `suggest.ts` and
    `problems.ts` are all "UI" concerns living in core precisely so they can be
    tested. The rule of thumb: if it has an ordering rule, a parsing rule or an
    off-by-one in it, it belongs in core.
-   Tests sit beside sources as `X.test.ts`. Prettier and `tsc --noEmit` run via
    `npm run lint` / `npm run compile`.
-   Comments explain _why_, not _what_, per the repo's CLAUDE.md. Several
    non-obvious decisions are documented in place — read them before changing the
    code they sit on.

## Things that will bite you

-   **Pin identity is `path#ordinal`** (`core/markers.ts`) and cluster identity is
    `firstMemberId+count` (`core/clustering.ts`). Both deliberately exclude
    coordinates _and colour_, so an edit moves a pin and a recolour restyles it,
    rather than either destroying and recreating it. Do not put anything else in
    an id without asking what re-renders as a result.
-   **Marker _size_ is the exception**: it cannot be restyled in place, because
    the icon carries the size and Leaflet anchors the element by it. So
    `setMarkerSize` tears every pin down and rebuilds. That is fine for a settings
    slider and would not be for anything on a hot path.
-   **Markers never use `L.Icon.Default`.** Leaflet resolves its default icons
    from a runtime script path that does not exist inside Obsidian. Everything is
    `L.divIcon`. Verified in M0; do not "fix" this back.
-   **Store notifications are coalesced to one per frame** and the scheduler is
    injectable (`GeoStore`'s second constructor argument) so tests can drive it.
    The control panel debounces its own typing separately, at 200 ms, and the view
    debounces settings writes at 500 ms.
-   **`GeoStore` keeps a `NoteDoc` per indexed note in lockstep with the index.**
    If you add a way for a note to enter or leave the index, it has to maintain
    both — `store.doc(path)` throws for a path it does not know, deliberately, so
    a desync fails loudly rather than silently filtering pins away.
-   **Settings are edited in place** (a tile URL, a group's colour), which is why
    `loadSettings` clones the defaults rather than shallow-merging onto them. A
    shallow merge hands out `DEFAULT_SETTINGS`'s own objects to be mutated. The
    same shallow assign is what lets a settings file written before M7 pick up
    `home`, `precision` and `markerSize` as defaults.
-   Filtering happens in `buildMarkers`, **before** clustering, or cluster counts
    would include pins that are not shown.
-   **The control panel is a sibling of the Leaflet container**, not a child, so a
    drag or right-click inside it is never also one on the map. Anything else
    overlaying the map should go in the same place for the same reason.
-   **Journey lines are `interactive: false`** and sit in a layer group added
    before the pins. Both matter: a line runs under the pins it joins and across
    the rest of the map, so an interactive one would take clicks meant for a pin
    and right-clicks meant for "Copy geotag".
-   **Type-ahead reads the caret, not the input's value.** Obsidian's
    `AbstractInputSuggest` hands `getSuggestions` the whole value, which is not
    enough — a query is several terms and only the one under the caret is being
    completed. `ui/suggest.ts` ignores the argument and reads `selectionStart`.

## How to verify

```sh
npm test                # unit tests
npm run build           # typecheck + bundle
npm run deploy          # copies into the vault in .deploy.local.json
npm run build:deploy    # both
```

The deploy target is a real vault at `/path/to/your/vault`
(configured in the gitignored `.deploy.local.json`). It has no hot-reload
plugin, so Obsidian needs a manual reload (Ctrl+R) after each deploy.

That vault contains **`MAP_TEST/`**, eight fixture notes each stating what it
expects — including `Ordinary links.md`, whose expectation is that it produces
nothing at all, and `Malformed geotags.md`, whose six broken geotags should
produce no pins but six rows in the panel's Problems section. See
`MAP_TEST/README.md`. The vault also contains the user's real trip notes under
`TRIPS/`, two of which carry genuine geotags.

**Mutation-test anything with rules in it.** The convention here has been to
break the implementation deliberately and confirm a test fails — it has caught
real gaps in the coordinate parser, the folder-prefix sweep, a query parser that
would have read `- skye` as an exclusion of Skye, a case-insensitive sort tested
with values that sorted the same either way, and a defensive array copy that
protected nothing and was removed. A green suite is not evidence on its own.

Revert mutants by **copying a backup file back**, not with `git checkout --` —
uncommitted work has been lost to that once already.
