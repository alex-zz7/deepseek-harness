#!/usr/bin/env node
/**
 * `dsh-import-sessions` — bring Cursor, Claude Code, and Codex conversations
 * into DeepSeek Harness from a terminal.
 *
 * This is the same importer the app's `/import` command and Import dialog use;
 * nothing here is CLI-specific except argument parsing and formatting.
 *
 *   dsh-import-sessions list [source] [--limit N] [--query text]
 *   dsh-import-sessions preview <source> <id>
 *   dsh-import-sessions import [sources…] [--limit N] [--all] [--force] [--dry-run]
 *   dsh-import-sessions check
 *
 * @module @alex/dsh-session-import/cli
 */

import { createImporter, SOURCE_IDS, formatListLine, relativeAge } from '../lib/library.js';

/** Parse `--flag`, `--flag=value`, and `--flag value` forms. */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split('=');
    const key = rawKey.toLowerCase();
    if (inline !== undefined) {
      flags[key] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
      continue;
    }
    flags[key] = true;
  }
  return { flags, positional };
}

/** Read a numeric flag, or `undefined` when absent. */
function numberFlag(flags, key) {
  const value = flags[key];
  if (value === undefined || value === true) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Resolve requested sources from positionals, `--source`, and `--all`. */
function sourcesFrom(positional, flags) {
  const raw = [];
  for (const token of positional) raw.push(...String(token).split(','));
  if (flags.source !== undefined && flags.source !== true) raw.push(...String(flags.source).split(','));
  const wanted = raw.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
  if (wanted.length === 0 || wanted.includes('all')) return [...SOURCE_IDS];
  const unknown = wanted.filter((value) => !SOURCE_IDS.includes(value));
  if (unknown.length > 0) throw new Error(`unknown source(s): ${unknown.join(', ')} — expected ${SOURCE_IDS.join(', ')} or all`);
  return [...new Set(wanted)];
}

/** Human-readable one-line summary of an import result. */
function resultLine(result) {
  if (result.ok === false) return `✗ ${result.source} ${String(result.id).slice(0, 8)} — ${result.reason}`;
  const mark = result.skipped === true ? '•' : '✓';
  const title = String(result.title ?? result.id);
  const clipped = title.length > 64 ? `${title.slice(0, 63)}…` : title;
  const workspace = result.cwd === undefined || result.cwd === null ? '' : `  →  ${result.cwd}`;
  const detail =
    result.skipped === true
      ? (result.reason ?? 'skipped')
      : `${result.messages ?? '?'} messages, ${result.events ?? '?'} events`;
  return `${mark} ${result.source.padEnd(6)} ${clipped}${workspace}  (${detail})`;
}

/** Print the usage banner. */
function usage() {
  process.stdout.write(
    [
      'Import external agent sessions into DeepSeek Harness.',
      '',
      '  dsh-import-sessions list [source…] [--limit N] [--query text]',
      '  dsh-import-sessions preview <source> <id>',
      '  dsh-import-sessions import [source…] [--limit N] [--all] [--force] [--dry-run] [--query text]',
      '  dsh-import-sessions repair [source…] [--limit N] [--all]',
      '  dsh-import-sessions check',
      '',
      `Sources: ${SOURCE_IDS.join(', ')} (default: all)`,
      '',
      'Options:',
      '  --home <dir>   harness home to import INTO (default: $DSH_HOME or ~/.dsh).',
      '                 This is the directory that contains sessions/, not the OS home.',
      '  --json         machine-readable output for `list`.',
      '',
    ].join('\n'),
  );
}

/** Run the CLI. */
async function main(argv) {
  const { flags, positional } = parseArgs(argv);
  const command = positional.shift() ?? 'list';
  if (flags.help === true || command === 'help') {
    usage();
    return 0;
  }
  const importer = createImporter(flags.home !== undefined && flags.home !== true ? { home: String(flags.home) } : {});

  if (command === 'check') {
    const check = await importer.check();
    process.stdout.write(
      [
        `format codec: v${check.currentVersion}`,
        `sessions root: ${check.sessionsRoot}`,
        `ledger: ${importer.paths.ledger}`,
        '',
      ].join('\n'),
    );
    return 0;
  }

  if (command === 'list' || command === 'ls') {
    const sources = sourcesFrom(positional, flags);
    const listing = await importer.list({
      sources,
      limit: numberFlag(flags, 'limit') ?? 30,
      query: flags.query === undefined || flags.query === true ? '' : String(flags.query),
    });
    if (flags.json === true) {
      process.stdout.write(`${JSON.stringify(listing, null, 2)}\n`);
      return 0;
    }
    const importable = listing.items.filter((item) => !item.imported).length;
    process.stdout.write(`${listing.total} session(s) found; showing ${listing.items.length}; ${importable} not imported yet.\n\n`);
    for (const item of listing.items) process.stdout.write(`${formatListLine(item)}\n`);
    return 0;
  }

  if (command === 'preview' || command === 'show') {
    const [source, id] = positional;
    if (source === undefined || id === undefined) throw new Error('preview needs a source and a session id');
    const preview = await importer.preview({ source, id });
    if (!preview.ok) {
      process.stderr.write(`cannot read ${source} ${id}: ${preview.reason}\n`);
      return 1;
    }
    const summary = preview.summary;
    process.stdout.write(
      [
        `source      ${summary.source}`,
        `external id ${summary.externalId}`,
        `title       ${summary.title}`,
        `workspace   ${summary.cwd ?? '(none)'}`,
        `model       ${summary.model ?? '(unknown)'}`,
        `span        ${new Date(summary.createdAt).toISOString()} → ${new Date(summary.updatedAt).toISOString()}`,
        `messages    ${summary.messages} (${summary.events} events)`,
        '',
      ].join('\n'),
    );
    for (const row of preview.plan.events) {
      if (row.type !== 'user/message' && row.type !== 'assistant/message') continue;
      const blocks = row.data.message?.content ?? [];
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' ')
        .replace(/\s+/g, ' ');
      if (text.length === 0) continue;
      process.stdout.write(`${(row.data.message?.role ?? row.type).padEnd(9)} ${text.slice(0, 160)}\n`);
    }
    return 0;
  }

  if (command === 'import') {
    const sources = sourcesFrom(positional, flags);
    const dryRun = flags['dry-run'] === true || flags.dry === true;
    const result = await importer.run({
      sources,
      limit: flags.all === true ? Number.MAX_SAFE_INTEGER : (numberFlag(flags, 'limit') ?? 5),
      query: flags.query === undefined || flags.query === true ? '' : String(flags.query),
      force: flags.force === true,
      dryRun,
      onProgress: (entry, index, total) => {
        if (total > 20 && index % 5 === 0) process.stderr.write(`\r${index}/${total}`);
      },
    });
    if (result.considered > 20) process.stderr.write('\n');
    process.stdout.write(
      `${dryRun ? 'Would import' : 'Imported'} ${result.imported}, skipped ${result.skipped}, failed ${result.failed} of ${result.considered} considered.\n\n`,
    );
    for (const entry of result.results) process.stdout.write(`${resultLine(entry)}\n`);
    if (!dryRun && result.imported > 0) {
      process.stdout.write(
        [
          '',
          `Artifacts written under ${importer.paths.sessionsRoot}.`,
          'Open the DeepSeek Harness app and the imported sessions are listed under their',
          'original workspace; a workspace that was never registered appears after the next',
          'import run or after adding the folder in the sidebar.',
        ].join('\n') + '\n',
      );
    }
    if (result.failed > 0) return 1;
    return 0;
  }

  if (command === 'repair' || command === 'reimport') {
    const sources = sourcesFrom(positional, flags);
    const result = await importer.repair({
      sources,
      limit: flags.all === true ? undefined : numberFlag(flags, 'limit'),
      onProgress: (entry, index, total) => {
        if (total > 20 && index % 5 === 0) process.stderr.write(`\r${index}/${total}`);
      },
    });
    if (result.considered > 20) process.stderr.write('\n');
    process.stdout.write(`Repaired ${result.repaired}, failed ${result.failed} of ${result.considered} ledger entr(ies).\n\n`);
    for (const entry of result.results) process.stdout.write(`${resultLine(entry)}\n`);
    process.stdout.write(
      `\nEach repaired session kept its id, so the sidebar row is the same one — rebuilt.\n`,
    );
    if (result.failed > 0) return 1;
    return 0;
  }

  if (command === 'ledger') {
    const ledger = await importer.ledger();
    const entries = Object.entries(ledger.entries);
    process.stdout.write(`${entries.length} recorded import(s) in ${importer.paths.ledger}\n\n`);
    for (const [key, entry] of entries) {
      process.stdout.write(`${key.padEnd(56)} ${entry.sessionId}  ${relativeAge(entry.importedAt)}\n`);
    }
    return 0;
  }

  process.stderr.write(`unknown command: ${command}\n\n`);
  usage();
  return 2;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
