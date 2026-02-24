/**
 * Parser for save.js files — Babel AST analysis for HTML output patterns.
 *
 * Determines block type:
 *   - save() returns JSX → static
 *   - save() returns null → dynamic
 *   - save() exists + render.php → hybrid
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { readFile, fileExists } from '../utils/file-utils.js';

/**
 * Parse a save.js file and return HTML output patterns.
 * @param {string} blockPath - Directory containing the block
 * @returns {object}
 */
export function parseSaveFile(blockPath) {
  const savePath = `${blockPath}/save.js`;
  const hasRenderPhp = fileExists(`${blockPath}/render.php`);

  if (!fileExists(savePath)) {
    // No save.js — dynamic block if render.php exists, otherwise unknown
    return {
      hasCustomSave: false,
      returnsNull: true,
      blockType: hasRenderPhp ? 'dynamic' : 'dynamic',
      wrapperElement: null,
      classPatterns: [],
      stylePatterns: [],
      usesInnerBlocks: false,
      attributeUsage: [],
    };
  }

  try {
    const content = readFile(savePath);
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    const result = {
      hasCustomSave: false,
      returnsNull: false,
      blockType: 'static',
      wrapperElement: null,
      classPatterns: [],
      stylePatterns: [],
      usesInnerBlocks: false,
      attributeUsage: [],
    };

    // Detect if save returns null (dynamic block)
    let foundSaveFunction = false;

    traverse.default(ast, {
      ExportDefaultDeclaration(path) {
        const decl = path.node.declaration;
        if (t.isFunctionDeclaration(decl) || t.isArrowFunctionExpression(decl)) {
          foundSaveFunction = true;
          extractAttributeUsage(decl, result);
          // Use path-based traversal (traverse.default on a raw node fails)
          path.get('declaration').traverse({
            ReturnStatement(retPath) {
              const arg = retPath.node.argument;
              if (t.isNullLiteral(arg)) {
                result.returnsNull = true;
              } else if (t.isJSXElement(arg) || t.isJSXFragment(arg)) {
                analyzeJSXStructure(arg, result);
              }
            },
            CallExpression(callPath) {
              const callee = callPath.node.callee;
              if (t.isIdentifier(callee) && (callee.name === 'clsx' || callee.name === 'classnames')) {
                extractClassPatterns(callPath.node, result);
              }
            },
          });
        }
      },
      FunctionDeclaration(path) {
        if (path.node.id && path.node.id.name === 'save' && !foundSaveFunction) {
          foundSaveFunction = true;
          extractAttributeUsage(path.node, result);
          path.traverse({
            ReturnStatement(retPath) {
              const arg = retPath.node.argument;
              if (t.isNullLiteral(arg)) {
                result.returnsNull = true;
              } else if (t.isJSXElement(arg) || t.isJSXFragment(arg)) {
                analyzeJSXStructure(arg, result);
              }
            },
            CallExpression(callPath) {
              const callee = callPath.node.callee;
              if (t.isIdentifier(callee) && (callee.name === 'clsx' || callee.name === 'classnames')) {
                extractClassPatterns(callPath.node, result);
              }
            },
          });
        }
      },
    });

    if (!foundSaveFunction) {
      result.returnsNull = true;
      result.blockType = hasRenderPhp ? 'dynamic' : 'dynamic';
    } else if (result.returnsNull) {
      result.blockType = hasRenderPhp ? 'dynamic' : 'dynamic';
    } else {
      result.hasCustomSave = true;
      result.blockType = hasRenderPhp ? 'hybrid' : 'static';
    }

    return result;
  } catch {
    return {
      hasCustomSave: false,
      returnsNull: true,
      blockType: hasRenderPhp ? 'dynamic' : 'dynamic',
      wrapperElement: null,
      classPatterns: [],
      stylePatterns: [],
      usesInnerBlocks: false,
      attributeUsage: [],
    };
  }
}

function extractAttributeUsage(funcNode, result) {
  const params = funcNode.params || [];
  if (params.length > 0 && t.isObjectPattern(params[0])) {
    params[0].properties.forEach(prop => {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name === 'attributes') {
        if (t.isObjectPattern(prop.value)) {
          prop.value.properties.forEach(attrProp => {
            if (t.isObjectProperty(attrProp) && t.isIdentifier(attrProp.key)) {
              result.attributeUsage.push(attrProp.key.name);
            }
          });
        }
      }
    });
  }
}

function analyzeJSXStructure(jsxNode, result) {
  if (!t.isJSXElement(jsxNode)) return;

  const elementName = getJSXElementName(jsxNode);

  if (elementName && !elementName.includes('.')) {
    // HTML element — use as wrapper if first one found
    if (!result.wrapperElement) result.wrapperElement = elementName;
  }

  if (elementName && elementName.includes('InnerBlocks')) {
    result.usesInnerBlocks = true;
  }

  jsxNode.openingElement.attributes.forEach(attr => {
    if (t.isJSXAttribute(attr)) {
      const attrName = attr.name.name;
      if (attrName === 'className') extractClassFromAttribute(attr.value, result);
      else if (attrName === 'style') extractStyleFromAttribute(attr.value, result);
    } else if (t.isJSXSpreadAttribute(attr)) {
      if (t.isCallExpression(attr.argument)) {
        const callee = attr.argument.callee;
        if (t.isMemberExpression(callee) &&
            t.isIdentifier(callee.object) && callee.object.name === 'useBlockProps' &&
            t.isIdentifier(callee.property) && callee.property.name === 'save') {
          result.classPatterns.push({
            source: 'useBlockProps.save()',
            dynamic: true,
            description: 'Uses WordPress block props with dynamic classes',
          });
        }
      }
    }
  });

  // Recurse into children
  if (jsxNode.children) {
    jsxNode.children.forEach(child => {
      if (t.isJSXElement(child)) analyzeJSXStructure(child, result);
    });
  }
}

function getJSXElementName(node) {
  if (t.isJSXIdentifier(node.openingElement.name)) return node.openingElement.name.name;
  if (t.isJSXMemberExpression(node.openingElement.name)) {
    const parts = [];
    function walk(n) {
      if (t.isJSXIdentifier(n)) parts.unshift(n.name);
      else if (t.isJSXMemberExpression(n)) {
        if (t.isJSXIdentifier(n.property)) parts.unshift(n.property.name);
        walk(n.object);
      }
    }
    walk(node.openingElement.name);
    return parts.join('.');
  }
  return null;
}

function extractClassPatterns(callNode, result) {
  callNode.arguments.forEach(arg => {
    if (t.isObjectExpression(arg)) {
      arg.properties.forEach(prop => {
        if (!t.isObjectProperty(prop)) return;
        let className = null;
        if (t.isStringLiteral(prop.key)) className = prop.key.value;
        else if (t.isIdentifier(prop.key)) className = prop.key.name;
        if (className) {
          result.classPatterns.push({
            className,
            conditional: true,
            condition: getExpressionString(prop.value),
          });
        }
      });
    } else if (t.isStringLiteral(arg)) {
      result.classPatterns.push({ className: arg.value, conditional: false });
    }
  });
}

function extractClassFromAttribute(value, result) {
  if (!value) return;
  if (t.isStringLiteral(value)) {
    result.classPatterns.push({ className: value.value, conditional: false, static: true });
  } else if (t.isJSXExpressionContainer(value)) {
    result.classPatterns.push({ source: 'dynamic', expression: getExpressionString(value.expression) });
  }
}

function extractStyleFromAttribute(value, result) {
  if (!value || !t.isJSXExpressionContainer(value)) return;
  const expr = value.expression;
  if (t.isObjectExpression(expr)) {
    expr.properties.forEach(prop => {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
        result.stylePatterns.push({
          property: prop.key.name,
          valueExpression: getExpressionString(prop.value),
        });
      }
    });
  } else {
    result.stylePatterns.push({ dynamic: true, expression: getExpressionString(expr) });
  }
}

function getExpressionString(node) {
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node)) return `"${node.value}"`;
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isBooleanLiteral(node)) return String(node.value);
  if (t.isMemberExpression(node)) {
    const obj = getExpressionString(node.object);
    const prop = t.isIdentifier(node.property) ? node.property.name : '?';
    return `${obj}.${prop}`;
  }
  if (t.isTemplateLiteral(node)) return '`template`';
  if (t.isConditionalExpression(node)) return 'condition ? a : b';
  return '[Expression]';
}
