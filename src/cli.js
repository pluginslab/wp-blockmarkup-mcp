#!/usr/bin/env node

import { Command } from 'commander';
import {
  addSource,
  listSources,
  getSource,
  removeSource,
  searchBlocks,
  getBlockSchema,
  getBlockMarkup,
  searchVariations,
  getStats,
  rebuildFtsIndex,
  isSourceIndexed,
  closeDb,
} from './db.js';
import { indexSources } from './indexer.js';
import { validateStructural } from './validation/structural-validator.js';

const program = new Command();

program
  .name('wp-blocks')
  .description('Gutenberg block markup indexer and search CLI')
  .version('0.1.0');

// --- source:add ---
program
  .command('source:add')
  .description('Add a new block source and index it')
  .requiredOption('--name <name>', 'Unique source name')
  .requiredOption('--type <type>', 'Source type: github-public, github-private, local-folder')
  .option('--repo <url>', 'Repository URL (for github types)')
  .option('--subfolder <path>', 'Subfolder within repo to index')
  .option('--path <path>', 'Local folder path (for local-folder type)')
  .option('--token-env <var>', 'Environment variable name containing GitHub token')
  .option('--branch <branch>', 'Git branch (default: main)', 'main')
  .option('--no-index', 'Skip automatic indexing after adding')
  .action(async (opts) => {
    try {
      const existing = getSource(opts.name);
      if (existing) {
        console.error(`Source "${opts.name}" already exists. Remove it first.`);
        process.exit(1);
      }

      addSource({
        name: opts.name,
        type: opts.type,
        repo_url: opts.repo || null,
        subfolder: opts.subfolder || null,
        local_path: opts.path || null,
        token_env_var: opts.tokenEnv || null,
        branch: opts.branch,
      });

      console.log(`Source "${opts.name}" added successfully.`);

      if (opts.index) {
        console.log(`\nIndexing "${opts.name}"...`);
        const stats = await indexSources({ sourceName: opts.name });
        printIndexStats(stats);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- source:list ---
program
  .command('source:list')
  .description('List all configured sources')
  .action(() => {
    try {
      const sources = listSources();
      if (sources.length === 0) {
        console.log('No sources configured. Use "wp-blocks source:add" to add one.');
        return;
      }

      console.log(`\n${'Name'.padEnd(25)} ${'Type'.padEnd(18)} ${'Branch'.padEnd(10)} ${'Indexed'.padEnd(10)} Details`);
      console.log('-'.repeat(95));

      for (const s of sources) {
        const details = s.repo_url || s.local_path || '';
        const subfolder = s.subfolder ? ` [${s.subfolder}]` : '';
        const indexed = isSourceIndexed(s.id) ? 'yes' : 'no';
        console.log(
          `${s.name.padEnd(25)} ${s.type.padEnd(18)} ${(s.branch || 'main').padEnd(10)} ${indexed.padEnd(10)} ${details}${subfolder}`
        );
      }
      console.log('');
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- source:remove ---
program
  .command('source:remove <name>')
  .description('Remove a source and all its indexed data')
  .action((name) => {
    try {
      const removed = removeSource(name);
      if (!removed) {
        console.error(`Source "${name}" not found.`);
        process.exit(1);
      }
      console.log(`Source "${name}" removed along with all indexed data.`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- index ---
program
  .command('index')
  .description('Re-index all enabled sources (or a specific one)')
  .option('--source <name>', 'Index a specific source only')
  .option('--force', 'Ignore content hash cache and re-index everything', false)
  .action(async (opts) => {
    try {
      const stats = await indexSources({
        sourceName: opts.source,
        force: opts.force,
      });
      printIndexStats(stats);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- search ---
program
  .command('search <query>')
  .description('Search indexed blocks by name, title, description, or category')
  .option('--source <name>', 'Filter by source name')
  .option('--category <cat>', 'Filter by block category')
  .option('--type <type>', 'Filter by block type: static, dynamic, hybrid')
  .option('--limit <n>', 'Max results', '20')
  .option('--include-removed', 'Include removed blocks', false)
  .action((query, opts) => {
    try {
      const results = searchBlocks(query, {
        source: opts.source,
        category: opts.category,
        blockType: opts.type,
        includeRemoved: opts.includeRemoved,
        limit: parseInt(opts.limit, 10),
      });

      if (results.length === 0) {
        console.log(`No blocks found matching "${query}".`);
        return;
      }

      console.log(`\nFound ${results.length} block(s) matching "${query}":\n`);

      for (const b of results) {
        console.log(`  ${b.block_name}`);
        console.log(`    Title: ${b.title || '—'} | Category: ${b.category || '—'}`);
        console.log(`    Type: ${b.block_type} | Validation: ${b.validation_status} | Confidence: ${b.confidence}%`);
        console.log(`    Source: ${b.source_name}`);
        if (b.description) console.log(`    Description: ${b.description}`);
        if (b.status === 'removed') console.log('    Status: REMOVED');
        console.log('');
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- schema ---
program
  .command('schema <block-name>')
  .description('Show full schema for a block (attributes, supports, variations, examples)')
  .action((blockName) => {
    try {
      const schema = getBlockSchema(blockName);
      if (!schema) {
        console.error(`Block "${blockName}" not found.`);
        process.exit(1);
      }

      console.log(`\n## ${schema.block_name}`);
      console.log(`Title: ${schema.title || '—'}`);
      console.log(`Category: ${schema.category || '—'}`);
      console.log(`Type: ${schema.block_type} | Validation: ${schema.validation_status} | Confidence: ${schema.confidence}%`);
      if (schema.description) console.log(`Description: ${schema.description}`);

      if (schema.attributes.length > 0) {
        console.log(`\nAttributes (${schema.attributes.length}):`);
        for (const a of schema.attributes) {
          const def = a.default_val ? ` = ${a.default_val}` : '';
          const enums = a.enum_values ? ` [${a.enum_values}]` : '';
          console.log(`  ${a.name}: ${a.type || '?'}${def}${enums}`);
        }
      }

      if (schema.supports.length > 0) {
        console.log(`\nSupports (${schema.supports.length}):`);
        for (const s of schema.supports) {
          console.log(`  ${s.feature}: ${s.config}`);
        }
      }

      if (schema.variations.length > 0) {
        console.log(`\nVariations (${schema.variations.length}):`);
        for (const v of schema.variations) {
          console.log(`  ${v.name}: ${v.title || '—'}`);
        }
      }

      if (schema.examples.length > 0) {
        console.log(`\nMarkup Examples (${schema.examples.length}):`);
        for (const e of schema.examples) {
          console.log(`\n  --- ${e.title} (${e.validation_status}) ---`);
          console.log(`  ${e.markup.split('\n').join('\n  ')}`);
        }
      }

      console.log('');
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- stats ---
program
  .command('stats')
  .description('Show indexing statistics and validation coverage')
  .action(() => {
    try {
      const stats = getStats();

      console.log('\nOverall Statistics:');
      console.log(`  Sources:          ${stats.totals.sources}`);
      console.log(`  Active blocks:    ${stats.totals.active_blocks}`);
      console.log(`  Removed blocks:   ${stats.totals.removed_blocks}`);
      console.log(`  Static blocks:    ${stats.totals.static_blocks}`);
      console.log(`  Dynamic blocks:   ${stats.totals.dynamic_blocks}`);
      console.log(`  Hybrid blocks:    ${stats.totals.hybrid_blocks}`);
      console.log(`  Verified blocks:  ${stats.totals.verified_blocks}`);
      console.log(`  Total attributes: ${stats.totals.total_attributes}`);
      console.log(`  Total variations: ${stats.totals.total_variations}`);
      console.log(`  Total examples:   ${stats.totals.total_examples}`);

      if (stats.per_source.length > 0) {
        console.log('\nPer Source:');
        console.log(`  ${'Name'.padEnd(25)} ${'Blocks'.padEnd(8)} ${'Static'.padEnd(8)} ${'Dynamic'.padEnd(9)} ${'Verified'.padEnd(10)} ${'Attrs'.padEnd(7)} Vars`);
        console.log('  ' + '-'.repeat(80));
        for (const s of stats.per_source) {
          console.log(
            `  ${s.name.padEnd(25)} ${String(s.blocks).padEnd(8)} ${String(s.static_blocks).padEnd(8)} ${String(s.dynamic_blocks).padEnd(9)} ${String(s.verified_blocks).padEnd(10)} ${String(s.attributes).padEnd(7)} ${s.variations}`
          );
        }
      }
      console.log('');
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- validate ---
program
  .command('validate <markup>')
  .description('Validate raw Gutenberg block markup (structural check + attribute verification)')
  .action((markup) => {
    try {
      const result = validateStructural(markup);

      if (result.valid) {
        console.log('\nVALID — Structural validation passed.');
      } else {
        console.log(`\nINVALID — ${result.errors.length} error(s):`);
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log(`\nWarnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
          console.log(`  - ${w}`);
        }
      }

      if (result.parsedBlocks.length > 0) {
        const blocks = result.parsedBlocks.filter(b => b.blockName !== null);
        if (blocks.length > 0) {
          console.log(`\nParsed ${blocks.length} block(s):`);
          for (const b of blocks) {
            console.log(`  - ${b.blockName} (${Object.keys(b.attrs || {}).length} attributes, ${b.innerBlocks.length} inner blocks)`);
          }
        }
      }

      console.log('');
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// --- rebuild-index ---
program
  .command('rebuild-index')
  .description('Rebuild FTS indexes (recovery for out-of-sync full-text search)')
  .action(() => {
    try {
      rebuildFtsIndex();
      console.log('FTS indexes rebuilt successfully.');
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

function printIndexStats(stats) {
  console.log('\nIndexing complete:');
  console.log(`  Sources processed:  ${stats.sources_processed}`);
  console.log(`  Blocks discovered:  ${stats.blocks_discovered}`);
  console.log(`  Blocks inserted:    ${stats.blocks_inserted}`);
  console.log(`  Blocks updated:     ${stats.blocks_updated}`);
  console.log(`  Blocks unchanged:   ${stats.blocks_skipped}`);
  console.log(`  Blocks removed:     ${stats.blocks_removed}`);
  console.log(`  Block types:        static=${stats.static_blocks}, dynamic=${stats.dynamic_blocks}, hybrid=${stats.hybrid_blocks}`);
  console.log(`  Total attributes:   ${stats.total_attributes}`);
  console.log(`  Total variations:   ${stats.total_variations}`);
  console.log(`  Total examples:     ${stats.total_examples}`);
  console.log(`  Verified examples:  ${stats.verified_examples || 0}`);
  console.log(`  Structural only:    ${stats.structural_only_examples || 0}`);

  if (stats.errors.length > 0) {
    console.log(`\n  Errors (${stats.errors.length}):`);
    for (const err of stats.errors) {
      console.log(`    - ${err}`);
    }
  }
}

program.parse();
