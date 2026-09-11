/**
 * Small host-side state bag for the app-only sidebar affordances.
 *
 * Why not `localStorage`: it is scoped to the page's origin, and the origin
 * includes the port. `dsh web` binds a fresh random port on every start here,
 * so the moment the server restarts the app is looking at a different origin
 * and every stored key is gone. Persisting next to the rest of DSH's state
 * under `~/.dsh` makes the value independent of how the surface was reached.
 *
 * The file is this plugin's own state, not workspace content, so it is written
 * with `node:fs` rather than through the composed filesystem service — the
 * sandbox governs file effects the *agent* can cause, not a user-driven
 * setting in DSH's own config directory.
 *
 * @module dsh-sidebar-editor/ui-state
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where the state bag lives. */
const FILE = join(homedir(), '.dsh', 'sidebar-editor-ui.json');

/** Serializes read-modify-write cycles so two writes cannot lose one another. */
let tail = Promise.resolve();

/**
 * Read the whole state bag.
 *
 * A missing or malformed file reads as empty rather than throwing: a corrupt
 * settings file must not take the routes down.
 *
 * @returns the stored object, or an empty one.
 */
export async function readUiState() {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Merge a shallow patch into the state bag and persist it.
 *
 * Shallow on purpose: the bag is a flat set of feature keys, each of which its
 * owner replaces wholesale.
 *
 * @param patch - the keys to replace.
 * @returns the state after the merge.
 */
export function mergeUiState(patch) {
  const run = tail.then(async () => {
    const current = await readUiState();
    const next = { ...current, ...patch };

    await mkdir(dirname(FILE), { recursive: true });
    const temporary = `${FILE}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
    await rename(temporary, FILE);

    return next;
  });
  // Keep the chain alive even when one cycle rejects.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
