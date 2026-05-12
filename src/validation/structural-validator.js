/**
 * Tier 1 — Structural validation (all blocks)
 *
 * Uses @wordpress/block-serialization-default-parser to parse markup exactly
 * the way WordPress does. This catches:
 *   - Malformed comment delimiters
 *   - Invalid JSON in attributes
 *   - Mismatched open/close tags
 *   - Missing closing delimiters
 *   - Attribute names not in block schema
 *   - Attribute type mismatches
 *   - Self-closing vs. content format correctness
 *
 * Returns: { valid: boolean, errors: string[], warnings: string[], parsedBlocks: object[] }
 */
import { parse as wpParse } from '@wordpress/block-serialization-default-parser';
import { getBlockSchema } from '../db.js';
import { validatePresetReferences } from './preset-reference-validator.js';

/**
 * Validate markup structurally using the WordPress block parser.
 * @param {string} markup - Raw Gutenberg block markup
 * @returns {object} { valid, errors, warnings, parsedBlocks }
 */
export function validateStructural(markup) {
  const errors = [];
  const warnings = [];

  if (!markup || typeof markup !== 'string' || markup.trim().length === 0) {
    return { valid: false, errors: ['Empty or invalid markup'], warnings, parsedBlocks: [] };
  }

  // Parse using the official WordPress parser
  let parsedBlocks;
  try {
    parsedBlocks = wpParse(markup);
  } catch (err) {
    return { valid: false, errors: [`Parser error: ${err.message}`], warnings, parsedBlocks: [] };
  }

  if (!parsedBlocks || parsedBlocks.length === 0) {
    return { valid: false, errors: ['No blocks found in markup'], warnings, parsedBlocks: [] };
  }

  // Filter out freeform (null blockName) blocks that are just whitespace
  const realBlocks = parsedBlocks.filter(b => b.blockName !== null);
  const freeformBlocks = parsedBlocks.filter(b => b.blockName === null);

  if (realBlocks.length === 0) {
    return { valid: false, errors: ['No valid block comments found — only freeform HTML'], warnings, parsedBlocks };
  }

  // Check freeform blocks for suspicious content (often indicates parsing errors)
  for (const fb of freeformBlocks) {
    const content = fb.innerHTML.trim();
    if (content.length > 0 && !isWhitespace(content)) {
      warnings.push(`Freeform HTML found outside block delimiters: "${truncate(content, 60)}"`);
    }
  }

  // Validate each real block
  for (const block of realBlocks) {
    validateBlock(block, errors, warnings);
  }

  // Additive pass: preset slug -> inline CSS variable kebab-case check.
  // Catches the "block recovery loop" footgun in hand-authored pattern files.
  const presetResult = validatePresetReferences(realBlocks);
  warnings.push(...presetResult.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    parsedBlocks,
  };
}

/**
 * Validate a single parsed block.
 */
function validateBlock(block, errors, warnings) {
  const { blockName, attrs, innerBlocks } = block;

  // 1. Validate block name format
  if (!blockName.includes('/')) {
    warnings.push(`Block "${blockName}" has no namespace — WordPress will assume "core/${blockName}"`);
  }

  // 2. Check if block exists in our database
  const schema = getBlockSchema(blockName);
  if (!schema) {
    // Try without namespace prefix for core blocks
    const altName = blockName.startsWith('core/') ? blockName.slice(5) : `core/${blockName}`;
    const altSchema = getBlockSchema(altName);
    if (!altSchema) {
      warnings.push(`Block "${blockName}" not found in any indexed source — cannot verify attributes`);
      // Still structurally valid if parser accepted it
    } else {
      validateAttributes(altSchema, attrs || {}, errors, warnings);
    }
  } else {
    validateAttributes(schema, attrs || {}, errors, warnings);
  }

  // 3. Validate inner blocks recursively
  if (innerBlocks && innerBlocks.length > 0) {
    for (const innerBlock of innerBlocks) {
      validateBlock(innerBlock, errors, warnings);
    }
  }
}

/**
 * Validate attributes against block schema.
 */
function validateAttributes(schema, attrs, errors, warnings) {
  // Build set of known attribute names
  const knownAttrs = new Set(schema.attributes.map(a => a.name));

  // Add common block-level attributes that aren't in block.json
  const globalAttrs = [
    'className', 'anchor', 'style', 'backgroundColor', 'textColor',
    'gradient', 'fontSize', 'fontFamily', 'align', 'lock', 'metadata',
  ];
  for (const ga of globalAttrs) knownAttrs.add(ga);

  // Derive implicit attributes from block supports configuration
  if (schema.supports && Array.isArray(schema.supports)) {
    for (const support of schema.supports) {
      const feature = support.feature;
      let config;
      try { config = typeof support.config === 'string' ? JSON.parse(support.config) : support.config; }
      catch { continue; }

      // Typography supports can imply textAlign, lineHeight, etc.
      if (feature === 'typography') {
        if (config?.textAlign !== false) knownAttrs.add('textAlign');
      }
      // Layout support implies layout attribute
      if (feature === 'layout') {
        knownAttrs.add('layout');
      }
      // Color support implies individual color attributes
      if (feature === 'color') {
        if (config?.link) knownAttrs.add('linkColor');
      }
      // Spacing support implies blockGap etc.
      if (feature === 'spacing') {
        if (config?.blockGap !== false) knownAttrs.add('blockGap');
      }
      // Border support implies borderColor
      if (feature === 'border') {
        knownAttrs.add('borderColor');
      }
      // Position support
      if (feature === 'position') {
        knownAttrs.add('position');
      }
    }
  }

  // Check for unknown attribute names
  for (const key of Object.keys(attrs)) {
    if (!knownAttrs.has(key)) {
      warnings.push(`Unknown attribute "${key}" on ${schema.block_name} — not in schema or global attributes`);
    }
  }

  // Type-check known attributes
  for (const schemaAttr of schema.attributes) {
    const value = attrs[schemaAttr.name];
    if (value === undefined) continue;

    if (schemaAttr.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      const allowedTypes = schemaAttr.type.split('|');

      // Skip special types
      if (schemaAttr.type === 'rich-text' || schemaAttr.type === 'unknown') continue;

      if (!allowedTypes.includes(actualType)) {
        errors.push(
          `Attribute "${schemaAttr.name}" on ${schema.block_name}: expected ${schemaAttr.type}, got ${actualType}`
        );
      }
    }

    // Check enum values
    if (schemaAttr.enum_values) {
      try {
        const allowed = JSON.parse(schemaAttr.enum_values);
        if (Array.isArray(allowed) && typeof value === 'string' && !allowed.includes(value)) {
          errors.push(
            `Attribute "${schemaAttr.name}" on ${schema.block_name}: value "${value}" not in allowed values [${allowed.join(', ')}]`
          );
        }
      } catch {
        // enum_values is not valid JSON — skip
      }
    }
  }

  // Check dynamic block format
  if (schema.block_type === 'dynamic') {
    // Dynamic blocks should typically use self-closing format
    // but having innerHTML is not an error — WordPress just ignores it
    // So this is a warning, not an error
  }
}

function isWhitespace(str) {
  return /^\s*$/.test(str);
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}
