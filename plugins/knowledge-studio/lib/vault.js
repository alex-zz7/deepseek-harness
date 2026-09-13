/**
 * Default vault skeleton. Only fills missing files; never overwrites.
 */

import { copyFile, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { isIndexableName } from '../../../knowledge/.kb/lib/extract.mjs';

const FILES = {
  'INDEX.md': `# 知识库

这是 DeepSeek Harness 的本地知识库入口。

把文档放进 \`docs/inbox/\` 或在设置里添加资料路径，然后构建索引。
提问时系统会先检索本库，再让模型根据命中段落回答。
`,
  'AGENTS.md': `# 这个文件夹是知识库，不是普通项目

系统会先检索本库，并把命中段落放进问题里的 \`<knowledge_context>\`。
有这段资料就直接回答，不要调用 Bash、Skill、Read、Grep，也不要再调用 \`mcp__kb__kb_search\`。
\`refuse="true"\` 或没有可靠命中时，直说本库没有，不要改走同名 Skill。

引用只写文件名，例如 〔手册名.pdf〕。不要写出 file:// 或绝对路径，也不要打开 \`index/chunks.jsonl\` 或 \`vectors.f32\`。
`,
  'README.md': `# 知识库文件夹

这里收文档：Markdown、TXT、PDF、Word、PPT、Excel、HTML、EPUB 等。图片和扫描件（没文字层的 PDF）不会进索引。

- \`sources/\` — 指向你本机资料的快捷方式（索引只读，不会改那些文件）
- \`index/\` — 向量索引：\`vectors.f32\`、\`chunks.jsonl\`、\`manifest.json\`
- \`docs/inbox/\` — 单独导入的文件副本
- \`docs/\` — 整理后的手写文档
`,
  'sources/README.md': `# 资料路径

这里是快捷方式，指向设置里添加的资料文件或文件夹。

索引会读取这些路径，不会往你的资料里写索引或副本。单独导入的文件仍会复制到 \`docs/inbox/\`。
`,
  'docs/INDEX.md': `# 手写文档

丢文件：\`docs/<主题>/<名字>.md\` 或 PDF / Word 等
还没分类：先放 \`docs/inbox/\`。

| 文档 | 路径 | 一句话 |
|---|---|---|
| （还没有） | | 新文件加在这一行下面 |
`,
};

const REPO_FILES = {
  'github/INDEX.md': `# GitHub 仓库索引

还没有连接。需要时再手动同步。
`,
  'skills/INDEX.md': `# Skill 索引

还没有连接。需要时再手动同步。
`,
};

export async function vaultExists(root) {
  try {
    const info = await stat(root);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function isEmptyVault(root) {
  try {
    const entries = await readdir(root);
    return entries.length === 0;
  } catch {
    return false;
  }
}

export async function needsSkeleton(root) {
  try {
    await stat(join(root, 'INDEX.md'));
    return false;
  } catch {
    return true;
  }
}

export async function bootstrapVault(root, { managed = false } = {}) {
  await mkdir(join(root, 'docs', 'inbox'), { recursive: true });
  await mkdir(join(root, 'sources'), { recursive: true });
  if (!managed) {
    await mkdir(join(root, 'github'), { recursive: true });
    await mkdir(join(root, 'skills'), { recursive: true });
  }
  const files = managed ? FILES : { ...FILES, ...REPO_FILES };
  const created = [];
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    try {
      await stat(abs);
    } catch {
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, body, 'utf8');
      created.push(rel);
    }
  }
  return { root, created };
}

export function sanitizeIngestName(name) {
  const base = String(name || 'note.md').split(/[/\\]/).pop() || 'note.md';
  const ext = extname(base).toLowerCase();
  const rawStem = ext ? base.slice(0, -ext.length) : base;
  const stem =
    rawStem.replace(/[^\w.\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '') || 'note';
  const kept = isIndexableName(`${stem}${ext || '.md'}`) ? ext || '.md' : '.md';
  return `${stem}${kept}`;
}

export async function ingestFile(root, sourcePath, originalName) {
  if (!(await vaultExists(root))) await bootstrapVault(root);
  let file = sanitizeIngestName(originalName || sourcePath);
  const inbox = join(root, 'docs', 'inbox');
  await mkdir(inbox, { recursive: true });
  try {
    await stat(join(inbox, file));
    const ext = extname(file);
    file = `${file.slice(0, -ext.length)}-${Date.now().toString(36)}${ext}`;
  } catch {
    // name is free
  }
  const rel = `docs/inbox/${file}`;
  await copyFile(sourcePath, join(root, rel));
  const indexPath = join(root, 'docs', 'INDEX.md');
  try {
    const current = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, appendIndexRow(current, file.replace(/\.[^.]+$/, ''), rel), 'utf8');
  } catch {
    // INDEX.md is optional after a hand-deleted skeleton.
  }
  return rel;
}

export function appendIndexRow(markdown, title, relPath) {
  const row = `| ${title} | ${relPath} | 用户导入 |`;
  if (/\| （还没有） \|/.test(markdown)) {
    return markdown.replace(/\| （还没有） \|[^\n]*\n/, `${row}\n`);
  }
  if (!markdown.includes('| 文档 |')) return `${markdown.trim()}\n\n${row}\n`;
  return `${markdown.trimEnd()}\n${row}\n`;
}
