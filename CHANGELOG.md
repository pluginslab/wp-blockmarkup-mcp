# Changelog

## [Unreleased]

### Fixed
- **Index `.jsx`, `.ts` and `.tsx` block sources.** The save, edit and variations parsers only looked for `save.js`, `edit.js` and `variations.js`. Gutenberg renamed its JSX-bearing block sources to `.jsx` in [WordPress/gutenberg#80990](https://github.com/WordPress/gutenberg/pull/80990) (August 2026), so indexing Gutenberg `trunk` silently classified all 116 core blocks as dynamic, with 0 verified examples, and dropped every inspector control. Sources are now resolved in the order `.js`, `.jsx`, `.ts`, `.tsx`. On Gutenberg `trunk` the index goes from 0 to 54 static blocks and from 0 to 256 verified examples. Sources that only ship `.js` files (WordPress 7.1 and earlier) produce the same index and the same content hashes as before, so they are not re-indexed; stale `trunk` indexes are repaired by a plain `wp-blocks index`, no `--force` needed.

## [1.1.1] - 2026-05-13

### Docs
- Add an **Updating** section to the README covering npx caching, the global-install path, version pinning, and the requirement to restart the MCP server after upgrades. Closes a real gap users hit silently: `npx wp-blockmarkup-mcp` caches by `(package + args)` hash and never refreshes, so anyone who installed at an older version would silently stay on it.

## [1.1.0] - 2026-05-12

### Added
- **Preset reference validator** — new additive Tier 1 pass that catches mismatches between `var:preset|<group>|<slug>` attribute references and the resolved `var(--wp--preset--<group>--<kebab-slug>)` form in inline `style=""`. WordPress applies `_wp_to_kebab_case()` to slugs when expanding preset references (hyphenating digit↔letter and camelCase boundaries), so a hand-authored attribute like `var:preset|spacing|30x` with inline style `var(--wp--preset--spacing--30x)` triggers Gutenberg's "Attempt block recovery" prompt on every editor open even though the frontend renders fine. The validator surfaces these as warnings via `validate_markup` (MCP) and the `validate` CLI command — no behavior change for clean markup.

## [1.0.2] - prior
- Improvements to markup generation and validation accuracy.
