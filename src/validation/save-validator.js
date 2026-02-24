/**
 * Tier 2 — Save function validation (static blocks only)
 *
 * Validates that generated markup matches the patterns expected by the block's
 * save() function. This works by analyzing the save parser output (AST patterns)
 * against the generated markup, without needing the full WordPress block editor
 * runtime.
 *
 * Checks:
 *   - Wrapper element matches save() output (div, p, figure, etc.)
 *   - Required CSS classes are present (wp-block-*, feature classes)
 *   - useBlockProps.save() spread patterns result in correct class structure
 *   - InnerBlocks.Content usage matches nested block presence
 *   - Style attribute patterns match supported features
 *   - Comment delimiter attributes match HTML attribute rendering
 *
 * For core blocks, we know the exact patterns. For third-party blocks,
 * we validate what we can from the AST analysis.
 *
 * Returns: { valid: boolean, status: 'verified'|'unverified', issues: string[], details: string[] }
 */
import { parse as wpParse } from '@wordpress/block-serialization-default-parser';

/**
 * Validate markup against save function patterns.
 * @param {string} markup - Generated block markup
 * @param {object} blockSchema - Full block schema from DB (with attributes, supports)
 * @param {object} saveData - Save parser output (from parseSaveFile)
 * @returns {object}
 */
export function validateSaveOutput(markup, blockSchema, saveData) {
  const issues = [];
  const details = [];

  if (!saveData || !saveData.hasCustomSave) {
    return {
      valid: true,
      status: 'attributes_only',
      issues: [],
      details: ['Dynamic block — save function returns null, only attribute validation applies'],
    };
  }

  // Parse the markup to extract innerHTML
  let parsedBlocks;
  try {
    parsedBlocks = wpParse(markup);
  } catch {
    return {
      valid: false,
      status: 'unverified',
      issues: ['Failed to parse markup for save validation'],
      details: [],
    };
  }

  const block = parsedBlocks.find(b => b.blockName !== null);
  if (!block) {
    return {
      valid: false,
      status: 'unverified',
      issues: ['No block found in parsed markup'],
      details: [],
    };
  }

  const innerHTML = block.innerHTML.trim();

  // 1. Validate wrapper element
  if (saveData.wrapperElement) {
    const wrapperRegex = new RegExp(`^<${saveData.wrapperElement}[\\s>]`);
    if (innerHTML && !wrapperRegex.test(innerHTML)) {
      // Extract actual wrapper
      const actualMatch = innerHTML.match(/^<(\w+)/);
      const actual = actualMatch ? actualMatch[1] : 'unknown';
      issues.push(
        `Expected wrapper <${saveData.wrapperElement}> but found <${actual}>`
      );
    } else {
      details.push(`Wrapper element <${saveData.wrapperElement}> matches`);
    }
  }

  // 2. Validate CSS class structure
  const blockName = blockSchema.block_name;
  const expectedBlockClass = `wp-block-${blockName.replace(/^core\//, '').replace(/\//g, '-')}`;

  if (innerHTML && innerHTML.includes('class=')) {
    const classMatch = innerHTML.match(/class="([^"]*)"/);
    if (classMatch) {
      const classes = classMatch[1].split(/\s+/);

      // Check wp-block-* class
      if (!classes.includes(expectedBlockClass)) {
        // Some blocks don't use the standard class pattern (e.g., core/paragraph uses just <p>)
        const isSimpleElement = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code'].includes(saveData.wrapperElement);
        if (!isSimpleElement) {
          issues.push(
            `Expected CSS class "${expectedBlockClass}" not found. Present classes: ${classes.join(', ')}`
          );
        } else {
          details.push(`Simple element <${saveData.wrapperElement}> — block class optional`);
        }
      } else {
        details.push(`Block class "${expectedBlockClass}" present`);
      }

      // Check color feature classes
      if (block.attrs) {
        if (block.attrs.backgroundColor) {
          const bgClass = `has-${block.attrs.backgroundColor}-background-color`;
          if (!classes.includes(bgClass)) {
            issues.push(`Background color attribute "${block.attrs.backgroundColor}" set but class "${bgClass}" not in HTML`);
          }
          if (!classes.includes('has-background')) {
            issues.push('Background color set but "has-background" class missing');
          }
        }
        if (block.attrs.textColor) {
          const textClass = `has-${block.attrs.textColor}-color`;
          if (!classes.includes(textClass)) {
            issues.push(`Text color attribute "${block.attrs.textColor}" set but class "${textClass}" not in HTML`);
          }
          if (!classes.includes('has-text-color')) {
            issues.push('Text color set but "has-text-color" class missing');
          }
        }
        if (block.attrs.fontSize) {
          const fontClass = `has-${block.attrs.fontSize}-font-size`;
          if (!classes.includes(fontClass)) {
            issues.push(`Font size attribute "${block.attrs.fontSize}" set but class "${fontClass}" not in HTML`);
          }
        }
        if (block.attrs.align) {
          const alignClass = `has-text-align-${block.attrs.align}`;
          const alignClass2 = `align${block.attrs.align}`;
          if (!classes.includes(alignClass) && !classes.includes(alignClass2)) {
            issues.push(`Align attribute "${block.attrs.align}" set but neither "${alignClass}" nor "${alignClass2}" found in classes`);
          }
        }
      }
    }
  }

  // 3. Validate InnerBlocks usage
  if (saveData.usesInnerBlocks) {
    // If save() uses InnerBlocks.Content, the markup should contain inner blocks or content placeholder
    if (block.innerBlocks.length === 0 && !block.innerHTML.includes('<!-- wp:')) {
      // InnerBlocks without actual inner blocks is OK for basic examples
      details.push('Save uses InnerBlocks.Content — basic example has no inner blocks');
    } else {
      details.push(`Save uses InnerBlocks.Content — ${block.innerBlocks.length} inner block(s) present`);
    }
  }

  // 4. Validate style attribute against spacing/typography
  if (block.attrs && block.attrs.style) {
    const styleMatch = innerHTML.match(/style="([^"]*)"/);
    if (styleMatch) {
      const styleStr = styleMatch[1];
      const style = block.attrs.style;

      // Check spacing
      if (style.spacing?.padding) {
        const paddingProps = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
        for (const prop of paddingProps) {
          if (!styleStr.includes(prop)) {
            // Check shorthand
            if (!styleStr.includes('padding:')) {
              issues.push(`Spacing padding set in attrs but "${prop}" not found in style attribute`);
              break; // Only report once for padding
            }
          }
        }
      }

      if (style.spacing?.margin) {
        const marginProps = ['margin-top', 'margin-bottom'];
        for (const prop of marginProps) {
          if (style.spacing.margin[prop.replace('margin-', '')] && !styleStr.includes(prop)) {
            if (!styleStr.includes('margin:')) {
              issues.push(`Spacing margin set in attrs but "${prop}" not found in style attribute`);
              break;
            }
          }
        }
      }

      // Check typography
      if (style.typography?.lineHeight && !styleStr.includes('line-height')) {
        issues.push('Typography lineHeight set in attrs but "line-height" not in style attribute');
      }

      details.push('Style attribute present and checked against attributes');
    } else if (block.attrs.style.spacing || block.attrs.style.typography) {
      issues.push('Style attributes set in comment but no style attribute found in HTML');
    }
  }

  // 5. Check closing delimiter presence
  if (!markup.includes(`<!-- /wp:${blockName}`)) {
    // Could be self-closing
    if (!markup.includes('/-->')) {
      issues.push('Missing closing block comment delimiter');
    }
  }

  const valid = issues.length === 0;
  return {
    valid,
    status: valid ? 'verified' : 'unverified',
    issues,
    details,
  };
}
