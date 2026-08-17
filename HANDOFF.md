# Handoff — M7: problems, settings, docs

Brief for whoever picks up M7. [VISION.md](VISION.md) is the what,
[PLANNING.md](PLANNING.md) is the how; this file records the state of play and
the things you would otherwise have to rediscover.

**Read `PLANNING.md` § "M7 — Problems, settings, docs" first.** Everything
below assumes it.

## Where things stand

M0–M6 are done. M7 is all that remains of v1.

M6 landed the filter box and colour groups: `core/query.ts` (parser and
matcher), `core/groups.ts` (colour resolution and the per-note style),
`ui/controls.ts` (the panel), with `NoteDoc` assembly in `obsidian/store.ts`
and colour plumbed through markers, clustering and `ui/map.ts`.

203 tests passing; `npm run build` and `npm run lint` clean. M6 has **not yet
been exercised in a real vault** — it was built and tested but not deployed, so
the first thing to do is `npm run build:deploy`, reload Obsidian, and try the
panel against `MAP_TEST/` and `TRIPS/`.

The repo directory is still `obsidian-map` although the plugin was renamed to
Ferry Map (id `ferry-map`). Renaming the directory is a bare `mv` — nothing in
the repo refers to it.

## What M7 has to build

Three things, and the last of them is the one that has been deferred twice:

1. A **problems list** — the malformed geotags the index has been collecting
   since M1 and never showing. `store.problems()` already returns them, each
   carrying path, raw text, reason, source, key and line.
2. A **settings tab** — tile URLs and attribution are already there; copy
   precision, default centre/zoom and marker size are not.
3. **README** — syntax, the unresolved-link consequence, the third-party tile
   services, and the deploy loop.

## Conventions this codebase holds to

These are consistent throughout and M7 should not break them.

- **`src/core/` never imports `obsidian`.** Not even for types — where a shape
  from the app is needed it is declared structurally (see `MetadataLike` in
  `core/geotags.ts`) and a compile-time guard in `obsidian/metadata.ts` fails
  the build if the real type stops satisfying it. This is what makes the core
  testable in a `node` jest environment.
- **`src/ui/map.ts` is the only module that imports Leaflet**, and it does not
  import `obsidian`. It emits events (`onSelect`, `onContextMenu`) and the view
  decides what they mean. Keep Obsidian `Menu`s and notices in `view.ts`.
- **Logic worth testing goes in `core/`, even when it is UI-adjacent.**
  `clustering.ts`, `markers.ts`, `query.ts` and `groups.ts` are all "UI"
  concerns living in core precisely so they can be tested. A problems list is
  mostly presentation, but any grouping or ordering rule belongs in core.
- Tests sit beside sources as `X.test.ts`. Prettier and `tsc --noEmit` run via
  `npm run lint` / `npm run compile`.
- Comments explain *why*, not *what*, per the repo's CLAUDE.md. Several
  non-obvious decisions are documented in place — read them before changing the
  code they sit on.

## Things that will bite you

- **Pin identity is `path#ordinal`** (`core/markers.ts`) and cluster identity is
  `firstMemberId+count` (`core/clustering.ts`). Both deliberately exclude
  coordinates *and colour*, so an edit moves a pin and a recolour restyles it,
  rather than either destroying and recreating it. Do not put anything else in
  an id without asking what re-renders as a result.
- **Markers never use `L.Icon.Default`.** Leaflet resolves its default icons
  from a runtime script path that does not exist inside Obsidian. Everything is
  `L.divIcon`. Verified in M0; do not "fix" this back.
- **Store notifications are coalesced to one per frame** and the scheduler is
  injectable (`GeoStore`'s second constructor argument) so tests can drive it.
  The control panel debounces its own typing separately, at 200 ms.
- **`GeoStore` keeps a `NoteDoc` per indexed note in lockstep with the index.**
  If you add a way for a note to enter or leave the index, it has to maintain
  both — `store.doc(path)` throws for a path it does not know, deliberately, so
  a desync fails loudly rather than silently filtering pins away.
- **Settings are edited in place** (a tile URL, a group's colour), which is why
  `loadSettings` clones the defaults rather than shallow-merging onto them. A
  shallow merge hands out `DEFAULT_SETTINGS`'s own objects to be mutated.
- Filtering happens in `buildMarkers`, **before** clustering, or cluster counts
  would include pins that are not shown.
- The control panel is a **sibling** of the Leaflet container, not a child. Put
  the problems list in the same place if it overlays the map, for the same
  reason: a child would feed Leaflet every drag and right-click.

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
produce no pins. See `MAP_TEST/README.md`. Those six are exactly what M7's
problems list has to surface, so that note is the milestone's fixture. The
vault also contains the user's real trip notes under `TRIPS/`, two of which
carry genuine geotags.

**Mutation-test anything with rules in it.** The convention here has been to
break the implementation deliberately and confirm a test fails — it caught real
gaps in the coordinate parser, the folder-prefix sweep, and (in M6) a query
parser that would have read `- skye` as an exclusion of Skye. A green suite is
not evidence on its own. Two M6 mutants survived: one was that genuine gap, and
the other showed a branch that could not affect the output, which was then
removed. Both outcomes are worth having.

## Open questions worth putting to the user

- **Where the problems list lives**: a dismissible banner over the map (as
  PLANNING.md sketches), a section inside the existing control panel, or the
  view header. The panel now exists, which it did not when M7 was written down,
  so the third option is cheaper than it was.
- **Whether M6 matches graph view closely enough** once they have used it. The
  documented deviations are content matching (absent, by agreement) and
  `file:md` not matching every note. Everything else was built for parity but
  parity was judged against the documented behaviour, not against a running
  graph view.
