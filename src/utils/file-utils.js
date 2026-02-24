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
