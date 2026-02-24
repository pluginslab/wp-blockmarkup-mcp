/**
 * Database layer — SQLite with FTS5
 *
 * Schema:
 *   sources         — registered repos/folders with indexing metadata
 *   blocks          — block metadata, type classification, validation status, confidence
 *   attributes      — per-block attributes with types, defaults, constraints
 *   supports        — per-block feature support configurations (color, typography, etc.)
 *   markup_examples — validated markup examples with features used
 *   variations      — block variations with attributes and markup
 *   blocks_fts      — FTS5 full-text search index
 *
 * Storage: ~/.wp-blockmarkup-mcp/blocks.db
 */

// TODO: Implement with better-sqlite3
