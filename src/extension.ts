// namer — kinship prefixes for imported symbols.
//
// All classification rules live in a per-project config:
//   namer.config.js | namer.config.cjs | namer.config.json (at workspace root)
//
// Schema (see namer-config.d.ts):
//   {
//     packages: {
//       ignore: [RegExp, ...],
//       rename: [[RegExp, 'prefix'], ...],
//     },
//     rules: [{prefix: 'lib.', match: [RegExp, ...]}, ...],
//     domain: {
//       root: 'domains' | 'features',
//       alias: [RegExp /* capture 1 = domain, capture 2 = headline */, ...],
//       prefixes: {own, neighbor, foreign},
//     },
//     classify({importPath, callsiteFile, myDomain, myHeadline}): string | null | undefined,
//     languages, opacity, showExternalPackagePrefix,
//   }
//
// Resolution order:
//   1. config.classify()                        — escape hatch
//   2. config.rules[]                           — first-match-wins by prefix
//   3. config.domain.alias[] (capture 1,2)      — same/other domain & headline
//   4. relative ./ → resolve absolute path      — same domain semantics
//   5. bare specifier:
//        a. packages.ignore[]                   — skip
//        b. packages.rename[]                   — apply renamed prefix
//        c. fallback                            — packageName + '.'

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

interface ClassifyArgs {
    /** Raw specifier as written in the import (`from '...'`). */
    importPath: string;
    /** Absolute path of the file containing the import. */
    callsiteFile: string;
    /** Resolved absolute path for relative imports; equals `importPath` otherwise. */
    targetPath: string;
    /** Local symbol name in the callsite (after `as`-aliasing). */
    name: string;
}

interface MatchSpec {
    /** Required. Tested against `importPath`. */
    path: RegExp;
    /** Optional. Tested against the symbol `name`. Use lookahead for negatives: `/^(?!Foo$|Bar$)/`. */
    name?: RegExp;
}

/** A matcher item. */
type Matcher =
    | RegExp                                       // tested against importPath
    | ((a: ClassifyArgs) => boolean)               // full control
    | MatchSpec;                                    // declarative path + optional name

interface Config {
    packages: {
        ignore: Matcher[];
        rename: Array<[Matcher, string]>;
        /** When true, unmatched bare specifiers render as `<packageName>.`. */
        autoPrefix: boolean;
    };
    rules: Array<{prefix: string; match: Matcher[]}>;
    classify?: (a: ClassifyArgs) => string | null | undefined;
    languages: string[];
    opacity: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Defaults (used when no project config is present)
// ───────────────────────────────────────────────────────────────────────────

function builtinDefaults(): Config {
    return {
        packages: {
            ignore: [],
            rename: [],
            autoPrefix: true,
        },
        rules: [],
        languages: ['typescript', 'typescriptreact'],
        opacity: '0.55',
    };
}

// ───────────────────────────────────────────────────────────────────────────
// Config loading
// ───────────────────────────────────────────────────────────────────────────

// .cjs first — works even when package.json has "type": "module".
const CONFIG_FILENAMES = ['namer.config.cjs', 'namer.config.js', 'namer.config.json'];

function toRegex(v: unknown): RegExp {
    if (v instanceof RegExp) return v;
    if (typeof v === 'string') return new RegExp(v);
    throw new Error(`namer: expected RegExp or string, got ${typeof v}`);
}

function toMatcher(v: unknown): Matcher {
    if (v instanceof RegExp) return v;
    if (typeof v === 'string') return new RegExp(v);
    if (typeof v === 'function') return v as Matcher;
    if (v && typeof v === 'object' && 'path' in (v as object)) {
        const o = v as {path: unknown; name?: unknown};
        return {
            path: toRegex(o.path),
            name: o.name === undefined ? undefined : toRegex(o.name),
        };
    }
    throw new Error('namer: matcher must be RegExp | string | function | {path, name?}');
}

function testMatcher(m: Matcher, args: ClassifyArgs): boolean {
    if (typeof m === 'function') {
        try { return Boolean(m(args)); }
        catch (e) { console.error('namer: matcher fn threw', e); return false; }
    }
    if (m instanceof RegExp) return m.test(args.importPath);
    // MatchSpec
    if (!m.path.test(args.importPath)) return false;
    if (m.name && !m.name.test(args.name)) return false;
    return true;
}

function normalize(raw: any): Partial<Config> {
    const out: Partial<Config> = {};

    if (raw.packages) {
        out.packages = {
            ignore: (raw.packages.ignore ?? []).map(toMatcher),
            rename: (raw.packages.rename ?? []).map((t: [unknown, string]) => [toMatcher(t[0]), String(t[1])]),
            autoPrefix: raw.packages.autoPrefix ?? true,
        };
    }
    if (raw.rules) {
        out.rules = raw.rules.map((r: any) => ({
            prefix: String(r.prefix ?? ''),
            match: (r.match ?? []).map(toMatcher),
        }));
    }
    if (typeof raw.classify === 'function') out.classify = raw.classify;
    if (Array.isArray(raw.languages)) out.languages = raw.languages;
    if (typeof raw.opacity === 'string') out.opacity = raw.opacity;

    return out;
}

interface LoadedConfig {
    folder: string;
    file: string;
    config: Partial<Config>;
}

function loadProjectConfig(folder: string): LoadedConfig | null {
    for (const name of CONFIG_FILENAMES) {
        const file = path.join(folder, name);
        if (!fs.existsSync(file)) continue;
        try {
            let raw: any;
            if (name.endsWith('.json')) {
                raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            } else {
                const resolved = require.resolve(file);
                delete require.cache[resolved];
                raw = require(resolved);
            }
            if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
                vscode.window.showWarningMessage(
                    `namer: ${file} loaded as empty/undefined. If your package.json has "type": "module", rename the file to namer.config.cjs.`,
                );
                continue;
            }
            return {folder, file, config: normalize(raw)};
        } catch (e) {
            const msg = (e as Error).message;
            const hint = msg.includes('ERR_REQUIRE_ESM') || msg.includes('module')
                ? ` Hint: rename to namer.config.cjs (your package.json may have "type": "module").`
                : '';
            vscode.window.showErrorMessage(`namer: failed to load ${file}: ${msg}${hint}`);
            continue;
        }
    }
    return null;
}

const configByFolder = new Map<string, LoadedConfig | null>();

function configForFile(filePath: string): Config {
    const uri = vscode.Uri.file(filePath);
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const folderPath = folder?.uri.fsPath;

    let override: Partial<Config> = {};
    if (folderPath) {
        if (!configByFolder.has(folderPath)) {
            configByFolder.set(folderPath, loadProjectConfig(folderPath));
        }
        override = configByFolder.get(folderPath)?.config ?? {};
    }

    const base = builtinDefaults();
    return {
        packages: {
            ignore:     override.packages?.ignore     ?? base.packages.ignore,
            rename:     override.packages?.rename     ?? base.packages.rename,
            autoPrefix: override.packages?.autoPrefix ?? base.packages.autoPrefix,
        },
        rules:    override.rules ?? base.rules,
        classify: override.classify ?? base.classify,
        languages: override.languages ?? base.languages,
        opacity:   override.opacity ?? base.opacity,
    };
}

function invalidateConfigs() {
    configByFolder.clear();
}

// ───────────────────────────────────────────────────────────────────────────
// Classification
// ───────────────────────────────────────────────────────────────────────────

function isBareSpecifier(spec: string): boolean {
    // Bare = a node_modules name. Not relative, not absolute, not a Vite-style alias.
    if (spec.startsWith('.') || spec.startsWith('/')) return false;
    if (spec.startsWith('@/')) return false;             // @/foo  → Vite alias
    return true;                                          // react | @scope/pkg | lodash/x
}

function externalPackageName(spec: string): string {
    if (spec.startsWith('@')) {
        const parts = spec.split('/');
        return parts.length >= 2 ? parts[1] : spec.slice(1);
    }
    return spec.split('/')[0];
}

function getPrefix(importPath: string, callsiteFile: string, name: string, config: Config): string | null {
    const targetPath = importPath.startsWith('.')
        ? path.resolve(path.dirname(callsiteFile), importPath)
        : importPath;
    const args: ClassifyArgs = {importPath, callsiteFile, targetPath, name};

    // 1. classify() — escape hatch
    if (config.classify) {
        try {
            const r = config.classify(args);
            if (r !== undefined) return r || null;
        } catch (e) {
            console.error('namer: classify() threw', e);
        }
    }

    // 2. rules — first match wins
    for (const rule of config.rules) {
        if (rule.match.some((m) => testMatcher(m, args))) {
            return rule.prefix || null;
        }
    }

    // 3. packages (ignore/rename apply to any import; autoPrefix only to bare specifiers)
    for (const m of config.packages.ignore) {
        if (testMatcher(m, args)) return null;
    }
    for (const [m, prefix] of config.packages.rename) {
        if (testMatcher(m, args)) return prefix || null;
    }
    if (config.packages.autoPrefix && isBareSpecifier(importPath)) {
        return externalPackageName(importPath) + '.';
    }
    return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Import parsing
// ───────────────────────────────────────────────────────────────────────────

function parseImports(text: string): Array<{names: string[]; source: string}> {
    const out: Array<{names: string[]; source: string}> = [];

    const namedRe = /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g;
    for (const m of text.matchAll(namedRe)) {
        const names = m[1]
            .split(',')
            .map((s) => s.trim().replace(/^type\s+/, ''))
            .map((s) => s.split(/\s+as\s+/).pop()!.trim())
            .filter(Boolean)
            .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
        out.push({names, source: m[2]});
    }

    const defaultRe = /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s*,\s*\{[\s\S]*?\})?\s+from\s+['"]([^'"]+)['"]/g;
    for (const m of text.matchAll(defaultRe)) {
        const name = m[1];
        if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) {
            out.push({names: [name], source: m[2]});
        }
    }

    return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Decoration cache & render
// ───────────────────────────────────────────────────────────────────────────

const decoCache = new Map<string, vscode.TextEditorDecorationType>();

function decoFor(prefix: string, opacity: string): vscode.TextEditorDecorationType {
    let d = decoCache.get(prefix);
    if (d) return d;
    d = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: prefix,
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
            margin: `0 0 0 0; opacity: ${opacity};`,
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    decoCache.set(prefix, d);
    return d;
}

function disposeAllDecorations() {
    for (const d of decoCache.values()) d.dispose();
    decoCache.clear();
}

function refresh(editor: vscode.TextEditor) {
    const config = configForFile(editor.document.fileName);

    if (!config.languages.includes(editor.document.languageId)) {
        for (const d of decoCache.values()) editor.setDecorations(d, []);
        return;
    }

    const text = editor.document.getText();
    const file = editor.document.fileName;

    const symbolPrefix = new Map<string, string>();
    for (const {names, source} of parseImports(text)) {
        for (const n of names) {
            const p = getPrefix(source, file, n, config);
            if (p === null) continue;
            symbolPrefix.set(n, p);
        }
    }

    const buckets = new Map<string, vscode.Range[]>();
    const push = (prefix: string, pos: vscode.Position) => {
        let arr = buckets.get(prefix);
        if (!arr) { arr = []; buckets.set(prefix, arr); }
        arr.push(new vscode.Range(pos, pos));
    };

    for (const m of text.matchAll(/<([A-Z][A-Za-z0-9_$]*)\b/g)) {
        const p = symbolPrefix.get(m[1]);
        if (!p) continue;
        push(p, editor.document.positionAt(m.index! + 1));
    }

    for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        const p = symbolPrefix.get(m[1]);
        if (!p) continue;
        const before = text.slice(Math.max(0, m.index! - 10), m.index!);
        if (/[.<]\s*$/.test(before)) continue;
        if (/\b(function|class)\s+$/.test(before)) continue;
        push(p, editor.document.positionAt(m.index!));
    }

    const seen = new Set(buckets.keys());
    for (const [prefix, ranges] of buckets) {
        editor.setDecorations(decoFor(prefix, config.opacity), ranges);
    }
    for (const [prefix, deco] of decoCache) {
        if (!seen.has(prefix)) editor.setDecorations(deco, []);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Activation
// ───────────────────────────────────────────────────────────────────────────

export function activate(ctx: vscode.ExtensionContext) {
    const refreshAll = () => {
        for (const ed of vscode.window.visibleTextEditors) refresh(ed);
    };
    const reloadConfigs = () => {
        invalidateConfigs();
        disposeAllDecorations();
        refreshAll();
    };

    refreshAll();

    const watcher = vscode.workspace.createFileSystemWatcher('**/namer.config.{js,cjs,json}');
    watcher.onDidCreate(reloadConfigs);
    watcher.onDidChange(reloadConfigs);
    watcher.onDidDelete(reloadConfigs);

    ctx.subscriptions.push(
        watcher,
        vscode.window.onDidChangeActiveTextEditor((e) => e && refresh(e)),
        vscode.window.onDidChangeVisibleTextEditors(() => refreshAll()),
        vscode.workspace.onDidChangeTextDocument((e) => {
            for (const ed of vscode.window.visibleTextEditors) {
                if (ed.document === e.document) refresh(ed);
            }
        }),
        vscode.commands.registerCommand('namer.refresh', refreshAll),
        vscode.commands.registerCommand('namer.reloadProjectConfig', reloadConfigs),
        vscode.commands.registerCommand('namer.restart', reloadConfigs),
        {dispose: disposeAllDecorations},
    );
}

export function deactivate() {}
