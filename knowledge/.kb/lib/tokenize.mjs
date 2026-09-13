/**
 * Tokenizer for BM25 lexical search over a mixed Chinese/English corpus.
 *
 * There is no Chinese word segmenter here on purpose: CJK text is indexed as
 * character bigrams, which is the standard segmentation-free approach and
 * keeps recall high without a dictionary. Latin text is split on camelCase,
 * underscores, dots and dashes so `getUserById` and `blog-write` are
 * reachable by their parts.
 */

const CJK_RUN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+/g;
const LATIN_RUN = /[a-z0-9][a-z0-9+#]*/g;

/** Split a Latin identifier into its component words. */
function splitIdentifier(word) {
  return word
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s._\-/]+/)
    .filter(Boolean);
}

/**
 * Tokenize text into terms for the inverted index.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const terms = [];

  // Latin: split identifiers on camelCase/hyphen/underscore, keep parts and whole.
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  for (const m of spaced.toLowerCase().matchAll(LATIN_RUN)) {
    const w = m[0];
    if (w.length < 2) continue;
    terms.push(w);
    if (/[._\-/]/.test(w)) terms.push(...splitIdentifier(w));
  }

  // CJK: overlapping bigrams, plus single chars for one-character queries.
  for (const m of text.matchAll(CJK_RUN)) {
    const run = m[0];
    if (run.length === 1) {
      terms.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) terms.push(run.slice(i, i + 2));
  }

  return terms;
}

/** Terms used for the query side — same rules, deduplicated. */
export function tokenizeQuery(text) {
  return [...new Set(tokenize(text))];
}
