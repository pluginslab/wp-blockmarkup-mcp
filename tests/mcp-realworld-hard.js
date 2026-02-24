#!/usr/bin/env node

/**
 * MCP Real-World HARD Effectiveness Test — WooCommerce Focus
 *
 * 5 challenging WooCommerce content generation requests that maximise
 * hallucination risk. Uses complex nested inner-block structures,
 * non-obvious block names, and tricky attribute patterns that models
 * will almost certainly get wrong without tool access.
 *
 * Requires: ANTHROPIC_API_KEY in .env
 * Requires: Gutenberg + WooCommerce sources indexed
 *
 * Run: node tests/mcp-realworld-hard.js
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

const tools = [
  {
    name: 'search_blocks',
    description: 'Search indexed WordPress blocks (Gutenberg core + WooCommerce) using full-text search. Returns block metadata, type (static/dynamic), and validation status.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — block name, title, or keyword' },
        source: { type: 'string', description: 'Filter by source name (e.g. "woocommerce")' },
        category: { type: 'string' },
        block_type: { type: 'string', enum: ['static', 'dynamic', 'hybrid'] },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_block_schema',
    description: 'Get the complete schema for a block: all attributes with types/defaults, support configurations, variations, and validation status.',
    input_schema: {
      type: 'object',
      properties: { block_name: { type: 'string', description: 'Full block name (e.g. "woocommerce/checkout")' } },
      required: ['block_name'],
    },
  },
  {
    name: 'get_block_markup',
    description: 'Get validated markup examples for a block.',
    input_schema: {
      type: 'object',
      properties: {
        block_name: { type: 'string' },
        features: { type: 'array', items: { type: 'string' } },
        validated_only: { type: 'boolean' },
      },
      required: ['block_name'],
    },
  },
  {
    name: 'validate_markup',
    description: 'Validate raw Gutenberg block markup structurally.',
    input_schema: {
      type: 'object',
      properties: { markup: { type: 'string' } },
      required: ['markup'],
    },
  },
  {
    name: 'list_block_attributes',
    description: 'List all attributes for a block with types, defaults, and allowed values.',
    input_schema: {
      type: 'object',
      properties: { block_name: { type: 'string' } },
      required: ['block_name'],
    },
  },
  {
    name: 'search_variations',
    description: 'Search block variations by name or description.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
];

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
        confidence: r.confidence, source: r.source_name, description: r.description,
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

async function askClaude(challenge, useTools) {
  const messages = [{ role: 'user', content: challenge }];
  const systemPrompt = useTools
    ? 'You are a senior WordPress/WooCommerce content engineer. Both Gutenberg core blocks and WooCommerce blocks are indexed and available via the provided tools. ALWAYS use search_blocks to find the correct block name and get_block_schema to verify exact attribute names before generating markup. WooCommerce has many inner blocks with specific naming conventions — do NOT guess them. Output raw Gutenberg block markup (HTML with block comment delimiters).'
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
        toolsUsed.push(`${block.name}(${JSON.stringify(block.input).slice(0, 80)})`);
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

// ==========================================================
// 5 HARD WooCommerce Challenges
// ==========================================================
const challenges = [
  {
    name: '1. WooCommerce Checkout page with inner blocks',
    prompt: `Generate Gutenberg block markup for a complete WooCommerce checkout page. The checkout block should:
- Use wide alignment
- Show form step numbers

Inside the checkout block, include these inner blocks in order:
1. The shipping address form block
2. The billing address form block
3. The shipping methods selection block
4. The payment methods block
5. The order summary block
6. The place order button block

Each inner block is a separate WooCommerce block that lives inside the checkout container. Use the correct WooCommerce block names for each — they follow a specific naming pattern.

Output only the raw Gutenberg block markup.`,
    checks: {
      requiredMarkup: [
        'wp:woocommerce/checkout',
      ],
      acceptAlternatives: [
        {
          label: 'Shipping address inner block',
          patterns: ['wp:woocommerce/checkout-shipping-address-block'],
        },
        {
          label: 'Billing address inner block',
          patterns: ['wp:woocommerce/checkout-billing-address-block'],
        },
        {
          label: 'Shipping methods inner block',
          patterns: ['wp:woocommerce/checkout-shipping-methods-block', 'wp:woocommerce/checkout-shipping-method-block'],
        },
        {
          label: 'Payment inner block',
          patterns: ['wp:woocommerce/checkout-payment-block'],
        },
        {
          label: 'Order summary inner block',
          patterns: ['wp:woocommerce/checkout-order-summary-block'],
        },
      ],
      wrongMarkup: [
        'wp:woocommerce/shipping-address',    // wrong — missing checkout- prefix
        'wp:woocommerce/billing-address',     // wrong — missing checkout- prefix
        'wp:woocommerce/payment-methods',     // wrong name
        'wp:woocommerce/order-summary',       // wrong — missing checkout- prefix
        'wp:woocommerce/place-order',         // wrong name
      ],
      requiredPatterns: [
        '"showFormStepNumbers":true|"showFormStepNumbers": true',
        '"align":"wide"|"align": "wide"',
      ],
    },
  },
  {
    name: '2. WooCommerce Cart page with order summary breakdown',
    prompt: `Generate Gutenberg block markup for a WooCommerce shopping cart page. Include:
1. The main cart block
2. Inside the cart, include:
   - The cart items listing block
   - The cart order summary block, which itself contains:
     - The subtotal line block
     - The discount/coupon line block
     - The shipping cost line block
     - The taxes line block
     - The totals line block
     - The coupon form block

WooCommerce cart inner blocks follow a specific naming convention with "cart-" prefix and "-block" suffix. The order summary sub-blocks also follow a pattern.

Output only the raw Gutenberg block markup.`,
    checks: {
      requiredMarkup: [
        'wp:woocommerce/cart',
      ],
      acceptAlternatives: [
        {
          label: 'Cart items',
          patterns: ['wp:woocommerce/cart-items-block'],
        },
        {
          label: 'Order summary container',
          patterns: ['wp:woocommerce/cart-order-summary-block'],
        },
        {
          label: 'Subtotal line',
          patterns: ['wp:woocommerce/cart-order-summary-subtotal-block'],
        },
        {
          label: 'Shipping line',
          patterns: ['wp:woocommerce/cart-order-summary-shipping-block'],
        },
        {
          label: 'Taxes line',
          patterns: ['wp:woocommerce/cart-order-summary-taxes-block'],
        },
        {
          label: 'Coupon form',
          patterns: ['wp:woocommerce/cart-order-summary-coupon-form-block'],
        },
      ],
      wrongMarkup: [
        'wp:woocommerce/shopping-cart',        // doesn't exist
        'wp:woocommerce/cart-items',           // wrong — missing -block suffix
        'wp:woocommerce/order-summary',        // wrong — missing cart- prefix
        'wp:woocommerce/cart-subtotal',        // wrong naming
        'wp:woocommerce/cart-total',           // wrong naming
      ],
      requiredPatterns: [
        'woocommerce/cart-order-summary',      // summary block somewhere
        'woocommerce/cart-items',              // items block somewhere
      ],
    },
  },
  {
    name: '3. WooCommerce Product Collection with inner product blocks',
    prompt: `Generate Gutenberg block markup for a WooCommerce product collection section that displays products in a grid. The collection should:
- Query products on sale
- Display in 3 columns
- Show 9 products per page

Inside the collection, use a product template that renders for each product:
1. The product image block (with sale badge visible, aligned left)
2. The product title block
3. The product price block
4. The product rating block (the star variant)
5. An "Add to Cart" button block

Use the WooCommerce product collection block as the outer container with a product template inside. Output only the raw Gutenberg block markup.`,
    checks: {
      requiredMarkup: [
        'wp:woocommerce/product-collection',
      ],
      acceptAlternatives: [
        {
          label: 'Product template',
          patterns: ['wp:woocommerce/product-template'],
        },
        {
          label: 'Product image',
          patterns: ['wp:woocommerce/product-image'],
        },
        {
          label: 'Product title',
          patterns: ['wp:woocommerce/product-title'],
        },
        {
          label: 'Product price',
          patterns: ['wp:woocommerce/product-price'],
        },
        {
          label: 'Add to cart',
          patterns: ['wp:woocommerce/add-to-cart-form', 'wp:woocommerce/product-button'],
        },
      ],
      wrongMarkup: [
        'wp:woocommerce/product-grid',         // doesn't exist
        'wp:woocommerce/product-loop',         // doesn't exist
        'wp:woocommerce/products',             // doesn't exist
        'wp:woocommerce/product-list',         // doesn't exist
        'wp:woocommerce/product-card',         // doesn't exist
      ],
      requiredPatterns: [
        'woocommerce/product-collection',
        'woocommerce/product-template',
        'woocommerce/product-image',
        'woocommerce/product-price',
      ],
    },
  },
  {
    name: '4. WooCommerce Product Filters (attribute + price)',
    prompt: `Generate Gutenberg block markup for a WooCommerce product filtering sidebar that includes:
1. A heading "Filter Products"
2. An attribute filter block that filters by the "color" attribute, displayed as a dropdown
3. A price filter block with a price range slider
4. An active filters block that shows currently applied filters

Use the correct WooCommerce filter block names. These are specific blocks with their own naming convention — they are NOT generic form elements. Each filter block is dynamic (self-closing).

Output only the raw Gutenberg block markup.`,
    checks: {
      requiredMarkup: [
        'wp:heading',
      ],
      acceptAlternatives: [
        {
          label: 'Attribute filter',
          patterns: ['wp:woocommerce/attribute-filter', 'wp:woocommerce/product-filter-attribute'],
        },
        {
          label: 'Price filter',
          patterns: ['wp:woocommerce/price-filter', 'wp:woocommerce/product-filter-price', 'wp:woocommerce/product-filter-price-slider'],
        },
        {
          label: 'Active filters',
          patterns: ['wp:woocommerce/active-filters'],
        },
      ],
      wrongMarkup: [
        'wp:woocommerce/filter',               // too generic — doesn't exist
        'wp:woocommerce/color-filter',         // doesn't exist
        'wp:woocommerce/product-filter',       // too generic
        'wp:woocommerce/filter-sidebar',       // doesn't exist
      ],
      requiredPatterns: [
        'woocommerce/.*filter',                // at least one filter block
        'Filter Products',
        '/-->',                                 // self-closing for dynamic blocks
      ],
    },
  },
  {
    name: '5. WooCommerce Order Confirmation page',
    prompt: `Generate Gutenberg block markup for a WooCommerce order confirmation / thank-you page that shows:
1. The order status message (e.g. "Thank you. Your order has been received.")
2. The order summary/details table
3. The total amount breakdown
4. The billing address the customer provided
5. The shipping address
6. Any downloadable files associated with the order

WooCommerce has specific blocks for each section of the order confirmation page. They follow a naming convention with "order-confirmation-" prefix. All are dynamic blocks.

Output only the raw Gutenberg block markup.`,
    checks: {
      requiredMarkup: [],
      acceptAlternatives: [
        {
          label: 'Order status',
          patterns: ['wp:woocommerce/order-confirmation-status'],
        },
        {
          label: 'Order summary',
          patterns: ['wp:woocommerce/order-confirmation-summary'],
        },
        {
          label: 'Order totals',
          patterns: ['wp:woocommerce/order-confirmation-totals'],
        },
        {
          label: 'Billing address',
          patterns: ['wp:woocommerce/order-confirmation-billing-address'],
        },
        {
          label: 'Shipping address',
          patterns: ['wp:woocommerce/order-confirmation-shipping-address'],
        },
        {
          label: 'Downloads',
          patterns: ['wp:woocommerce/order-confirmation-downloads'],
        },
      ],
      wrongMarkup: [
        'wp:woocommerce/order-details',        // doesn't exist
        'wp:woocommerce/order-status',         // wrong — missing confirmation- part
        'wp:woocommerce/order-summary',        // wrong — missing confirmation- part
        'wp:woocommerce/order-totals',         // wrong — missing confirmation- part
        'wp:woocommerce/thank-you',            // doesn't exist
        'wp:woocommerce/order-received',       // doesn't exist
      ],
      requiredPatterns: [
        'order-confirmation-status|order-confirmation-summary',
        'order-confirmation-billing|order-confirmation-shipping',
        '/-->',                                 // self-closing for dynamic blocks
      ],
    },
  },
];

// ==========================================================
// Main
// ==========================================================
async function main() {
  console.log('='.repeat(70));
  console.log('  MCP REAL-WORLD HARD TEST — WOOCOMMERCE BLOCKS');
  console.log('  Complex nested structures, inner blocks, tricky naming');
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
