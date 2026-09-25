import fs from 'node:fs';

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function readJSON(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

export function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Extensions a block source file can use, in lookup order.
 * Gutenberg moved JSX-bearing files from .js to .jsx in August 2026
 * (WordPress/gutenberg#80990), and many third-party blocks ship .tsx.
 */
export const SOURCE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

/**
 * Find a block source file by base name, whatever its extension.
 * @param {string} blockPath - Directory containing the block
 * @param {string} baseName - File name without extension, e.g. 'save'
 * @returns {string|null} Full path of the first match, or null
 */
export function resolveSourceFile(blockPath, baseName) {
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = `${blockPath}/${baseName}${ext}`;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
