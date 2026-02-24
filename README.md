# wp-blockmarkup-mcp

**Give your AI assistant a verified block markup database instead of letting it guess Gutenberg HTML.**

wp-blockmarkup-mcp is a local [MCP server](https://modelcontextprotocol.io/) that extracts, validates, and indexes every Gutenberg block from WordPress core, WooCommerce, or any block-based plugin you work with. It gives AI tools like Claude Code a verified database of block schemas, attributes, and validated markup examples to query — instead of relying on training data that hallucinates block structures, invents attributes, and produces markup that triggers "Attempt Block Recovery" in the editor.

## Why This Exists

AI assistants are increasingly used to generate WordPress content programmatically — building pages via the REST API, migrating content between platforms, populating headless frontends. But every AI model shares the same blind spot: **block markup comes from training data, not from the actual block source code**.

This means:

- **Models invent attributes that don't exist** — `fontSize` as a number when it expects a string slug like `"large"`
- **Class naming patterns are wrong** — `has-background-color-vivid-red` instead of `has-vivid-red-background-color`
- **Block nesting rules are ignored** — putting blocks inside containers that don't support `InnerBlocks`
- **Dynamic blocks get static markup** — generating HTML for blocks that only accept comment delimiters with attributes
- **Third-party blocks are invisible** — WooCommerce blocks, Kadence blocks, ACF blocks are all unknown to training data
- **Subtle mismatches break silently** — the markup looks right but the editor flags it as invalid, requiring manual recovery

You only discover these problems when content lands in the editor and every block shows a yellow warning bar. In an agentic workflow where the AI generates and pushes content autonomously, bad markup means broken pages.

## The Solution

**Feed the AI real block data.** Instead of hoping the model remembers the right markup format, give it a verified database to query and validate against.

wp-blockmarkup-mcp parses the actual source code of any block-based plugin, extracts every block's schema, and **validates generated markup against the block's own `save()` function** — the same validation the block editor uses internally. Your AI assistant queries this database before generating content, and can validate its output before pushing it.

This fits naturally into content generation workflows. When Claude Code (or any MCP-compatible assistant) needs to generate Gutenberg block markup, it:

1. **Searches** the indexed database for relevant blocks
2. **Retrieves** the full attribute schema and validated markup examples
3. **Generates** content using verified patterns
4. **Validates** the generated markup against the block's actual save function before pushing it

No "Attempt Block Recovery". No broken pages. No guessing.

**What gets indexed:**

| Data | Details |
|------|---------|
| Block metadata | Name, title, description, category, API version |
| Attributes | Full schema with types, defaults, sources, selectors, allowed values |
| Support configs | Alignment, color, typography, spacing, border, layout, dimensions |
| Variations | Pre-configured block variations with attributes and markup |
| Save patterns | HTML wrapper elements, class naming patterns, style patterns, InnerBlocks usage |
| UI controls | Inspector controls, toolbar controls, attribute mappings |
| Validated markup | Examples validated against the block's own `save()` function |

**What the AI gets for each block:**

- Full attribute table with types, defaults, and constraints
- Support configuration (which features the block enables)
- Validated markup examples for different feature combinations (basic, with colors, with typography, with spacing, full-featured)
- Block type classification (static / dynamic / hybrid)
- Validation status (verified / unverified / attributes-only)
- Variations with pre-configured attributes and markup

## Quick Start

```bash
# Clone and install
git clone https://github.com/pluginslab/wp-blockmarkup-mcp.git
cd wp-blockmarkup-mcp
npm install
```

### Index Your First Source

Each `source:add` command clones the repo and indexes it automatically:

```bash
# WordPress Gutenberg core blocks (115 blocks)
npx wp-blocks source:add \
  --name gutenberg \
  --type github-public \
  --repo https://github.com/WordPress/gutenberg \
  --branch trunk
```

That's it. 115 core blocks extracted, validated, and indexed.

### Connect to Claude Code

Add the MCP server to your Claude Code configuration. Create or edit `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "wp-blockmarkup": {
      "command": "npx",
      "args": ["--prefix", "/absolute/path/to/wp-blockmarkup-mcp", "wp-blockmarkup-mcp"]
    }
  }
}
```

Now when you ask Claude Code to generate WordPress content with Gutenberg blocks, it will automatically search block schemas and validate markup against your indexed sources.

## Indexing Sources

### Gutenberg Core Blocks

```bash
npx wp-blocks source:add \
  --name gutenberg \
  --type github-public \
  --repo https://github.com/WordPress/gutenberg \
  --branch trunk
```

### WooCommerce Blocks

```bash
npx wp-blocks source:add \
  --name woocommerce-blocks \
  --type github-public \
  --repo https://github.com/woocommerce/woocommerce \
  --subfolder plugins/woocommerce-blocks \
  --branch trunk
```

### Any Public Block Plugin

```bash
# Example: Kadence Blocks
npx wp-blocks source:add \
  --name kadence-blocks \
  --type github-public \
  --repo https://github.com/stellarwp/kadence-blocks

# Example: GenerateBlocks
npx wp-blocks source:add \
  --name generateblocks \
  --type github-public \
  --repo https://github.com/suspended-developer/generateblocks
```

### Your Private Plugins

For private GitHub repos, store your token in an environment variable (never in the config):

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

npx wp-blocks source:add \
  --name my-custom-blocks \
  --type github-private \
  --repo https://github.com/yourorg/your-blocks \
  --token-env GITHUB_TOKEN
```

### Local Block Development

Point directly at a folder on your machine — great for blocks you're actively developing:

```bash
npx wp-blocks source:add \
  --name my-local-blocks \
  --type local-folder \
  --path /path/to/wp-content/plugins/my-blocks
```

### Source Options

| Option | Description |
|--------|-------------|
| `--name` | Unique name for this source (required) |
| `--type` | `github-public`, `github-private`, or `local-folder` (required) |
| `--repo` | GitHub repository URL |
| `--subfolder` | Only index a subfolder within the repo |
| `--branch` | Git branch (default: `main` — use `trunk` for WordPress/Gutenberg repos) |
| `--token-env` | Environment variable name holding a GitHub token (private repos) |
| `--path` | Local folder path |
| `--no-index` | Register the source without indexing it yet |

## CLI Reference

```
npx wp-blocks source:add        Add a source and index it
npx wp-blocks source:list       List all sources with indexed status
npx wp-blocks source:remove     Remove a source and all its data
npx wp-blocks index             Re-index all sources (or --source <name>)
npx wp-blocks search <query>    Full-text search across blocks
npx wp-blocks validate <markup> Validate block markup against save() function
npx wp-blocks stats             Show block counts and validation coverage per source
npx wp-blocks rebuild-index     Rebuild full-text search indexes
```

### CLI Examples

```bash
# Search for image-related blocks
npx wp-blocks search "image gallery"

# Search only blocks from a specific source
npx wp-blocks search "product" --source woocommerce-blocks

# Validate a block markup string
npx wp-blocks validate '<!-- wp:paragraph {"align":"center"} --><p class="has-text-align-center">Hello</p><!-- /wp:paragraph -->'

# Get full schema for a specific block
npx wp-blocks search "core/heading" --exact

# Re-index a specific source after updates
npx wp-blocks index --source gutenberg

# Force full re-index (ignore content hash cache)
npx wp-blocks index --force

# See what you have indexed
npx wp-blocks stats
```

## MCP Tools

When connected to Claude Code (or any MCP-compatible client), six tools are available:

### `search_blocks`

Full-text search with BM25 ranking across all indexed blocks. Search by name, title, description, or category. Supports filters for source, category, and block type (static/dynamic).

### `get_block_schema`

Returns the complete schema for a block: full attribute table with types and defaults, support configurations, variations, validation status, and block type. This is how the AI understands what a block accepts before generating markup.

### `get_block_markup`

Returns validated markup examples for a block, optionally filtered by features used (color, typography, spacing, alignment). Every returned example has been validated against the block's actual `save()` function — if it's in the database, it won't trigger "Attempt Block Recovery".

### `validate_markup`

Accepts raw block markup and validates it at multiple levels:
- **Structural** — correct comment delimiter format, valid JSON attributes
- **Schema** — attribute names and types match the block's registered schema
- **Save function** — for static blocks, re-runs `save()` and compares output

Returns `VALID`, `INVALID` with specific errors, or `ATTRIBUTES_ONLY` for dynamic blocks where only the comment delimiter can be validated.

### `list_block_attributes`

Returns all attributes for a block with their types, defaults, allowed values, sources, and selectors. Useful when the AI needs to construct specific attribute combinations.

### `search_variations`

Searches block variations by name or description. Returns matching variations with their pre-configured attributes and validated markup.

## How It Works

### Extraction Pipeline

1. **Sources** are registered via the CLI — each points to a GitHub repo or local folder
2. **Block discovery** scans for `block.json` files recursively throughout the source
3. **Parsing** runs four analyzers per block:
   - `block-json-parser` — metadata, attributes, supports, context
   - `edit-parser` — Babel AST analysis for UI controls and attribute mappings
   - `save-parser` — Babel AST analysis for HTML output patterns, class names, styles
   - `variations-parser` — pre-configured block variations
4. **Classification** determines block type:
   - **Static** — has `save()` returning JSX (full validation possible)
   - **Dynamic** — `save()` returns null, rendered by PHP (attribute validation only)
   - **Hybrid** — has both `save()` JSX and `render.php`
5. **Markup generation** creates examples for each block with different feature combinations

### Validation Pipeline

Generated markup goes through tiered validation:

**Tier 1 — Structural (all blocks)**
Uses `@wordpress/block-serialization-default-parser`:
- Parses the comment delimiter format
- Verifies attribute JSON is valid
- Checks attribute keys exist in the block schema
- Checks attribute value types match the schema

**Tier 2 — Save function (static blocks only)**
Uses `@wordpress/blocks` + `@wordpress/block-library` in Node.js with `browser-env`:
- Registers the block's `save()` function
- Parses the generated markup to extract `{ blockName, attrs, innerHTML }`
- Re-runs `save(attrs)` and renders to static HTML
- Compares the output against the stored innerHTML
- **This is the same validation the block editor performs internally** — if it passes here, it will not trigger "Attempt Block Recovery" in the editor

**Tier 3 — Dynamic blocks**
- Validates the comment delimiter + attributes only
- Stores the self-closing format: `<!-- wp:namespace/block-name {"attrs":"here"} /-->`
- Marks as `validation_status: 'attributes_only'` — WordPress accepts this format via REST API and renders the HTML server-side via PHP

Only markup that passes validation is stored in the database. The confidence score reflects extraction quality; the validation status reflects markup correctness.

### Incremental Updates

- `git pull` on cached repos (or re-read local folders)
- Content hash per block directory — skip unchanged blocks
- Re-extract and re-validate only changed blocks
- Soft-delete blocks whose `block.json` was removed

### Data Storage

All data lives in `~/.wp-blockmarkup-mcp/`:

```
~/.wp-blockmarkup-mcp/
  blocks.db           # SQLite database (FTS5, WAL mode)
  cache/              # Cloned repositories
```

### Database Schema

```sql
sources         — registered repos/folders with indexing metadata
blocks          — block metadata, type, validation status, confidence
attributes      — per-block attributes with types, defaults, constraints
supports        — per-block feature support configurations
markup_examples — validated markup examples with features used
variations      — block variations with attributes and markup
blocks_fts      — FTS5 full-text search index
```

## Dynamic Blocks

Dynamic blocks (Latest Posts, Search, Categories, etc.) have their `save()` function return `null` — the HTML output is rendered server-side by PHP based on the current data and theme.

For these blocks, wp-blockmarkup-mcp:
- Extracts the full attribute schema from `block.json`
- Validates attribute types and constraints
- Stores the **comment-only self-closing markup format**: `<!-- wp:latest-posts {"postsToShow":5} /-->`
- Marks them as `validation_status: 'attributes_only'`

This format is valid and accepted by the WordPress REST API. WordPress will render the visual HTML server-side when the post is displayed. The AI can use this markup to insert dynamic blocks with correct attributes — the visual output just depends on the server environment.

## Companion Tool: wp-devdocs-mcp

This project is part of the [PluginsLab](https://github.com/pluginslab) ecosystem alongside [wp-devdocs-mcp](https://github.com/pluginslab/wp-devdocs-mcp), which indexes WordPress hooks, filters, and JS APIs for AI-assisted **code** development.

Together they cover both sides of WordPress AI assistance:
- **wp-devdocs-mcp** — verified hooks for writing plugin/theme **code**
- **wp-blockmarkup-mcp** — verified block schemas for generating **content**

Same source registration workflow. Same MCP integration. Complementary tools for the same AI assistant.

## Requirements

- Node.js 20+
- ~500MB disk space per large plugin source (Gutenberg, WooCommerce)

## License

MIT
