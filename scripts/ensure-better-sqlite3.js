#!/usr/bin/env node

/**
 * postinstall script — checks whether better-sqlite3 native bindings are
 * present and attempts to build them if not.
 *
 * This runs automatically after `npm install` / `npm install -g`.  On
 * npm >= 11 the install/postinstall scripts may be blocked by the
 * allow-scripts mechanism; in that case the runtime auto-repair in
 * src/db.js will catch the missing binary on first launch instead.
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const _require = createRequire(import.meta.url);

try {
  const bsPkgPath = _require.resolve('better-sqlite3/package.json');
  const bsDir = dirname(bsPkgPath);

  // Common binary output locations for better-sqlite3
  const candidates = [
    join(bsDir, 'build', 'Release', 'better_sqlite3.node'),
    join(bsDir, 'build', 'Debug', 'better_sqlite3.node'),
    join(bsDir, 'prebuilds'),
  ];

  const binaryExists = candidates.some((p) => existsSync(p));

  if (binaryExists) {
    process.exit(0);
  }

  console.log('');
  console.log('[wp-blockmarkup-mcp] better-sqlite3 native binary not found.');
  console.log('[wp-blockmarkup-mcp] Running prebuild-install...');

  execSync('npx --yes prebuild-install', {
    cwd: bsDir,
    stdio: 'inherit',
    timeout: 120_000,
  });
} catch {
  // silently ignore — the runtime repair in src/db.js will handle it
}
