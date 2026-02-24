/**
 * Parser for edit.js files — Babel AST analysis for UI controls.
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { readFile, fileExists } from '../utils/file-utils.js';

const CONTROL_PATTERNS = {
  AlignmentControl: { attribute: 'align', possibleValues: ['left', 'center', 'right', 'justify'] },
  BlockAlignmentControl: { attribute: 'align', possibleValues: ['left', 'center', 'right', 'wide', 'full', 'none'] },
  BlockVerticalAlignmentControl: { attribute: 'verticalAlignment', possibleValues: ['top', 'center', 'bottom', 'stretch'] },
  ColorPalette: { attribute: 'color', type: 'color' },
  ColorPicker: { attribute: 'color', type: 'color' },
  FontSizePicker: { attribute: 'fontSize', possibleValues: ['small', 'medium', 'large', 'x-large'] },
  ToggleControl: { type: 'boolean' },
  RangeControl: { type: 'number', hasMinMax: true },
  SelectControl: { type: 'select', hasOptions: true },
  RadioControl: { type: 'radio', hasOptions: true },
  TextControl: { type: 'string' },
  TextareaControl: { type: 'string', multiline: true },
  URLInput: { attribute: 'url', type: 'string' },
  URLPopover: { attribute: 'url', type: 'string' },
  MediaUpload: { attribute: 'mediaId', type: 'number' },
  ImageSizeControl: { attribute: 'sizeSlug', possibleValues: ['thumbnail', 'medium', 'large', 'full'] },
};

/**
 * Parse an edit.js file and return extracted UI controls.
 * @param {string} blockPath - Directory containing the block
 * @returns {{ controls: object[], imports: object[] }}
 */
export function parseEditFile(blockPath) {
  const editPath = `${blockPath}/edit.js`;

  if (!fileExists(editPath)) {
    return { controls: [], imports: [] };
  }

  try {
    const content = readFile(editPath);
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    const controls = [];
    const imports = [];

    traverse.default(ast, {
      ImportDeclaration(path) {
        const source = path.node.source.value;
        const specifiers = path.node.specifiers.map(spec => {
          if (t.isImportSpecifier(spec)) return spec.imported.name;
          if (t.isImportDefaultSpecifier(spec)) return `default:${spec.local.name}`;
          if (t.isImportNamespaceSpecifier(spec)) return `*:${spec.local.name}`;
          return null;
        }).filter(Boolean);
        imports.push({ source, specifiers });
      },
    });

    traverse.default(ast, {
      JSXElement(path) {
        const elementName = getJSXElementName(path.node);
        if (CONTROL_PATTERNS[elementName]) {
          const control = extractControlInfo(path.node, elementName);
          if (control) controls.push(control);
        }
      },
    });

    return { controls, imports };
  } catch {
    return { controls: [], imports: [] };
  }
}

function getJSXElementName(node) {
  if (t.isJSXIdentifier(node.openingElement.name)) {
    return node.openingElement.name.name;
  }
  if (t.isJSXMemberExpression(node.openingElement.name)) {
    return getJSXMemberExpressionName(node.openingElement.name);
  }
  return null;
}

function getJSXMemberExpressionName(memberExpr) {
  const parts = [];
  function walk(node) {
    if (t.isJSXIdentifier(node)) {
      parts.unshift(node.name);
    } else if (t.isJSXMemberExpression(node)) {
      if (t.isJSXIdentifier(node.property)) parts.unshift(node.property.name);
      walk(node.object);
    }
  }
  walk(memberExpr);
  return parts.join('.');
}

function extractControlInfo(node, elementName) {
  const pattern = CONTROL_PATTERNS[elementName];
  const control = {
    component: elementName,
    attributeName: null,
    label: null,
    help: null,
    possibleValues: pattern.possibleValues || null,
    type: pattern.type || null,
    min: null,
    max: null,
    step: null,
    options: null,
  };

  node.openingElement.attributes.forEach(attr => {
    if (!t.isJSXAttribute(attr)) return;
    const propName = attr.name.name;
    const propValue = getAttributeValue(attr.value);

    switch (propName) {
      case 'onChange':
        if (propValue) {
          const match = propValue.match(/setAttributes\s*\(\s*\{[\s\n]*([a-zA-Z_$][a-zA-Z0-9_$]*)/);
          if (match) control.attributeName = match[1];
        }
        break;
      case 'label': control.label = propValue; break;
      case 'help': control.help = propValue; break;
      case 'min': control.min = propValue; break;
      case 'max': control.max = propValue; break;
      case 'step': control.step = propValue; break;
      case 'options': control.options = extractOptions(attr.value); break;
    }
  });

  return control;
}

function getAttributeValue(value) {
  if (!value) return null;
  if (t.isStringLiteral(value)) return value.value;
  if (t.isJSXExpressionContainer(value)) {
    const expr = value.expression;
    if (t.isStringLiteral(expr)) return expr.value;
    if (t.isNumericLiteral(expr)) return expr.value;
    if (t.isBooleanLiteral(expr)) return expr.value;
    if (t.isTemplateLiteral(expr)) return expr.quasis.map(q => q.value.cooked).join('${...}');
    return '[Expression]';
  }
  return null;
}

function extractOptions(value) {
  if (!value || !t.isJSXExpressionContainer(value)) return null;
  const expr = value.expression;
  if (!t.isArrayExpression(expr)) return null;

  return expr.elements.map(element => {
    if (!t.isObjectExpression(element)) return null;
    const obj = {};
    element.properties.forEach(prop => {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
        if (t.isStringLiteral(prop.value)) obj[prop.key.name] = prop.value.value;
        else if (t.isNumericLiteral(prop.value)) obj[prop.key.name] = prop.value.value;
      }
    });
    return obj;
  }).filter(Boolean);
}
