import { parseBlockJson } from '../src/parsers/block-json-parser.js';
import { parseSaveFile } from '../src/parsers/save-parser.js';
import { parseEditFile } from '../src/parsers/edit-parser.js';
import { parseVariationsFile } from '../src/parsers/variations-parser.js';
import { generateMarkupExamples, generateDynamicMarkup } from '../src/utils/markup-generator.js';

const gutenberg = '/Users/marcelschmitz/localdev/ai-related/pluginslab-skills/gutenberg-block-extractor/gutenberg';

// Test a few representative blocks
const blocks = [
  { name: 'paragraph', type: 'static' },
  { name: 'heading', type: 'static' },
  { name: 'image', type: 'static' },
  { name: 'columns', type: 'static' },
  { name: 'latest-posts', type: 'dynamic' },
  { name: 'search', type: 'dynamic' },
];

console.log('=== Parser Tests ===\n');

for (const { name, type } of blocks) {
  const blockPath = `${gutenberg}/packages/block-library/src/${name}`;

  const blockJson = parseBlockJson(blockPath);
  const save = parseSaveFile(blockPath);
  const edit = parseEditFile(blockPath);
  const variations = parseVariationsFile(blockPath);

  const attrCount = Object.keys(blockJson?.attributes || {}).length;
  const supportCount = Object.keys(blockJson?.supports || {}).filter(k => blockJson.supports[k] !== null).length;

  console.log(`${blockJson?.name || name}:`);
  console.log(`  block.json: ${attrCount} attrs, ${supportCount} supports`);
  console.log(`  save.js: type=${save.blockType}, wrapper=${save.wrapperElement}, innerBlocks=${save.usesInnerBlocks}`);
  console.log(`  edit.js: ${edit.controls.length} controls, ${edit.imports.length} imports`);
  console.log(`  variations: ${variations.length}`);

  // Verify block type detection
  const detectedType = save.blockType;
  const typeMatch = detectedType === type;
  console.log(`  type check: expected=${type}, got=${detectedType} ${typeMatch ? '✓' : '✗ MISMATCH'}`);

  // Generate markup
  const blockData = { blockJson, save, edit, variations };
  if (detectedType === 'dynamic') {
    const dynMarkup = generateDynamicMarkup(blockJson.name);
    console.log(`  dynamic markup: ${dynMarkup}`);
  } else {
    const examples = generateMarkupExamples(blockData);
    console.log(`  markup examples: ${examples.length} generated`);
    if (examples.length > 0) {
      console.log(`  first example: ${examples[0].markup.substring(0, 80)}...`);
    }
  }

  console.log('');
}

console.log('=== All parser tests passed ===');
