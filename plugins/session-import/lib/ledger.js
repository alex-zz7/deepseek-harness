/**
 * The import ledger: what has already been imported, and from where.
 *
 * Re-importing a conversation would produce a second, near-identical session in
 * the sidebar, so every import records its origin here and the next run skips
 * it. The ledger is plain JSON under the harness home — readable, editable, and
 * deletable by the person who owns the machine.
 *
 * @module @alex/dsh-session-import/ledger
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harnessHome } from './harness.js';

/** Current ledger schema version. */
export const LEDGER_VERSION = 1;

/**
 * Path of the ledger inside a harness home.
 * @param home - harness home; defaults to the resolved one.
 * @returns absolute ledger path.
 */
export function ledgerPath(home = harnessHome()) {
  return join(home, 'session-import', 'ledger.json');
}

/**
 * Load the ledger, tolerating absence and corruption.
 *
 * A damaged ledger must not block an import: the worst case of an empty ledger
 * is a duplicate session, which the user can archive, while refusing to run
 * would be a dead end.
 * @param path - ledger path.
 * @returns the parsed ledger, or an empty one.
 */
export async function readLedger(path = ledgerPath()) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { version: LEDGER_VERSION, entries: {} };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return { version: LEDGER_VERSION, entries: {} };
    }
    return { version: LEDGER_VERSION, entries: parsed.entries };
  } catch {
    return { version: LEDGER_VERSION, entries: {} };
  }
}

/**
 * Key one external session.
 * @param source - source id.
 * @param externalId - the source's own session id.
 * @returns a stable ledger key.
 */
export function ledgerKey(source, externalId) {
  return `${source}:${externalId}`;
}

/**
 * Persist one ledger.
 * @param ledger - the ledger to write.
 * @param path - ledger path.
 */
export async function writeLedger(ledger, path = ledgerPath()) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify(ledger, null, 2)}\n`;
  await writeFile(path, body, { encoding: 'utf8', mode: 0o600 });
}

/**
 * Record one completed import.
 * @param entry - what was imported and what it became.
 * @param path - ledger path.
 * @returns the updated ledger.
 */
export async function recordImport(entry, path = ledgerPath()) {
  const ledger = await readLedger(path);
  ledger.entries[ledgerKey(entry.source, entry.externalId)] = {
    sessionId: entry.sessionId,
    title: entry.title,
    cwd: entry.cwd ?? null,
    eventCount: entry.eventCount,
    messageCount: entry.messageCount,
    importedAt: entry.importedAt ?? Date.now(),
    artifact: entry.artifact ?? null,
    digest: entry.digest ?? null,
  };
  await writeLedger(ledger, path);
  return ledger;
}

/**
 * Forget one ledger entry, so the session becomes importable again.
 * @param source - source id.
 * @param externalId - the source's session id.
 * @param path - ledger path.
 * @returns whether an entry was removed.
 */
export async function forgetImport(source, externalId, path = ledgerPath()) {
  const ledger = await readLedger(path);
  const key = ledgerKey(source, externalId);
  if (ledger.entries[key] === undefined) return false;
  delete ledger.entries[key];
  await writeLedger(ledger, path);
  return true;
}
