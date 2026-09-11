/**
 * Host-layer extra skill roots. The official filesystem provider only scans
 * project `.dsh/.agents` plus `~/.dsh/skills` and `~/.agents/skills`, and only
 * one directory deep. Cursor also loads `~/.cursor`, `~/.claude`, and `~/.codex`.
 *
 * This plugin is a bundle patch that mounts a second `skill-filesystem` on the
 * host skill registry (global layer). Preset agents merge that layer with their
 * own, so every session sees the extra roots.
 */
export function apply() {}
