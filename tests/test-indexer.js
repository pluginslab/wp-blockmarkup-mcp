import {
  getDb, closeDb, addSource, getSource, removeSource, getStats, getBlockSchema, searchBlocks,
} from '../src/db.js';
import { indexSources } from '../src/indexer.js';

// Use the already-cloned Gutenberg repo from the block extractor as a local source
const gutenbergPath = '/Users/marcelschmitz/localdev/ai-related/pluginslab-skills/gutenberg-block-extractor/gutenberg';

async function run() {
  const db = getDb();

  // Clean up any previous test
  try { removeSource('test-gutenberg'); } catch {}

  // Register as local folder source, pointing at the block-library subfolder
  addSource({
    name: 'test-gutenberg',
    type: 'local-folder',
    local_path: `${gutenbergPath}/packages/block-library/src`,
  });

  console.log('Source added:', getSource('test-gutenberg').name);

  // Run the indexer
  console.log('\nIndexing...\n');
  const stats = await indexSources({ sourceName: 'test-gutenberg' });

  console.log('\n=== Indexing Stats ===');
  console.log(`Sources processed: ${stats.sources_processed}`);
  console.log(`Blocks discovered: ${stats.blocks_discovered}`);
  console.log(`  inserted: ${stats.blocks_inserted}`);
  console.log(`  updated: ${stats.blocks_updated}`);
  console.log(`  skipped: ${stats.blocks_skipped}`);
  console.log(`  removed: ${stats.blocks_removed}`);
  console.log(`Block types: static=${stats.static_blocks}, dynamic=${stats.dynamic_blocks}, hybrid=${stats.hybrid_blocks}`);
  console.log(`Total attributes: ${stats.total_attributes}`);
  console.log(`Total variations: ${stats.total_variations}`);
  console.log(`Total markup examples: ${stats.total_examples}`);
  console.log(`Errors: ${stats.errors.length}`);
  if (stats.errors.length > 0) {
    stats.errors.forEach(e => console.log(`  - ${e}`));
  }

  // Test DB stats
  console.log('\n=== DB Stats ===');
  const dbStats = getStats();
  console.log(JSON.stringify(dbStats.totals, null, 2));

  // Test search
  console.log('\n=== Search Test ===');
  const results = searchBlocks('paragraph');
  console.log(`"paragraph" search: ${results.length} results`);
  if (results.length > 0) console.log(`  First: ${results[0].block_name} (${results[0].block_type})`);

  // Test schema
  console.log('\n=== Schema Test ===');
  const schema = getBlockSchema('core/paragraph');
  if (schema) {
    console.log(`core/paragraph schema:`);
    console.log(`  attrs: ${schema.attributes.length}`);
    console.log(`  supports: ${schema.supports.length}`);
    console.log(`  examples: ${schema.examples.length}`);
    console.log(`  variations: ${schema.variations.length}`);
    console.log(`  type: ${schema.block_type}`);
  }

  // Test re-index (should skip all)
  console.log('\n=== Re-index Test (should skip all) ===');
  const reindexStats = await indexSources({ sourceName: 'test-gutenberg' });
  console.log(`Skipped: ${reindexStats.blocks_skipped}, Inserted: ${reindexStats.blocks_inserted}`);

  // Clean up
  removeSource('test-gutenberg');
  closeDb();
  console.log('\nDone!');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
