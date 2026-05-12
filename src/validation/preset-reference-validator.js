/**
 * Preset reference validator — additive Tier 1 pass.
 *
 * Catches a specific Gutenberg "block recovery" footgun in hand-authored
 * pattern files: when a block attribute references a theme preset by slug
 * (e.g. var:preset|spacing|30x) but the inline style="" on the rendered
 * element uses the non-kebab CSS variable (--wp--preset--spacing--30x
 * instead of the canonical --wp--preset--spacing--30-x), WordPress flags the
 * block as invalid and prompts "Attempt block recovery" on every editor open.
 *
 * WordPress applies _wp_to_kebab_case() to slugs when expanding the
 * var:preset|... reference into a CSS variable. The transform inserts a
 * hyphen at three boundaries:
 *   - camelCase  (aB -> a-b)
 *   - digit->letter  (0a -> 0-a)   <-- the one that bites pattern authors
 *   - letter->digit  (a0 -> a-0)
 *
 * Emits warnings only; never fails validation.
 */

const PRESET_ATTR_REGEX = /^var:preset\|([a-z0-9-]+)\|(.+)$/;

/**
 * Mirror of WordPress core's _wp_to_kebab_case() from wp-includes/blocks.php.
 */
export function wpToKebabCase(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/([a-z0-9])([A-Z])|([0-9])([a-zA-Z])|([a-zA-Z])([0-9])/g, (_, a, b, c, d, e, f) => {
      return `${a || ''}${c || ''}${e || ''}-${b || ''}${d || ''}${f || ''}`;
    })
    .toLowerCase();
}

/**
 * Walk an attribute object, yielding every string leaf with its dotted path.
 */
function* walkStrings(value, path = []) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    yield { path: path.join('.'), value };
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* walkStrings(value[i], [...path, String(i)]);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      yield* walkStrings(value[key], [...path, key]);
    }
  }
}

/**
 * Collect preset references from a block's attrs.
 * @returns {Array<{path: string, group: string, slug: string}>}
 */
function collectPresetRefs(attrs) {
  const refs = [];
  for (const { path, value } of walkStrings(attrs)) {
    const m = value.match(PRESET_ATTR_REGEX);
    if (m) refs.push({ path, group: m[1], slug: m[2] });
  }
  return refs;
}

/**
 * Check a single block's innerHTML for a non-canonical CSS variable matching
 * a preset reference whose slug differs from its kebab form.
 */
function checkBlock(block, warnings) {
  const { blockName, attrs, innerHTML, innerBlocks } = block;
  if (blockName) {
    const refs = collectPresetRefs(attrs || {});
    for (const ref of refs) {
      const kebabSlug = wpToKebabCase(ref.slug);
      if (kebabSlug === ref.slug) continue; // No transform needed — nothing to mismatch.

      const canonicalVar = `--wp--preset--${ref.group}--${kebabSlug}`;
      const wrongVar = `--wp--preset--${ref.group}--${ref.slug}`;

      // Only flag if the wrong form actually appears in the rendered HTML.
      // Avoids false positives for dynamic blocks (no innerHTML) or blocks
      // where the preset is consumed via class rather than inline style.
      const html = innerHTML || '';
      if (html.includes(`var(${wrongVar})`)) {
        warnings.push(
          `Block "${blockName}" — attribute path "${ref.path}" references preset "${ref.group}.${ref.slug}" but inline style uses "${wrongVar}" instead of the canonical "${canonicalVar}". The editor will flag this as invalid on load.`
        );
      }
    }
  }

  if (innerBlocks && innerBlocks.length > 0) {
    for (const inner of innerBlocks) checkBlock(inner, warnings);
  }
}

/**
 * Run the preset-reference check across a parsed block tree.
 * @param {object[]} parsedBlocks - Output of @wordpress/block-serialization-default-parser
 * @returns {{ warnings: string[] }}
 */
export function validatePresetReferences(parsedBlocks) {
  const warnings = [];
  if (!Array.isArray(parsedBlocks)) return { warnings };
  for (const block of parsedBlocks) {
    if (block && block.blockName !== null) checkBlock(block, warnings);
  }
  return { warnings };
}
