# namer — kinship prefixes for TS/TSX

VS Code extension that renders **inlay prefixes** before imported symbols at
their callsites, so you can tell at a glance where a symbol came from
without scrolling up to imports.

```
<lib.PageHeader>           ← shared
<api.useSuspenseSales />   ← api
<my.SalesToolbar/>         ← own (relative ./ or _internal/)
<near.AddSalePanel/>       ← neighbor (same domain, other headline)
<far.AppointmentDialog/>   ← foreign (other domain)
<Button/>                  ← shadcn (no prefix by default)
```

Prefixes are **decorations**, not edits. Source files stay clean. Closing
JSX tags are not decorated.

## Classification rules

`myDomain` = first path segment after `/domains/` (or `/features/`).
`myHeadline` = first segment after `/<root>/<myDomain>/`.

| Import path pattern               | Kinship  | Default prefix |
|-----------------------------------|----------|----------------|
| `@ui/*`, `@/components/ui/*`      | shadcn   | (none)         |
| `@shared/*` `@lib/*` `@stores/*` `@i18n` `@/components/!ui` `@/lib/*` `@/stores/*` | shared | `lib.` |
| `@api/*`, `@/api/*`               | api      | `api.`         |
| `./*` `../*` (relative)           | own      | `my.`          |
| `@domain/<myDomain>/<sameHeadline>/*` or any `/_internal/` of own domain | own | `my.` |
| `@domain/<myDomain>/<otherHeadline>/*` | neighbor | `near.` |
| `@domain/<otherDomain>/*` (or features equiv.) | foreign | `far.` |

All patterns are configurable via `namer.aliases.*` settings.

## Install locally (no marketplace)

```bash
cd /Users/cody/vscode-namer/namer
npm install
npm run compile
npm run package        # → namer-0.0.1.vsix
code --install-extension namer-0.0.1.vsix
```

To live-develop: open the folder in VS Code → press `F5` → Extension
Development Host opens with the plugin active. Edit `src/extension.ts`,
re-run `F5`.

## Settings

All under the `namer.*` namespace:

- `namer.prefixes` — per-kinship prefix string. Set to `""` to disable.
- `namer.aliases.shadcn|shared|api|domain` — arrays of regex matched
  against the import path.
- `namer.domainRoot` — folder name marking domains root (default
  `domains`; also matches `features` automatically).
- `namer.opacity` — CSS opacity of the rendered prefix (default `0.55`).
- `namer.languages` — language IDs to activate on.

## Project config (per-repo, full control)

Drop a `namer.config.cjs` (or `.js` / `.json`) at your workspace root. It
overrides VS Code settings and built-in defaults. Watched and hot-reloaded.

> ⚠️ If your `package.json` has `"type": "module"`, use the **`.cjs`**
> extension. Otherwise Node parses the file as ESM and `module.exports`
> silently produces an empty config. The plugin tries `.cjs` first.

```js
// namer.config.js
/** @type {import('./namer-config').NamerConfig} */
module.exports = {
    prefixes: {
        shared: 'lib.',
        api:    'api.',
        own:    'my.',
        neighbor: 'near.',
        foreign:  'far.',
    },

    // Hide certain node_modules entirely
    reactPackages: [/^react$/, /^react-dom/, /^@tanstack\//],

    // Rename or hide other packages
    externalOverrides: [
        {match: /^lucide-react$/, prefix: 'icon.'},
        {match: /^@radix-ui\//,   prefix: null},   // hide all radix
        {match: /^zod$/,          prefix: ''},     // same — hide
    ],

    // Domains root in this repo (default 'domains'; 'features' is always recognized too)
    domainRoot: 'features',

    // ★ Full custom classifier — return string | '' | null | undefined.
    //   Called BEFORE built-in rules. Return undefined to fall through.
    classify({importPath, callsiteFile, myDomain, myHeadline}) {
        // Example: stuff under @generated/ → "gen."
        if (importPath.startsWith('@generated/')) return 'gen.';
        return undefined;
    },
};
```

JSON variant (no functions allowed):

```json
{
    "prefixes": {"foreign": "EXT."},
    "reactPackages": ["^react$", "^@tanstack/"],
    "externalOverrides": [
        {"match": "^lucide-react$", "prefix": "icon."}
    ]
}
```

Each top-level key in the project config FULLY REPLACES the corresponding
default (for arrays). Leave a key out to keep the default behavior.

For autocomplete inside the config, copy `namer-config.d.ts` from the
plugin folder into your project and reference it with the `@type` JSDoc.

## Commands

- `Namer: Refresh decorations` — force a re-scan of visible editors.
- `Namer: Reload project config` — re-read `namer.config.*` from disk.
