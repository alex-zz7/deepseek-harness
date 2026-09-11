/**
 * Persisted pin set for the sidebar, and the reordering that enforces it.
 *
 * Why this exists at all: the workspace order is *manual only*. Its own
 * documentation says a new session is **prepended at attach**, explicit
 * reordering goes through `insertSessionBefore`, and **activity never
 * reorders**. There is therefore no "natural" order for an unpinned session to
 * fall back to, and a one-shot move-to-top would be pushed down again by the
 * next session created.
 *
 * So a pin is this plugin's own concept: a persisted set of session ids that
 * {@link applyPinOrder} keeps at the front of their workspace by driving the
 * real `insertSessionBefore` API. The order stays the product's; only the
 * pinned prefix is ours.
 *
 * The file is the plugin's own state under `~/.dsh`, not workspace content, so
 * it is written with `node:fs` rather than through the composed filesystem
 * service. The sandbox governs file effects the *agent* can cause; this is a
 * user-driven setting for this plugin, in the same directory the rest of DSH
 * keeps its configuration.
 *
 * @module dsh-sidebar-editor/pins
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where the pin set lives. */
const FILE = join(homedir(), '.dsh', 'sidebar-editor-pins.json');

/** Serializes read-modify-write cycles so two toggles cannot lose one another. */
let tail = Promise.resolve();

/**
 * Read the pin set.
 *
 * A missing or malformed file reads as "nothing pinned" rather than throwing:
 * a corrupt settings file must not take the route down.
 *
 * @returns the pinned session ids, most-important first.
 */
export async function readPins() {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    if (!Array.isArray(parsed?.pinned)) return [];
    return parsed.pinned.filter((id) => typeof id === 'string');
  } catch {
    return [];
  }
}

/**
 * Write the pin set atomically.
 * @param pinned - the full set to persist, most-important first.
 */
async function writePins(pinned) {
  await mkdir(dirname(FILE), { recursive: true });
  const temporary = `${FILE}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ pinned }, null, 2), 'utf8');
  await rename(temporary, FILE);
}

/**
 * Add or remove one session, preserving the order of the rest.
 * @param sessionId - the session to pin or unpin.
 * @param pinned - true to pin, false to unpin.
 * @returns the resulting set, most-important first.
 */
export function setPinned(sessionId, pinned) {
  const run = tail.then(async () => {
    const current = await readPins();
    const without = current.filter((id) => id !== sessionId);
    // A newly pinned session goes to the front of the pinned block.
    const next = pinned ? [sessionId, ...without] : without;
    await writePins(next);
    return next;
  });
  // Keep the chain alive even when one cycle rejects.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Enforce "pinned first" inside every workspace that has a pinned session.
 *
 * Each workspace is fixed by walking the desired order backwards and inserting
 * every element before the one that should follow it. Walking backwards is
 * what makes it converge: an earlier insert may displace a later element, so
 * the last pair has to be settled first.
 *
 * @param registry - the host workspace registry.
 * @param pinned - the pinned session ids, most-important first.
 * @returns the number of workspaces whose order actually changed.
 */
export async function applyPinOrder(registry, pinned) {
  if (pinned.length === 0) return 0;
  let changed = 0;

  for (const workspace of registry.list()) {
    const ids = workspace.sessionIds;
    const pinnedHere = pinned.filter((id) => ids.includes(id));
    if (pinnedHere.length === 0) continue;

    const rest = ids.filter((id) => !pinnedHere.includes(id));
    const desired = [...pinnedHere, ...rest];
    if (desired.every((id, index) => id === ids[index])) continue;

    for (let index = desired.length - 2; index >= 0; index--) {
      await workspace.insertSessionBefore(desired[index], desired[index + 1]);
    }
    changed += 1;
  }

  return changed;
}
