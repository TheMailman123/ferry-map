# Map

An Obsidian plugin providing a navigable world map view over geotagged notes in
your vault.

> Early development. Nothing here is stable yet.

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
MAP_VAULT=/path/to/vault npm run build:deploy
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
