import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSourceFile } from '../src/utils/file-utils.js';
import { parseSaveFile } from '../src/parsers/save-parser.js';
import { parseEditFile } from '../src/parsers/edit-parser.js';
import { parseVariationsFile } from '../src/parsers/variations-parser.js';

// Gutenberg renamed its JSX-bearing block sources from .js to .jsx in
// WordPress/gutenberg#80990 (August 2026). A block that only ships .jsx
// files must be parsed exactly like one that ships .js files.

let root;

const SAVE = `
import { useBlockProps, RichText } from '@wordpress/block-editor';
export default function save( { attributes } ) {
  return (
    <p { ...useBlockProps.save() }>
      <RichText.Content value={ attributes.content } />
    </p>
  );
}
`;

const EDIT = `
import { InspectorControls } from '@wordpress/block-editor';
import { ToggleControl } from '@wordpress/components';
export default function Edit( { attributes, setAttributes } ) {
  return (
    <InspectorControls>
      <ToggleControl
        label="Drop cap"
        checked={ attributes.dropCap }
        onChange={ ( dropCap ) => setAttributes( { dropCap } ) }
      />
    </InspectorControls>
  );
}
`;

const VARIATIONS = `
const variations = [
  { name: 'plain', title: 'Plain', icon: <svg />, attributes: { dropCap: false } },
];
export default variations;
`;

function writeBlock(dir, ext) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'block.json'), JSON.stringify({ name: 'test/demo' }));
  writeFileSync(join(dir, `save${ext}`), SAVE);
  writeFileSync(join(dir, `edit${ext}`), EDIT);
  writeFileSync(join(dir, `variations${ext}`), VARIATIONS);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'wp-blockmarkup-src-'));
  writeBlock(join(root, 'js'), '.js');
  writeBlock(join(root, 'jsx'), '.jsx');
  writeBlock(join(root, 'tsx'), '.tsx');
  mkdirSync(join(root, 'empty'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

test('resolveSourceFile: finds .js, .jsx and .tsx sources', () => {
  assert.equal(resolveSourceFile(join(root, 'js'), 'save'), `${join(root, 'js')}/save.js`);
  assert.equal(resolveSourceFile(join(root, 'jsx'), 'save'), `${join(root, 'jsx')}/save.jsx`);
  assert.equal(resolveSourceFile(join(root, 'tsx'), 'save'), `${join(root, 'tsx')}/save.tsx`);
});

test('resolveSourceFile: returns null when no source exists', () => {
  assert.equal(resolveSourceFile(join(root, 'empty'), 'save'), null);
});

test('resolveSourceFile: prefers .js when several extensions exist', () => {
  const dir = join(root, 'both');
  mkdirSync(dir);
  writeFileSync(join(dir, 'save.js'), SAVE);
  writeFileSync(join(dir, 'save.jsx'), SAVE);
  assert.equal(resolveSourceFile(dir, 'save'), `${dir}/save.js`);
});

test('parseSaveFile: a .jsx-only block is static, like its .js twin', () => {
  const fromJs = parseSaveFile(join(root, 'js'));
  const fromJsx = parseSaveFile(join(root, 'jsx'));
  assert.equal(fromJsx.blockType, 'static');
  assert.equal(fromJsx.hasCustomSave, true);
  assert.deepEqual(fromJsx, fromJs);
});

test('parseSaveFile: a block without any save source stays dynamic', () => {
  assert.equal(parseSaveFile(join(root, 'empty')).blockType, 'dynamic');
});

test('parseEditFile: controls are extracted from edit.jsx', () => {
  const fromJs = parseEditFile(join(root, 'js'));
  const fromJsx = parseEditFile(join(root, 'jsx'));
  assert.ok(fromJsx.controls.length > 0);
  assert.deepEqual(fromJsx, fromJs);
});

test('parseVariationsFile: variations are extracted from variations.jsx', () => {
  const fromJs = parseVariationsFile(join(root, 'js'));
  const fromJsx = parseVariationsFile(join(root, 'jsx'));
  assert.equal(fromJsx.length, 1);
  assert.deepEqual(fromJsx, fromJs);
});
