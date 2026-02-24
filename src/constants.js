import { join } from 'node:path';
import { homedir } from 'node:os';

export const BASE_DIR = join(homedir(), '.wp-blockmarkup-mcp');
export const DB_PATH = join(BASE_DIR, 'blocks.db');
export const CACHE_DIR = join(BASE_DIR, 'cache');
