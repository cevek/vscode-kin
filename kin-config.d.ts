// Type hints for namer.config.{cjs,js,json}. Reference with JSDoc:
//   /** @type {import('./namer-config').NamerConfig} */
//   module.exports = { ... };

export interface ClassifyArgs {
    /** Raw specifier as written in the import (`from '...'`). */
    importPath: string;
    /** Absolute path of the file containing the import. */
    callsiteFile: string;
    /** Resolved absolute path for relative imports; equals importPath otherwise. */
    targetPath: string;
    /** Local symbol name as used in the callsite (after `as`-aliasing). */
    name: string;
}

export type Pattern = RegExp | string;

/**
 * Declarative matcher.
 *   - `path` is tested against importPath.
 *   - `onlyNames` (OR): name must match at least one. Omit to accept any name.
 *   - `excludeNames` (AND of NOTs): name must not match any.
 */
export interface MatchSpec {
    path: Pattern;
    onlyNames?: Pattern[];
    excludeNames?: Pattern[];
}

/**
 * A matcher item:
 *   - RegExp / string      — tested against importPath
 *   - (args) => boolean    — full control
 *   - { path, onlyNames?, excludeNames? }
 */
export type Matcher =
    | Pattern
    | ((args: ClassifyArgs) => boolean)
    | MatchSpec;

export interface Rule {
    prefix: string;
    /** OR across items. */
    match: Matcher[];
    /** Top-level OR: name must match at least one. */
    onlyNames?: Pattern[];
    /** Top-level AND of NOTs: name must not match any. */
    excludeNames?: Pattern[];
}

export interface NamerConfig {
    packages?: {
        /** Don't decorate these imports. */
        ignore?: Matcher[];
        /** Replace the auto-derived `<pkg>.` prefix. */
        rename?: Array<[Matcher, string]>;
        /** When true (default), unmatched bare specifiers render as `<packageName>.`. */
        autoPrefix?: boolean;
    };

    /** Static rules — checked in order, first match wins. `prefix: ''` = skip. */
    rules?: Rule[];

    /** Custom classifier (per symbol). Called BEFORE rules. */
    classify?: (args: ClassifyArgs) => string | null | undefined;

    languages?: string[];
    opacity?: string;
}
