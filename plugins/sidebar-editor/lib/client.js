/**
 * Browser half of the sidebar editor.
 *
 * Registers an `editor` tab type at the `extension` band for file addresses.
 * The tab registry ranks claims by band first, so `extension` beats the
 * shipped `text` preview (`fallback` band) for the same
 * `dsh-resource://file/**` glob — the extension is the one in force, and the
 * builtin resumes when this plugin unloads.
 *
 * Reads go through the `workspaceFiles` Remote the client already holds: it
 * returns content and the freshness token together, which is exactly the pair
 * a save must guard on. The write goes to this plugin's own host route,
 * because that service is read-only by design.
 *
 * Highlighting is this file's own tokenizer. Shiki ships inside the shell, but
 * it is not reachable from a client plugin — `require('shiki')` misses the
 * module table, and the language grammars are dynamic imports resolved
 * relative to the shell's own bundle URL. Reimplementing a small scanner keeps
 * the pane dependency-free and, more importantly, gives the overlay layer
 * metrics this file controls, which is what keeps it aligned with the
 * textarea.
 *
 * Loaded by `window.__ModuleLoader__`, so this file is plain ES2022 with a
 * CommonJS-shaped factory: no bundler, no JSX.
 *
 * @module dsh-sidebar-editor/client
 */

window.__ModuleLoader__.load({
	id: 'dsh-sidebar-editor',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const react = require('react');
		const h = react.createElement;

		/** The tab kind this package owns. */
		const EDITOR_KIND = 'editor';
		/** This implementation's identity: the key its body registers under. */
		const EDITOR_ID = 'dsh-sidebar-editor';

		/** `dsh-resource://file/` — 20 characters, the prefix before the scope. */
		const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';
		const FILE_ADDRESS_PREFIX_LENGTH = FILE_ADDRESS_PREFIX.length;

		const WRITE_ROUTE = '/sidebar-editor/write';

		/** Extensions the pane refuses; everything else opens as UTF-8 text. */
		const BINARY =
			/\.(png|jpe?g|gif|webp|avif|bmp|ico|icns|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|woff2?|ttf|otf|eot|so|dylib|dll|exe|bin|o|a|class|jar|war|mp3|mp4|mov|avi|mkv|wav|flac|ogg|webm|sqlite|sqlite3|db|pyc|node|wasm)$/i;

		/** How many pages to pull before giving up on a runaway read. */
		const MAX_PAGES = 400;

		/** Lines above which the remainder renders unstyled rather than stall a keystroke. */
		const HIGHLIGHT_MAX_LINES = 3000;

		/** Matches above which the pane stops marking every hit. */
		const MAX_MATCHES = 2000;

		/** Spaces one Tab inserts. */
		const INDENT = '  ';

		/**
		 * Unsaved text per tab address.
		 *
		 * Whether an inactive tab stays mounted is the pane framework's
		 * business, and a docked-but-not-active tab may be unmounted. Holding
		 * drafts outside React means switching files never discards work, and a
		 * draft is dropped the moment its text reaches disk.
		 */
		const DRAFTS = new Map();

		// ── addresses ───────────────────────────────────────────────────────────

		/**
		 * Split a `dsh-resource://file/…` address into its scope, and for a
		 * session address its session id and decoded path.
		 *
		 * Mirrors the shipped preview's parser, including per-segment decoding,
		 * so a name carrying `#`, `?`, or a space reads as itself.
		 * @param address - the tab's address.
		 * @returns the parsed address, or undefined when it is not a file address.
		 */
		function parseFileAddress(address) {
			try {
				if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined;
				const end = address.search(/[?#]/);
				const trimmed = address.slice(FILE_ADDRESS_PREFIX_LENGTH, end === -1 ? undefined : end);
				const [scope, ...rest] = trimmed.split('/');

				if (scope === 'session') {
					const [id, ...segments] = rest;
					if (!id || segments.length === 0) return undefined;
					return {
						scope,
						sessionId: decodeURIComponent(id),
						path: segments.map(decodeURIComponent).join('/'),
					};
				}
				if (scope === 'absolute') {
					return { scope, path: '/' + rest.map(decodeURIComponent).join('/') };
				}
				return undefined;
			} catch {
				return undefined;
			}
		}

		/**
		 * Last path segment of an address, decoded.
		 * @param address - a `dsh-resource://` address.
		 * @returns the file name, or the address when it has no segment.
		 */
		function basenameOf(address) {
			if (typeof address !== 'string') return String(address);
			const path = address.split('?')[0].split('#')[0];
			const segments = path.split('/').filter(Boolean);
			const last = segments[segments.length - 1] ?? address;
			try {
				return decodeURIComponent(last);
			} catch {
				return last;
			}
		}

		/**
		 * Whether this type wants the address.
		 * @param address - the address being claimed.
		 * @returns true for session-scoped, non-binary file addresses.
		 */
		function isEditableAddress(address) {
			const parsed = parseFileAddress(address);
			if (parsed === undefined || parsed.scope !== 'session') return false;
			const name = basenameOf(address);
			if (!name) return false;
			return !BINARY.test(name);
		}

		/**
		 * The editor type's registry definition.
		 * @returns the definition to register.
		 */
		function editorDefinition() {
			return {
				id: EDITOR_ID,
				kind: EDITOR_KIND,
				patterns: ['dsh-resource://file/**'],
				priority: 'extension',
				canOpen: isEditableAddress,
				title: basenameOf,
			};
		}

		// ── language detection ──────────────────────────────────────────────────

		/** File extension to scanner family. */
		const LANGUAGE_BY_EXTENSION = {
			js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js',
			json: 'json', jsonc: 'json',
			md: 'md', markdown: 'md', mdx: 'md',
			py: 'py', pyi: 'py',
			sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh',
			yml: 'hash', yaml: 'hash', toml: 'hash', ini: 'hash', cfg: 'hash', conf: 'hash', env: 'hash',
			html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html',
			css: 'css', scss: 'css', less: 'css',
			go: 'js', rs: 'js', java: 'js', kt: 'js', swift: 'js',
			c: 'js', h: 'js', cpp: 'js', hpp: 'js', cs: 'js', php: 'js',
			sql: 'sql',
		};

		/**
		 * Scanner family for a file name.
		 * @param name - the file's basename.
		 * @returns the family key, or `text` when nothing matches.
		 */
		function languageOf(name) {
			const lower = String(name).toLowerCase();
			if (lower === 'dockerfile' || lower === 'makefile') return 'sh';
			const dot = lower.lastIndexOf('.');
			if (dot === -1) return 'text';
			return LANGUAGE_BY_EXTENSION[lower.slice(dot + 1)] ?? 'text';
		}

		/** Keywords worth colouring, per scanner family. */
		const KEYWORDS = {
			js: 'const let var function return if else for while do break continue class extends new this super import export from default async await try catch finally throw typeof instanceof delete in of void yield static get set null undefined true false',
			py: 'def class return if elif else for while break continue import from as pass raise try except finally with lambda yield global nonlocal assert del in is not and or None True False async await self',
			sh: 'if then else elif fi for while until do done case esac function return export local readonly declare set unset source alias echo cd exit',
			sql: 'select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit offset union all as and or not null distinct count sum avg min max',
		};

		/** Comment and string syntax per scanner family. */
		function syntaxOf(family) {
			switch (family) {
				case 'py':
					return { line: '#', block: null, quotes: ['"', "'"] };
				case 'sh':
				case 'hash':
					return { line: '#', block: null, quotes: ['"', "'"] };
				case 'sql':
					return { line: '--', block: ['/*', '*/'], quotes: ["'", '"'] };
				case 'css':
					return { line: null, block: ['/*', '*/'], quotes: ['"', "'"] };
				case 'html':
					return { line: null, block: ['<!--', '-->'], quotes: ['"', "'"] };
				case 'json':
					return { line: null, block: null, quotes: ['"'] };
				default:
					return { line: '//', block: ['/*', '*/'], quotes: ['"', "'", '`'] };
			}
		}

		/** Sticky scanners; sticky avoids re-slicing the remaining text each step. */
		const RE_NUMBER = /\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
		const RE_WORD = /[A-Za-z_$][\w$]*/y;
		const RE_SPACE = /\s+/y;
		const RE_PUNCT = /[^\w\s]/y;

		/**
		 * Scan code into coloured tokens.
		 *
		 * One left-to-right pass: comments, then strings, then numbers, then
		 * words, then whitespace and punctuation. Unterminated constructs fall
		 * back to plain text rather than swallowing the rest of the file.
		 *
		 * @param text - the source to scan.
		 * @param family - scanner family from {@link languageOf}.
		 * @returns `{ t, v }` tokens; `t` is a palette key or null.
		 */
		function tokenizeCode(text, family) {
			const syntax = syntaxOf(family);
			const keywords = new Set((KEYWORDS[family] ?? '').split(' ').filter(Boolean));
			const out = [];
			const n = text.length;
			let i = 0;

			while (i < n) {
				if (syntax.block !== null && text.startsWith(syntax.block[0], i)) {
					const close = text.indexOf(syntax.block[1], i + syntax.block[0].length);
					const stop = close === -1 ? n : close + syntax.block[1].length;
					out.push({ t: 'comment', v: text.slice(i, stop) });
					i = stop;
					continue;
				}

				if (syntax.line !== null && text.startsWith(syntax.line, i)) {
					let stop = text.indexOf('\n', i);
					if (stop === -1) stop = n;
					out.push({ t: 'comment', v: text.slice(i, stop) });
					i = stop;
					continue;
				}

				const quote = syntax.quotes.find((q) => text.startsWith(q, i));
				if (quote !== undefined) {
					let j = i + quote.length;
					while (j < n) {
						if (text[j] === '\\') {
							j += 2;
							continue;
						}
						if (text.startsWith(quote, j)) {
							j += quote.length;
							break;
						}
						if (text[j] === '\n' && quote !== '`') break;
						j += 1;
					}
					const stop = Math.min(j, n);
					out.push({ t: 'string', v: text.slice(i, stop) });
					i = stop;
					continue;
				}

				RE_NUMBER.lastIndex = i;
				const number = RE_NUMBER.exec(text);
				if (number !== null) {
					out.push({ t: 'number', v: number[0] });
					i += number[0].length;
					continue;
				}

				RE_WORD.lastIndex = i;
				const word = RE_WORD.exec(text);
				if (word !== null) {
					const value = word[0];
					const isCall = /^\s*\(/.test(text.slice(i + value.length, i + value.length + 40));
					let type = null;
					if (keywords.has(value)) type = 'keyword';
					else if (/^[A-Z]/.test(value)) type = 'type';
					else if (isCall) type = 'func';
					out.push({ t: type, v: value });
					i += value.length;
					continue;
				}

				RE_SPACE.lastIndex = i;
				const space = RE_SPACE.exec(text);
				if (space !== null) {
					out.push({ t: null, v: space[0] });
					i += space[0].length;
					continue;
				}

				out.push({ t: 'punct', v: text[i] });
				i += 1;
			}

			return out;
		}

		/** Inline Markdown spans, appended to `out`. */
		const RE_INLINE = /(`[^`\n]*`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]*\]\([^)\n]*\))/g;

		/**
		 * Append one line's inline Markdown spans.
		 * @param out - token sink.
		 * @param line - the line to scan.
		 */
		function pushInline(out, line) {
			RE_INLINE.lastIndex = 0;
			let last = 0;
			let match = RE_INLINE.exec(line);
			while (match !== null) {
				if (match.index > last) out.push({ t: null, v: line.slice(last, match.index) });
				const value = match[0];
				let type = 'link';
				if (value.startsWith('`')) type = 'code';
				else if (value.startsWith('*')) type = 'emphasis';
				out.push({ t: type, v: value });
				last = match.index + value.length;
				match = RE_INLINE.exec(line);
			}
			if (last < line.length) out.push({ t: null, v: line.slice(last) });
		}

		/**
		 * Scan Markdown line by line, so block structure (headings, fences,
		 * lists, quotes) colours differently from body text.
		 * @param text - the document.
		 * @returns `{ t, v }` tokens, newlines preserved verbatim.
		 */
		function tokenizeMarkdown(text) {
			const out = [];
			const lines = text.split('\n');
			let fenced = false;

			for (let index = 0; index < lines.length; index++) {
				if (index > 0) out.push({ t: null, v: '\n' });
				const line = lines[index];

				if (/^\s*(?:```|~~~)/.test(line)) {
					fenced = !fenced;
					out.push({ t: 'keyword', v: line });
					continue;
				}
				if (fenced) {
					out.push({ t: 'code', v: line });
					continue;
				}

				const heading = /^(#{1,6})(\s.*)?$/.exec(line);
				if (heading !== null) {
					out.push({ t: 'heading', v: heading[1] });
					if (heading[2] !== undefined) out.push({ t: 'heading', v: heading[2] });
					continue;
				}
				if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) && line.trim() !== '') {
					out.push({ t: 'punct', v: line });
					continue;
				}
				const quote = /^(\s*>+\s?)(.*)$/.exec(line);
				if (quote !== null) {
					out.push({ t: 'comment', v: quote[1] });
					pushInline(out, quote[2]);
					continue;
				}
				const list = /^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/.exec(line);
				if (list !== null) {
					out.push({ t: 'keyword', v: list[1] });
					pushInline(out, list[2]);
					continue;
				}
				pushInline(out, line);
			}

			return out;
		}

		/**
		 * Tokenize a document, leaving anything past the line cap unstyled so a
		 * huge file cannot stall a keystroke.
		 * @param text - the document.
		 * @param family - scanner family.
		 * @returns the token list.
		 */
		function tokenize(text, family) {
			if (family === 'md') {
				const lines = text.split('\n');
				if (lines.length <= HIGHLIGHT_MAX_LINES) return tokenizeMarkdown(text);
				const head = lines.slice(0, HIGHLIGHT_MAX_LINES).join('\n');
				return [...tokenizeMarkdown(head), { t: null, v: '\n' + lines.slice(HIGHLIGHT_MAX_LINES).join('\n') }];
			}
			if (family === 'text') return [{ t: null, v: text }];

			const lines = text.split('\n');
			if (lines.length > HIGHLIGHT_MAX_LINES) {
				const head = lines.slice(0, HIGHLIGHT_MAX_LINES).join('\n');
				return [
					...tokenizeCode(head, family),
					{ t: null, v: '\n' + lines.slice(HIGHLIGHT_MAX_LINES).join('\n') },
				];
			}
			return tokenizeCode(text, family);
		}

		/**
		 * Split tokens at match boundaries so every hit can be marked.
		 *
		 * Tokens and matches are both in document order, so one two-pointer walk
		 * does it; a hit spanning several tokens (a phrase crossing a keyword
		 * and a string, say) is carried across the boundary rather than lost.
		 *
		 * @param tokens - the token list.
		 * @param ranges - sorted, non-overlapping `[start, end)` match offsets.
		 * @returns tokens, with matched pieces carrying the index of their range
		 *   as `m`, so the active hit can be styled apart from the rest.
		 */
		function markMatches(tokens, ranges) {
			if (ranges.length === 0) return tokens;

			const out = [];
			let offset = 0;
			let cursor = 0;

			for (const token of tokens) {
				const start = offset;
				const end = offset + token.v.length;
				offset = end;

				while (cursor < ranges.length && ranges[cursor][1] <= start) cursor += 1;

				const pieces = [];
				let at = start;
				let index = cursor;
				while (index < ranges.length && ranges[index][0] < end) {
					const hitStart = Math.max(ranges[index][0], start);
					const hitEnd = Math.min(ranges[index][1], end);
					if (hitStart > at) pieces.push([-1, token.v.slice(at - start, hitStart - start)]);
					pieces.push([index, token.v.slice(hitStart - start, hitEnd - start)]);
					at = hitEnd;
					// A hit running past this token keeps its index for the next one.
					if (ranges[index][1] <= end) index += 1;
					else break;
				}
				cursor = index;

				if (pieces.length === 0) {
					out.push(token);
					continue;
				}
				if (at < end) pieces.push([-1, token.v.slice(at - start)]);
				for (const [hit, value] of pieces) {
					out.push(hit === -1 ? { t: token.t, v: value } : { t: token.t, v: value, m: hit });
				}
			}

			return out;
		}

		/**
		 * 1-based line holding a character offset.
		 * @param text - the document.
		 * @param index - the offset.
		 * @returns the line number.
		 */
		function lineOf(text, index) {
			let line = 1;
			for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line += 1;
			return line;
		}

		// ── palette ─────────────────────────────────────────────────────────────

		/** Token colours on a dark surface (One Dark hues). */
		const PALETTE_DARK = {
			comment: '#7f848e',
			string: '#98c379',
			number: '#d19a66',
			keyword: '#c678dd',
			type: '#e5c07b',
			func: '#61afef',
			punct: '#9aa0a6',
			heading: '#61afef',
			code: '#e06c75',
			emphasis: '#e5c07b',
			link: '#61afef',
		};

		/** Token colours on a light surface (One Light hues). */
		const PALETTE_LIGHT = {
			comment: '#8a8f98',
			string: '#22863a',
			number: '#b76b01',
			keyword: '#a626a4',
			type: '#986801',
			func: '#4078f2',
			punct: '#696c77',
			heading: '#4078f2',
			code: '#e45649',
			emphasis: '#986801',
			link: '#4078f2',
		};

		/** Every hit, and the one the caret is on. */
		const MATCH_BACKGROUND = 'rgba(255, 196, 0, 0.30)';
		const CURRENT_MATCH_BACKGROUND = 'rgba(255, 145, 0, 0.55)';

		// ── metrics ─────────────────────────────────────────────────────────────
		//
		// The highlight layer and the textarea must lay text out identically or
		// the caret drifts from the glyphs. One object feeds both, and the
		// gutter reuses its line height.

		const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
		const FONT_SIZE = 12;
		const LINE_HEIGHT = 18;
		const PADDING_Y = 10;
		const PADDING_X = 12;

		/** Shared text metrics for the two stacked code layers. */
		const CODE_METRICS = {
			margin: 0,
			border: 'none',
			padding: `${PADDING_Y}px ${PADDING_X}px`,
			fontFamily: FONT_FAMILY,
			fontSize: FONT_SIZE,
			lineHeight: `${LINE_HEIGHT}px`,
			tabSize: 2,
			whiteSpace: 'pre',
			overflowWrap: 'normal',
			wordBreak: 'normal',
			boxSizing: 'border-box',
		};

		/** Chrome around the code area. */
		const styles = {
			root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: FONT_SIZE },
			bar: {
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				padding: '6px 10px',
				borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25))',
				flex: '0 0 auto',
				fontFamily: FONT_FAMILY,
			},
			name: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
			spacer: { flex: '1 1 auto' },
			button: {
				padding: '3px 10px',
				borderRadius: 6,
				border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
				background: 'transparent',
				color: 'inherit',
				cursor: 'pointer',
				font: 'inherit',
			},
			iconButton: {
				padding: '2px 7px',
				borderRadius: 5,
				border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
				background: 'transparent',
				color: 'inherit',
				cursor: 'pointer',
				font: 'inherit',
				lineHeight: 1.2,
			},
			findBar: {
				display: 'flex',
				alignItems: 'center',
				gap: 6,
				padding: '6px 10px',
				flex: '0 0 auto',
				flexWrap: 'wrap',
				borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25))',
				fontFamily: FONT_FAMILY,
			},
			field: {
				padding: '3px 7px',
				borderRadius: 5,
				border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
				background: 'var(--dsw-alias-bg-layer-2, transparent)',
				color: 'inherit',
				font: 'inherit',
				minWidth: 90,
				flex: '1 1 90px',
			},
			counter: { opacity: 0.7, minWidth: 54, textAlign: 'center' },
			body: { display: 'flex', flex: '1 1 auto', minHeight: 0, position: 'relative' },
			gutter: {
				flex: '0 0 auto',
				overflow: 'hidden',
				position: 'relative',
				paddingTop: PADDING_Y,
				paddingBottom: PADDING_Y,
				textAlign: 'right',
				userSelect: 'none',
				fontFamily: FONT_FAMILY,
				fontSize: FONT_SIZE,
				lineHeight: `${LINE_HEIGHT}px`,
				color: 'var(--dsw-alias-label-dimmed, rgba(127,127,127,0.75))',
				borderRight: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.18))',
			},
			gutterInner: { paddingLeft: 10, paddingRight: 10, willChange: 'transform' },
			codeArea: { flex: '1 1 auto', minWidth: 0, position: 'relative', overflow: 'hidden' },
			highlight: {
				...CODE_METRICS,
				position: 'absolute',
				top: 0,
				left: 0,
				minWidth: '100%',
				pointerEvents: 'none',
				willChange: 'transform',
			},
			input: {
				...CODE_METRICS,
				position: 'absolute',
				inset: 0,
				width: '100%',
				height: '100%',
				resize: 'none',
				outline: 'none',
				background: 'transparent',
				color: 'transparent',
				caretColor: 'var(--dsw-alias-label-primary, currentColor)',
				overflow: 'auto',
			},
			notice: { padding: '4px 10px', flex: '0 0 auto', fontFamily: FONT_FAMILY },
			center: { padding: 16, opacity: 0.75, fontFamily: FONT_FAMILY },
		};

		// ── face ────────────────────────────────────────────────────────────────

		/**
		 * The pane's business face: reads bound to the Client Remote.
		 * @param ctx - client root context carrying `remote`.
		 * @returns the Slot `inject` factory.
		 */
		function editorFace(ctx) {
			return (sessionId) => ({
				/**
				 * Read a whole text file by paging the Remote until `eof`.
				 *
				 * Paging rather than `readAll` because the paged read returns
				 * decoded text and a per-page freshness token, so the caller
				 * never base64-decodes and never hits the whole-file byte cap.
				 *
				 * @param path - the path the address carried.
				 * @param signal - the owning tab's lifetime.
				 * @returns `{ ok: true, text, version, absolutePath }` or `{ ok: false, error }`.
				 */
				readFile: async (path, signal) => {
					const parts = [];
					let offset = 1;
					let version;
					let absolutePath;

					for (let page = 0; page < MAX_PAGES; page++) {
						const result = await ctx.remote.workspaceFiles.read(sessionId, path, { offset }, signal);
						if (!result.ok) return { ok: false, error: result.error };

						const value = result.value;
						if (absolutePath === undefined) absolutePath = value.absolutePath;
						if (version === undefined) {
							version = value.version;
						} else if (value.version !== version) {
							// The file moved mid-walk; the caller must start over
							// rather than splice two versions together.
							return {
								ok: false,
								error: { code: 'FS_STALE_VERSION', message: '文件在读取过程中被修改' },
							};
						}

						if (value.lines === 0) break;
						parts.push(value.text);
						offset += value.lines;
						if (value.eof) break;
					}

					return { ok: true, text: parts.join('\n'), version, absolutePath };
				},
			});
		}

		// ── body ────────────────────────────────────────────────────────────────

		/**
		 * Replace the textarea's selection through the editing pipeline, so the
		 * browser's own undo stack keeps working.
		 * @param textarea - the field to edit.
		 * @param text - replacement text.
		 */
		function insertText(textarea, text) {
			textarea.focus();
			let done = false;
			try {
				done = document.execCommand('insertText', false, text);
			} catch {
				done = false;
			}
			if (done) return;

			// execCommand is deprecated; fall back to a value splice that React's
			// onChange still sees.
			const { selectionStart, selectionEnd, value } = textarea;
			textarea.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
			textarea.selectionStart = textarea.selectionEnd = selectionStart + text.length;
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
		}

		/**
		 * All non-overlapping occurrences of `query` in `text`.
		 * @param text - the document.
		 * @param query - the search text; empty finds nothing.
		 * @param caseSensitive - whether case must match.
		 * @returns sorted `[start, end)` ranges, capped at {@link MAX_MATCHES}.
		 */
		function findMatches(text, query, caseSensitive) {
			if (query === '') return [];
			const haystack = caseSensitive ? text : text.toLowerCase();
			const needle = caseSensitive ? query : query.toLowerCase();
			const ranges = [];
			let from = 0;

			for (;;) {
				const at = haystack.indexOf(needle, from);
				if (at === -1) break;
				ranges.push([at, at + needle.length]);
				from = at + needle.length;
				if (ranges.length >= MAX_MATCHES) break;
			}

			return ranges;
		}

		/**
		 * The editable pane: gutter, highlighted overlay, find/replace, and a
		 * transparent textarea that owns input and scrolling.
		 * @param props - slot runtime props plus this plugin's injected face.
		 * @returns the pane element.
		 */
		function EditorBody(props) {
			const { useTabInfo, readFile } = props;

			// Slot hooks are render-time hooks. Calling one from an effect
			// re-enters the slot framework on every commit and wedges the page's
			// main thread, so it runs here, unconditionally, at the top level.
			//
			// The address lives on `tab.navigation`, not on the tab record: a tab
			// record carries `contentId`, and `navigation` is what the opening
			// `open` carried (address, params, revision).
			const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined;
			const address = info?.tab?.navigation?.address ?? info?.tab?.contentId ?? '';

			const parsed = parseFileAddress(address);
			const name = basenameOf(address) || '(no file)';
			const family = languageOf(name);

			const rootRef = react.useRef(null);
			const gutterRef = react.useRef(null);
			const highlightRef = react.useRef(null);
			const inputRef = react.useRef(null);
			const findInputRef = react.useRef(null);
			const pendingSelection = react.useRef(null);

			const [status, setStatus] = react.useState('loading');
			const [text, setText] = react.useState('');
			const [savedText, setSavedText] = react.useState('');
			const [version, setVersion] = react.useState(undefined);
			const [absolutePath, setAbsolutePath] = react.useState(undefined);
			const [notice, setNotice] = react.useState(undefined);
			const [saving, setSaving] = react.useState(false);
			const [dark, setDark] = react.useState(true);

			const [findOpen, setFindOpen] = react.useState(false);
			const [query, setQuery] = react.useState('');
			const [replacement, setReplacement] = react.useState('');
			const [caseSensitive, setCaseSensitive] = react.useState(false);
			const [matchIndex, setMatchIndex] = react.useState(0);

			const dirty = status === 'ready' && text !== savedText;

			// Pick the palette from the surface the pane actually landed on, since
			// the app exposes no token-colour variables to read.
			react.useEffect(() => {
				const element = rootRef.current;
				if (element === null) return;
				const colour = getComputedStyle(element).color ?? '';
				const parts = colour.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
				if (parts === null) return;
				const luminance =
					(0.299 * Number(parts[1]) + 0.587 * Number(parts[2]) + 0.114 * Number(parts[3])) / 255;
				setDark(luminance > 0.5);
			}, []);

			/** Pull the file into the pane, preferring an unsaved draft. */
			const load = react.useCallback(() => {
				if (parsed === undefined) {
					setStatus('error');
					setNotice({ kind: 'error', message: '这个地址不是会话文件地址，无法读取。' });
					return undefined;
				}
				if (typeof readFile !== 'function') {
					setStatus('error');
					setNotice({ kind: 'error', message: '读取接口未注入。' });
					return undefined;
				}

				const controller = new AbortController();
				setStatus('loading');
				setNotice(undefined);

				readFile(parsed.path, controller.signal)
					.then((result) => {
						if (controller.signal.aborted) return;
						if (!result.ok) {
							setStatus('error');
							setNotice({
								kind: 'error',
								message: `${result.error?.code ?? 'read-failed'}: ${result.error?.message ?? ''}`,
							});
							return;
						}

						const draft = DRAFTS.get(address);
						setSavedText(result.text);
						setVersion(result.version);
						setAbsolutePath(result.absolutePath);
						setStatus('ready');

						if (draft !== undefined && draft !== result.text) {
							setText(draft);
							setNotice({ kind: 'info', message: '已恢复未保存的改动。' });
						} else {
							setText(result.text);
							DRAFTS.delete(address);
						}
					})
					.catch((error) => {
						if (controller.signal.aborted) return;
						setStatus('error');
						setNotice({ kind: 'error', message: String(error) });
					});

				return () => controller.abort();
			}, [address, parsed?.path, readFile]);

			react.useEffect(() => load(), [load]);

			// Keep the draft ledger honest: a tab that reaches disk holds none.
			react.useEffect(() => {
				if (status !== 'ready') return;
				if (text === savedText) DRAFTS.delete(address);
				else DRAFTS.set(address, text);
			}, [address, status, text, savedText]);

			/** Keep the overlay and gutter on the textarea's scroll offset. */
			const syncScroll = react.useCallback(() => {
				const input = inputRef.current;
				if (input === null) return;
				if (highlightRef.current !== null) {
					highlightRef.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
				}
				if (gutterRef.current !== null) {
					gutterRef.current.style.transform = `translateY(${-input.scrollTop}px)`;
				}
			}, []);

			// A programmatic edit changes the text without a scroll event.
			react.useLayoutEffect(syncScroll, [text, syncScroll]);

			// Reapply the caret a programmatic edit asked for, after React commits.
			react.useLayoutEffect(() => {
				const pending = pendingSelection.current;
				const input = inputRef.current;
				if (pending === null || input === null) return;
				pendingSelection.current = null;
				input.selectionStart = pending.start;
				input.selectionEnd = pending.end;
			}, [text]);

			const matches = react.useMemo(
				() => (findOpen ? findMatches(text, query, caseSensitive) : []),
				[caseSensitive, findOpen, query, text],
			);

			const activeIndex = matches.length === 0 ? 0 : Math.min(matchIndex, matches.length - 1);

			/** Put the active hit in the middle of the viewport. */
			const revealMatch = react.useCallback(
				(index) => {
					const input = inputRef.current;
					const match = matches[index];
					if (input === null || match === undefined) return;
					const top = (lineOf(text, match[0]) - 1) * LINE_HEIGHT;
					const view = input.clientHeight;
					if (top < input.scrollTop || top + LINE_HEIGHT > input.scrollTop + view) {
						input.scrollTop = Math.max(0, top - view / 2);
					}
				},
				[matches, text],
			);

			react.useEffect(() => {
				if (findOpen) revealMatch(activeIndex);
			}, [activeIndex, findOpen, revealMatch]);

			// Focus the search field the moment the bar opens.
			react.useEffect(() => {
				if (findOpen && findInputRef.current !== null) findInputRef.current.focus();
			}, [findOpen]);

			const step = react.useCallback(
				(delta) => {
					if (matches.length === 0) return;
					setMatchIndex((current) => {
						const base = Math.min(current, matches.length - 1);
						return (base + delta + matches.length) % matches.length;
					});
				},
				[matches.length],
			);

			const replaceCurrent = react.useCallback(() => {
				const match = matches[activeIndex];
				if (match === undefined) return;
				setText(text.slice(0, match[0]) + replacement + text.slice(match[1]));
				setNotice({
					kind: 'info',
					message: `已替换 1 处${matches.length > 1 ? `，还剩 ${matches.length - 1} 处` : ''}`,
				});
			}, [activeIndex, matches, replacement, text]);

			const replaceAll = react.useCallback(() => {
				if (matches.length === 0) return;
				let out = '';
				let last = 0;
				for (const [start, end] of matches) {
					out += text.slice(last, start) + replacement;
					last = end;
				}
				out += text.slice(last);
				setText(out);
				setNotice({ kind: 'info', message: `已全部替换：${matches.length} 处` });
			}, [matches, replacement, text]);

			/** Save through the host route, guarded on the version we read. */
			const save = react.useCallback(() => {
				if (absolutePath === undefined || parsed === undefined || saving) return;
				setSaving(true);
				setNotice(undefined);

				fetch(WRITE_ROUTE, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						sessionId: parsed.sessionId,
						absolutePath,
						content: text,
						expectedVersion: version,
					}),
				})
					.then(async (response) => {
						const payload = await response.json().catch(() => ({}));
						if (response.ok && payload.ok) {
							setSavedText(text);
							setVersion(payload.version);
							DRAFTS.delete(address);
							setNotice({
								kind: 'info',
								message: `已保存 · ${payload.operation} · ${payload.bytes} 字节`,
							});
							return;
						}
						if (response.status === 409) {
							setNotice({
								kind: 'error',
								message: '文件已被外部修改，保存被拒绝。请点「重新载入」后再改。',
							});
							return;
						}
						setNotice({
							kind: 'error',
							message: `${payload.code ?? response.status}: ${payload.message ?? ''}`,
						});
					})
					.catch((error) => setNotice({ kind: 'error', message: String(error) }))
					.finally(() => setSaving(false));
			}, [absolutePath, address, parsed?.sessionId, saving, text, version]);

			/**
			 * Indent or outdent every line the selection touches.
			 * @param event - the Tab keydown.
			 */
			const applyIndent = react.useCallback((event) => {
				const input = event.currentTarget;
				const value = input.value;
				const start = input.selectionStart;
				const end = input.selectionEnd;

				const firstLine = value.lastIndexOf('\n', start - 1) + 1;
				let lastLine = value.indexOf('\n', end);
				if (lastLine === -1) lastLine = value.length;

				const block = value.slice(firstLine, lastLine);
				const lines = block.split('\n');
				const outdenting = event.shiftKey;
				const changed = lines
					.map((line) => (outdenting ? line.replace(/^ {1,2}|^\t/, '') : INDENT + line))
					.join('\n');

				const next = value.slice(0, firstLine) + changed + value.slice(lastLine);
				if (next === value) return;

				// Keep the selection over the same lines after the shift.
				const delta = changed.length - block.length;
				pendingSelection.current = {
					start: outdenting ? Math.max(firstLine, start - 2) : start + INDENT.length,
					end: end + delta,
				};

				input.value = next;
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}, []);

			/** ⌘S saves, ⌘F finds, Escape closes the find bar, Tab indents. */
			const onKeyDown = react.useCallback(
				(event) => {
					if (event.metaKey || event.ctrlKey) {
						const key = String(event.key).toLowerCase();
						if (key === 's') {
							event.preventDefault();
							save();
							return;
						}
						if (key === 'f') {
							event.preventDefault();
							setFindOpen(true);
							return;
						}
					}
					if (event.key === 'Escape' && findOpen) {
						event.preventDefault();
						setFindOpen(false);
						return;
					}
					if (event.key === 'Tab') {
						event.preventDefault();
						const input = event.currentTarget;
						// A collapsed caret inserts; a selection shifts whole lines.
						if (input.selectionStart === input.selectionEnd && !event.shiftKey) {
							insertText(input, INDENT);
							return;
						}
						applyIndent(event);
					}
				},
				[applyIndent, findOpen, save],
			);

			const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;

			const tokens = react.useMemo(
				() => (status === 'ready' ? tokenize(text, family) : []),
				[text, family, status],
			);

			const marked = react.useMemo(() => markMatches(tokens, matches), [tokens, matches]);

			const lineCount = react.useMemo(() => {
				if (status !== 'ready') return 0;
				let count = 1;
				for (let i = 0; i < text.length; i++) if (text[i] === '\n') count += 1;
				return count;
			}, [text, status]);

			const bar = h(
				'div',
				{ style: styles.bar },
				h('span', { style: styles.name }, name),
				dirty ? h('span', { title: '未保存' }, '●') : null,
				h('span', { style: styles.spacer }),
				h(
					'button',
					{
						style: styles.iconButton,
						onClick: () => setFindOpen((open) => !open),
						title: '查找与替换（⌘F）',
						disabled: status !== 'ready',
					},
					'查找',
				),
				h(
					'button',
					{
						style: styles.button,
						onClick: () => load(),
						disabled: status === 'loading',
						title: '丢弃改动并重新读取',
					},
					'重新载入',
				),
				h(
					'button',
					{
						style: styles.button,
						onClick: save,
						disabled: !dirty || saving || status !== 'ready',
						title: '保存（⌘S）',
					},
					saving ? '保存中…' : '保存',
				),
			);

			const findBar = findOpen
				? h(
						'div',
						{ style: styles.findBar },
						h('input', {
							style: styles.field,
							ref: findInputRef,
							value: query,
							placeholder: '查找',
							spellCheck: false,
							onChange: (event) => {
								setQuery(event.target.value);
								setMatchIndex(0);
							},
							onKeyDown: (event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									step(event.shiftKey ? -1 : 1);
								} else if (event.key === 'Escape') {
									event.preventDefault();
									setFindOpen(false);
								}
							},
						}),
						h('input', {
							style: styles.field,
							value: replacement,
							placeholder: '替换为',
							spellCheck: false,
							onChange: (event) => setReplacement(event.target.value),
							onKeyDown: (event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									replaceCurrent();
								} else if (event.key === 'Escape') {
									event.preventDefault();
									setFindOpen(false);
								}
							},
						}),
						h(
							'span',
							{ style: styles.counter },
							query === '' ? '' : matches.length === 0 ? '无结果' : `${activeIndex + 1} / ${matches.length}`,
						),
						h(
							'button',
							{ style: styles.iconButton, onClick: () => step(-1), title: '上一个（⇧Enter）' },
							'↑',
						),
						h('button', { style: styles.iconButton, onClick: () => step(1), title: '下一个（Enter）' }, '↓'),
						h(
							'button',
							{
								style: styles.iconButton,
								onClick: () => setCaseSensitive((on) => !on),
								title: '区分大小写',
								'aria-pressed': caseSensitive,
								...(caseSensitive ? { 'data-active': 'true' } : {}),
							},
							'Aa',
						),
						h(
							'button',
							{ style: styles.iconButton, onClick: replaceCurrent, disabled: matches.length === 0 },
							'替换',
						),
						h(
							'button',
							{ style: styles.iconButton, onClick: replaceAll, disabled: matches.length === 0 },
							'全部替换',
						),
						h('button', { style: styles.iconButton, onClick: () => setFindOpen(false), title: '关闭' }, '×'),
					)
				: null;

			if (status !== 'ready') {
				return h(
					'div',
					{ style: styles.root, ref: rootRef },
					bar,
					h(
						'div',
						{ style: styles.center },
						status === 'loading' ? '正在读取…' : notice?.message ?? '读取失败',
					),
				);
			}

			// One gutter row per line, so scroll height matches the code exactly.
			const gutterRows = [];
			for (let line = 1; line <= lineCount; line++) gutterRows.push(line);

			return h(
				'div',
				{ style: styles.root, ref: rootRef },
				bar,
				findBar,
				h(
					'div',
					{ style: styles.body },
					h(
						'div',
						{ style: styles.gutter },
						h(
							'div',
							{ style: styles.gutterInner, ref: gutterRef },
							gutterRows.map((line) => h('div', { key: line }, String(line))),
						),
					),
					h(
						'div',
						{ style: styles.codeArea },
						h(
							'pre',
							{ style: styles.highlight, ref: highlightRef, 'aria-hidden': 'true' },
							h(
								'code',
								null,
								marked.map((token, index) => {
									if (token.t === null && token.m === undefined) return token.v;
									const style =
										token.m === undefined
											? { color: palette[token.t] }
											: {
													color: token.t === null ? 'inherit' : palette[token.t],
													background:
														token.m === activeIndex
															? CURRENT_MATCH_BACKGROUND
															: MATCH_BACKGROUND,
													borderRadius: 2,
												};
									return h('span', { key: index, style }, token.v);
								}),
								// Guarantees the final line box exists when the file
								// ends with a newline.
								'\u200b',
							),
						),
						h('textarea', {
							style: styles.input,
							ref: inputRef,
							value: text,
							spellCheck: false,
							wrap: 'off',
							onChange: (event) => setText(event.target.value),
							onKeyDown,
							onScroll: syncScroll,
						}),
					),
				),
				notice
					? h(
							'div',
							{
								style: {
									...styles.notice,
									color:
										notice.kind === 'error'
											? 'var(--dsw-alias-state-error-primary, #e5484d)'
											: 'inherit',
								},
							},
							notice.message,
						)
					: null,
			);
		}

		// ── plugin ──────────────────────────────────────────────────────────────

		/**
		 * Required browser services: the tab registry, the keyed seat, copy, and
		 * the Remote namespace carrying `workspaceFiles`.
		 *
		 * `remote.workspaceFiles` is listed even though `remote` is already
		 * present: the Remote is a service-accessor tree, and reading a
		 * namespace property off it is itself an injection.
		 */
		const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'];

		/**
		 * Client plugin body.
		 * @param ctx - client root context carrying the registry and the slots.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.sidebarRightTabs.register(editorDefinition()), 'sidebar-editor: editor type');
			ctx.effect(
				() =>
					ctx.slots.inject('sidebar.right.pane.tab', () =>
						ctx.slots.register(
							{
								name: 'sidebar.right.pane.tab',
								key: EDITOR_ID,
								inject: editorFace(ctx),
							},
							EditorBody,
						),
					),
				'sidebar-editor: editor tab body',
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
