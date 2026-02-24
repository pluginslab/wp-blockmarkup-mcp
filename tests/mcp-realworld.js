#!/usr/bin/env node

/**
 * MCP Real-World Effectiveness Test — WooCommerce Focus
 *
 * 5 content generation challenges using WooCommerce blocks that models
 * are unlikely to know from training data. Tests block name correctness,
 * attribute accuracy, and dynamic/static format awareness.
 *
 * Requires: ANTHROPIC_API_KEY in .env
 * Requires: Gutenberg + WooCommerce sources indexed
 *
 * Run: node tests/mcp-realworld.js
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  searchBlocks,
  getBlockSchema,
  getBlockMarkup,
  listBlockAttributes,
  searchVariations,
  closeDb,
} from '../src/db.js';
import { validateStructural } from '../src/validation/structural-validator.js';

const client = new Anthropic();
const MODEL = 'claude-sonnet-4-20250514';

// --- Tool definitions (Anthropic format) ---
const tools = [
  {
    name: 'search_blocks',
    description: 'Search indexed WordPress blocks (Gutenberg core + WooCommerce) using full-text search. Returns block metadata, type (static/dynamic), and validation status.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — block name, title, description, or category keyword' },
        source: { type: 'string', description: 'Filter by source name (e.g. "gutenberg", "woocommerce")' },
        category: { type: 'string', description: 'Filter by block category' },
        block_type: { type: 'string', enum: ['static', 'dynamic', 'hybrid'], description: 'Filter by block type' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_block_schema',
    description: 'Get the complete schema for a block: all attributes with types/defaults, support configurations, variations, and validation status.',
    input_schema: {
      type: 'object',
      properties: {
        block_name: { type: 'string', description: 'Full block name (e.g. "woocommerce/featured-product", "core/paragraph")' },
      },
      required: ['block_name'],
    },
  },
  {
    name: 'get_block_markup',
    description: 'Get validated markup examples for a block. Every returned example has been validated against the block\'s actual source.',
    input_schema: {
      type: 'object',
      properties: {
        block_name: { type: 'string', description: 'Full block name (e.g. "woocommerce/mini-cart")' },
        features: { type: 'array', items: { type: 'string' }, description: 'Filter by features: color, typography, spacing, align' },
        validated_only: { type: 'boolean', description: 'Only return verified examples' },
      },
      required: ['block_name'],
    },
  },
  {
    name: 'validate_markup',
    description: 'Validate raw Gutenberg block markup structurally. Checks comment delimiters, JSON attributes, block name existence, and attribute types.',
    input_schema: {
      type: 'object',
      properties: {
        markup: { type: 'string', description: 'Raw Gutenberg block markup to validate' },
      },
      required: ['markup'],
    },
  },
  {
    name: 'list_block_attributes',
    description: 'List all attributes for a block with types, defaults, allowed values, sources, and selectors.',
    input_schema: {
      type: 'object',
      properties: {
        block_name: { type: 'string', description: 'Full block name (e.g. "woocommerce/product-image")' },
      },
      required: ['block_name'],
    },
  },
  {
    name: 'search_variations',
    description: 'Search block variations by name or description. Returns variations with pre-configured attributes.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
];

// --- Execute tool call against real DB ---
function executeTool(name, input) {
  switch (name) {
    case 'search_blocks': {
      const results = searchBlocks(input.query, {
        source: input.source, category: input.category,
        blockType: input.block_type, limit: input.limit || 10,
      });
      return JSON.stringify(results.map(r => ({
        block_name: r.block_name, title: r.title, category: r.category,
        block_type: r.block_type, validation_status: r.validation_status,
        confidence: r.confidence, source: r.source_name,
        description: r.description,
      })));
    }
    case 'get_block_schema': {
      const schema = getBlockSchema(input.block_name);
      if (!schema) return JSON.stringify({ error: `Block "${input.block_name}" not found` });
      return JSON.stringify({
        block_name: schema.block_name, title: schema.title, category: schema.category,
        block_type: schema.block_type, validation_status: schema.validation_status,
        attributes: schema.attributes.map(a => ({
          name: a.name, type: a.type, default: a.default_val, enum: a.enum_values,
        })),
        supports: schema.supports.map(s => ({ feature: s.feature, config: s.config })),
        variations: schema.variations.map(v => ({ name: v.name, title: v.title })),
      });
    }
    case 'get_block_markup': {
      const examples = getBlockMarkup(input.block_name, {
        features: input.features, validatedOnly: input.validated_only,
      });
      return JSON.stringify(examples.map(e => ({
        title: e.title, markup: e.markup,
        validation_status: e.validation_status,
        features_used: e.features_used ? JSON.parse(e.features_used) : [],
      })));
    }
    case 'validate_markup': {
      const result = validateStructural(input.markup);
      return JSON.stringify({
        valid: result.valid, errors: result.errors, warnings: result.warnings,
        blocks: result.parsedBlocks.filter(b => b.blockName).map(b => b.blockName),
      });
    }
    case 'list_block_attributes': {
      const attrs = listBlockAttributes(input.block_name);
      return JSON.stringify(attrs.map(a => ({
        name: a.name, type: a.type, default: a.default_val,
        source: a.source, selector: a.selector, enum: a.enum_values,
      })));
    }
    case 'search_variations': {
      const results = searchVariations(input.query, { limit: input.limit || 10 });
      return JSON.stringify(results.map(v => ({
        name: v.name, title: v.title, block_name: v.block_name,
        description: v.description, attributes: v.attributes,
      })));
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// --- Send challenge to Claude ---
async function askClaude(challenge, useTools) {
  const messages = [{ role: 'user', content: challenge }];
  const systemPrompt = useTools
    ? 'You are a senior WordPress/WooCommerce content engineer. Both Gutenberg core blocks and WooCommerce blocks are indexed and available via the provided tools. ALWAYS use search_blocks to find the correct block name and get_block_schema to verify exact attribute names before generating markup. Do NOT guess WooCommerce block names or attribute names — they are often non-obvious. Output raw Gutenberg block markup (HTML with block comment delimiters).'
    : 'You are a senior WordPress/WooCommerce content engineer. Output raw Gutenberg block markup (HTML with block comment delimiters). Be precise with block names, attributes, and CSS class patterns. WooCommerce blocks use the "woocommerce/" namespace.';

  let response = await client.messages.create({
    model: MODEL, max_tokens: 4096, system: systemPrompt,
    messages, ...(useTools ? { tools } : {}),
  });

  let toolCallCount = 0;
  const toolsUsed = [];

  while (response.stop_reason === 'tool_use') {
    const assistantContent = response.content;
    const toolResults = [];

    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        toolCallCount++;
        toolsUsed.push(`${block.name}(${JSON.stringify(block.input).slice(0, 60)}...)`);
        const result = executeTool(block.name, block.input);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }
    }

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: MODEL, max_tokens: 4096, system: systemPrompt,
      messages, tools,
    });
  }

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return { text, toolCallCount, toolsUsed };
}

// --- Validate generated markup against ground truth ---
function validateOutput(output, checks) {
  const results = { correct: [], missing: [], hallucinated: [], patternOk: [], patternFail: [] };

  // Extract actual block names from markup for precise matching
  const blockNames = extractBlockNames(output);

  for (const pattern of checks.requiredMarkup || []) {
    if (output.includes(pattern)) results.correct.push(pattern);
    else results.missing.push(pattern);
  }

  for (const alt of checks.acceptAlternatives || []) {
    const found = alt.patterns.find(p => output.includes(p));
    if (found) results.correct.push(`${alt.label}: ${found}`);
    else results.missing.push(`${alt.label}: none of [${alt.patterns.join(', ')}]`);
  }

  // Use extracted block names for wrongMarkup to avoid substring false positives
  // e.g. "wp:woocommerce/cart-items" shouldn't match "wp:woocommerce/cart-items-block"
  for (const pattern of checks.wrongMarkup || []) {
    const wrongName = pattern.replace('wp:', '');
    if (blockNames.includes(wrongName)) results.hallucinated.push(pattern);
  }

  for (const p of checks.requiredPatterns || []) {
    if (output.match(new RegExp(p, 's'))) results.patternOk.push(p.slice(0, 60));
    else results.patternFail.push(p.slice(0, 60));
  }

  return results;
}

// ==========================================================
// 5 WooCommerce Real-World Challenges
// ==========================================================
const challenges = [
  {
    name: '1. WooCommerce Featured Product showcase',
    prompt: `Generate Gutenberg block markup for a WooCommerce featured product section:
- Display product ID 42 as a hero-style featured product block
- Use a background image (URL: https://example.com/product-bg.jpg, media ID: 100)
- Center the content alignment
- Dim the background overlay to 60%
- Set the overlay color to black
- The call-to-action button text should say "Buy Now" (not the default)
- Set minimum height to 400px
- Use "cover" image fit so the image fills the container

This should use the WooCommerce featured product block, not a generic Group or Cover block. Output only the raw Gutenberg block markup with the correct block name and JSON attributes in the block comment.`,
    checks: {
      requiredMarkup: [
        'wp:woocommerce/featured-product',
      ],
      wrongMarkup: [
        'wp:woocommerce/product-hero',      // doesn't exist
        'wp:woocommerce/product-banner',     // doesn't exist
        'wp:woocommerce/product-showcase',   // doesn't exist
        'wp:featured-product',               // missing woocommerce/ namespace
        'wp:woocommerce/product ',           // too generic — not a block
      ],
      requiredPatterns: [
        '"productId":42|"productId": 42',
        '"dimRatio":60|"dimRatio": 60',
        '"contentAlign":"center"|"contentAlign": "center"',
        '"linkText":"Buy Now"|"linkText": "Buy Now"',
        '"minHeight":400|"minHeight": 400',
        '"imageFit":"cover"|"imageFit": "cover"',
      ],
    },
  },
  {
    name: '2. WooCommerce Mini Cart with custom configuration',
    prompt: `Generate Gutenberg block markup for a WooCommerce mini shopping cart widget to place in the site header:
- Hide the price display next to the cart icon
- Use the "bag" icon style for the cart (not the default cart icon)
- The product count indicator should always be visible (not hidden on empty)
- Set the cart icon color to a custom value: #1a1a2e
- Set the price text color to a custom value: #e94560

This should use the WooCommerce mini cart block. Output only the raw block markup with all attributes in the JSON block comment. This is a dynamic block — it should use self-closing format.`,
    checks: {
      requiredMarkup: [
        'wp:woocommerce/mini-cart',
      ],
      wrongMarkup: [
        'wp:woocommerce/cart-icon',          // doesn't exist
        'wp:woocommerce/shopping-cart',       // doesn't exist
        'wp:woocommerce/cart-widget',         // doesn't exist
        'wp:woocommerce/mini-basket',         // doesn't exist
        'wp:mini-cart',                        // missing namespace
      ],
      requiredPatterns: [
        '"hasHiddenPrice":true|"hasHiddenPrice": true',
        '"miniCartIcon":"bag"|"miniCartIcon": "bag"',
        '"iconColorValue":"#1a1a2e"|"iconColorValue": "#1a1a2e"',
        '"priceColorValue":"#e94560"|"priceColorValue": "#e94560"',
        '/-->',  // self-closing format for dynamic block
      ],
    },
  },
  {
    name: '3. WooCommerce Product Image with sale badge',
    prompt: `Generate Gutenberg block markup for a WooCommerce product image display:
- Show the product image for product ID 99
- Display the sale badge
- Align the sale badge to the left (not the default position)
- Make the image link to the product page
- Set a 4:3 aspect ratio
- Use "cover" as the image scale mode

This should use the WooCommerce product image block (not the core image block). Output only the raw block markup with correct attribute names in the JSON block comment. This block is dynamic — use self-closing format.`,
    checks: {
      requiredMarkup: [
        'wp:woocommerce/product-image',
      ],
      wrongMarkup: [
        'wp:woocommerce/product-photo',      // doesn't exist
        'wp:woocommerce/product-thumbnail',   // doesn't exist
        'wp:woocommerce/product-img',         // doesn't exist
        'wp:image',                            // wrong block entirely
      ],
      requiredPatterns: [
        '"productId":99|"productId": 99',
        '"showSaleBadge":true|"showSaleBadge": true',
        '"saleBadgeAlign":"left"|"saleBadgeAlign": "left"',
        '"showProductLink":true|"showProductLink": true',
        '"aspectRatio":"4:3"|"aspectRatio": "4:3"|"aspectRatio":"4/3"',
        '"scale":"cover"|"scale": "cover"',
        '/-->',  // self-closing
      ],
    },
  },
  {
    name: '4. WooCommerce Product Gallery with zoom and fullscreen',
    prompt: `Generate Gutenberg block markup for a WooCommerce product image gallery on a single product page:
- Enable hover zoom on gallery images
- Enable fullscreen on click
- Wrap the gallery in a Group block with wide alignment

Use the WooCommerce product gallery block. Output only the raw block markup. The gallery block is dynamic — use self-closing format.`,
    checks: {
      requiredMarkup: [
        'wp:woocommerce/product-gallery',
      ],
      acceptAlternatives: [
        {
          label: 'Wrapper group',
          patterns: ['wp:group'],
        },
      ],
      wrongMarkup: [
        'wp:woocommerce/gallery',             // doesn't exist
        'wp:woocommerce/product-images',       // doesn't exist
        'wp:woocommerce/image-gallery',        // doesn't exist
        'wp:gallery',                          // wrong — that's core gallery
      ],
      requiredPatterns: [
        '"hoverZoom":true|"hoverZoom": true',
        '"fullScreenOnClick":true|"fullScreenOnClick": true',
      ],
    },
  },
  {
    name: '5. WooCommerce Product page: price, rating, and SKU',
    prompt: `Generate Gutenberg block markup for a WooCommerce single product detail section containing:
1. A Group block as wrapper
2. The product price display block
3. The product star rating block (use the stars variant, not the counter)
4. The product SKU display block

All product blocks should be for product ID 55. These are WooCommerce blocks that render server-side — use self-closing format for each. Output only the raw block markup.`,
    checks: {
      requiredMarkup: [
        'wp:woocommerce/product-price',
      ],
      acceptAlternatives: [
        {
          label: 'Rating block',
          patterns: ['wp:woocommerce/product-rating-stars', 'wp:woocommerce/product-rating'],
        },
        {
          label: 'SKU block',
          patterns: ['wp:woocommerce/product-sku'],
        },
        {
          label: 'Group wrapper',
          patterns: ['wp:group'],
        },
      ],
      wrongMarkup: [
        'wp:woocommerce/price',               // doesn't exist — missing "product-"
        'wp:woocommerce/rating',              // doesn't exist — missing "product-"
        'wp:woocommerce/sku',                 // doesn't exist — missing "product-"
        'wp:woocommerce/product-stars',        // doesn't exist
        'wp:woocommerce/star-rating',          // doesn't exist
      ],
      requiredPatterns: [
        'woocommerce/product-price',
        'woocommerce/product-sku',
        '/-->',  // at least some self-closing blocks
      ],
    },
  },
];

// ==========================================================
// Main
// ==========================================================
function extractBlockNames(text) {
  const matches = text.match(/<!-- wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)/g) || [];
  const names = matches.map(m => m.replace('<!-- wp:', ''));
  return [...new Set(names)];
}

function printValidation(v) {
  if (v.correct.length) console.log(`\n  Correct:        ${v.correct.join(', ')}`);
  if (v.missing.length) console.log(`  Missing:        ${v.missing.join(', ')}`);
  if (v.hallucinated.length) console.log(`  HALLUCINATED:   ${v.hallucinated.join(', ')}`);
  if (v.patternOk.length) console.log(`  Patterns OK:    ${v.patternOk.join(', ')}`);
  if (v.patternFail.length) console.log(`  Patterns FAIL:  ${v.patternFail.join(', ')}`);
}

async function main() {
  console.log('='.repeat(70));
  console.log('  MCP REAL-WORLD EFFECTIVENESS TEST — WOOCOMMERCE BLOCKS');
  console.log('  Content generation: WITHOUT vs WITH tool access');
  console.log('='.repeat(70));

  const summary = {
    without: { correct: 0, missing: 0, hallucinated: 0, patternOk: 0, patternFail: 0 },
    with:    { correct: 0, missing: 0, hallucinated: 0, patternOk: 0, patternFail: 0 },
  };

  for (const c of challenges) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`${c.name}`);
    console.log(`${'─'.repeat(70)}`);

    // WITHOUT tools
    console.log('\nAsking WITHOUT tools...');
    const rWithout = await askClaude(c.prompt, false);
    const vWithout = validateOutput(rWithout.text, c.checks);

    console.log(`\n--- WITHOUT TOOLS ---`);
    const blocksWithout = extractBlockNames(rWithout.text);
    console.log(`Blocks used: ${blocksWithout.join(', ') || 'none found'}`);
    printValidation(vWithout);

    // WITH tools
    console.log('\nAsking WITH tools...');
    const rWith = await askClaude(c.prompt, true);
    const vWith = validateOutput(rWith.text, c.checks);

    console.log(`\n--- WITH TOOLS (${rWith.toolCallCount} tool calls) ---`);
    const blocksWith = extractBlockNames(rWith.text);
    console.log(`Blocks used: ${blocksWith.join(', ') || 'none found'}`);
    printValidation(vWith);

    if (rWith.toolsUsed.length > 0) {
      console.log(`\n  Tool calls:`);
      for (const t of rWith.toolsUsed) console.log(`    ${t}`);
    }

    summary.without.correct += vWithout.correct.length;
    summary.without.missing += vWithout.missing.length;
    summary.without.hallucinated += vWithout.hallucinated.length;
    summary.without.patternOk += vWithout.patternOk.length;
    summary.without.patternFail += vWithout.patternFail.length;
    summary.with.correct += vWith.correct.length;
    summary.with.missing += vWith.missing.length;
    summary.with.hallucinated += vWith.hallucinated.length;
    summary.with.patternOk += vWith.patternOk.length;
    summary.with.patternFail += vWith.patternFail.length;
  }

  // --- Summary ---
  console.log(`\n${'='.repeat(70)}`);
  console.log('  SUMMARY');
  console.log(`${'='.repeat(70)}`);
  console.log(`\n                  Markup OK   Missing    Hallucinated    Patterns`);
  console.log(`  WITHOUT tools:  ${String(summary.without.correct).padEnd(12)}${String(summary.without.missing).padEnd(11)}${String(summary.without.hallucinated).padEnd(16)}${summary.without.patternOk}/${summary.without.patternOk + summary.without.patternFail}`);
  console.log(`  WITH tools:     ${String(summary.with.correct).padEnd(12)}${String(summary.with.missing).padEnd(11)}${String(summary.with.hallucinated).padEnd(16)}${summary.with.patternOk}/${summary.with.patternOk + summary.with.patternFail}`);

  const markupDiff = summary.with.correct - summary.without.correct;
  const hallDiff = summary.without.hallucinated - summary.with.hallucinated;
  console.log(`\n  Delta:          ${markupDiff > 0 ? '+' : ''}${markupDiff} correct, ${hallDiff > 0 ? '-' : '+'}${Math.abs(hallDiff)} hallucinations`);
  console.log('');
}

try {
  await main();
} catch (err) {
  console.error(`Fatal error: ${err.message}`);
  if (err.message.includes('API key')) {
    console.error('Make sure ANTHROPIC_API_KEY is set in .env');
  }
  process.exit(1);
} finally {
  closeDb();
}
