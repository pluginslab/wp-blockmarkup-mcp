# Roadmap

Feature ideas sourced from the WordPress MCP ecosystem, Gutenberg community discussions, and identified gaps in the block editor + AI space.

**Landscape context:** wp-blockmarkup-mcp is **completely uncontested** in its niche. No other tool — MCP server, WordPress plugin, or AI service — extracts block schemas from actual source code, validates Gutenberg block markup structurally and via AST analysis, and exposes this as MCP tools. The closest alternatives are AI content generation plugins (AI Builder, AI Block Editor) that generate blocks but lack any validation layer. Brian Coords' article ["Getting the Block Editor Ready for AI"](https://www.briancoords.com/getting-the-block-editor-ready-for-ai/) articulates the exact problem we solve: block markup is rigid, AI training data is outdated, and there's no unified design system for blocks.

Key references:
- [Getting the Block Editor Ready for AI](https://www.briancoords.com/getting-the-block-editor-ready-for-ai/) — Core problem statement we address
- [Gutenberg #7604](https://github.com/WordPress/gutenberg/issues/7604) — Block validation, deprecation, and migration (long-standing issue)
- [Gutenberg #8532](https://github.com/WordPress/gutenberg/issues/8532) — Custom validators for block validation
- [WordPress/mcp-adapter](https://github.com/WordPress/mcp-adapter) — Official Abilities API → MCP bridge
- [WordPress/block-development-examples](https://github.com/WordPress/block-development-examples) — Official block examples
- [AI Block Editor plugin](https://wordpress.org/plugins/ai-editor/) — AI block generation (no validation, frequent failures on complex layouts)
- [WordPress.com AI Assistant](https://wordpress.com/blog/2026/02/17/wordpress-ai-assistant/) — Built-in AI for site editor (WordPress.com only)

---

## Shipped

- **1.1.0** — Preset reference validator. Catches `var:preset|<group>|<slug>` attribute references whose inline `var(--wp--preset--<group>--<slug>)` does not match the canonical kebab form WordPress derives via `_wp_to_kebab_case()`. Emits warnings through `validate_markup` (MCP) and the `validate` CLI. Eliminates the "Attempt block recovery" loop for hand-authored pattern files.

---

## High priority

### theme.json integration

Parse and expose theme.json design tokens so AI can generate blocks that match the site's design system.

**Why:** This is the #1 gap identified by Brian Coords. Block markup is meaningless without the design context — colors, typography, spacing, and layout settings defined in theme.json. AI agents generate blocks with hardcoded values or wrong class names because they don't know what the theme supports. Providing theme.json data alongside block schemas means AI-generated content respects the site's design system out of the box.

**Scope:**
- New indexer: parse theme.json files from themes (core themes like Twenty Twenty-Five, popular block themes)
- Index: color palette, font families/sizes, spacing presets, layout settings, block-specific appearance tools
- New tool: `get_theme_tokens` — `{ theme? }` → `{ colors, typography, spacing, layout, blockSupports }`
- Enrich `get_block_markup` results with theme-appropriate class names and style values
- Support custom theme.json sources (user can point at their own theme)

---

### Block pattern library

Index and serve registered block patterns as searchable MCP resources.

**Why:** Block patterns are the natural unit of AI content generation — they sit between individual blocks and full pages. A pattern like "hero section with image and CTA" is much more useful to an AI than raw block schemas. WordPress core ships ~50 patterns, themes add more, and the Pattern Directory has thousands. No AI tool currently makes these searchable or validated.

**Scope:**
- New indexer: extract patterns from `register_block_pattern()` calls and pattern PHP files
- Index: name, title, description, categories, block types used, the actual markup
- New tools:
  - `search_patterns` — `{ query, category? }` → `{ patterns: [{ name, title, description, categories, blockCount }] }`
  - `get_pattern_markup` — `{ name }` → `{ markup, blocks_used }` (validated markup)
- Validate pattern markup through the existing two-tier pipeline
- Include patterns from core, default themes, and optionally the Pattern Directory API

---

### Block deprecation awareness

Parse deprecated versions of blocks and expose migration paths.

**Why:** Gutenberg blocks evolve across versions — attributes change, markup structures are updated, and old versions are "deprecated" with migration functions. AI agents generating markup for an outdated block version will cause validation errors in the editor. This is directly relevant to the long-standing [Gutenberg #7604](https://github.com/WordPress/gutenberg/issues/7604). No tool currently tracks block deprecation status.

**Scope:**
- Extend parser to extract `deprecated` array from block registrations
- Index: block name, deprecated versions, what changed (attributes, markup), migration function
- Flag deprecated markup in `validate_markup` results with migration suggestions
- New tool: `get_block_deprecations` — `{ block }` → `{ current_version, deprecated_versions: [{ since, changes, migration }] }`

---

### WooCommerce block support

Index WooCommerce's ~40 Gutenberg blocks.

**Why:** E-commerce is the highest-value use case for AI content generation — product pages, store layouts, checkout flows. WooCommerce blocks have complex schemas and specific attribute requirements. AI agents frequently get WooCommerce block markup wrong because the training data is sparse.

**Scope:**
- Add WooCommerce as a source (similar to how core Gutenberg is indexed)
- Parse all `woocommerce/*` blocks: Product Collection, Cart, Checkout, Mini Cart, etc.
- Handle WooCommerce-specific block patterns (store patterns)
- Include WooCommerce's inner block constraints (e.g., Checkout must contain specific child blocks)

---

## Medium priority

### Dynamic block render output

For server-rendered blocks, capture and index the actual HTML output.

**Why:** Many important blocks (Query Loop, Latest Posts, Site Title, Navigation, etc.) are entirely dynamic — their `save()` returns `null` and all rendering happens in PHP via `render_callback`. Our current two-tier validation can't help with these blocks because there's no save markup to analyze. Capturing their rendered output fills this gap.

**Scope:**
- Identify dynamic blocks (save returns null, has render_callback or render attribute)
- For blocks with a Playground instance available (via wp-playground-mcp): render them with sample data and capture output
- For static analysis: parse the `render_callback` PHP to extract HTML structure
- New tool: `get_dynamic_block_output` — `{ block, attributes? }` → `{ html, attributes_used }`
- Mark dynamic vs. static blocks in schema results

---

### InnerBlocks schema and nesting validation

Expose allowed/required InnerBlocks configurations for complex block layouts.

**Why:** Many Gutenberg layouts depend on correct nesting: Columns must contain Column blocks, Buttons must contain Button blocks, Group can contain anything. AI agents frequently generate invalid nesting (e.g., a Button directly inside Columns). No tool currently provides this constraint information.

**Scope:**
- Parse `InnerBlocks` usage from edit() functions: allowedBlocks, templateLock, template
- Parse `parent` and `ancestor` constraints from block.json
- Enrich `get_block_schema` with nesting rules
- Add nesting validation to `validate_markup` — check that child blocks are allowed
- New tool: `validate_block_nesting` — `{ markup }` → `{ valid, errors: [{ block, issue, allowed }] }`

---

### Block markup suggestions / autocomplete

Given a partial block markup or intent description, return valid completions.

**Why:** AI agents often generate almost-correct block markup — a missing attribute, wrong class name, or incomplete comment delimiter. A suggestion tool that takes partial markup and returns the valid completion would dramatically reduce iteration cycles.

**Scope:**
- New tool: `suggest_block_markup` — `{ intent: string, context?: string }` → `{ suggestions: [{ markup, confidence, block_used }] }`
- Use indexed schemas and patterns to generate valid completions
- Match intent against block descriptions and pattern titles
- Return multiple options ranked by relevance

---

### Block compatibility matrix

Track which blocks are available in which WordPress versions.

**Why:** AI agents often generate blocks that don't exist in the target WordPress version. A block added in WordPress 6.5 won't work in 6.3. Version-aware tooling prevents this class of errors entirely.

**Scope:**
- Track block `@since` / first appearance across WordPress versions
- Add `wp_version` filter to all search and schema tools
- New tool: `check_block_compatibility` — `{ blocks: string[], wp_version }` → `{ compatible: [...], incompatible: [...] }`
- Index multiple WordPress versions' block registries

---

### MCP prompt templates

Ship pre-built MCP prompt templates for common block generation tasks.

**Why:** The MCP spec supports a "prompts" primitive alongside tools and resources. Pre-built prompts like "generate a hero section" or "create a pricing table" that leverage our block schemas would make wp-blockmarkup-mcp more useful out of the box. The WordPress MCP Adapter already supports MCP prompts.

**Scope:**
- Define MCP prompts for common content patterns: hero, CTA, pricing, FAQ, testimonials, features grid
- Each prompt includes the relevant block schemas and validated example markup
- Prompts are parameterizable (e.g., "hero section with {columns} columns")
- Register via MCP SDK's prompt system

---

## Future ideas

### Block style variations indexing

Index registered block style variations beyond core defaults, including those from themes.

**Why:** Block style variations (e.g., "outline" vs "fill" for buttons) are defined by both core and themes. AI agents need to know what styles are available to generate correct class names (`is-style-outline`).

**Scope:** Parse `register_block_style()` calls and theme.json `styles.blocks` entries.

---

### Multi-block composition validation

Validate not just individual blocks but composed layouts as a whole.

**Why:** Individual blocks can be valid but the composition can be invalid — e.g., a Group block with `layout.type: flex` containing blocks that don't support flex children. Composition-level validation catches errors that block-level validation misses.

**Scope:** New tool: `validate_composition` — `{ markup }` → validates the entire block tree, checking nesting, layout compatibility, and structural integrity.

---

### Block markup linting

Go beyond validation (pass/fail) to suggest improvements.

**Why:** Valid markup can still be suboptimal — missing accessibility attributes, deprecated patterns, inefficient block choices (e.g., using a Group where a Stack would be more semantic). A linting tool surfaces these issues.

**Scope:** New tool: `lint_block_markup` — `{ markup }` → `{ suggestions: [{ block, issue, recommendation, severity }] }`. Check for: missing alt text on images, empty heading blocks, buttons without links, color contrast issues (if theme.json colors are available).

---

### Abilities API registration

Register wp-blockmarkup-mcp tools as WordPress Abilities for the official MCP Adapter.

**Why:** As the Abilities API becomes standard in WordPress 6.9+, registering our tools as Abilities would make block intelligence discoverable through the official MCP Adapter. Any AI agent connected to a WordPress site could access block schema and validation without needing our separate MCP server.

**Scope:** WordPress plugin companion that registers our tools via `register_ability()`. Translates our MCP tool interfaces to the Abilities API format.

---

### Custom block registry

Allow developers to index their own custom blocks from private plugins/themes.

**Why:** Enterprise WordPress sites often have dozens of custom blocks. Our tool currently focuses on core + popular plugins. Supporting custom source directories would make wp-blockmarkup-mcp useful for teams building their own block libraries.

**Scope:** Already partially supported via source management CLI. Needs documentation and ergonomic improvements for pointing at local block directories.
