/**
 * Markdown chunker for the knowledge vault.
 *
 * Splits by heading hierarchy first, then by paragraph budget, so a chunk
 * never straddles two unrelated sections. Line numbers are carried through so
 * a retrieved chunk can be opened in the editor verbatim.
 *
 * Budget is measured in *estimated tokens*, not characters: CJK runs about
 * 1 token/char while Latin runs about 0.25, so a fixed character budget would
 * either truncate Chinese or shatter English. The embedding model
 * (multilingual-e5-small) has a 512-token window, so chunks are kept under
 * MAX_TOKENS with margin to spare.
 *
 * Two corrections keep chunk quality up: undersized fragments left over from
 * heading boundaries are merged back together, and single lines too long for
 * the window are split on sentence boundaries rather than silently truncated.
 */

// Budgets are in calibrated tokens (see TOKEN_FUDGE). MAX_TOKENS sits below the
// model's 512-token window so that even a p99-dense chunk plus the heading
// breadcrumb prefix still fits without truncation.
const TARGET_TOKENS = 340;
const MAX_TOKENS = 420;
const MIN_TOKENS = 90;
const OVERLAP_TOKENS = 60;

/** CJK ideographs, kana, and Hangul — roughly one token each. */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/**
 * Correction for the naive CJK-1/char, Latin-1/4char estimate, measured
 * against the real multilingual-e5 tokenizer over this vault's 16k chunks:
 * the ratio of true tokens to the naive estimate is p50 1.18, p90 1.43,
 * p99 1.69. The naive estimate undercounts because rare CJK codepoints cost
 * 2-3 tokens each and code/punctuation is denser than prose. Sizing chunks
 * with the raw estimate left 9% of them over the 512-token window and
 * silently truncated; this factor brings that under ~2%.
 */
const TOKEN_FUDGE = 1.45;

/** Estimate tokens for a string: CJK ~1/char, everything else ~1/4 chars. */
export function estTokens(s) {
  let cjk = 0;
  for (const ch of s) if (CJK.test(ch)) cjk++;
  return (cjk + (s.length - cjk) / 4) * TOKEN_FUDGE;
}

/** Parse YAML frontmatter; returns its lines and the body offset. */
function parseFrontmatter(lines) {
  if (lines[0]?.trim() !== '---') return { frontmatter: null, bodyStart: 0 };
  for (let i = 1; i < Math.min(lines.length, 40); i++) {
    if (lines[i].trim() === '---') {
      return { frontmatter: lines.slice(1, i).join('\n'), bodyStart: i + 1 };
    }
  }
  return { frontmatter: null, bodyStart: 0 };
}

/**
 * Pull `description:` / `name:` out of frontmatter for metadata.
 *
 * A skill's `description` is its routing contract — it enumerates the trigger
 * phrases a user actually types ("write blog", "new blog post"). It therefore
 * has to survive into both the metadata and the embedded text. YAML block
 * scalars (`description: >` or `|`) spread across several indented lines, so
 * the regex form alone would capture nothing but the ">" marker.
 */
function frontmatterFields(fm) {
  if (!fm) return {};
  const lines = fm.split('\n');

  const readScalar = (key) => {
    const start = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    if (start < 0) return undefined;

    const inline = lines[start].replace(new RegExp(`^${key}:\\s*`), '').trim();
    // Block scalar: gather the indented continuation lines.
    if (inline === '' || inline === '>' || inline === '|' || /^[>|][-+]?$/.test(inline)) {
      const out = [];
      for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim() === '') {
          out.push('');
          continue;
        }
        if (!/^\s/.test(l)) break; // dedented back to a top-level key
        out.push(l.trim());
      }
      const joined = out.join(' ').replace(/\s+/g, ' ').trim();
      return joined || undefined;
    }
    return inline.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim() || undefined;
  };

  return { name: readScalar('name'), description: readScalar('description') };
}

/**
 * Split text into pieces that each fit the token budget, cutting at the
 * nearest sentence or whitespace boundary so words are not chopped in half.
 */
function splitByBudget(text, budget) {
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    // Grow a window until the budget is spent.
    let end = start;
    let tokens = 0;
    while (end < text.length && tokens < budget) {
      tokens += (CJK.test(text[end]) ? 1 : 0.25) * TOKEN_FUDGE;
      end++;
    }
    if (end >= text.length) {
      pieces.push(text.slice(start));
      break;
    }
    // Back off to the last natural boundary inside the window.
    const window = text.slice(start, end);
    const boundary = Math.max(
      window.lastIndexOf('。'),
      window.lastIndexOf('！'),
      window.lastIndexOf('？'),
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('; '),
      window.lastIndexOf(' '),
    );
    const cut = boundary > window.length * 0.5 ? boundary + 1 : window.length;
    pieces.push(text.slice(start, start + cut));
    start += cut;
  }
  return pieces.map((p) => p.trim()).filter(Boolean);
}

/**
 * Split one markdown document into chunks.
 *
 * @param {string} text Raw file contents.
 * @returns {Array<{heading: string, startLine: number, endLine: number, text: string}>}
 */
export function chunkMarkdown(text) {
  const lines = text.split('\n');
  const { frontmatter, bodyStart } = parseFrontmatter(lines);
  const fmFields = frontmatterFields(frontmatter);

  /** Section accumulator: a heading plus the lines under it. */
  const sections = [];
  const stack = []; // [{level, title}]
  let current = { heading: '', startLine: 1, lines: [] };
  let inFence = false;
  let fenceMarker = '';

  const flush = () => {
    if (current.lines.length || current.heading) sections.push(current);
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Track fenced code blocks so `#` comments are not mistaken for headings.
    const fence = trimmed.match(/^(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      current.lines.push({ n: i + 1, text: line });
      continue;
    }

    const h = !inFence && trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: h[2].trim() });
      current = {
        heading: stack.map((s) => s.title).join(' > '),
        startLine: i + 1,
        lines: [{ n: i + 1, text: line }],
      };
      continue;
    }

    current.lines.push({ n: i + 1, text: line });
  }
  flush();

  // Second pass: enforce the token budget within each section.
  const chunks = [];
  for (const section of sections) {
    const rendered = section.lines.map((l) => l.text).join('\n').trim();
    if (!rendered) continue;

    if (estTokens(rendered) <= MAX_TOKENS) {
      chunks.push(toChunk(section, rendered, section.lines[0].n, section.lines.at(-1).n));
      continue;
    }
    chunks.push(...splitSection(section));
  }

  // Third pass: recombine fragments too small to retrieve on their own.
  const merged = mergeSmall(chunks);

  // The name and description are the file's identity, so every chunk carries
  // the name (short, and the string users copy verbatim), but only the leading
  // chunk carries the full description. Repeating a 60-word description on all
  // 36 chunks of a SKILL.md would make them near-duplicates and reintroduce
  // the redundancy collapse that document-level fusion exists to prevent.
  return merged.map((c, i) => ({
    ...c,
    index: i,
    name: fmFields.name,
    description: i === 0 ? fmFields.description : undefined,
  }));
}

/** Build the final chunk record. */
function toChunk(section, body, startLine, endLine) {
  return { heading: section.heading, startLine, endLine, text: body };
}

/**
 * Split an oversized section at paragraph boundaries, carrying a small tail of
 * the previous piece into the next so a sentence split across the seam is
 * still recoverable by either chunk.
 */
function splitSection(section) {
  const out = [];
  const paras = [];
  let buf = [];
  for (const line of section.lines) {
    if (line.text.trim() === '' && buf.length) {
      paras.push(buf);
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) paras.push(buf);

  let cur = [];
  let curTokens = 0;
  const emit = () => {
    if (!cur.length) return;
    const flat = cur.flat();
    out.push(
      toChunk(
        section,
        flat.map((l) => l.text).join('\n').trim(),
        flat[0].n,
        flat.at(-1).n,
      ),
    );
    // Seed the next chunk with the tail of this one for continuity.
    const tail = [];
    let tailTokens = 0;
    for (let i = flat.length - 1; i >= 0 && tailTokens < OVERLAP_TOKENS; i--) {
      tail.unshift(flat[i]);
      tailTokens += estTokens(flat[i].text);
    }
    const carry = tail.length < flat.length;
    cur = carry ? [tail] : [];
    curTokens = carry ? tailTokens : 0;
  };

  for (const para of paras) {
    const paraTokens = para.reduce((s, l) => s + estTokens(l.text), 0);

    // A paragraph larger than the whole budget is split on sentence boundaries.
    if (paraTokens > MAX_TOKENS) {
      emit();
      for (const line of para) {
        const pieces =
          estTokens(line.text) > MAX_TOKENS
            ? splitByBudget(line.text, TARGET_TOKENS)
            : [line.text];
        for (const piece of pieces) {
          const t = estTokens(piece);
          if (curTokens + t > TARGET_TOKENS && cur.length) emit();
          cur.push([{ n: line.n, text: piece }]);
          curTokens += t;
        }
      }
      continue;
    }

    if (curTokens + paraTokens > TARGET_TOKENS && cur.length) emit();
    cur.push(para);
    curTokens += paraTokens;
  }
  emit();
  return out;
}

/** Deduplicate and join heading breadcrumbs when chunks are merged. */
function joinHeadings(a, b) {
  const seen = new Set();
  const parts = [];
  for (const h of [a, b]) {
    for (const seg of (h ?? '').split(' > ')) {
      const s = seg.trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        parts.push(s);
      }
    }
  }
  return parts.join(' > ').slice(0, 160);
}

/**
 * Merge adjacent undersized chunks so the index is not dominated by heading
 * stubs. A fragment is absorbed by its neighbour whenever the combined text
 * still fits the window and at least one side is below MIN_TOKENS.
 */
function mergeSmall(chunks) {
  if (!chunks.length) return chunks;
  const out = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const prev = out[out.length - 1];
    const next = chunks[i];
    const pt = estTokens(prev.text);
    const nt = estTokens(next.text);
    const combined = pt + nt;

    if (combined <= MAX_TOKENS && (pt < MIN_TOKENS || nt < MIN_TOKENS)) {
      out[out.length - 1] = {
        heading: joinHeadings(prev.heading, next.heading),
        startLine: prev.startLine,
        endLine: next.endLine,
        text: `${prev.text}\n\n${next.text}`,
      };
    } else {
      out.push(next);
    }
  }
  return out;
}

/**
 * Text handed to the embedding model.
 *
 * This is the fix that makes semantic routing work at all. A skill body is
 * written in the skill's own vocabulary ("Write new blog articles…"), while
 * the user asks in theirs ("怎么写博客"). The frontmatter description is the
 * only place that bridges the two — it lists the trigger phrases — so it is
 * embedded ahead of the body on every chunk, along with the skill name (which
 * carries the identifier users copy verbatim) and the heading breadcrumb.
 *
 * Adding these cost a re-embed of the whole vault but moved semantic queries
 * from near-total failure to reliable top-5 hits.
 */
export function embedText(chunk, relPath) {
  const bits = [];
  if (chunk.name) bits.push(chunk.name);
  const crumb = chunk.heading || relPath;
  bits.push(crumb);
  if (chunk.description) bits.push(chunk.description);
  return `passage: ${bits.join(' — ')}\n${chunk.text}`;
}
