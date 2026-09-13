/**
 * Turn a vault file into searchable plain text.
 *
 * Markdown stays as-is. Office / PDF / HTML go through a dedicated extractor
 * so the index and kb_read share one implementation.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname } from 'node:path';

const require = createRequire(import.meta.url);

const TEXT_EXTS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.xml',
  '.log',
]);

const HTML_EXTS = new Set(['.html', '.htm']);

/** Extensions the vault will ingest and index. */
export const INDEXABLE_EXTS = new Set([
  ...TEXT_EXTS,
  ...HTML_EXTS,
  '.pdf',
  '.docx',
  '.doc',
  '.rtf',
  '.odt',
  '.pptx',
  '.ppt',
  '.xlsx',
  '.epub',
]);

export function isIndexableName(name) {
  return INDEXABLE_EXTS.has(extname(String(name || '')).toLowerCase());
}

export function extOf(name) {
  return extname(String(name || '')).toLowerCase();
}

function clean(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(xml) {
  return clean(
    decodeXml(String(xml || '').replace(/<[^>]+>/g, ' ')).replace(/[ \t]{2,}/g, ' '),
  );
}

async function readUtf8(absPath) {
  const buf = await readFile(absPath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf);
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf);
  }
  return buf.toString('utf8');
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (buf) => chunks.push(buf));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8');
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}`));
        return;
      }
      resolve(out);
    });
  });
}

async function textutil(absPath) {
  if (process.platform !== 'darwin') {
    throw new Error('textutil 只在 macOS 上可用');
  }
  return clean(await run('textutil', ['-convert', 'txt', '-stdout', absPath]));
}

async function unzipList(absPath) {
  const out = await run('unzip', ['-Z', '-1', absPath]);
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function unzipFile(absPath, inner) {
  return run('unzip', ['-p', absPath, inner]);
}

async function extractPdf(absPath) {
  const buf = await readFile(absPath);
  let pdfParse;
  try {
    pdfParse = require('pdf-parse/lib/pdf-parse.js');
  } catch {
    pdfParse = require('pdf-parse');
  }
  const result = await pdfParse(buf);
  const text = clean(result?.text);
  if (!text) throw new Error('PDF 里没有可提取的文字（可能是扫描件）');
  return text;
}

async function extractDocx(absPath) {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: absPath });
    const text = clean(result?.value);
    if (text) return text;
  } catch {
    // fall through to the zip XML
  }
  const xml = await unzipFile(absPath, 'word/document.xml');
  const text = stripTags(xml);
  if (!text) throw new Error('Word 文档是空的');
  return text;
}

async function extractPptx(absPath) {
  const entries = await unzipList(absPath);
  const slides = entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort();
  if (slides.length === 0) throw new Error('PPT 里没有幻灯片');
  const parts = [];
  for (const slide of slides) {
    const xml = await unzipFile(absPath, slide);
    const text = stripTags(xml);
    if (text) parts.push(text);
  }
  if (parts.length === 0) throw new Error('PPT 里没有可提取的文字');
  return parts.join('\n\n');
}

async function extractXlsx(absPath) {
  const chunks = [];
  try {
    const shared = await unzipFile(absPath, 'xl/sharedStrings.xml');
    const strings = [...shared.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((match) => decodeXml(match[1]).trim());
    if (strings.length) chunks.push(strings.join('\n'));
  } catch {
    // some workbooks have no shared strings
  }
  try {
    const entries = await unzipList(absPath);
    for (const sheet of entries.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))) {
      const text = stripTags(await unzipFile(absPath, sheet));
      if (text) chunks.push(text);
    }
  } catch {
    // ignore missing sheets
  }
  const text = clean(chunks.join('\n\n'));
  if (!text) throw new Error('表格里没有可提取的文字');
  return text;
}

async function extractEpub(absPath) {
  const entries = await unzipList(absPath);
  const docs = entries.filter((name) => /\.(xhtml|html|htm|xml)$/i.test(name) && !/META-INF/i.test(name));
  if (docs.length === 0) throw new Error('EPUB 里没有正文');
  const parts = [];
  for (const doc of docs) {
    const text = stripTags(await unzipFile(absPath, doc));
    if (text) parts.push(text);
  }
  const text = clean(parts.join('\n\n'));
  if (!text) throw new Error('EPUB 里没有可提取的文字');
  return text;
}

/**
 * @param {string} absPath
 * @returns {Promise<string>}
 */
export async function extractText(absPath) {
  const ext = extOf(absPath);
  if (TEXT_EXTS.has(ext)) return clean(await readUtf8(absPath));
  if (HTML_EXTS.has(ext)) return stripTags(await readUtf8(absPath));
  if (ext === '.pdf') return extractPdf(absPath);
  if (ext === '.docx') return extractDocx(absPath);
  if (ext === '.doc' || ext === '.rtf' || ext === '.odt' || ext === '.ppt') return textutil(absPath);
  if (ext === '.pptx') return extractPptx(absPath);
  if (ext === '.xlsx') return extractXlsx(absPath);
  if (ext === '.epub') return extractEpub(absPath);
  throw new Error(`还不支持 ${ext || '这个格式'}`);
}
