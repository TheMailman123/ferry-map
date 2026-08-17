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
    groups.ts              resolve a note's colour from the ordered group list
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

## M0 — Dependency *(done)*

`leaflet` + `@types/leaflet` added. A throwaway bundle confirmed:

- 147 KB JS / 15 KB CSS minified, and the three PNGs Leaflet's stylesheet
  references are inlined as `data:` URIs by the loaders already configured in
  `esbuild.config.mjs`. The plugin ships as `main.js` + `styles.css` with no
  loose assets.
- `_detectIconPath` / `imagePath` **are** in the bundle, confirming Leaflet
  still resolves default marker icons from a runtime script path that does not
  exist inside Obsidian.

Decision: markers use `L.divIcon` throughout, never `L.Icon.Default`. This
sidesteps the icon path problem entirely (no image assets at all) and is what
M6 needs anyway, since a `divIcon` can be recoloured from CSS.

## M1 — Coordinate core (no UI)

`core/coordinates.ts`:

- `parseCoordinate(text: string): Coordinate | { error: string }` — strict,
  anchored match on the whole string: optional sign, decimal number, comma,
  optional whitespace, decimal number. Range-checked. Anything else is a
  non-match (not a geotag at all) or an error (looked like one, wasn't valid);
  these are distinct results, because only the second becomes a problem entry.
- `formatGeotag(c: Coordinate, places = 4): string` — `[[58.6276, -4.9997]]`.

`core/geotags.ts`:

- `extractGeoTags(path, cache): { tags: GeoTag[]; problems: GeoTagProblem[] }`
  over a `CachedMetadata`-shaped input, reading `links` (body) and
  `frontmatterLinks` (properties). Both are `Reference`s carrying `link` and
  `displayText`, so one loop handles both, differing only in `source`, `key`
  and `line`.
- Obsidian sets `displayText` to the link target when there is no alias, so
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

- `L.map` in the view container, with a map layer (OpenStreetMap) and a
  satellite layer (Esri World Imagery), both from settings, plus
  `L.control.layers` for the toggle. Attribution is set for each, as the tile
  terms require.
- Centre, zoom and active layer persist to plugin settings on `moveend` /
  `baselayerchange`, so reopening the tab returns you where you were.
- `onResize()` on the view calls `map.invalidateSize()` — a Leaflet map in a
  hidden or resized pane renders wrong without it.

**Done when:** the map tab pans, zooms, toggles map/satellite, and restores its
position after an Obsidian restart.

## M3 — Markers

- On `workspace.onLayoutReady`, walk `vault.getMarkdownFiles()` through the
  adapter and populate the index. Deferred to layout-ready because the metadata
  cache is still filling during `onload`.
- Render one marker per geotag, labelled `alias ?? basename`, with a popup
  showing the label and the origin note's name.
- Selecting a marker opens its origin note via
  `workspace.openLinkText(path, "", ...)`, and where the geotag is in the body,
  scrolls to its line using `GeoTag.line` and `EditorPosition`.
- The marker layer syncs by diffing against a keyed map (`path + source + key +
  line`), so an edit to one note does not tear down and rebuild every marker.

**Done when:** every geotagged note in a test vault appears, labels are right,
and clicking lands on the correct note and line.

## M4 — Live updates *(done)*

`obsidian/watcher.ts`, all subscriptions wrapped in `this.registerEvent(...)`:

- `metadataCache.on("changed")` → re-extract that one file, update the index.
- `metadataCache.on("deleted")` → remove.
- `vault.on("rename")` → rename in the index (the cache does **not** fire
  `changed` on rename; the Obsidian typings say so explicitly).
- `vault.on("create")` is not needed — a new file produces a `changed` once
  indexed.

Updates are coalesced into one marker resync per animation frame so a
fast-typing edit does not thrash the map.

**Done when:** adding, editing, renaming and deleting a geotag in an open vault
moves/adds/removes its pin without reopening the tab.

## M5 — Copy geotag *(done)*

Right-click on the map surface opens an Obsidian `Menu` at the pointer with
"Copy geotag" (`[[lat, lon]]`, 4 decimal places) and "Copy coordinates"
(bare `lat, lon`). Writes via `navigator.clipboard.writeText` and confirms with
a `Notice` showing exactly what was copied.

Longitude is normalised into ±180 first — panning past the antimeridian
otherwise yields values like `-185.2` that are valid to Leaflet but not to the
parser, which would make the plugin emit geotags it refuses to read back.

**Done when:** right-click → paste into a note → the pin appears at the point
that was clicked.

## M6 — Filters and colour groups

`core/query.ts` — a small recursive-descent parser producing an AST of
`And | Or | Not | Predicate`, and `matches(ast, doc)` against a
`NoteDoc { path, basename, tags }` assembled from the metadata cache.

v1 predicates: `path:`, `file:`, `tag:`, quoted phrases, `-` negation, implicit
AND between terms, `OR`. A bare word matches path or basename. Content matching
is deliberately absent (see VISION.md) and slots in as one more predicate.

`core/groups.ts` — given the ordered group list and a `NoteDoc`, return the
colour of the **first** group in list order whose query matches; groups lower
in the list do not override it.

`ui/controls.ts` — a collapsible panel over the map mirroring graph view's:
a filter query input, and an add/remove list of groups each with a query input
and an Obsidian colour swatch. Both persist to settings.

Markers are recoloured with `divIcon`s carrying a CSS custom property, so
group colour changes restyle rather than rebuild the marker layer.

**Done when:** a query in the filter box hides non-matching pins, and a group
query colours matching pins, matching graph view's behaviour on the same query.

## M7 — Problems, settings, docs

- `ui/problems.ts`: a dismissible banner when the index holds problems —
  "3 geotags could not be read" — expanding to a list of note, raw text and
  reason, each clickable through to the offending line.
- Settings tab: tile URLs and attribution for both layers, copy precision,
  default centre/zoom, marker size.
- README: syntax, the unresolved-link consequence, the third-party tile
  services, and the deploy loop.
- Optionally add `.github/workflows/check.yml` (lint + compile + test) mirroring
  the reference project, once there is enough to protect.

**Done when:** a vault containing a deliberately broken geotag surfaces it
rather than silently omitting the pin.

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

- **Leaflet asset handling under esbuild** is the usual source of a broken
  first render (missing marker icons, unstyled controls). Confronted in M0
  rather than discovered in M3.
- **Graph view parity** is a moving target defined by an undocumented UI. M6
  fixes the observable behaviour of a documented subset rather than chasing it.
- **Marker volume**: Leaflet is comfortable to a few thousand markers, and
  clustering (`core/clustering.ts`) reduces what is drawn at low zoom. If a
  vault still exceeds that, the remaining lever is `preferCanvas`, additive to
  `ui/map.ts`.
