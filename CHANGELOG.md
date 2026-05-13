# Changelog

## [1.1.1] - 2026-05-13

### Docs
- Add an **Updating** section to the README covering npx caching, the global-install path, version pinning, and the requirement to restart the MCP server after upgrades. Closes a real gap users hit silently: `npx wp-blockmarkup-mcp` caches by `(package + args)` hash and never refreshes, so anyone who installed at an older version would silently stay on it.

## [1.1.0] - 2026-05-12

### Added
- **Preset reference validator** — new additive Tier 1 pass that catches mismatches between `var:preset|<group>|<slug>` attribute references and the resolved `var(--wp--preset--<group>--<kebab-slug>)` form in inline `style=""`. WordPress applies `_wp_to_kebab_case()` to slugs when expanding preset references (hyphenating digit↔letter and camelCase boundaries), so a hand-authored attribute like `var:preset|spacing|30x` with inline style `var(--wp--preset--spacing--30x)` triggers Gutenberg's "Attempt block recovery" prompt on every editor open even though the frontend renders fine. The validator surfaces these as warnings via `validate_markup` (MCP) and the `validate` CLI command — no behavior change for clean markup.

## [1.0.2] - prior
- Improvements to markup generation and validation accuracy.
