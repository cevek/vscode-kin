// kin — kinship prefixes for imported symbols.
//
// All classification rules live in a per-project config at workspace root:
//   kin.config.cjs | kin.config.js | kin.config.json
//
// See kin-config.d.ts for the full schema. Resolution order:
//   1. config.classify()                  — escape hatch (per symbol)
//   2. config.rules[]                     — first-match-wins
//   3. packages.ignore / rename / autoPrefix
//   4. null — no decoration

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
    /** OR: name must match at least one. If omitted, names aren't constrained. */
    onlyNames?: RegExp[];
    /** AND of NOTs: name must not match any of these. */
    excludeNames?: RegExp[];
}

/** A matcher item. */
type Matcher =
    | RegExp                                       // tested against importPath
    | ((a: ClassifyArgs) => boolean)               // full control
    | MatchSpec;                                    // declarative path + name filters

interface Rule {
    prefix: string;
    match: Matcher[];
    /** Top-level OR: name must match at least one. */
    onlyNames?: RegExp[];
    /** Top-level AND of NOTs: name must not match any. */
    excludeNames?: RegExp[];
}

interface Config {
    packages: {
        ignore: Matcher[];
        rename: Array<[Matcher, string]>;
        /** When true, unmatched bare specifiers render as `<packageName>.`. */
        autoPrefix: boolean;
    };
    rules: Rule[];
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
const CONFIG_FILENAMES = ['kin.config.cjs', 'kin.config.js', 'kin.config.json'];

function toRegex(v: unknown): RegExp {
    if (v instanceof RegExp) return v;
    if (typeof v === 'string') return new RegExp(v);
    throw new Error(`kin: expected RegExp or string, got ${typeof v}`);
}

function toPatternArray(v: unknown): RegExp[] | undefined {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) throw new Error('kin: expected array of RegExp/string');
    return v.map(toRegex);
}

function toMatcher(v: unknown): Matcher {
    if (v instanceof RegExp) return v;
    if (typeof v === 'string') return new RegExp(v);
    if (typeof v === 'function') return v as Matcher;
    if (v && typeof v === 'object' && 'path' in (v as object)) {
        const o = v as {path: unknown; onlyNames?: unknown; excludeNames?: unknown};
        return {
            path: toRegex(o.path),
            onlyNames: toPatternArray(o.onlyNames),
            excludeNames: toPatternArray(o.excludeNames),
        };
    }
    throw new Error('kin: matcher must be RegExp | string | function | {path, onlyNames?, excludeNames?}');
}

function passesNameFilters(name: string, only?: RegExp[], exclude?: RegExp[]): boolean {
    if (only && !only.some((re) => re.test(name))) return false;
    if (exclude && exclude.some((re) => re.test(name))) return false;
    return true;
}

function testMatcher(m: Matcher, args: ClassifyArgs): boolean {
    if (typeof m === 'function') {
        try { return Boolean(m(args)); }
        catch (e) { console.error('kin: matcher fn threw', e); return false; }
    }
    if (m instanceof RegExp) return m.test(args.importPath);
    // MatchSpec
    if (!m.path.test(args.importPath)) return false;
    return passesNameFilters(args.name, m.onlyNames, m.excludeNames);
}

function ruleApplies(rule: Rule, args: ClassifyArgs): boolean {
    if (!rule.match.some((m) => testMatcher(m, args))) return false;
    return passesNameFilters(args.name, rule.onlyNames, rule.excludeNames);
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
            onlyNames: toPatternArray(r.onlyNames),
            excludeNames: toPatternArray(r.excludeNames),
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
                    `kin: ${file} loaded as empty/undefined. If your package.json has "type": "module", rename the file to kin.config.cjs.`,
                );
                continue;
            }
            return {folder, file, config: normalize(raw)};
        } catch (e) {
            const msg = (e as Error).message;
            const hint = msg.includes('ERR_REQUIRE_ESM') || msg.includes('module')
                ? ` Hint: rename to kin.config.cjs (your package.json may have "type": "module").`
                : '';
            vscode.window.showErrorMessage(`kin: failed to load ${file}: ${msg}${hint}`);
            continue;
        }
    }
    return null;
}

const configByFolder = new Map<string, LoadedConfig | null>();

/** Returns Config when a project config exists, or null when the extension should stay silent. */
function configForFile(filePath: string): Config | null {
    const uri = vscode.Uri.file(filePath);
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const folderPath = folder?.uri.fsPath;
    if (!folderPath) return null;

    if (!configByFolder.has(folderPath)) {
        configByFolder.set(folderPath, loadProjectConfig(folderPath));
    }
    const loaded = configByFolder.get(folderPath);
    if (!loaded) return null;                       // no kin.config.* → opt-out

    const override = loaded.config;
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
            console.error('kin: classify() threw', e);
        }
    }

    // 2. rules — first match wins
    for (const rule of config.rules) {
        if (ruleApplies(rule, args)) {
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

    // No project config → stay silent. Also clear any leftovers from a prior config.
    if (!config || !config.languages.includes(editor.document.languageId)) {
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

    const watcher = vscode.workspace.createFileSystemWatcher('**/kin.config.{js,cjs,json}');
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
        vscode.commands.registerCommand('kin.refresh', refreshAll),
        vscode.commands.registerCommand('kin.reloadProjectConfig', reloadConfigs),
        vscode.commands.registerCommand('kin.restart', reloadConfigs),
        {dispose: disposeAllDecorations},
    );
}

export function deactivate() {}
