# Changelog

All notable changes to **kin** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] — Initial release

### Added

- Inlay-prefix rendering on JSX opening tags and identifier call sites.
- Per-project config (`kin.config.cjs` / `.js` / `.json`) at workspace root with hot-reload on save.
- Matcher forms:
  - `RegExp` / `string` → tests `importPath`
  - Function `(args) => boolean` with `{importPath, callsiteFile, targetPath, name}`
  - Object `{path, onlyNames?, excludeNames?}` for declarative name-filtering
- Rule-level `onlyNames` / `excludeNames` filters.
- `packages.ignore` / `packages.rename` / `packages.autoPrefix` for npm specifiers.
- `classify()` programmatic escape hatch with per-symbol invocation.
- Commands: `Kin: Refresh decorations`, `Kin: Reload project config`, `Kin: Restart`.
