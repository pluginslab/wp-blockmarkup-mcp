#!/usr/bin/env node
/**
 * MCP server entry point for wp-blockmarkup-mcp
 *
 * Exposes tools over stdio:
 *   search_blocks         — Full-text search across indexed blocks
 *   get_block_schema      — Full attribute/support schema for a block
 *   get_block_markup      — Validated markup examples for a block
 *   validate_markup       — Validate raw block markup string
 *   list_block_attributes — All attributes for a block with types/defaults
 *   search_variations     — Search block variations by name/description
 */

// TODO: Implement MCP server with @modelcontextprotocol/sdk
