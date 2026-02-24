import { z } from 'zod';
import {
  searchBlocks,
  getBlockSchema,
  getBlockMarkup,
  listBlockAttributes,
  searchVariations,
} from '../db.js';

// --- search_blocks ---

export const searchBlocksSchema = {
  name: 'search_blocks',
  description: 'Search Gutenberg blocks across all indexed sources using full-text search. Returns BM25-ranked results with block metadata, type classification, and validation status.',
  inputSchema: {
    query: z.string().describe('Search query — block name, title, description, or category keyword'),
    source: z.string().optional().describe('Filter by source name'),
    category: z.string().optional().describe('Filter by block category (text, media, design, widgets, etc.)'),
    block_type: z.enum(['static', 'dynamic', 'hybrid']).optional().describe('Filter by block type'),
    include_removed: z.boolean().optional().describe('Include soft-deleted blocks'),
    limit: z.number().min(1).max(100).optional().describe('Max results (default 20)'),
  },
};

export function handleSearchBlocks(args) {
  try {
    const results = searchBlocks(args.query, {
      source: args.source,
      category: args.category,
      blockType: args.block_type,
      includeRemoved: args.include_removed,
      limit: args.limit || 20,
    });

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No blocks found matching "${args.query}". Try broader search terms or check source indexing with the CLI.` }],
      };
    }

    const formatted = results.map((b, i) => {
      const lines = [
        `### ${i + 1}. ${b.block_name}`,
        `- **Title:** ${b.title || '—'} | **Category:** ${b.category || '—'}`,
        `- **Type:** ${b.block_type} | **Validation:** ${b.validation_status} | **Confidence:** ${b.confidence}%`,
        `- **Source:** ${b.source_name}`,
      ];
      if (b.description) lines.push(`- **Description:** ${b.description}`);
      if (b.status === 'removed') lines.push('- **Status:** REMOVED');
      return lines.join('\n');
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Found ${results.length} block(s) matching "${args.query}":\n\n${formatted}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error searching blocks: ${err.message}` }], isError: true };
  }
}

// --- get_block_schema ---

export const getBlockSchemaSchema = {
  name: 'get_block_schema',
  description: 'Get the complete schema for a Gutenberg block: all attributes with types/defaults, support configurations, variations, and validation status. Use the full block name (e.g. "core/paragraph").',
  inputSchema: {
    block_name: z.string().describe('Full block name (e.g. "core/paragraph", "woocommerce/product-price")'),
  },
};

export function handleGetBlockSchema(args) {
  try {
    const schema = getBlockSchema(args.block_name);

    if (!schema) {
      return {
        content: [{ type: 'text', text: `Block "${args.block_name}" not found. Use search_blocks to find blocks first.` }],
      };
    }

    const sections = [
      `## ${schema.block_name}`,
      `**Title:** ${schema.title || '—'} | **Category:** ${schema.category || '—'}`,
      `**Type:** ${schema.block_type} | **Validation:** ${schema.validation_status} | **Confidence:** ${schema.confidence}%`,
    ];

    if (schema.description) sections.push(`**Description:** ${schema.description}`);

    // Attributes
    if (schema.attributes.length > 0) {
      sections.push(`\n### Attributes (${schema.attributes.length})`);
      const attrLines = schema.attributes.map(a => {
        const parts = [`- **${a.name}**: \`${a.type || '?'}\``];
        if (a.default_val) parts.push(`(default: ${a.default_val})`);
        if (a.enum_values) parts.push(`[${a.enum_values}]`);
        if (a.source) parts.push(`source: ${a.source}`);
        if (a.selector) parts.push(`selector: ${a.selector}`);
        return parts.join(' ');
      });
      sections.push(attrLines.join('\n'));
    }

    // Supports
    if (schema.supports.length > 0) {
      sections.push(`\n### Supports (${schema.supports.length})`);
      const supportLines = schema.supports.map(s => `- **${s.feature}**: ${s.config}`);
      sections.push(supportLines.join('\n'));
    }

    // Variations
    if (schema.variations.length > 0) {
      sections.push(`\n### Variations (${schema.variations.length})`);
      const varLines = schema.variations.map(v => {
        const desc = v.description ? ` — ${v.description}` : '';
        return `- **${v.name}**: ${v.title || '—'}${desc}`;
      });
      sections.push(varLines.join('\n'));
    }

    return {
      content: [{ type: 'text', text: sections.join('\n') }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error getting block schema: ${err.message}` }], isError: true };
  }
}

// --- get_block_markup ---

export const getBlockMarkupSchema = {
  name: 'get_block_markup',
  description: 'Get validated markup examples for a Gutenberg block. Optionally filter by features used (color, typography, spacing, align). Every returned example has been extracted from the block\'s actual source.',
  inputSchema: {
    block_name: z.string().describe('Full block name (e.g. "core/paragraph")'),
    features: z.array(z.string()).optional().describe('Filter examples by features used: color, typography, spacing, align, border'),
    validated_only: z.boolean().optional().describe('Only return verified examples (default false)'),
  },
};

export function handleGetBlockMarkup(args) {
  try {
    const examples = getBlockMarkup(args.block_name, {
      features: args.features,
      validatedOnly: args.validated_only,
    });

    if (examples.length === 0) {
      return {
        content: [{ type: 'text', text: `No markup examples found for "${args.block_name}".` }],
      };
    }

    const formatted = examples.map((e, i) => {
      const features = e.features_used ? JSON.parse(e.features_used) : [];
      const featureStr = features.length > 0 ? ` [${features.join(', ')}]` : '';
      return `### ${i + 1}. ${e.title}${featureStr} (${e.validation_status})\n${e.description || ''}\n\`\`\`html\n${e.markup}\n\`\`\``;
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `${examples.length} markup example(s) for "${args.block_name}":\n\n${formatted}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error getting block markup: ${err.message}` }], isError: true };
  }
}

// --- validate_markup ---

export const validateMarkupSchema = {
  name: 'validate_markup',
  description: 'Validate raw Gutenberg block markup. Checks structural format (comment delimiters, JSON attributes) and verifies the block name exists in indexed sources. For static blocks, checks attribute names/types against the block schema.',
  inputSchema: {
    markup: z.string().describe('Raw Gutenberg block markup string to validate'),
  },
};

export function handleValidateMarkup(args) {
  try {
    // Parse the block comment to extract block name and attributes
    const blockMatch = args.markup.match(/<!--\s+wp:([^\s{/]+)(?:\s+(\{[^}]*\}))?\s*(\/)?-->/);

    if (!blockMatch) {
      return {
        content: [{ type: 'text', text: 'INVALID — Could not parse block comment delimiter. Expected format: `<!-- wp:namespace/block-name {"attrs":"here"} -->`' }],
      };
    }

    const blockName = blockMatch[1];
    const attrsJson = blockMatch[2];
    const selfClosing = blockMatch[3];

    // Validate JSON attributes
    let attrs = {};
    if (attrsJson) {
      try {
        attrs = JSON.parse(attrsJson);
      } catch {
        return {
          content: [{ type: 'text', text: `INVALID — Attribute JSON is malformed: ${attrsJson}` }],
        };
      }
    }

    // Check if block exists
    const schema = getBlockSchema(blockName);
    if (!schema) {
      // Try with core/ prefix
      const coreSchema = getBlockSchema(`core/${blockName}`);
      if (coreSchema) {
        return validateAgainstSchema(coreSchema, attrs, selfClosing, args.markup);
      }
      return {
        content: [{ type: 'text', text: `UNKNOWN BLOCK — "${blockName}" is not in any indexed source. The markup structure looks valid but the block cannot be verified.` }],
      };
    }

    return validateAgainstSchema(schema, attrs, selfClosing, args.markup);
  } catch (err) {
    return { content: [{ type: 'text', text: `Error validating markup: ${err.message}` }], isError: true };
  }
}

function validateAgainstSchema(schema, attrs, selfClosing, markup) {
  const issues = [];
  const warnings = [];

  // Check if dynamic block uses self-closing format correctly
  if (schema.block_type === 'dynamic' && !selfClosing) {
    warnings.push('Dynamic block has inner HTML content — this is valid but WordPress renders the output server-side, so the inner HTML may be ignored.');
  }

  // Check attribute names against schema
  const knownAttrs = new Set(schema.attributes.map(a => a.name));
  // Add common block-level attributes that aren't in block.json
  knownAttrs.add('className');
  knownAttrs.add('anchor');
  knownAttrs.add('style');
  knownAttrs.add('backgroundColor');
  knownAttrs.add('textColor');
  knownAttrs.add('gradient');
  knownAttrs.add('fontSize');
  knownAttrs.add('fontFamily');
  knownAttrs.add('align');
  knownAttrs.add('lock');

  for (const key of Object.keys(attrs)) {
    if (!knownAttrs.has(key)) {
      issues.push(`Unknown attribute "${key}" — not found in ${schema.block_name} schema`);
    }
  }

  // Check attribute types
  for (const schemaAttr of schema.attributes) {
    if (attrs[schemaAttr.name] !== undefined && schemaAttr.type) {
      const value = attrs[schemaAttr.name];
      const expectedType = schemaAttr.type;
      const actualType = Array.isArray(value) ? 'array' : typeof value;

      // Simple type check (type can be compound like "string|boolean")
      const allowedTypes = expectedType.split('|');
      if (!allowedTypes.includes(actualType) && expectedType !== 'rich-text' && expectedType !== 'unknown') {
        issues.push(`Attribute "${schemaAttr.name}" expected type ${expectedType}, got ${actualType}`);
      }
    }
  }

  // Check closing comment
  if (!selfClosing && !markup.includes(`<!-- /wp:`)) {
    issues.push('Missing closing comment delimiter (<!-- /wp:block-name -->)');
  }

  if (issues.length === 0) {
    const status = schema.block_type === 'dynamic' ? 'VALID (attributes only — dynamic block)' : 'VALID';
    let text = `${status} — Block "${schema.block_name}" markup passes structural validation.`;
    if (warnings.length > 0) text += `\n\nWarnings:\n${warnings.map(w => `  - ${w}`).join('\n')}`;
    return { content: [{ type: 'text', text }] };
  }

  let text = `ISSUES FOUND — Block "${schema.block_name}" markup has ${issues.length} issue(s):\n${issues.map(i => `  - ${i}`).join('\n')}`;
  if (warnings.length > 0) text += `\n\nWarnings:\n${warnings.map(w => `  - ${w}`).join('\n')}`;
  return { content: [{ type: 'text', text }] };
}

// --- list_block_attributes ---

export const listBlockAttributesSchema = {
  name: 'list_block_attributes',
  description: 'List all attributes for a Gutenberg block with their types, defaults, allowed values, sources, and selectors. Useful for constructing specific attribute combinations.',
  inputSchema: {
    block_name: z.string().describe('Full block name (e.g. "core/image")'),
  },
};

export function handleListBlockAttributes(args) {
  try {
    const attrs = listBlockAttributes(args.block_name);

    if (attrs.length === 0) {
      return {
        content: [{ type: 'text', text: `No attributes found for "${args.block_name}". The block may not exist or may have no defined attributes.` }],
      };
    }

    const formatted = attrs.map(a => {
      const lines = [`### ${a.name}`];
      lines.push(`- **Type:** ${a.type || 'unknown'}`);
      if (a.default_val) lines.push(`- **Default:** ${a.default_val}`);
      if (a.source) lines.push(`- **Source:** ${a.source}`);
      if (a.selector) lines.push(`- **Selector:** ${a.selector}`);
      if (a.enum_values) lines.push(`- **Allowed values:** ${a.enum_values}`);
      return lines.join('\n');
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `${attrs.length} attribute(s) for "${args.block_name}":\n\n${formatted}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error listing attributes: ${err.message}` }], isError: true };
  }
}

// --- search_variations ---

export const searchVariationsSchema = {
  name: 'search_variations',
  description: 'Search Gutenberg block variations by name or description. Returns matching variations with their pre-configured attributes and parent block information.',
  inputSchema: {
    query: z.string().describe('Search query — variation name, title, or description'),
    limit: z.number().min(1).max(100).optional().describe('Max results (default 20)'),
  },
};

export function handleSearchVariations(args) {
  try {
    const results = searchVariations(args.query, { limit: args.limit || 20 });

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No variations found matching "${args.query}".` }],
      };
    }

    const formatted = results.map((v, i) => {
      const lines = [
        `### ${i + 1}. ${v.title || v.name}`,
        `- **Block:** ${v.block_name} (${v.block_title || '—'})`,
        `- **Variation:** ${v.name}`,
        `- **Source:** ${v.source_name}`,
      ];
      if (v.description) lines.push(`- **Description:** ${v.description}`);
      if (v.attributes) lines.push(`- **Attributes:** ${v.attributes}`);
      if (v.markup) lines.push(`- **Markup:**\n\`\`\`html\n${v.markup}\n\`\`\``);
      return lines.join('\n');
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Found ${results.length} variation(s) matching "${args.query}":\n\n${formatted}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error searching variations: ${err.message}` }], isError: true };
  }
}
