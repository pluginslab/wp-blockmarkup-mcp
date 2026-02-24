/**
 * Validation pipeline — coordinates all validation tiers.
 *
 * For each block markup:
 *   1. Run structural validation (Tier 1) — always
 *   2. If block is static/hybrid, run save function validation (Tier 2)
 *   3. If block is dynamic, mark as 'attributes_only' (Tier 3)
 *
 * Assigns final validation_status:
 *   - 'verified'        — passed both Tier 1 and Tier 2
 *   - 'structural_only' — passed Tier 1 but Tier 2 found issues
 *   - 'attributes_only' — dynamic block, only comment delimiter validated
 *   - 'invalid'         — failed Tier 1
 */
import { validateStructural } from './structural-validator.js';
import { validateSaveOutput } from './save-validator.js';

/**
 * Run the full validation pipeline on a markup example.
 * @param {string} markup - Raw Gutenberg block markup
 * @param {object} blockSchema - Full block schema from DB (with attributes, supports, block_type)
 * @param {object} [saveData] - Save parser output (optional, for Tier 2)
 * @returns {object} { status, tier1, tier2, summary }
 */
export function validateMarkup(markup, blockSchema, saveData) {
  // Tier 1: Structural validation
  const tier1 = validateStructural(markup);

  if (!tier1.valid) {
    return {
      status: 'invalid',
      tier1,
      tier2: null,
      summary: `INVALID — ${tier1.errors.length} structural error(s): ${tier1.errors.join('; ')}`,
    };
  }

  // Dynamic blocks: skip Tier 2
  if (blockSchema.block_type === 'dynamic') {
    return {
      status: 'attributes_only',
      tier1,
      tier2: null,
      summary: `VALID (attributes only) — dynamic block, structural check passed${tier1.warnings.length > 0 ? ` with ${tier1.warnings.length} warning(s)` : ''}`,
    };
  }

  // Tier 2: Save function validation (static/hybrid only)
  if (saveData) {
    const tier2 = validateSaveOutput(markup, blockSchema, saveData);

    if (tier2.status === 'verified') {
      return {
        status: 'verified',
        tier1,
        tier2,
        summary: `VERIFIED — passed structural and save function validation${tier1.warnings.length > 0 ? ` (${tier1.warnings.length} warning(s))` : ''}`,
      };
    }

    return {
      status: 'structural_only',
      tier1,
      tier2,
      summary: `STRUCTURAL ONLY — passed Tier 1 but Tier 2 found ${tier2.issues.length} issue(s): ${tier2.issues.join('; ')}`,
    };
  }

  // No save data available — can only confirm structural validity
  return {
    status: 'structural_only',
    tier1,
    tier2: null,
    summary: `STRUCTURAL ONLY — passed structural validation (no save data for Tier 2)${tier1.warnings.length > 0 ? ` with ${tier1.warnings.length} warning(s)` : ''}`,
  };
}

/**
 * Validate all markup examples for a block and update their validation_status.
 * Called during indexing to upgrade unverified examples.
 * @param {object} blockSchema - Full block schema
 * @param {object[]} examples - Markup examples from DB
 * @param {object} [saveData] - Save parser output
 * @returns {object[]} Array of { id, status, summary }
 */
export function validateBlockExamples(blockSchema, examples, saveData) {
  const results = [];

  for (const example of examples) {
    const result = validateMarkup(example.markup, blockSchema, saveData);
    results.push({
      id: example.id,
      previousStatus: example.validation_status,
      newStatus: result.status,
      summary: result.summary,
      tier1Errors: result.tier1.errors,
      tier1Warnings: result.tier1.warnings,
      tier2Issues: result.tier2?.issues || [],
      tier2Details: result.tier2?.details || [],
    });
  }

  return results;
}
