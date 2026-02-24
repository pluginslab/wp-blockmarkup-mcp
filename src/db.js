import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH } from './constants.js';

let db;

export function getDb() {
  if (!db) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDb(db);
  }
  return db;
}

export function closeDb() {
  if (db) {
    stmtCache.clear();
    db.close();
    db = null;
  }
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      repo_url TEXT,
      subfolder TEXT,
      local_path TEXT,
      token_env_var TEXT,
      branch TEXT DEFAULT 'main',
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      block_name TEXT NOT NULL,
      title TEXT,
      description TEXT,
      category TEXT,
      block_type TEXT NOT NULL DEFAULT 'static',
      api_version INTEGER,
      validation_status TEXT DEFAULT 'unverified',
      confidence INTEGER DEFAULT 0,
      file_path TEXT NOT NULL,
      content_hash TEXT,
      status TEXT DEFAULT 'active',
      removed_at TEXT,
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_id, block_name)
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_source_id ON blocks(source_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_block_name ON blocks(block_name);
    CREATE INDEX IF NOT EXISTS idx_blocks_category ON blocks(category);
    CREATE INDEX IF NOT EXISTS idx_blocks_block_type ON blocks(block_type);
    CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status);
    CREATE INDEX IF NOT EXISTS idx_blocks_source_status ON blocks(source_id, status);

    CREATE TABLE IF NOT EXISTS attributes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT,
      default_val TEXT,
      source TEXT,
      selector TEXT,
      enum_values TEXT,
      UNIQUE(block_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_attributes_block_id ON attributes(block_id);

    CREATE TABLE IF NOT EXISTS supports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      feature TEXT NOT NULL,
      config TEXT,
      UNIQUE(block_id, feature)
    );

    CREATE INDEX IF NOT EXISTS idx_supports_block_id ON supports(block_id);

    CREATE TABLE IF NOT EXISTS markup_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      markup TEXT NOT NULL,
      attributes_json TEXT,
      validation_status TEXT DEFAULT 'unverified',
      features_used TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_markup_block_id ON markup_examples(block_id);

    CREATE TABLE IF NOT EXISTS variations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      title TEXT,
      description TEXT,
      attributes TEXT,
      inner_blocks TEXT,
      scope TEXT,
      markup TEXT,
      UNIQUE(block_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_variations_block_id ON variations(block_id);

    CREATE TABLE IF NOT EXISTS indexed_files (
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      mtime_ms REAL,
      content_hash TEXT,
      UNIQUE(source_id, file_path)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
      block_name,
      title,
      description,
      category,
      content='blocks',
      content_rowid='id'
    );
  `);
}

// --- Prepared statement cache ---
const stmtCache = new Map();

function stmt(db, sql) {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, db.prepare(sql));
  }
  return stmtCache.get(sql);
}

// --- Sources ---

export function addSource(data) {
  const db = getDb();
  return stmt(db, `
    INSERT INTO sources (name, type, repo_url, subfolder, local_path, token_env_var, branch, enabled)
    VALUES (@name, @type, @repo_url, @subfolder, @local_path, @token_env_var, @branch, @enabled)
  `).run({
    name: data.name,
    type: data.type,
    repo_url: data.repo_url || null,
    subfolder: data.subfolder || null,
    local_path: data.local_path || null,
    token_env_var: data.token_env_var || null,
    branch: data.branch || 'main',
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1,
  });
}

export function listSources() {
  const db = getDb();
  return stmt(db, 'SELECT * FROM sources ORDER BY name').all();
}

export function getSource(name) {
  const db = getDb();
  return stmt(db, 'SELECT * FROM sources WHERE name = ?').get(name);
}

export function getSourceById(id) {
  const db = getDb();
  return stmt(db, 'SELECT * FROM sources WHERE id = ?').get(id);
}

export function removeSource(name) {
  const db = getDb();
  const source = getSource(name);
  if (!source) return null;
  // Clean up FTS before cascade delete
  stmt(db, 'DELETE FROM blocks_fts WHERE rowid IN (SELECT id FROM blocks WHERE source_id = ?)').run(source.id);
  stmt(db, 'DELETE FROM sources WHERE name = ?').run(name);
  return source;
}

export function isSourceIndexed(sourceId) {
  const db = getDb();
  const row = stmt(db, 'SELECT COUNT(*) as count FROM indexed_files WHERE source_id = ?').get(sourceId);
  return row.count > 0;
}

// --- Blocks ---

export function upsertBlock(data) {
  const db = getDb();
  const upsertTx = db.transaction((d) => {
    const existing = stmt(db, `
      SELECT id, content_hash FROM blocks
      WHERE source_id = @source_id AND block_name = @block_name
    `).get(d);

    if (existing) {
      if (existing.content_hash === d.content_hash) {
        // No change — bump last_seen_at
        stmt(db, "UPDATE blocks SET last_seen_at = datetime('now'), status = 'active' WHERE id = ?").run(existing.id);
        return { id: existing.id, action: 'skipped' };
      }
      // Update
      stmt(db, `
        UPDATE blocks SET
          title = @title, description = @description, category = @category,
          block_type = @block_type, api_version = @api_version,
          validation_status = @validation_status, confidence = @confidence,
          file_path = @file_path, content_hash = @content_hash,
          status = 'active', removed_at = NULL, last_seen_at = datetime('now')
        WHERE id = @id
      `).run({ ...d, id: existing.id });
      // Update FTS
      stmt(db, 'DELETE FROM blocks_fts WHERE rowid = ?').run(existing.id);
      stmt(db, `
        INSERT INTO blocks_fts(rowid, block_name, title, description, category)
        VALUES (@id, @block_name, @title, @description, @category)
      `).run({ ...d, id: existing.id });
      // Clear old child data for re-insertion
      stmt(db, 'DELETE FROM attributes WHERE block_id = ?').run(existing.id);
      stmt(db, 'DELETE FROM supports WHERE block_id = ?').run(existing.id);
      stmt(db, 'DELETE FROM markup_examples WHERE block_id = ?').run(existing.id);
      stmt(db, 'DELETE FROM variations WHERE block_id = ?').run(existing.id);
      return { id: existing.id, action: 'updated' };
    }

    // Insert
    const result = stmt(db, `
      INSERT INTO blocks (
        source_id, block_name, title, description, category,
        block_type, api_version, validation_status, confidence,
        file_path, content_hash, status
      ) VALUES (
        @source_id, @block_name, @title, @description, @category,
        @block_type, @api_version, @validation_status, @confidence,
        @file_path, @content_hash, 'active'
      )
    `).run(d);

    stmt(db, `
      INSERT INTO blocks_fts(rowid, block_name, title, description, category)
      VALUES (@id, @block_name, @title, @description, @category)
    `).run({ ...d, id: result.lastInsertRowid });

    return { id: Number(result.lastInsertRowid), action: 'inserted' };
  });

  return upsertTx(data);
}

export function markBlocksRemoved(sourceId, activeBlockIds) {
  const db = getDb();
  const tx = db.transaction(() => {
    const allBlocks = stmt(db, `
      SELECT id FROM blocks WHERE source_id = ? AND status = 'active'
    `).all(sourceId);

    const activeSet = new Set(activeBlockIds.map(Number));
    const toRemove = allBlocks.filter(b => !activeSet.has(b.id));

    const removeStmt = stmt(db, `
      UPDATE blocks SET status = 'removed', removed_at = datetime('now') WHERE id = ?
    `);

    for (const b of toRemove) {
      removeStmt.run(b.id);
    }

    return toRemove.length;
  });

  return tx();
}

export function updateBlockValidation(blockId, validationStatus) {
  const db = getDb();
  stmt(db, 'UPDATE blocks SET validation_status = ? WHERE id = ?').run(validationStatus, blockId);
}

export function getBlockByName(blockName) {
  const db = getDb();
  return stmt(db, `
    SELECT b.*, s.name AS source_name FROM blocks b
    JOIN sources s ON s.id = b.source_id
    WHERE b.block_name = ? AND b.status = 'active'
    ORDER BY b.last_seen_at DESC LIMIT 1
  `).get(blockName);
}

export function getBlockById(id) {
  const db = getDb();
  return stmt(db, `
    SELECT b.*, s.name AS source_name FROM blocks b
    JOIN sources s ON s.id = b.source_id
    WHERE b.id = ?
  `).get(id);
}

export function searchBlocks(query, opts = {}) {
  const db = getDb();
  const { source, category, blockType, includeRemoved, limit = 20 } = opts;

  const ftsQuery = query.replace(/['"(){}[\]*:^~!]/g, ' ').trim();
  if (!ftsQuery) return [];

  const terms = ftsQuery.split(/\s+/).filter(Boolean).map(t => `"${t}"*`).join(' ');

  let sql = `
    SELECT b.*, s.name AS source_name,
      bm25(blocks_fts, 10, 5, 3, 2) AS rank
    FROM blocks_fts
    JOIN blocks b ON b.id = blocks_fts.rowid
    JOIN sources s ON s.id = b.source_id
    WHERE blocks_fts MATCH @terms
  `;

  const params = { terms };

  if (!includeRemoved) {
    sql += ` AND b.status = 'active'`;
  }
  if (source) {
    sql += ` AND s.name = @source`;
    params.source = source;
  }
  if (category) {
    sql += ` AND b.category = @category`;
    params.category = category;
  }
  if (blockType) {
    sql += ` AND b.block_type = @blockType`;
    params.blockType = blockType;
  }

  sql += ` ORDER BY rank LIMIT @limit`;
  params.limit = limit;

  return db.prepare(sql).all(params);
}

// --- Attributes ---

export function insertAttributes(blockId, attributes) {
  const db = getDb();
  const insertStmt = stmt(db, `
    INSERT OR REPLACE INTO attributes (block_id, name, type, default_val, source, selector, enum_values)
    VALUES (@block_id, @name, @type, @default_val, @source, @selector, @enum_values)
  `);

  const tx = db.transaction((attrs) => {
    for (const [name, attr] of Object.entries(attrs)) {
      // type can be a string or array — normalize to string
      const type = Array.isArray(attr.type) ? attr.type.join('|') : (attr.type || null);
      insertStmt.run({
        block_id: blockId,
        name,
        type,
        default_val: attr.default !== undefined && attr.default !== null ? JSON.stringify(attr.default) : null,
        source: attr.source || null,
        selector: attr.selector || null,
        enum_values: attr.enum ? JSON.stringify(attr.enum) : null,
      });
    }
  });

  tx(attributes);
}

export function getBlockAttributes(blockId) {
  const db = getDb();
  return stmt(db, 'SELECT * FROM attributes WHERE block_id = ? ORDER BY name').all(blockId);
}

export function listBlockAttributes(blockName) {
  const db = getDb();
  return db.prepare(`
    SELECT a.* FROM attributes a
    JOIN blocks b ON b.id = a.block_id
    WHERE b.block_name = ? AND b.status = 'active'
    ORDER BY a.name
  `).all(blockName);
}

// --- Supports ---

export function insertSupports(blockId, supports) {
  const db = getDb();
  const insertStmt = stmt(db, `
    INSERT OR REPLACE INTO supports (block_id, feature, config)
    VALUES (@block_id, @feature, @config)
  `);

  const tx = db.transaction((supportsObj) => {
    for (const [feature, config] of Object.entries(supportsObj)) {
      insertStmt.run({
        block_id: blockId,
        feature,
        config: JSON.stringify(config),
      });
    }
  });

  tx(supports);
}

export function getBlockSupports(blockId) {
  const db = getDb();
  return stmt(db, 'SELECT * FROM supports WHERE block_id = ? ORDER BY feature').all(blockId);
}

// --- Markup Examples ---

export function insertMarkupExample(data) {
  const db = getDb();
  return stmt(db, `
    INSERT INTO markup_examples (block_id, title, description, markup, attributes_json, validation_status, features_used)
    VALUES (@block_id, @title, @description, @markup, @attributes_json, @validation_status, @features_used)
  `).run({
    block_id: data.block_id,
    title: data.title,
    description: data.description || null,
    markup: data.markup,
    attributes_json: data.attributes_json || null,
    validation_status: data.validation_status || 'unverified',
    features_used: data.features_used ? JSON.stringify(data.features_used) : null,
  });
}

export function getBlockMarkup(blockName, opts = {}) {
  const db = getDb();
  const { features, validatedOnly = false } = opts;

  let sql = `
    SELECT me.* FROM markup_examples me
    JOIN blocks b ON b.id = me.block_id
    WHERE b.block_name = @block_name AND b.status = 'active'
  `;

  const params = { block_name: blockName };

  if (validatedOnly) {
    sql += ` AND me.validation_status = 'verified'`;
  }

  sql += ` ORDER BY me.id`;

  let results = db.prepare(sql).all(params);

  // Filter by features if requested
  if (features && features.length > 0) {
    results = results.filter(r => {
      if (!r.features_used) return false;
      const used = JSON.parse(r.features_used);
      return features.some(f => used.includes(f));
    });
  }

  return results;
}

// --- Variations ---

export function insertVariation(data) {
  const db = getDb();
  return stmt(db, `
    INSERT OR REPLACE INTO variations (block_id, name, title, description, attributes, inner_blocks, scope, markup)
    VALUES (@block_id, @name, @title, @description, @attributes, @inner_blocks, @scope, @markup)
  `).run({
    block_id: data.block_id,
    name: data.name,
    title: data.title || null,
    description: data.description || null,
    attributes: data.attributes ? JSON.stringify(data.attributes) : null,
    inner_blocks: data.inner_blocks ? JSON.stringify(data.inner_blocks) : null,
    scope: data.scope ? JSON.stringify(data.scope) : null,
    markup: data.markup || null,
  });
}

export function getBlockVariations(blockId) {
  const db = getDb();
  return stmt(db, 'SELECT * FROM variations WHERE block_id = ? ORDER BY name').all(blockId);
}

export function searchVariations(query, opts = {}) {
  const db = getDb();
  const { limit = 20 } = opts;
  // Simple LIKE search since variations don't have their own FTS
  const pattern = `%${query}%`;
  return db.prepare(`
    SELECT v.*, b.block_name, b.title AS block_title, s.name AS source_name
    FROM variations v
    JOIN blocks b ON b.id = v.block_id
    JOIN sources s ON s.id = b.source_id
    WHERE b.status = 'active'
      AND (v.name LIKE @pattern OR v.title LIKE @pattern OR v.description LIKE @pattern)
    ORDER BY v.title
    LIMIT @limit
  `).all({ pattern, limit });
}

// --- Indexed Files ---

export function getIndexedFile(sourceId, filePath) {
  const db = getDb();
  return stmt(db, 'SELECT * FROM indexed_files WHERE source_id = ? AND file_path = ?').get(sourceId, filePath);
}

export function upsertIndexedFile(sourceId, filePath, mtimeMs, contentHash) {
  const db = getDb();
  stmt(db, `
    INSERT INTO indexed_files (source_id, file_path, mtime_ms, content_hash)
    VALUES (@source_id, @file_path, @mtime_ms, @content_hash)
    ON CONFLICT(source_id, file_path)
    DO UPDATE SET mtime_ms = @mtime_ms, content_hash = @content_hash
  `).run({ source_id: sourceId, file_path: filePath, mtime_ms: mtimeMs, content_hash: contentHash });
}

export function clearIndexedFiles(sourceId) {
  const db = getDb();
  stmt(db, 'DELETE FROM indexed_files WHERE source_id = ?').run(sourceId);
}

// --- FTS Rebuild ---

export function rebuildFtsIndex() {
  const db = getDb();
  const tx = db.transaction(() => {
    db.exec('DELETE FROM blocks_fts');
    db.exec(`
      INSERT INTO blocks_fts(rowid, block_name, title, description, category)
      SELECT id, block_name, title, description, category FROM blocks WHERE status = 'active'
    `);
  });
  tx();
}

// --- Stats ---

export function getStats() {
  const db = getDb();
  const sources = stmt(db, 'SELECT COUNT(*) as count FROM sources').get();
  const totalBlocks = stmt(db, "SELECT COUNT(*) as count FROM blocks WHERE status = 'active'").get();
  const removedBlocks = stmt(db, "SELECT COUNT(*) as count FROM blocks WHERE status = 'removed'").get();
  const staticBlocks = stmt(db, "SELECT COUNT(*) as count FROM blocks WHERE status = 'active' AND block_type = 'static'").get();
  const dynamicBlocks = stmt(db, "SELECT COUNT(*) as count FROM blocks WHERE status = 'active' AND block_type = 'dynamic'").get();
  const hybridBlocks = stmt(db, "SELECT COUNT(*) as count FROM blocks WHERE status = 'active' AND block_type = 'hybrid'").get();
  const verified = stmt(db, "SELECT COUNT(*) as count FROM blocks WHERE status = 'active' AND validation_status = 'verified'").get();
  const totalAttributes = stmt(db, `
    SELECT COUNT(*) as count FROM attributes a
    JOIN blocks b ON b.id = a.block_id WHERE b.status = 'active'
  `).get();
  const totalVariations = stmt(db, `
    SELECT COUNT(*) as count FROM variations v
    JOIN blocks b ON b.id = v.block_id WHERE b.status = 'active'
  `).get();
  const totalExamples = stmt(db, `
    SELECT COUNT(*) as count FROM markup_examples me
    JOIN blocks b ON b.id = me.block_id WHERE b.status = 'active'
  `).get();

  const perSource = db.prepare(`
    SELECT s.name,
      (SELECT COUNT(*) FROM blocks WHERE source_id = s.id AND status = 'active') AS blocks,
      (SELECT COUNT(*) FROM blocks WHERE source_id = s.id AND status = 'removed') AS removed_blocks,
      (SELECT COUNT(*) FROM blocks WHERE source_id = s.id AND status = 'active' AND block_type = 'static') AS static_blocks,
      (SELECT COUNT(*) FROM blocks WHERE source_id = s.id AND status = 'active' AND block_type = 'dynamic') AS dynamic_blocks,
      (SELECT COUNT(*) FROM blocks WHERE source_id = s.id AND status = 'active' AND validation_status = 'verified') AS verified_blocks,
      (SELECT COUNT(*) FROM attributes a JOIN blocks b ON b.id = a.block_id WHERE b.source_id = s.id AND b.status = 'active') AS attributes,
      (SELECT COUNT(*) FROM variations v JOIN blocks b ON b.id = v.block_id WHERE b.source_id = s.id AND b.status = 'active') AS variations,
      (SELECT COUNT(*) FROM markup_examples me JOIN blocks b ON b.id = me.block_id WHERE b.source_id = s.id AND b.status = 'active') AS examples,
      (SELECT COUNT(*) FROM indexed_files WHERE source_id = s.id) AS files
    FROM sources s ORDER BY s.name
  `).all();

  return {
    totals: {
      sources: sources.count,
      active_blocks: totalBlocks.count,
      removed_blocks: removedBlocks.count,
      static_blocks: staticBlocks.count,
      dynamic_blocks: dynamicBlocks.count,
      hybrid_blocks: hybridBlocks.count,
      verified_blocks: verified.count,
      total_attributes: totalAttributes.count,
      total_variations: totalVariations.count,
      total_examples: totalExamples.count,
    },
    per_source: perSource,
  };
}

// --- Full block schema (for get_block_schema MCP tool) ---

export function getBlockSchema(blockName) {
  const block = getBlockByName(blockName);
  if (!block) return null;

  const attributes = getBlockAttributes(block.id);
  const supports = getBlockSupports(block.id);
  const variations = getBlockVariations(block.id);
  const examples = getBlockMarkup(blockName);

  return {
    ...block,
    attributes,
    supports,
    variations,
    examples,
  };
}
