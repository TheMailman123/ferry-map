# Vision & Scope — Ferry Map

## Vision

A map tab in Obsidian that shows your geotagged notes as pins on a navigable
world map, with the same filtering and colour-grouping controls as the native
graph view.

The map is a **view over the vault, not a store**. It never writes to notes.
Notes are the single source of truth; the map reads them, renders them, and
gets out of the way. Where the map needs to help you author a geotag, it does
so by putting text on the clipboard for you to paste — never by editing a file.

The guiding principle for the syntax is that a geotag should look and behave
like something Obsidian already understands, so it needs no special editor
support and degrades gracefully when the plugin is disabled.

## Syntax

A geotag is an ordinary Obsidian internal link whose target is a coordinate
pair:

```markdown
We camped near the lighthouse [[58.6276, -4.9997]] and walked out at dawn.
```

Coordinates are decimal degrees, latitude first, comma-separated.

A pin is labelled with the name of the note it came from, and selecting it
navigates to that note. Where a geotag supplies an alias, the alias supersedes
the note name as the label — useful when one note carries several places:

```markdown
[[58.6276, -4.9997|Cape Wrath Lighthouse]]
```

The identical token is valid as a YAML property value, so a note can carry its
own location in its properties:

```yaml
---
title: Cape Wrath
location: "[[58.6276, -4.9997]]"
---
```

A property may also hold a list, for notes covering several places:

```yaml
---
location:
    - "[[58.6276, -4.9997|Lighthouse]]"
    - "[[58.5901, -4.8812|Bothy]]"
---
```

Any property key is scanned, not just `location` — a geotag is recognised by
its shape, not by the key it sits under.

Properties hold the wikilink form only. `location: "58.6276, -4.9997"` without
brackets is not a geotag: one syntax for both locations means one extraction
path, and the bare form could not carry an alias anyway.

### Why this shape

Obsidian's metadata cache already parses every internal link in every note, in
the body (`CachedMetadata.links`) and in properties
(`CachedMetadata.frontmatterLinks`). Both are the same `Reference` type
carrying `link` and `displayText`. So the plugin reads geotags from a cache
Obsidian maintains anyway: no markdown parsing, no file reads, no separate
re-scan when a note changes, and body and property geotags go through one
parser. A note may carry any number of geotags, anywhere.

### Known cost of this shape

These links point at notes that do not exist, so Obsidian treats them as
**unresolved links**: they render in the dim "unresolved" style and appear as
unresolved nodes in graph view unless that display option is turned off.

The sharpest edge — clicking a geotag offering to *create* a note called
`58.6276, -4.9997` — is removed by the plugin, which intercepts clicks on
geotag links and opens the map at that point instead. What was the main cost of
this syntax is therefore also one of its better features.

The remainder is accepted as the price of a syntax that needs no parser and no
plugin-specific markup, and it is contained: if it becomes intolerable, a
distinguishing prefix (`[[geo:58.6276, -4.9997]]`) can be added later without
changing the architecture, since only the coordinate parser would move.

### Parsing rules

- Decimal degrees only. Latitude then longitude, separated by a comma.
- Latitude must be within ±90, longitude within ±180.
- Surrounding whitespace is ignored; a leading `+` is allowed.
- A link is a geotag only if its **entire** target matches this shape, so a
  real note named `Chapter 3, Part 2` is never mistaken for one.
- A link that looks like a geotag but is invalid (out of range, three numbers,
  trailing junk) is **reported, never silently dropped** — it surfaces in a
  problems list in the map view rather than quietly failing to appear.

## Scope

### In scope for v1

- **Map view** — a tab with a pannable, zoomable world map from an online tile
  source, with a map/satellite layer toggle. View position persists.
- **Markers** — every geotag in the vault becomes a pin, labelled with its
  origin note's name unless the geotag supplies an alias. Selecting a pin opens
  that note, at the geotag's own line where the geotag is in the body.
- **Overlapping pins** — where the zoom is too coarse to tell several geotags
  apart, they are drawn as one pin carrying a count, so the map never quietly
  under-reports what is there. Hovering lists what is beneath; clicking offers
  a choice of them, since geotags at identical coordinates never separate at
  any zoom and would otherwise be unreachable.
- **Following a geotag link** — clicking a geotag in a note opens the map
  centred on that point, rather than Obsidian's offer to create a note.
- **Live** — pins update as notes are created, edited, renamed and deleted.
- **Copy coordinates** — right-clicking the map offers "Copy geotag", putting
  `[[lat, lon]]` for that point on the clipboard, ready to paste into a note.
  Coordinates are rounded to 4 decimal places (~11 m), enough to identify a
  building without producing unreadably long links.
- **Filters and colour groups** — a control panel mirroring the graph view's:
  a filter query that hides non-matching notes, and an ordered list of
  colour groups, each a query plus a colour. Both persist in settings.
- **Problems list** — malformed geotags are visible and clickable, not silent.

### Explicitly out of scope for v1

- **Any writing to notes.** No pin dragging, no "create note here", no command
  that stamps coordinates into a file. The clipboard is the only bridge from
  map to note.
- **Offline maps.** Tiles come from the network. The tile URLs are settings, so
  a local tile server can be pointed at, but bundling or caching tiles is not
  v1 work.
- **Non-decimal coordinate formats** — degrees/minutes/seconds, MGRS, what3words,
  place-name geocoding. The parser is written so a second format is additive.
- **Routes, shapes and heatmaps.** Points only. (Grouping overlapping points
  under a count is in scope; drawing anything that is not a point is not.)
- **Content-text search in filter queries** (see below).

### Deliberate deviation from "identical to graph view"

Graph view's filter and group queries accept Obsidian's full search syntax,
including full-text content matching. Full-text matching requires reading every
note in the vault rather than consulting the metadata cache, which is a
different performance profile and a much larger implementation.

v1 supports the metadata-backed subset, which is what group queries are made of
in practice: `path:`, `file:`, `tag:`, quoted phrases, `-` negation, implicit
AND, and `OR`. The query engine is structured so a content predicate can be
added as one more matcher later.

## Non-goals

- Being a GIS. There is no analysis, measurement, or projection work here.
- Being a general-purpose map embedder. This plugin renders one view of the
  whole vault, not maps inside individual notes.
- Managing tile provider accounts or API keys.

## Dependency

Leaflet (BSD-2-Clause, ~40 KB gzipped) is the map renderer. It is the smallest
mature raster-tile map library and is bundled into `main.js` — the plugin loads
no scripts at runtime. It is the only planned runtime dependency.

Tiles are fetched from the network at view time. The defaults are OpenStreetMap
for the map layer and Esri World Imagery for satellite; both are configurable,
and both are third-party services that will see tile requests when the map is
open. This is stated in the README so it is not a surprise.
