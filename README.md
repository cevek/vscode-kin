# kin

**See where every imported symbol comes from — without scrolling up to imports.**

`kin` paints a tiny prefix in front of every JSX tag and function call you write, telling you at a glance whether it's a shadcn primitive, a shared utility, a piece of your domain, or something from another corner of the repo.

```tsx
import {Button}              from '@ui/button';
import {formatCurrency}      from '@/lib/format-currency';
import {useSuspenseSales}    from '@/api/hooks/useSales';
import {SaleRow}             from './SaleRow';
import {AddSalePanel}        from '@/features/sales/AddSalePanel';
import {AppointmentDialog}   from '@/features/appointments/AppointmentDialog';
import {Plus}                from 'lucide-react';

// rendered in the editor:
<Button onClick={...}>                              // ← <Button …>
  <icon.Plus size={16} />                           // ← rename: lucide-react → icon.
  {lib.formatCurrency(total)}                       // ← lib.
</Button>
api.useSuspenseSales(...)                           // ← api.
<my.SaleRow row={row} />                            // ← my. (relative)
<near.AddSalePanel />                               // ← near. (same domain)
<far.AppointmentDialog />                           // ← far. (other domain)
```

The prefixes are **decorations**, not edits. Your source stays clean. Git, copy-paste, diffs — everything sees the original code.

---

## Why

A typical React file has 20-50 imports. When you read a tag like `<Card />` in the middle of JSX, your eyes need to scroll back to the import to learn: is this our `Card`? A shadcn one? Something a teammate added from a feature folder?

`kin` makes that information visible on every callsite. Once you've used it for a day, scrolling-up-to-imports feels like a chore.

---

## How it works

You ship a `kin.config.cjs` at your repo root. It lists path patterns and assigns prefixes to them. `kin` watches the file and hot-reloads.

The plugin classifies **per symbol per import** by:
1. Optional custom `classify()` function — full programmatic override
2. A list of `rules[]` — each picks a `prefix` and `match`es by path / name
3. `packages.{ignore, rename, autoPrefix}` for node_modules

First match wins. The picked prefix is rendered as an inlay decoration in front of the symbol's name everywhere it appears (JSX opening tags and call sites). Closing JSX tags are left alone.

---

## Install

```bash
code --install-extension kin-0.0.1.vsix
```

Then drop a `kin.config.cjs` (see below) at your workspace root.

> **Opt-in per project:** without a `kin.config.*` at the workspace root the extension stays completely silent. Open any project that doesn't have one and you'll see no decorations. Only repos that drop a config get the prefixes — so you can install once and let each repo decide whether to use it.

> **ESM heads-up:** if your `package.json` has `"type": "module"`, use the **`.cjs`** extension. Otherwise Node parses the file as ESM and `module.exports` silently produces an empty config.

---

## Quick start

A minimal config that covers most React/TypeScript apps:

```js
// kin.config.cjs
/** @type {import('kin/kin-config').NamerConfig} */
module.exports = {
    packages: {
        ignore: [/^react$/, /^react-dom/, /^react\//],
        rename: [[/^lucide-react$/, 'icon.']],
    },
    rules: [
        // shadcn primitives — keep clean, no prefix
        {prefix: '', match: [/^@\/components\/ui\//]},

        // shared utilities
        {prefix: 'lib.', match: [/^@\/lib\//, /^@\/components\/(?!ui\/)/]},

        // backend hooks/types
        {prefix: 'api.', match: [/^@\/api\//]},

        // anything relative — same folder/headline
        {prefix: 'my.', match: [/^\.\.?\//]},
    ],
};
```

Reload the window (`Developer: Reload Window` or `Kin: Restart`) and open a file with imports.

---

## Configuration

### Full schema

```ts
type Pattern = RegExp | string;

interface MatchSpec {
    path: Pattern;                      // tested against importPath
    onlyNames?: Pattern[];              // OR: name must match at least one
    excludeNames?: Pattern[];           // AND of NOTs: name must not match any
}

type Matcher =
    | Pattern                            // tests importPath
    | ((args: ClassifyArgs) => boolean)  // full control
    | MatchSpec;

interface Rule {
    prefix: string;                      // '' = decorate-with-nothing (skip)
    match: Matcher[];                    // OR across items
    onlyNames?: Pattern[];               // top-level OR
    excludeNames?: Pattern[];            // top-level AND of NOTs
}

interface ClassifyArgs {
    importPath: string;                  // raw from `from '...'`
    callsiteFile: string;                // absolute path of the editing file
    targetPath: string;                  // resolved abs for relative; importPath otherwise
    name: string;                        // local symbol name (after `as`)
}

interface NamerConfig {
    packages?: {
        ignore?: Matcher[];
        rename?: Array<[Matcher, string]>;
        autoPrefix?: boolean;            // default true; only for bare specifiers
    };
    rules?: Rule[];
    classify?: (args: ClassifyArgs) => string | null | undefined;
    languages?: string[];                // VS Code language IDs
    opacity?: string;                    // CSS opacity 0…1, default '0.55'
}
```

### Match semantics

For each (import, symbol-name) pair `kin` evaluates:

```
classify(args) → if string|null|'' returned, that's final
              → if undefined, fall through

for each rule in order:
    if any(match items match) AND name passes top-level filters:
        use rule.prefix (or skip if '')
        STOP

for bare specifiers:
    packages.ignore matches  → skip
    packages.rename matches  → use renamed prefix
    packages.autoPrefix      → use last segment of package name + '.'

otherwise → no decoration
```

A `MatchSpec` (`{path, onlyNames?, excludeNames?}`) matches when:

```
path.test(importPath)
  AND (onlyNames is empty OR any pattern matches name)
  AND (excludeNames is empty OR no pattern matches name)
```

---

## Cookbook

### Rename a verbose npm package

```js
packages: {
    rename: [
        [/^@tanstack\/react-query$/, 'rq.'],
        [/^lucide-react$/,            'icon.'],
        [/^date-fns(?:\/|$)/,         'd.'],
    ],
}
```

Result: `rq.useQuery(...)`, `<icon.Plus />`, `d.format(...)`.

### Hide a package entirely

```js
packages: {
    ignore: [/^clsx$/, /^@radix-ui\//, /^@tanstack\//],
}
```

Result: `clsx(...)`, `<Dialog.Root>` render with no prefix.

### Different prefix per folder

```js
rules: [
    {prefix: 'ui.',    match: [/^@\/components\/ui\//]},
    {prefix: 'lib.',   match: [/^@\/lib\//]},
    {prefix: 'hook.',  match: [/^@\/hooks\//]},
    {prefix: 'store.', match: [/^@\/stores\//]},
],
```

### Exclude specific names from a prefix

```js
{
    prefix: 'lib.',
    match: [/^@\/lib\//],
    excludeNames: [/^cn$/, /^useTranslation$/, /^truncate$/],
}
```

`cn`, `useTranslation` and `truncate` will be skipped even though they live under `@/lib/`.

### Match by name only

```js
// Anything named like a hook, from anywhere → "hook."
{prefix: 'hook.', match: [/./], onlyNames: [/^use[A-Z]/]}

// Anything with Dto/Input suffix, only from generated types → "dto."
{
    prefix: 'dto.',
    match: [{path: /^@\/api\/generated\/types/, onlyNames: [/Dto$/, /Input$/]}],
}
```

### Programmatic classification (escape hatch)

```js
classify({importPath, name, callsiteFile}) {
    // Test files should mark mocks distinctly
    if (callsiteFile.endsWith('.test.tsx') && importPath.includes('__mocks__')) {
        return 'mock.';
    }
    // Lowercase the class name for API client wrappers
    if (importPath.startsWith('@/api/clients/')) {
        return name.replace(/Client$/, '').toLowerCase() + '.';
    }
    return undefined;  // everything else — use rules
}
```

`classify` runs **before** rules. Return:
- `string` → use as prefix
- `''` / `null` → skip decoration
- `undefined` → fall through to rules

### Encode domain distance (own / neighbor / foreign)

Useful if you have a vertical-slice/domain folder structure (`src/features/<domain>/<headline>/…`).

```js
const ctx = (p) => {
    const m = p.match(/(?:^@|\/src)\/features\/([^/]+)\/([^/]+)/);
    return m ? {domain: m[1], headline: m[2]} : {};
};
const targetCtx = ({targetPath, importPath}) =>
    ctx(targetPath).domain ? ctx(targetPath) : ctx(importPath);

module.exports = {
    rules: [
        // shared / ui / api as above ...

        {
            prefix: 'my.',
            match: [(args) => {
                const me = ctx(args.callsiteFile);
                const t  = targetCtx(args);
                return me.domain && me.domain === t.domain && me.headline === t.headline;
            }],
        },
        {
            prefix: 'near.',
            match: [(args) => {
                const me = ctx(args.callsiteFile);
                const t  = targetCtx(args);
                return me.domain && me.domain === t.domain && me.headline !== t.headline;
            }],
        },
        {
            prefix: 'far.',
            match: [(args) => {
                const me = ctx(args.callsiteFile);
                const t  = targetCtx(args);
                return me.domain && t.domain && me.domain !== t.domain;
            }],
        },
    ],
};
```

After this, every domain import gets one of three prefixes:
- `my.` — same folder / same feature
- `near.` — same domain, different feature
- `far.` — different domain entirely

---

## Commands

- **Kin: Refresh decorations** — re-scan visible editors
- **Kin: Reload project config** — re-read `kin.config.*` from disk
- **Kin: Restart** — clear cache + reload + refresh

Hot reload also fires automatically when `kin.config.*` is saved.

---

## Tips

- `prefix: ''` in a rule means "matched — but render nothing". Useful for whitelisting (e.g. shadcn primitives).
- The decoration colour follows the `editorCodeLens.foreground` theme token, with configurable `opacity` (default `0.55`).
- `kin` doesn't read your `tsconfig.json` paths. For `@/…`-style aliases, write the patterns yourself in `rules[]`.
- `kin` doesn't resolve aliased imports to real file paths. `targetPath` is absolute **only** for relative imports.

---

## Limitations

- Regex-based import parsing. Edge cases (string concatenations inside `from`, re-exports through barrel files) are not supported.
- No TypeScript AST. Type-only vs runtime imports look identical to `kin`.
- The decoration rendering uses VS Code's `before` text decoration API — extremely lightweight, but the prefix is not selectable text.

---

## License

MIT
