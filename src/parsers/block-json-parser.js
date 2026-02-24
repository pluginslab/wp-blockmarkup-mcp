/**
 * Parser for block.json files — extracts metadata, attributes, and support configs.
 */
import { readJSON, fileExists } from '../utils/file-utils.js';

/**
 * Parse a block.json file and return structured block data.
 * @param {string} blockPath - Directory containing the block
 * @returns {object|null}
 */
export function parseBlockJson(blockPath) {
  const blockJsonPath = `${blockPath}/block.json`;

  if (!fileExists(blockJsonPath)) {
    return null;
  }

  const raw = readJSON(blockJsonPath);

  return {
    name: raw.name || null,
    title: raw.title || null,
    category: raw.category || null,
    description: raw.description || null,
    keywords: raw.keywords || [],
    attributes: extractAttributes(raw.attributes || {}),
    supports: extractSupports(raw.supports || {}),
    parent: raw.parent || null,
    ancestor: raw.ancestor || null,
    providesContext: raw.providesContext || null,
    usesContext: raw.usesContext || [],
    example: raw.example || null,
    apiVersion: raw.apiVersion || 2,
  };
}

function extractAttributes(attributes) {
  const extracted = {};
  for (const [name, config] of Object.entries(attributes)) {
    extracted[name] = {
      type: config.type || 'unknown',
      default: config.default !== undefined ? config.default : null,
      source: config.source || null,
      selector: config.selector || null,
      attribute: config.attribute || null,
      query: config.query || null,
      enum: config.enum || null,
      role: config.role || null,
      multiline: config.multiline || null,
    };
  }
  return extracted;
}

function extractSupports(supports) {
  return {
    align: extractAlignSupport(supports.align),
    alignWide: supports.alignWide !== undefined ? supports.alignWide : null,
    anchor: supports.anchor !== undefined ? supports.anchor : null,
    ariaLabel: supports.ariaLabel !== undefined ? supports.ariaLabel : null,
    className: supports.className !== undefined ? supports.className : null,
    color: extractColorSupport(supports.color),
    customClassName: supports.customClassName !== undefined ? supports.customClassName : null,
    defaultStylePicker: supports.defaultStylePicker !== undefined ? supports.defaultStylePicker : null,
    html: supports.html !== undefined ? supports.html : null,
    inserter: supports.inserter !== undefined ? supports.inserter : null,
    multiple: supports.multiple !== undefined ? supports.multiple : null,
    reusable: supports.reusable !== undefined ? supports.reusable : null,
    spacing: extractSpacingSupport(supports.spacing),
    typography: extractTypographySupport(supports.typography),
    border: extractBorderSupport(supports.__experimentalBorder || supports.border),
    dimensions: extractDimensionsSupport(supports.dimensions),
    position: extractPositionSupport(supports.position),
    layout: supports.layout || null,
    interactivity: supports.interactivity || null,
    lock: supports.lock !== undefined ? supports.lock : null,
    splitting: supports.splitting !== undefined ? supports.splitting : null,
  };
}

function extractAlignSupport(align) {
  if (align === undefined || align === null) return null;
  if (align === true) return ['left', 'center', 'right', 'wide', 'full'];
  if (align === false) return false;
  if (Array.isArray(align)) return align;
  return null;
}

function extractColorSupport(color) {
  if (!color) return null;
  if (color === true) return { enabled: true };
  return {
    enabled: true,
    background: color.background !== undefined ? color.background : null,
    gradients: color.gradients !== undefined ? color.gradients : null,
    text: color.text !== undefined ? color.text : null,
    link: color.link !== undefined ? color.link : null,
    button: color.button !== undefined ? color.button : null,
    heading: color.heading !== undefined ? color.heading : null,
  };
}

function extractSpacingSupport(spacing) {
  if (!spacing) return null;
  if (spacing === true) return { enabled: true };
  return {
    enabled: true,
    margin: spacing.margin !== undefined ? spacing.margin : null,
    padding: spacing.padding !== undefined ? spacing.padding : null,
    blockGap: spacing.blockGap !== undefined ? spacing.blockGap : null,
  };
}

function extractTypographySupport(typography) {
  if (!typography) return null;
  if (typography === true) return { enabled: true };
  return {
    enabled: true,
    fontSize: typography.fontSize !== undefined ? typography.fontSize : null,
    lineHeight: typography.lineHeight !== undefined ? typography.lineHeight : null,
    textAlign: typography.textAlign !== undefined ? typography.textAlign : null,
    fontFamily: typography.__experimentalFontFamily !== undefined ? typography.__experimentalFontFamily : null,
    fontStyle: typography.__experimentalFontStyle !== undefined ? typography.__experimentalFontStyle : null,
    fontWeight: typography.__experimentalFontWeight !== undefined ? typography.__experimentalFontWeight : null,
    letterSpacing: typography.__experimentalLetterSpacing !== undefined ? typography.__experimentalLetterSpacing : null,
    textDecoration: typography.__experimentalTextDecoration !== undefined ? typography.__experimentalTextDecoration : null,
    textTransform: typography.__experimentalTextTransform !== undefined ? typography.__experimentalTextTransform : null,
    writingMode: typography.__experimentalWritingMode !== undefined ? typography.__experimentalWritingMode : null,
  };
}

function extractBorderSupport(border) {
  if (!border) return null;
  if (border === true) return { enabled: true };
  return {
    enabled: true,
    color: border.color !== undefined ? border.color : null,
    radius: border.radius !== undefined ? border.radius : null,
    style: border.style !== undefined ? border.style : null,
    width: border.width !== undefined ? border.width : null,
  };
}

function extractDimensionsSupport(dimensions) {
  if (!dimensions) return null;
  if (dimensions === true) return { enabled: true };
  return {
    enabled: true,
    minHeight: dimensions.minHeight !== undefined ? dimensions.minHeight : null,
    aspectRatio: dimensions.aspectRatio !== undefined ? dimensions.aspectRatio : null,
  };
}

function extractPositionSupport(position) {
  if (!position) return null;
  if (position === true) return { enabled: true };
  return {
    enabled: true,
    sticky: position.sticky !== undefined ? position.sticky : null,
  };
}
