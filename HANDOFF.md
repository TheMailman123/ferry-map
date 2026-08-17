# Handoff — M6: filters and colour groups

Brief for whoever picks up M6. [VISION.md](VISION.md) is the what,
[PLANNING.md](PLANNING.md) is the how; this file records the state of play and
the things you would otherwise have to rediscover.

**Read `PLANNING.md` § "M6 — Filters and colour groups" first.** Everything
below assumes it.

## Where things stand

M0–M5 are done, deployed and working in a real vault. M6 and M7 remain.

Working tree is clean at `a1c5bb8`, `main` branch, 116 tests passing.
`npm run build` and `npm run lint` are clean.

The repo directory is still `obsidian-map` although the plugin was renamed to
Ferry Map (id `ferry-map`). Renaming the directory is a bare `mv` — nothing in
the repo refers to it — but it was left alone to avoid pulling the ground out
from under a live session.

## What M6 has to build

Two things, mirroring Obsidian's graph view:

1. A **filter query** that hides non-matching pins.
2. An ordered list of **colour groups**, each a query plus a colour.

Both persist in settings. The user asked for parity with graph view, with one
agreed deviation recorded in VISION.md: **no full-text content matching in v1**,
because it means reading every note rather than consulting the metadata cache.
v1 covers `path:`, `file:`, `tag:`, quoted phrases, `-` negation, implicit AND,
and `OR`.

**Settled by the user, do not re-litigate:** where several colour groups match a
note, the **topmost group in the list wins**. Groups below it do not override.

## Conventions this codebase holds to

These are consistent throughout and M6 should not break them.

- **`src/core/` never imports `obsidian`.** Not even for types — where a shape
  from the app is needed it is declared structurally (see `MetadataLike` in
  `core/geotags.ts`) and a compile-time guard in `obsidian/metadata.ts` fails
  the build if the real type stops satisfying it. This is what makes the core
  testable in a `node` jest environment.
- **`src/ui/map.ts` is the only module that imports Leaflet**, and it does not
  import `obsidian`. It emits events (`onSelect`, `onContextMenu`) and the view
  decides what they mean. Keep Obsidian `Menu`s and notices in `view.ts`.
- **Logic worth testing goes in `core/`, even when it is UI-adjacent.**
  `core/clustering.ts` and `core/markers.ts` are both "UI" concerns that live in
  core precisely so they can be tested. The query parser and group resolution
  belong there too: `core/query.ts`, `core/groups.ts`.
- Tests sit beside sources as `X.test.ts`. Prettier and `tsc --noEmit` run via
  `npm run lint` / `npm run compile`.
- Comments explain *why*, not *what*, per the repo's CLAUDE.md. Several
  non-obvious decisions are documented in place — read them before changing the
  code they sit on.

## Things that will bite you

- **Pin identity is `path#ordinal`** (`core/markers.ts`) and cluster identity is
  `firstMemberId+count` (`core/clustering.ts`). Both deliberately exclude
  coordinates, so an edit *moves* a pin rather than destroying and recreating
  it. If M6 adds colour to the marker, do **not** put the colour in the id —
  recolouring should restyle, not rebuild. The plan calls for a `divIcon` with a
  CSS custom property; `--ferry-map-marker-colour` is already wired up in
  `styles.css` and currently falls back to `--interactive-accent`.
- **Markers never use `L.Icon.Default`.** Leaflet resolves its default icons
  from a runtime script path that does not exist inside Obsidian. Everything is
  `L.divIcon`. Verified in M0; do not "fix" this back.
- **Store notifications are coalesced to one per frame** and the scheduler is
  injectable (`GeoStore`'s second constructor argument) so tests can drive it.
  If filtering re-renders on every keystroke in the filter box, debounce it the
  same way rather than notifying per character.
- **`clusterMarkers` runs on zoom, not pan.** Filtering changes which markers
  exist, so it must call the same path that re-clusters — `setMarkers` already
  does.
- Filtering has to happen **before** clustering, or counts will include pins
  that are not shown.

## Suggested shape for M6

Nothing here is binding, but it follows the existing grain:

- `core/query.ts` — parse a query string to an AST (`And | Or | Not |
  Predicate`), and `matches(ast, doc)` against a `NoteDoc { path, basename,
  tags }`. Parsing and matching are pure and should be heavily tested; this is
  the M6 equivalent of M1's coordinate parser and deserves the same rigour,
  including the "what must *not* match" cases.
- `core/groups.ts` — `colourFor(doc, groups)`, first match wins.
- `obsidian/adapter.ts` — needs a way to get a note's tags for `NoteDoc`.
  `metadata(file)` already returns `CachedMetadata`, which carries `tags` and
  frontmatter tags; assembling `NoteDoc` probably belongs in `obsidian/store.ts`
  alongside the geotags, so the view gets tags and colours from one place.
- `ui/controls.ts` — the panel. `ui/view.ts` owns it and passes results down.

## How to verify

```sh
npm test                # unit tests
npm run build           # typecheck + bundle
npm run deploy          # copies into the vault in .deploy.local.json
```

The deploy target is a real vault at `/path/to/your/vault`
(configured in the gitignored `.deploy.local.json`). It has no hot-reload
plugin, so Obsidian needs a manual reload (Ctrl+R) after each deploy.

That vault contains **`MAP_TEST/`**, eight fixture notes each stating what it
expects — including `Ordinary links.md`, whose expectation is that it produces
nothing at all, and `Malformed geotags.md`, whose six broken geotags should
produce no pins. See `MAP_TEST/README.md`. It also contains the user's real
trip notes under `TRIPS/`, two of which carry genuine geotags.

Useful M6 test material: the fixtures span several folders and the real notes
are all under `TRIPS/`, so `path:MAP_TEST` and `path:TRIPS` are meaningful
queries to check against.

**Mutation-test the query parser.** The convention here has been to break the
implementation deliberately and confirm a test fails — it caught real gaps in
the coordinate parser and the folder-prefix sweep. A green suite over a parser
is not evidence on its own.

## Open question worth putting to the user

How closely should the control panel mirror graph view's *layout* — a
collapsible settings pane over the map, matching its section headings and
colour swatches, or something simpler suited to a map? The user asked for a
system "identical to the native graph view", which was clear about behaviour but
not about chrome. Worth one question before building the panel.
