# Plan

Implementation plan for the v1 described in [VISION.md](VISION.md). Milestones
are ordered so that each one is independently testable and the risky, novel
work (coordinate extraction) lands before any of the map surface is built.

## Architecture

The shape borrows from the adjacent `ferry-calendar` project: domain logic in
`core/` knows nothing about Obsidian and is unit-tested directly; everything
that touches the app goes through one narrow adapter; the UI layer is thin.

```
src/
  main.ts                  plugin entry: settings, view + command registration
  core/                    no Obsidian imports, fully unit-tested
    types.ts               Coordinate, GeoTag, GeoTagProblem, NoteDoc
    coordinates.ts         parse and format "lat, lon"
    geotags.ts             link references -> GeoTag[] + GeoTagProblem[]
    geo_index.ts           path -> tags/problems, with incremental updates
    query.ts               filter/group query parsing and matching
    groups.ts              a note's colour, and whether the filter hides it
  obsidian/
    adapter.ts             ObsidianInterface: the only place `app` is touched
    watcher.ts             cache/vault events -> incremental index updates
  ui/
    view.ts                MapView (ItemView)
    map.ts                 Leaflet bridge: tiles, layers, markers, context menu
    controls.ts            filter + colour-group panel
    problems.ts            malformed-geotag list
    settings.ts            settings interface, defaults, settings tab
    styles.css
```

Tests live beside sources as `X.test.ts`, per the reference project.

### Core types

```ts
interface Coordinate {
    lat: number; // -90..90
    lon: number; // -180..180
}

interface GeoTag {
    coordinate: Coordinate;
    /** Link alias, when the geotag supplied one. Supersedes the note name. */
    alias: string | null;
    /** Vault path of the note the geotag was found in. */
    path: string;
    source: "body" | "property";
    /** Property key, when source is "property". */
    key: string | null;
    /** Line of the geotag in the body, for navigation. Null for properties. */
    line: number | null;
}

/** A link that looked like a geotag but was not usable. Never dropped silently. */
interface GeoTagProblem {
    path: string;
    raw: string;
    reason: string;
    line: number | null;
}
```

`GeoTag` carries no marker label. The label is derived at render time
(`alias ?? note basename`) so a note rename does not require reindexing tags.

---

## M0 — Dependency _(done)_

`leaflet` + `@types/leaflet` added. A throwaway bundle confirmed:

-   147 KB JS / 15 KB CSS minified, and the three PNGs Leaflet's stylesheet
    references are inlined as `data:` URIs by the loaders already configured in
    `esbuild.config.mjs`. The plugin ships as `main.js` + `styles.css` with no
    loose assets.
-   `_detectIconPath` / `imagePath` **are** in the bundle, confirming Leaflet
    still resolves default marker icons from a runtime script path that does not
    exist inside Obsidian.

Decision: markers use `L.divIcon` throughout, never `L.Icon.Default`. This
sidesteps the icon path problem entirely (no image assets at all) and is what
M6 needs anyway, since a `divIcon` can be recoloured from CSS.

## M1 — Coordinate core (no UI)

`core/coordinates.ts`:

-   `parseCoordinate(text: string): Coordinate | { error: string }` — strict,
    anchored match on the whole string: optional sign, decimal number, comma,
    optional whitespace, decimal number. Range-checked. Anything else is a
    non-match (not a geotag at all) or an error (looked like one, wasn't valid);
    these are distinct results, because only the second becomes a problem entry.
-   `formatGeotag(c: Coordinate, places = 4): string` — `[[58.6276, -4.9997]]`.

`core/geotags.ts`:

-   `extractGeoTags(path, cache): { tags: GeoTag[]; problems: GeoTagProblem[] }`
    over a `CachedMetadata`-shaped input, reading `links` (body) and
    `frontmatterLinks` (properties). Both are `Reference`s carrying `link` and
    `displayText`, so one loop handles both, differing only in `source`, `key`
    and `line`.
-   Obsidian sets `displayText` to the link target when there is no alias, so
    "has an alias" is `displayText !== link`, not `displayText != null`.

`core/geo_index.ts`: a `Map<path, {tags, problems}>` with `set`, `remove`,
`rename`, `tags()`, `problems()`. Rename only rewrites the key and the `path`
field — no reparsing.

**Tests (this is the milestone's real deliverable):** valid pairs including
negatives, zero, poles and antimeridian; out-of-range latitude and longitude;
three components; trailing text; a plain note link (`Chapter 3, Part 2`) that
must not be treated as a geotag or a problem; aliased and unaliased forms; a
geotag in a property; several geotags in one note; index add/update/remove/rename.

**Done when:** `npm test` covers the above and no UI exists yet.

## M2 — Map surface

`ui/map.ts` wraps Leaflet so no other module imports it:

-   `L.map` in the view container, with a map layer (OpenStreetMap) and a
    satellite layer (Esri World Imagery), both from settings, plus
    `L.control.layers` for the toggle. Attribution is set for each, as the tile
    terms require.
-   Centre, zoom and active layer persist to plugin settings on `moveend` /
    `baselayerchange`, so reopening the tab returns you where you were.
-   `onResize()` on the view calls `map.invalidateSize()` — a Leaflet map in a
    hidden or resized pane renders wrong without it.

**Done when:** the map tab pans, zooms, toggles map/satellite, and restores its
position after an Obsidian restart.

## M3 — Markers

-   On `workspace.onLayoutReady`, walk `vault.getMarkdownFiles()` through the
    adapter and populate the index. Deferred to layout-ready because the metadata
    cache is still filling during `onload`.
-   Render one marker per geotag, labelled `alias ?? basename`, with a popup
    showing the label and the origin note's name.
-   Selecting a marker opens its origin note via
    `workspace.openLinkText(path, "", ...)`, and where the geotag is in the body,
    scrolls to its line using `GeoTag.line` and `EditorPosition`.
-   The marker layer syncs by diffing against a keyed map (`path + source + key +
line`), so an edit to one note does not tear down and rebuild every marker.

**Done when:** every geotagged note in a test vault appears, labels are right,
and clicking lands on the correct note and line.

## M4 — Live updates _(done)_

`obsidian/watcher.ts`, all subscriptions wrapped in `this.registerEvent(...)`:

-   `metadataCache.on("changed")` → re-extract that one file, update the index.
-   `metadataCache.on("deleted")` → remove.
-   `vault.on("rename")` → rename in the index (the cache does **not** fire
    `changed` on rename; the Obsidian typings say so explicitly).
-   `vault.on("create")` is not needed — a new file produces a `changed` once
    indexed.

Updates are coalesced into one marker resync per animation frame so a
fast-typing edit does not thrash the map.

**Done when:** adding, editing, renaming and deleting a geotag in an open vault
moves/adds/removes its pin without reopening the tab.

## M5 — Copy geotag _(done)_

Right-click on the map surface opens an Obsidian `Menu` at the pointer with
"Copy geotag" (`[[lat, lon]]`, 4 decimal places) and "Copy coordinates"
(bare `lat, lon`). Writes via `navigator.clipboard.writeText` and confirms with
a `Notice` showing exactly what was copied.

Longitude is normalised into ±180 first — panning past the antimeridian
otherwise yields values like `-185.2` that are valid to Leaflet but not to the
parser, which would make the plugin emit geotags it refuses to read back.

**Done when:** right-click → paste into a note → the pin appears at the point
that was clicked.

## M6 — Filters and colour groups _(done)_

`core/query.ts` — a small recursive-descent parser producing an AST of
`And | Or | Not | Predicate`, and `matches(ast, doc)` against a
`NoteDoc { path, basename, tags }` assembled from the metadata cache.

v1 predicates: `path:`, `file:`, `tag:`, quoted phrases, `-` negation, implicit
AND between terms, `OR`, and brackets. A bare word matches the path, which ends
in the file name. Content matching is deliberately absent (see VISION.md) and
slots in as one more predicate.

Brackets were not in the original list but are in Obsidian's search, and a
recursive-descent parser gets them almost free. Treating them as literal text
would silently misread a query typed out of graph-view habit.

Parsing is **lenient by design**, because every prefix of a query is something
the user is momentarily holding while typing: `path:` with no value yet, an
unclosed quote or bracket, a dangling `-`. Those contribute nothing rather than
erroring or blanking the map. The rules are enumerated on `parseQuery` and each
one is tested.

`core/groups.ts` — given the ordered group list and a `NoteDoc`, return the
colour of the **first** group in list order whose query matches; groups lower
in the list do not override it. A group with an empty query colours nothing,
unlike an empty filter, which shows everything. `noteStyler` combines the two
questions into the one answer the marker layer needs, memoised per note.

`ui/controls.ts` — a collapsible panel over the map mirroring graph view's:
a settings button opening a card of "Filters" and "Groups" sections, the first
a query input, the second an add/remove list of groups each with a query input
and a colour swatch. Both persist to settings, debounced.

The panel is a **sibling** of the Leaflet container rather than a child, so a
drag or right-click inside it is never also one on the map. Nothing has to
disable Leaflet's event handling.

Markers are recoloured with `divIcon`s carrying a CSS custom property, set on
the pin element in place, so a group colour change restyles the marker rather
than replacing its icon. Colour is deliberately absent from both the marker and
cluster ids.

A cluster covering more than one group wears all of them: `colourSlices` in
`core/clustering.ts` breaks its members down by colour, and the pin draws them
as a `conic-gradient` ring around a plain centre. A single colour underneath is
still drawn as a plain pin. The ring rather than a full pie is so the count
stays readable, which it cannot be against two or three arbitrary group colours
at once.

`core/suggest.ts` and `ui/suggest.ts` — type-ahead in the query boxes, as graph
view has. The core half finds the term the caret is in, offers the keys and
values that could finish it, and splices the accepted one back in; the UI half
is an `AbstractInputSuggest` so the popover behaves like every other suggester
in the app. The vocabulary comes from the **geotagged** notes alone rather than
the whole vault: these queries only decide which pins are drawn, so completing
to a tag no pin carries would empty the map.

**Done:** the filter box hides non-matching pins, group queries colour matching
ones, a pin over several groups shows all of them, and both query boxes
complete as you type. 250 tests, including mutation passes over the parser, the
group resolution, the marker ids, the cluster slices and the completion logic.

## M7 — Problems, settings, docs _(done)_

`core/problems.ts` — the ordering rules, gathered by note: notes by name with
the path as tie-break, and within a note properties before body lines, so the
list reads in the same order as the vault and the file.

The list itself became a **third section of the control panel** rather than the
banner sketched here. The panel did not exist when this was written; once it
did, a section cost nothing and a banner would have been a second floating
thing over the map. The section is absent rather than empty when there is
nothing wrong — a standing "Problems" heading trains the eye to skip it — and
the count is repeated as a badge on the panel's toggle, since the panel is
closed by default.

Settings tab: tile URLs and attribution for both layers, plus copy precision
and marker size as sliders, and a default view.

**Default view** is stored apart from the remembered view. The map has always
reopened where it was left, so a "default" consulted only on first ever open
would have been vestigial; a _home_ to return to is worth having, so it is
captured from the map by a button and reached by a "Go to default view"
command. Marker size reaches an open map immediately, since the settings tab
can sit beside it; the tile settings still need the view reopened.

README: the syntax in body and properties, what makes a link geotag-shaped, the
query language, the unresolved-link consequence, and the third-party tile
services.

`.github/workflows/check.yml` was **not** added: this repo has no remote, so a
workflow would never run. Worth adding the day it is pushed anywhere.

**Done:** the six broken geotags in `MAP_TEST/Malformed geotags.md` are listed
in the panel and each navigates to its line. 263 tests, including a mutation
pass over the problem ordering.

## M8 — Journeys _(done)_

`core/routes.ts` — a note carrying several geotags is usually a trip, and drawn
as loose pins that is lost: the map shows where you went but not that it was one
journey, nor in what order. `buildRoutes` groups geotags by note, orders them as
they appear in the file and returns a polyline per note with two or more.

File order is the line a body geotag sits on, with property geotags first
because frontmatter is the top of the file. Ties — two geotags on one line, two
in one property list — keep the order Obsidian's cache reports links in, which
is the order they appear across the line.

Routes take the same `NoteStyle` the markers do, so a filter cannot hide a
note's pins and leave its journey behind, and a colour group colours the line
with the pins. Points are the geotags' own coordinates rather than clustered
positions: a journey is between the places, and a line snapping to cluster
centres would move as the map zoomed.

The lines are a layer group added **before** the pins, so they run underneath
them, and are `interactive: false` so they never take a click meant for a pin or
a right-click meant for "Copy geotag".

**Known limitation:** a journey between two points either side of the
antimeridian is drawn the long way round. Both readings are defensible and
neither is knowable from the note, so the numbers as written win.

**Done:** a note with several geotags draws a line through them in file order.
278 tests, including a mutation pass over the ordering and grouping.

---

## Verification

Per milestone, tests first where there is logic to test:

```sh
npm test            # core/ parsers, index, query engine
npm run build       # typecheck + bundle
```

End to end, against a real vault:

```sh
echo '{ "vault": "/path/to/test/vault" }' > .deploy.local.json
npm run build:deploy
```

Install [hot-reload](https://github.com/pjeby/hot-reload) in that vault so
rebuilds are picked up without restarting Obsidian.

A small set of fixture notes in the test vault should cover: a note with one
body geotag, one with an aliased geotag, one with several geotags, one with a
property geotag, one with a malformed geotag, and one with an ordinary
comma-containing note link that must be ignored. These same cases are what the
M1 unit tests assert on, so a divergence between the two is a real bug.

## Risks

-   **Leaflet asset handling under esbuild** is the usual source of a broken
    first render (missing marker icons, unstyled controls). Confronted in M0
    rather than discovered in M3.
-   **Graph view parity** is a moving target defined by an undocumented UI. M6
    fixes the observable behaviour of a documented subset rather than chasing it.
-   **Marker volume**: Leaflet is comfortable to a few thousand markers, and
    clustering (`core/clustering.ts`) reduces what is drawn at low zoom. If a
    vault still exceeds that, the remaining lever is `preferCanvas`, additive to
    `ui/map.ts`.
