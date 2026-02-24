/**
 * Block indexer — orchestrates block discovery, parsing, markup generation,
 * and database storage with incremental update support.
 */
import fg from 'fast-glob';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchSource } from './source-manager.js';
import { parseBlockJson } from './parsers/block-json-parser.js';
import { parseEditFile } from './parsers/edit-parser.js';
import { parseSaveFile } from './parsers/save-parser.js';
import { parseVariationsFile } from './parsers/variations-parser.js';
import { generateMarkupExamples, generateDynamicMarkup } from './utils/markup-generator.js';
import { validateMarkup } from './validation/index.js';
import {
  listSources,
  getSource,
  upsertBlock,
  markBlocksRemoved,
  insertAttributes,
  insertSupports,
  insertMarkupExample,
  insertVariation,
  getIndexedFile,
  upsertIndexedFile,
  updateBlockValidation,
} from './db.js';

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/tests/**',
  '**/test/**',
  '**/__tests__/**',
  '**/spec/**',
];

/**
 * Index all enabled sources, or a specific one.
 * @param {object} opts - { sourceName, force }
 * @returns {object} Stats about the indexing run
 */
export async function indexSources(opts = {}) {
  const { sourceName, force = false } = opts;

  let sources;
  if (sourceName) {
    const source = getSource(sourceName);
    if (!source) throw new Error(`Source not found: ${sourceName}`);
    if (!source.enabled) throw new Error(`Source "${sourceName}" is disabled`);
    sources = [source];
  } else {
    sources = listSources().filter(s => s.enabled);
  }

  if (sources.length === 0) {
    return { message: 'No enabled sources found. Add a source first.' };
  }

  const stats = {
    sources_processed: 0,
    blocks_discovered: 0,
    blocks_inserted: 0,
    blocks_updated: 0,
    blocks_skipped: 0,
    blocks_removed: 0,
    static_blocks: 0,
    dynamic_blocks: 0,
    hybrid_blocks: 0,
    total_attributes: 0,
    total_variations: 0,
    total_examples: 0,
    verified_examples: 0,
    structural_only_examples: 0,
    errors: [],
  };

  for (const source of sources) {
    try {
      console.error(`Fetching source: ${source.name} (${source.type})...`);
      const localPath = await fetchSource(source);
      console.error(`Indexing source: ${source.name} from ${localPath}`);
      await indexSource(source, localPath, force, stats);
      stats.sources_processed++;
    } catch (err) {
      const msg = `Error processing source "${source.name}": ${err.message}`;
      console.error(msg);
      stats.errors.push(msg);
    }
  }

  return stats;
}

/**
 * Index a single source — discover blocks, parse, generate markup, store.
 */
async function indexSource(source, localPath, force, stats) {
  // Discover all block.json files
  const blockJsonFiles = await fg(['**/block.json'], {
    cwd: localPath,
    ignore: IGNORE_PATTERNS,
    absolute: false,
    onlyFiles: true,
  });

  console.error(`Found ${blockJsonFiles.length} block.json files in ${source.name}`);

  const activeBlockIds = [];

  for (const blockJsonFile of blockJsonFiles) {
    const blockDir = dirname(blockJsonFile);
    const fullBlockDir = join(localPath, blockDir);

    try {
      // Compute content hash for the block directory (block.json + save.js + edit.js + variations.js)
      const dirHash = computeBlockDirHash(fullBlockDir);

      // Incremental skip
      if (!force) {
        const indexed = getIndexedFile(source.id, blockDir);
        if (indexed && indexed.content_hash === dirHash) {
          // Find the existing block ID to track as active
          const blockJson = parseBlockJson(fullBlockDir);
          if (blockJson?.name) {
            const { getBlockByName } = await import('./db.js');
            const existing = getBlockByName(blockJson.name);
            if (existing) activeBlockIds.push(existing.id);
          }
          stats.blocks_skipped++;
          continue;
        }
      }

      // Parse the block
      const blockData = extractBlock(fullBlockDir);
      if (!blockData.blockJson || !blockData.blockJson.name) {
        console.error(`  Skipping ${blockDir} — no valid block name`);
        continue;
      }

      stats.blocks_discovered++;

      // Determine block type from save parser
      const blockType = blockData.save.blockType;

      // Calculate confidence
      const confidence = calculateConfidence(blockData);

      // Upsert block into database
      const blockResult = upsertBlock({
        source_id: source.id,
        block_name: blockData.blockJson.name,
        title: blockData.blockJson.title,
        description: blockData.blockJson.description,
        category: blockData.blockJson.category,
        block_type: blockType,
        api_version: blockData.blockJson.apiVersion,
        validation_status: 'unverified', // Tier 2 validation happens separately
        confidence,
        file_path: blockDir,
        content_hash: dirHash,
      });

      const blockId = blockResult.id;
      activeBlockIds.push(blockId);

      if (blockResult.action === 'inserted') stats.blocks_inserted++;
      else if (blockResult.action === 'updated') stats.blocks_updated++;
      else { stats.blocks_skipped++; continue; }

      // Track block type
      if (blockType === 'static') stats.static_blocks++;
      else if (blockType === 'dynamic') stats.dynamic_blocks++;
      else if (blockType === 'hybrid') stats.hybrid_blocks++;

      // Insert attributes
      if (blockData.blockJson.attributes && Object.keys(blockData.blockJson.attributes).length > 0) {
        insertAttributes(blockId, blockData.blockJson.attributes);
        stats.total_attributes += Object.keys(blockData.blockJson.attributes).length;
      }

      // Insert supports
      const supports = blockData.blockJson.supports || {};
      const nonNullSupports = Object.fromEntries(
        Object.entries(supports).filter(([, v]) => v !== null && v !== undefined)
      );
      if (Object.keys(nonNullSupports).length > 0) {
        insertSupports(blockId, nonNullSupports);
      }

      // Insert variations
      if (blockData.variations.length > 0) {
        for (const variation of blockData.variations) {
          insertVariation({
            block_id: blockId,
            name: variation.name,
            title: variation.title,
            description: variation.description,
            attributes: variation.attributes,
            inner_blocks: variation.innerBlocks,
            scope: variation.scope,
          });
          stats.total_variations++;
        }
      }

      // Generate, validate, and insert markup examples
      let blockValidationStatus = 'unverified';
      const exampleStatuses = [];

      if (blockType === 'dynamic') {
        // Dynamic blocks: store self-closing comment markup
        const dynMarkup = generateDynamicMarkup(blockData.blockJson.name);
        insertMarkupExample({
          block_id: blockId,
          title: 'Dynamic Block',
          description: 'Self-closing comment format — HTML rendered server-side by PHP',
          markup: dynMarkup,
          attributes_json: '{}',
          validation_status: 'attributes_only',
          features_used: [],
        });
        stats.total_examples++;
        blockValidationStatus = 'attributes_only';
      } else {
        // Static/hybrid blocks: generate markup examples, validate each
        const examples = generateMarkupExamples(blockData);
        // Build a minimal schema object for validation
        const schemaForValidation = {
          block_name: blockData.blockJson.name,
          block_type: blockType,
          attributes: Object.entries(blockData.blockJson.attributes || {}).map(([name, attr]) => ({
            name,
            type: Array.isArray(attr.type) ? attr.type.join('|') : (attr.type || null),
            enum_values: attr.enum ? JSON.stringify(attr.enum) : null,
          })),
          supports: Object.entries(blockData.blockJson.supports || {}).map(([feature, config]) => ({
            feature,
            config: JSON.stringify(config),
          })),
        };

        for (const example of examples) {
          // Run validation pipeline
          let validationStatus = 'unverified';
          try {
            const result = validateMarkup(example.markup, schemaForValidation, blockData.save);
            validationStatus = result.status;
            if (validationStatus === 'verified') stats.verified_examples++;
            else if (validationStatus === 'structural_only') stats.structural_only_examples++;
          } catch {
            // Validation failed — leave as unverified
          }

          exampleStatuses.push(validationStatus);
          insertMarkupExample({
            block_id: blockId,
            title: example.title,
            description: example.description,
            markup: example.markup,
            attributes_json: JSON.stringify(example.attributes),
            validation_status: validationStatus,
            features_used: example.features,
          });
          stats.total_examples++;
        }

        // Determine block-level validation status from examples
        if (exampleStatuses.length > 0 && exampleStatuses.every(s => s === 'verified')) {
          blockValidationStatus = 'verified';
        } else if (exampleStatuses.some(s => s === 'verified')) {
          blockValidationStatus = 'structural_only';
        }
      }

      // Update block-level validation status
      updateBlockValidation(blockId, blockValidationStatus);

      // Track this block directory as indexed
      const blockStat = statSync(join(fullBlockDir, 'block.json'));
      upsertIndexedFile(source.id, blockDir, blockStat.mtimeMs, dirHash);

      console.error(`  ✓ ${blockData.blockJson.name} (${blockType}, confidence: ${confidence}%)`);
    } catch (err) {
      const msg = `Error indexing block in ${blockDir}: ${err.message}`;
      console.error(`  ✗ ${msg}`);
      stats.errors.push(msg);
    }
  }

  // Soft-delete blocks no longer present in source
  const removed = markBlocksRemoved(source.id, activeBlockIds);
  stats.blocks_removed += removed;
  if (removed > 0) {
    console.error(`  Removed ${removed} blocks no longer in source`);
  }
}

/**
 * Extract all data from a single block directory.
 */
function extractBlock(blockPath) {
  const blockJson = parseBlockJson(blockPath);
  const edit = parseEditFile(blockPath);
  const save = parseSaveFile(blockPath);
  const variations = parseVariationsFile(blockPath);

  return { blockJson, edit, save, variations };
}

/**
 * Calculate a confidence score (0-100) for the extraction.
 */
function calculateConfidence(blockData) {
  let score = 0;
  let factors = 0;

  // block.json parsed successfully
  if (blockData.blockJson) {
    score += 100;
    factors++;
  }

  // Edit controls found
  if (blockData.edit.controls.length > 0) {
    score += 80;
  }
  factors++;

  // Save patterns found
  if (blockData.save.hasCustomSave) {
    score += 70;
  } else if (blockData.save.returnsNull) {
    score += 60; // Dynamic blocks are still valid, slightly lower confidence
  }
  factors++;

  return factors > 0 ? Math.round(score / factors) : 0;
}

/**
 * Compute a content hash for a block directory.
 * Hashes the contents of key files: block.json, save.js, edit.js, variations.js
 */
function computeBlockDirHash(blockDir) {
  const hash = createHash('sha256');
  const files = ['block.json', 'save.js', 'edit.js', 'variations.js'];

  for (const file of files) {
    const fullPath = join(blockDir, file);
    try {
      const content = readFileSync(fullPath, 'utf-8');
      hash.update(content);
    } catch {
      // File doesn't exist — that's fine, hash the absence
      hash.update(`__missing__${file}`);
    }
  }

  return hash.digest('hex').slice(0, 16);
}
