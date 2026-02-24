/**
 * Parser for block.json files
 *
 * Extracts:
 *   - Block metadata (name, title, category, description, apiVersion)
 *   - Attributes with types, defaults, sources, selectors
 *   - Support configurations (align, color, typography, spacing, border, layout, etc.)
 *   - Context (provides/usesContext)
 *   - Parent/ancestor constraints
 *   - Allowed blocks (for InnerBlocks)
 *
 * Based on: gutenberg-block-extractor/src/parsers/block-json-parser.js
 */

// TODO: Port from gutenberg-block-extractor
