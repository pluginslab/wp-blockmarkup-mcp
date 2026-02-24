/**
 * Parser for variations.js files — extracts block variations with attributes.
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { readFile, fileExists } from '../utils/file-utils.js';

/**
 * Parse a variations.js file and return extracted variations.
 * @param {string} blockPath - Directory containing the block
 * @returns {object[]}
 */
export function parseVariationsFile(blockPath) {
  const variationsPath = `${blockPath}/variations.js`;

  if (!fileExists(variationsPath)) {
    return [];
  }

  try {
    const content = readFile(variationsPath);
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    const variations = [];

    traverse.default(ast, {
      ExportDefaultDeclaration(path) {
        if (t.isArrayExpression(path.node.declaration)) {
          extractVariationsFromArray(path.node.declaration, variations);
        }
      },
      VariableDeclaration(path) {
        path.node.declarations.forEach(declarator => {
          if (t.isIdentifier(declarator.id) &&
              declarator.id.name === 'variations' &&
              t.isArrayExpression(declarator.init)) {
            extractVariationsFromArray(declarator.init, variations);
          }
        });
      },
    });

    return variations;
  } catch {
    return [];
  }
}

function extractVariationsFromArray(arrayExpr, variations) {
  arrayExpr.elements.forEach(element => {
    if (t.isObjectExpression(element)) {
      const variation = extractVariationObject(element);
      if (variation) variations.push(variation);
    }
  });
}

function extractVariationObject(objExpr) {
  const variation = {
    name: null,
    title: null,
    description: null,
    attributes: {},
    innerBlocks: [],
    scope: [],
    keywords: [],
    isDefault: false,
  };

  objExpr.properties.forEach(prop => {
    if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) return;

    switch (prop.key.name) {
      case 'name': variation.name = getStringValue(prop.value); break;
      case 'title': variation.title = getStringValue(prop.value); break;
      case 'description': variation.description = getStringValue(prop.value); break;
      case 'attributes':
        if (t.isObjectExpression(prop.value)) variation.attributes = extractAttributesObject(prop.value);
        break;
      case 'innerBlocks':
        if (t.isArrayExpression(prop.value)) variation.innerBlocks = extractInnerBlocksArray(prop.value);
        break;
      case 'scope':
        if (t.isArrayExpression(prop.value)) {
          variation.scope = prop.value.elements.filter(el => t.isStringLiteral(el)).map(el => el.value);
        }
        break;
      case 'keywords':
        if (t.isArrayExpression(prop.value)) {
          variation.keywords = prop.value.elements.filter(el => t.isStringLiteral(el)).map(el => el.value);
        }
        break;
      case 'isDefault': variation.isDefault = getBooleanValue(prop.value); break;
    }
  });

  return variation.name ? variation : null;
}

function extractAttributesObject(objExpr) {
  const attributes = {};
  objExpr.properties.forEach(prop => {
    if (t.isObjectProperty(prop)) {
      const key = getPropertyKey(prop.key);
      const value = getPropertyValue(prop.value);
      if (key) attributes[key] = value;
    }
  });
  return attributes;
}

function extractInnerBlocksArray(arrayExpr) {
  return arrayExpr.elements.map(element => {
    if (t.isArrayExpression(element) && element.elements.length >= 2) {
      const blockName = getStringValue(element.elements[0]);
      const blockAttrs = t.isObjectExpression(element.elements[1])
        ? extractAttributesObject(element.elements[1])
        : {};
      const innerBlocks = element.elements.length > 2 && t.isArrayExpression(element.elements[2])
        ? extractInnerBlocksArray(element.elements[2])
        : [];
      return { blockName, attributes: blockAttrs, innerBlocks };
    }
    return null;
  }).filter(Boolean);
}

function getStringValue(node) {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.quasis.length === 1) return node.quasis[0].value.cooked;
  return null;
}

function getBooleanValue(node) {
  return t.isBooleanLiteral(node) ? node.value : false;
}

function getPropertyKey(node) {
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node)) return node.value;
  return null;
}

function getPropertyValue(node) {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isArrayExpression(node)) return node.elements.map(el => getPropertyValue(el));
  if (t.isObjectExpression(node)) return extractAttributesObject(node);
  return '[Complex Value]';
}
