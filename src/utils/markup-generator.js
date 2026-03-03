/**
 * Generates Gutenberg block markup examples for validation and storage.
 */
import { DEFAULT_COLORS, DEFAULT_FONT_SIZES } from './component-defaults.js';

/**
 * Generate markup examples for a block based on its parsed data.
 * @param {object} blockData - { blockJson, save }
 * @returns {object[]} Array of { title, description, markup, attributes, features }
 */
export function generateMarkupExamples(blockData) {
  const examples = [];
  const { blockJson } = blockData;

  if (!blockJson || !blockJson.name) return examples;

  const blockName = blockJson.name;
  const supports = blockJson.supports || {};

  // Basic — no attributes
  examples.push({
    title: 'Basic Usage',
    description: 'Minimal block with no additional attributes',
    markup: generateBasicMarkup(blockName, blockData),
    attributes: {},
    features: [],
  });

  if (supports.align) {
    examples.push({
      title: 'With Alignment',
      description: 'Block with text alignment',
      markup: generateAlignmentExample(blockName, blockData),
      attributes: { align: 'center' },
      features: ['align'],
    });
  }

  if (supports.color) {
    examples.push({
      title: 'With Colors',
      description: 'Block with background and text colors',
      markup: generateColorExample(blockName, blockData),
      attributes: { backgroundColor: 'pale-cyan-blue', textColor: 'vivid-purple' },
      features: ['color'],
    });
  }

  if (supports.typography) {
    examples.push({
      title: 'With Typography',
      description: 'Block with custom typography settings',
      markup: generateTypographyExample(blockName, blockData),
      attributes: { fontSize: 'large' },
      features: ['typography'],
    });
  }

  if (supports.spacing) {
    examples.push({
      title: 'With Spacing',
      description: 'Block with padding and margin',
      markup: generateSpacingExample(blockName, blockData),
      attributes: { style: { spacing: { padding: { top: '2rem', right: '2rem', bottom: '2rem', left: '2rem' } } } },
      features: ['spacing'],
    });
  }

  // Full-featured
  examples.push({
    title: 'Full Featured',
    description: 'Block with multiple attributes combined',
    markup: generateFullFeaturedExample(blockName, blockData),
    attributes: buildFullAttributes(supports),
    features: Object.keys(supports).filter(k => supports[k]),
  });

  return examples;
}

function getWrapper(blockData) {
  if (blockData.save?.wrapperElement) return blockData.save.wrapperElement;

  // Block-specific defaults for blocks whose save.js uses variable wrapper elements
  // (e.g., core/heading uses <TagName> which resolves to h1-h6 at runtime)
  const blockName = blockData.blockJson?.name;
  const wrapperDefaults = {
    'core/heading': 'h2',
    'core/button': 'div',
    'core/list': 'ul',
    'core/list-item': 'li',
    'core/quote': 'blockquote',
    'core/pullquote': 'figure',
    'core/verse': 'pre',
  };

  return wrapperDefaults[blockName] || 'div';
}

function getBlockClass(blockName) {
  return `wp-block-${blockName.replace('core/', '')}`;
}

function getDefaultContent(blockName) {
  const blockType = blockName.split('/')[1];
  const contentMap = {
    paragraph: 'This is a paragraph block with example content.',
    heading: 'Example Heading',
    list: '<li>List item 1</li><li>List item 2</li><li>List item 3</li>',
    quote: '<p>This is a quote block with inspiring content.</p>',
    code: 'function example() {\n  return "Hello World";\n}',
    preformatted: 'Preformatted text preserves   spaces and\nline breaks.',
    pullquote: '<p>A pull quote stands out from the rest of the content.</p>',
    verse: 'Verse text\npreserves line breaks\nfor poetry',
    button: '<a class="wp-block-button__link" href="#">Click Me</a>',
    table: '<table><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>',
  };
  return contentMap[blockType] || '';
}

function generateBasicMarkup(blockName, blockData) {
  const wrapper = getWrapper(blockData);
  const content = getDefaultContent(blockName);
  const blockClass = getBlockClass(blockName);

  if (!content && blockData.save?.usesInnerBlocks) {
    return `<!-- wp:${blockName} -->\n<${wrapper} class="${blockClass}"><!-- wp:paragraph -->\n<p>Inner content</p>\n<!-- /wp:paragraph --></${wrapper}>\n<!-- /wp:${blockName} -->`;
  }

  if (!content) {
    return `<!-- wp:${blockName} -->\n<${wrapper} class="${blockClass}"></${wrapper}>\n<!-- /wp:${blockName} -->`;
  }

  return `<!-- wp:${blockName} -->\n<${wrapper} class="${blockClass}">${content}</${wrapper}>\n<!-- /wp:${blockName} -->`;
}

function generateAlignmentExample(blockName, blockData) {
  const wrapper = getWrapper(blockData);
  const content = getDefaultContent(blockName) || '';
  const blockClass = getBlockClass(blockName);

  return `<!-- wp:${blockName} {"align":"center"} -->\n<${wrapper} class="${blockClass} has-text-align-center">${content}</${wrapper}>\n<!-- /wp:${blockName} -->`;
}

function generateColorExample(blockName, blockData) {
  const wrapper = getWrapper(blockData);
  const content = getDefaultContent(blockName) || '';
  const blockClass = getBlockClass(blockName);
  const color = DEFAULT_COLORS[9]; // Pale cyan blue

  return `<!-- wp:${blockName} {"backgroundColor":"${color.slug}","textColor":"vivid-purple"} -->\n<${wrapper} class="${blockClass} has-${color.slug}-background-color has-vivid-purple-color has-text-color has-background">${content}</${wrapper}>\n<!-- /wp:${blockName} -->`;
}

function generateTypographyExample(blockName, blockData) {
  const wrapper = getWrapper(blockData);
  const content = getDefaultContent(blockName) || '';
  const blockClass = getBlockClass(blockName);
  const fontSize = DEFAULT_FONT_SIZES[2]; // Large

  return `<!-- wp:${blockName} {"fontSize":"${fontSize.slug}","style":{"typography":{"lineHeight":"1.5"}}} -->\n<${wrapper} class="${blockClass} has-${fontSize.slug}-font-size" style="line-height:1.5">${content}</${wrapper}>\n<!-- /wp:${blockName} -->`;
}

function generateSpacingExample(blockName, blockData) {
  const wrapper = getWrapper(blockData);
  const content = getDefaultContent(blockName) || '';
  const blockClass = getBlockClass(blockName);

  return `<!-- wp:${blockName} {"style":{"spacing":{"padding":{"top":"2rem","right":"2rem","bottom":"2rem","left":"2rem"},"margin":{"top":"1rem","bottom":"1rem"}}}} -->\n<${wrapper} class="${blockClass}" style="margin-top:1rem;margin-bottom:1rem;padding-top:2rem;padding-right:2rem;padding-bottom:2rem;padding-left:2rem">${content}</${wrapper}>\n<!-- /wp:${blockName} -->`;
}

function generateFullFeaturedExample(blockName, blockData) {
  const wrapper = getWrapper(blockData);
  const content = getDefaultContent(blockName) || '';
  const supports = blockData.blockJson?.supports || {};

  const attributes = buildFullAttributes(supports);
  const classes = [getBlockClass(blockName)];
  const styles = [];

  if (supports.align) {
    classes.push('has-text-align-center');
  }
  if (supports.color) {
    classes.push('has-pale-cyan-blue-background-color');
    classes.push('has-vivid-purple-color');
    classes.push('has-text-color');
    classes.push('has-background');
  }
  if (supports.typography && supports.typography.fontSize) {
    classes.push('has-large-font-size');
    styles.push('line-height:1.6');
  }
  if (supports.spacing) {
    styles.push('padding-top:1.5rem', 'padding-right:1.5rem', 'padding-bottom:1.5rem', 'padding-left:1.5rem');
  }

  const attrString = JSON.stringify(attributes);
  const classString = classes.join(' ');
  const styleString = styles.length > 0 ? ` style="${styles.join(';')}"` : '';

  return `<!-- wp:${blockName} ${attrString} -->\n<${wrapper} class="${classString}"${styleString}>${content}</${wrapper}>\n<!-- /wp:${blockName} -->`;
}

function buildFullAttributes(supports) {
  const attributes = {};

  if (supports.align) {
    attributes.align = 'center';
  }
  if (supports.color) {
    attributes.backgroundColor = 'pale-cyan-blue';
    attributes.textColor = 'vivid-purple';
  }
  if (supports.typography && supports.typography.fontSize) {
    attributes.fontSize = 'large';
    if (!attributes.style) attributes.style = {};
    if (!attributes.style.typography) attributes.style.typography = {};
    attributes.style.typography.lineHeight = '1.6';
  }
  if (supports.spacing) {
    if (!attributes.style) attributes.style = {};
    if (!attributes.style.spacing) attributes.style.spacing = {};
    attributes.style.spacing.padding = {
      top: '1.5rem', right: '1.5rem', bottom: '1.5rem', left: '1.5rem',
    };
  }

  return attributes;
}

/**
 * Generate the self-closing comment markup for dynamic blocks.
 * @param {string} blockName
 * @param {object} attributes
 * @returns {string}
 */
export function generateDynamicMarkup(blockName, attributes = {}) {
  const attrString = Object.keys(attributes).length > 0 ? ` ${JSON.stringify(attributes)}` : '';
  return `<!-- wp:${blockName}${attrString} /-->`;
}
