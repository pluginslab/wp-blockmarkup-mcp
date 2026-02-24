#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  searchBlocksSchema, handleSearchBlocks,
  getBlockSchemaSchema, handleGetBlockSchema,
  getBlockMarkupSchema, handleGetBlockMarkup,
  validateMarkupSchema, handleValidateMarkup,
  listBlockAttributesSchema, handleListBlockAttributes,
  searchVariationsSchema, handleSearchVariations,
} from './mcp/tools.js';

// Initialize DB on import (side effect)
import { getDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const server = new McpServer({
  name: 'wp-blockmarkup-mcp',
  version: pkg.version,
});

// Register tools
server.tool(
  searchBlocksSchema.name,
  searchBlocksSchema.description,
  searchBlocksSchema.inputSchema,
  handleSearchBlocks,
);

server.tool(
  getBlockSchemaSchema.name,
  getBlockSchemaSchema.description,
  getBlockSchemaSchema.inputSchema,
  handleGetBlockSchema,
);

server.tool(
  getBlockMarkupSchema.name,
  getBlockMarkupSchema.description,
  getBlockMarkupSchema.inputSchema,
  handleGetBlockMarkup,
);

server.tool(
  validateMarkupSchema.name,
  validateMarkupSchema.description,
  validateMarkupSchema.inputSchema,
  handleValidateMarkup,
);

server.tool(
  listBlockAttributesSchema.name,
  listBlockAttributesSchema.description,
  listBlockAttributesSchema.inputSchema,
  handleListBlockAttributes,
);

server.tool(
  searchVariationsSchema.name,
  searchVariationsSchema.description,
  searchVariationsSchema.inputSchema,
  handleSearchVariations,
);

// Ensure DB is ready
try {
  getDb();
} catch (err) {
  process.stderr.write(`Failed to initialize database: ${err.message}\n`);
  process.exit(1);
}

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
