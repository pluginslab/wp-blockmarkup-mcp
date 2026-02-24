/**
 * Parser for save.js files — Babel AST analysis
 *
 * Extracts:
 *   - HTML wrapper elements
 *   - Class naming patterns (static, dynamic, conditional via clsx)
 *   - Style patterns (inline CSS from attributes)
 *   - InnerBlocks usage
 *   - useBlockProps.save() spread patterns
 *   - Attribute references in JSX
 *
 * Also determines block type:
 *   - save() returns JSX → static block
 *   - save() returns null → dynamic block
 *   - save() + render.php exists → hybrid block
 *
 * Based on: gutenberg-block-extractor/src/parsers/save-parser.js
 */

// TODO: Port from gutenberg-block-extractor
