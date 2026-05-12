import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse as wpParse } from '@wordpress/block-serialization-default-parser';
import {
  validatePresetReferences,
  wpToKebabCase,
} from '../src/validation/preset-reference-validator.js';

test('wpToKebabCase: digit->letter boundary', () => {
  assert.equal(wpToKebabCase('30x'), '30-x');
  assert.equal(wpToKebabCase('16x'), '16-x');
});

test('wpToKebabCase: letter->digit boundary', () => {
  assert.equal(wpToKebabCase('x30'), 'x-30');
});

test('wpToKebabCase: camelCase boundary', () => {
  assert.equal(wpToKebabCase('fontSize'), 'font-size');
});

test('wpToKebabCase: no boundary', () => {
  assert.equal(wpToKebabCase('primary'), 'primary');
  assert.equal(wpToKebabCase('lg'), 'lg');
});

test('wpToKebabCase: pre-hyphenated slug with digit->letter at end', () => {
  assert.equal(wpToKebabCase('0-5x'), '0-5-x');
});

function parse(markup) {
  return wpParse(markup).filter(b => b.blockName !== null);
}

test('flags digit->letter mismatch in inline style', () => {
  const markup = `<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|30x"}}}} -->
<div class="wp-block-group" style="padding-top:var(--wp--preset--spacing--30x)"></div>
<!-- /wp:group -->`;
  const { warnings } = validatePresetReferences(parse(markup));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /core\/group/);
  assert.match(warnings[0], /style\.spacing\.padding\.top/);
  assert.match(warnings[0], /--wp--preset--spacing--30x/);
  assert.match(warnings[0], /--wp--preset--spacing--30-x/);
});

test('passes when inline style uses canonical kebab form', () => {
  const markup = `<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|30x"}}}} -->
<div class="wp-block-group" style="padding-top:var(--wp--preset--spacing--30-x)"></div>
<!-- /wp:group -->`;
  const { warnings } = validatePresetReferences(parse(markup));
  assert.deepEqual(warnings, []);
});

test('passes when slug has no digit-letter boundary', () => {
  const markup = `<!-- wp:group {"backgroundColor":"primary","style":{"color":{"background":"var:preset|color|primary"}}} -->
<div class="wp-block-group" style="background:var(--wp--preset--color--primary)"></div>
<!-- /wp:group -->`;
  const { warnings } = validatePresetReferences(parse(markup));
  assert.deepEqual(warnings, []);
});

test('handles 0-5x decimal-with-x suffix', () => {
  const okMarkup = `<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|0-5x"}}}} -->
<div class="wp-block-group" style="padding-top:var(--wp--preset--spacing--0-5-x)"></div>
<!-- /wp:group -->`;
  assert.deepEqual(validatePresetReferences(parse(okMarkup)).warnings, []);

  const badMarkup = `<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|0-5x"}}}} -->
<div class="wp-block-group" style="padding-top:var(--wp--preset--spacing--0-5x)"></div>
<!-- /wp:group -->`;
  const { warnings } = validatePresetReferences(parse(badMarkup));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /--wp--preset--spacing--0-5-x/);
});

test('validates multiple preset references in same block independently', () => {
  const markup = `<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|30x","right":"var:preset|spacing|16x"}}}} -->
<div class="wp-block-group" style="padding-top:var(--wp--preset--spacing--30x);padding-right:var(--wp--preset--spacing--16x)"></div>
<!-- /wp:group -->`;
  const { warnings } = validatePresetReferences(parse(markup));
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some(w => w.includes('30x') && w.includes('30-x')));
  assert.ok(warnings.some(w => w.includes('16x') && w.includes('16-x')));
});

test('no preset references means no work and no warnings', () => {
  const markup = `<!-- wp:paragraph -->
<p>Hello world</p>
<!-- /wp:paragraph -->`;
  const { warnings } = validatePresetReferences(parse(markup));
  assert.deepEqual(warnings, []);
});

test('recurses into inner blocks', () => {
  const markup = `<!-- wp:group -->
<div class="wp-block-group">
<!-- wp:paragraph {"style":{"spacing":{"padding":{"top":"var:preset|spacing|30x"}}}} -->
<p style="padding-top:var(--wp--preset--spacing--30x)">x</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->`;
  const { warnings } = validatePresetReferences(parse(markup));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /core\/paragraph/);
});

test('does not flag when preset ref exists in attrs but not in inline style', () => {
  // Dynamic-block-like case: attr references preset but innerHTML is empty.
  const markup = `<!-- wp:latest-posts {"style":{"spacing":{"padding":{"top":"var:preset|spacing|30x"}}}} /-->`;
  const { warnings } = validatePresetReferences(parse(markup));
  assert.deepEqual(warnings, []);
});

test('real-world reproducer: hero pattern with two mismatches', () => {
  const markup = `<!-- wp:group {"className":"pl-hero","style":{"spacing":{"padding":{"top":"var:preset|spacing|30x","right":"var:preset|spacing|16x"}}},"backgroundColor":"gray-900","layout":{"type":"constrained"}} -->
<div class="wp-block-group pl-hero has-gray-900-background-color has-background" style="padding-top:var(--wp--preset--spacing--30x);padding-right:var(--wp--preset--spacing--16x)">
</div>
<!-- /wp:group -->`;
  const { warnings } = validatePresetReferences(parse(markup));
  assert.equal(warnings.length, 2);
});
