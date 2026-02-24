import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import simpleGit from 'simple-git';
import { CACHE_DIR } from './constants.js';

/**
 * Fetch a source and return the local path to index.
 * Routes to the appropriate handler based on source type.
 */
export async function fetchSource(source) {
  switch (source.type) {
    case 'github-public':
      return fetchGithubPublic(source);
    case 'github-private':
      return fetchGithubPrivate(source);
    case 'local-folder':
      return fetchLocalFolder(source);
    default:
      throw new Error(`Unknown source type: ${source.type}`);
  }
}

/**
 * Fetch a public GitHub repo via shallow clone / pull.
 * Returns the local path to the (optionally subfoldered) source.
 */
async function fetchGithubPublic(source) {
  const repoName = source.repo_url.replace(/.*\/\/[^/]+\//, '').replace(/\.git$/, '').replace(/\//g, '--');
  const cloneDir = join(CACHE_DIR, repoName);
  mkdirSync(CACHE_DIR, { recursive: true });

  const git = simpleGit();
  const branch = source.branch || 'main';

  if (existsSync(join(cloneDir, '.git'))) {
    // Pull latest
    const repoGit = simpleGit(cloneDir);
    try {
      await repoGit.fetch('origin', branch, ['--depth=1']);
      await repoGit.reset(['--hard', `origin/${branch}`]);
    } catch (err) {
      console.error(`Warning: pull failed for ${source.name}, using cached version: ${err.message}`);
    }
  } else {
    // Shallow clone
    await git.clone(source.repo_url, cloneDir, [
      '--depth=1',
      '--branch', branch,
      '--single-branch',
    ]);
  }

  return source.subfolder ? join(cloneDir, source.subfolder) : cloneDir;
}

/**
 * Fetch a private GitHub repo using a token from an env var.
 * Token is injected into the URL at clone time — never stored in .git/config.
 */
async function fetchGithubPrivate(source) {
  const tokenEnvVar = source.token_env_var;
  if (!tokenEnvVar) {
    throw new Error(`Source "${source.name}" is type github-private but has no token_env_var configured`);
  }

  const token = process.env[tokenEnvVar];
  if (!token) {
    throw new Error(`Environment variable "${tokenEnvVar}" is not set. Required for private repo "${source.name}"`);
  }

  const repoName = source.repo_url.replace(/.*\/\/[^/]+\//, '').replace(/\.git$/, '').replace(/\//g, '--');
  const cloneDir = join(CACHE_DIR, repoName);
  mkdirSync(CACHE_DIR, { recursive: true });

  const authedUrl = source.repo_url.replace('https://', `https://${token}@`);
  const git = simpleGit();
  const branch = source.branch || 'main';

  if (existsSync(join(cloneDir, '.git'))) {
    const repoGit = simpleGit(cloneDir);
    try {
      // Set remote URL with token temporarily for fetch
      await repoGit.remote(['set-url', 'origin', authedUrl]);
      await repoGit.fetch('origin', branch, ['--depth=1']);
      await repoGit.reset(['--hard', `origin/${branch}`]);
      // Remove token from stored remote
      await repoGit.remote(['set-url', 'origin', source.repo_url]);
    } catch (err) {
      // Clean up token from remote even on error
      try { await repoGit.remote(['set-url', 'origin', source.repo_url]); } catch {}
      console.error(`Warning: pull failed for ${source.name}: ${err.message}`);
    }
  } else {
    await git.clone(authedUrl, cloneDir, [
      '--depth=1',
      '--branch', branch,
      '--single-branch',
    ]);
    // Remove token from stored remote
    const repoGit = simpleGit(cloneDir);
    await repoGit.remote(['set-url', 'origin', source.repo_url]);
  }

  return source.subfolder ? join(cloneDir, source.subfolder) : cloneDir;
}

/**
 * Validate and return a local folder path.
 */
async function fetchLocalFolder(source) {
  const localPath = source.local_path;
  if (!localPath) {
    throw new Error(`Source "${source.name}" is type local-folder but has no local_path configured`);
  }

  if (!existsSync(localPath)) {
    throw new Error(`Local path does not exist: ${localPath}`);
  }

  return localPath;
}
