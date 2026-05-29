// Type hints for namer.config.{js,cjs}. Reference with JSDoc:
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

/**
 * Declarative matcher.
 *   - `path` (required) is tested against importPath
 *   - `name` (optional) is tested against the symbol name.
 *     Use lookahead for negatives: /^(?!Button$|Alert$)/
 */
export interface MatchSpec {
    path: RegExp | string;
    name?: RegExp | string;
}

/**
 * A matcher item:
 *   - RegExp / string      — tested against importPath
 *   - (args) => boolean    — full control
 *   - { path, name? }      — declarative path + optional name filter
 */
export type Matcher =
    | RegExp
    | string
    | ((args: ClassifyArgs) => boolean)
    | MatchSpec;

export interface NamerConfig {
    packages?: {
        /** Don't decorate these imports. */
        ignore?: Matcher[];
        /** Replace the auto-derived `<pkg>.` prefix with a custom one. */
        rename?: Array<[Matcher, string]>;
        /** When true (default), unmatched bare specifiers render as `<packageName>.`. */
        autoPrefix?: boolean;
    };

    /** Static rules — checked in order, first match wins. `prefix: ''` = skip. */
    rules?: Array<{
        prefix: string;
        match: Matcher[];
    }>;

    /**
     * Custom classifier. Called BEFORE rules. Per-symbol. Return:
     *   string    — use as prefix
     *   ''        — skip decoration
     *   null      — skip decoration
     *   undefined — fall through to rules
     */
    classify?: (args: ClassifyArgs) => string | null | undefined;

    languages?: string[];
    opacity?: string;
}
