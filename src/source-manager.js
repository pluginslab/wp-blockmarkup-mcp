/**
 * Source manager — handles registration, git operations, and local folder watching
 *
 * Responsibilities:
 *   - Register GitHub (public/private) and local folder sources
 *   - Clone/pull repos to ~/.wp-blockmarkup-mcp/cache/
 *   - Track source metadata (branch, subfolder, commit hash, last indexed)
 *   - List, remove, and update sources
 *
 * Mirrors the source management pattern from wp-devdocs-mcp.
 */

// TODO: Implement with simple-git
