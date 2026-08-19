# Ferry Map

An Obsidian plugin providing a navigable world map view over geotagged notes in
your vault.

> Early development. Nothing here is stable yet.

## Geotags

A geotag is an ordinary Obsidian internal link whose target is a coordinate
pair — decimal degrees, latitude first:

```markdown
We camped near the lighthouse [[58.6276, -4.9997]] and walked out at dawn.
```

Give it an alias and the alias labels the pin instead of the note name, which
is what you want when one note covers several places:

```markdown
[[58.6276, -4.9997|Cape Wrath Lighthouse]]
```

The same token works as a property value, so a note can carry its own location:

```yaml
---
location: "[[58.6276, -4.9997]]"
---
```

A property may hold a list, and **any** key is scanned — a geotag is recognised
by its shape, not by the key it sits under:

```yaml
---
location:
    - "[[58.6276, -4.9997|Lighthouse]]"
    - "[[58.5901, -4.8812|Bothy]]"
---
```

Properties take the wikilink form only. `location: "58.6276, -4.9997"` without
brackets is not a geotag.

### The rules

-   Decimal degrees only, latitude then longitude, separated by a comma.
-   Latitude within ±90, longitude within ±180.
-   Surrounding whitespace is ignored; a leading `+` is allowed.
-   The **entire** link target must match, so a note named `Chapter 3, Part 2` is
    never mistaken for a geotag.
-   A link that is geotag-shaped but invalid — out of range, three numbers,
    trailing text — is reported in the map's Problems section rather than
    silently dropped.

That last rule is why `[[58.6276, -4.9997 lighthouse]]` is a _problem_ and not
a pin: it splits on the comma into two parts that both start with a number, so
it was clearly meant to be a geotag, and the author meant to type `|` rather
than a space.

### Geotags are unresolved links

This is the one cost of the syntax and it is worth knowing before you commit to
it. Geotags point at notes that do not exist, so Obsidian treats them as
**unresolved links**: they render in the dim unresolved style, and they appear
as unresolved nodes in graph view unless you turn that display option off.

The sharpest edge is gone — clicking a geotag opens the map at that point
instead of offering to create a note called `58.6276, -4.9997` — but the
styling remains. The plugin never writes to your notes, so nothing here is
irreversible: disable it and your geotags are ordinary links again.

## Using the map

Open it from the ribbon globe or the **Open Ferry Map** command.

-   **Hovering a pin** names it, then says where it came from: the note, and the
    headings the geotag was written under — `Skye › Day 2 › Morning`. A geotag
    in a property has no heading above it, so it shows the note alone.
-   **Clicking a pin** opens its note, at the geotag's own line where the geotag
    is in the body. Where pins are too close together to tell apart they are
    drawn as one pin carrying a count; hovering that lists what is underneath
    and clicking it offers a choice.
-   **Right-clicking the map** offers "Copy geotag" and "Copy coordinates",
    putting text on the clipboard for you to paste. The map never edits a note.
-   **A note with several geotags** is drawn as a journey: its pins are joined
    by a line, in the order the geotags appear in the note. Properties come
    first, since frontmatter sits above the body. The line takes the note's
    group colour, and a filter that hides the note hides its line too. Hover it
    to see which note drew it.
-   **The gear button** opens filters, colour groups and any problems.

### Filters and colour groups

A filter query hides non-matching pins; colour groups colour the pins they
match, the topmost matching group winning. Both boxes speak a subset of
Obsidian's own search syntax and complete as you type:

| Term             | Matches                                |
| ---------------- | -------------------------------------- |
| `skye`           | a bare word, against the note's path   |
| `path:TRIPS`     | notes under a folder                   |
| `file:Oban`      | notes by name                          |
| `tag:ferry`      | notes tagged `#ferry`, and its subtags |
| `"Isle of Skye"` | a phrase                               |
| `-tag:draft`     | notes _without_ it                     |
| `a OR b`         | either — capitals, unquoted            |
| `(a OR b) c`     | grouped                                |

Terms with no operator between them are ANDed. Content matching is deliberately
absent: everything here is answered from the metadata cache Obsidian already
maintains, without reading a single file.

Completions are drawn from your **geotagged** notes only, not the whole vault —
completing to a tag no pin carries would just empty the map.

## Settings

-   **Tile sources** — URL template and attribution for the map and satellite
    layers. Changes are picked up when the map view is reopened.
-   **Default view** — captured from wherever the map is now. The **Go to default
    view** command returns there. It is kept apart from the position the map
    remembers between sessions, which every pan overwrites.
-   **Marker size** — pin diameter. Applies to an open map immediately.
-   **Journey lines** — whether a note's geotags are joined into a line. On by
    default; turn it off in a vault where enough notes carry enough geotags that
    the lines become the map.
-   **Coordinate precision** — decimal places used when copying. Four places is
    about 11 m, which is enough to identify a place and honest about what a click
    on a map actually knows.

### Tiles come from third parties

The map ships pointing at **OpenStreetMap** for the map layer and **Esri World
Imagery** for satellite. Both are third-party services: while the map view is
open your Obsidian client requests tiles from them directly, so those providers
see your IP address and the areas you look at. Nothing else about your vault
leaves your machine — the plugin reads notes only through Obsidian's local
metadata cache.

If that is not acceptable, point the tile URLs at a local tile server in
settings. Whatever you configure, check you are within the provider's usage
policy; the defaults are suitable for personal use, not for redistribution.

## Development

```sh
npm install
npm run dev            # esbuild watch → main.js + main.css
npm run build          # typecheck + production bundle
npm test               # jest
npm run lint           # prettier --check
```

### Testing in a vault

Point the deploy script at a vault, either once:

```sh
FERRY_MAP_VAULT=/path/to/vault npm run build:deploy
```

or persistently, in a gitignored `.deploy.local.json`:

```json
{ "vault": "/path/to/vault" }
```

Installing the [hot-reload](https://github.com/pjeby/hot-reload) plugin in that
vault makes Obsidian pick up rebuilds without a restart.

### Releasing

`npm version patch` bumps `package.json`, `manifest.json` and `versions.json`
in one commit and tags it (unprefixed, per `.npmrc`).

## License

MIT
