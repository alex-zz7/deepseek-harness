/**
 * Knowledge page entry + rebuild toast.
 *
 * The page itself reuses the workspace sidebar + conversation. This module
 * only switches that page on/off and shows index progress.
 */

window.__ModuleLoader__.load({
  id: 'dsh-knowledge-studio',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require('react');
    const reactDom = require('react-dom');
    const h = react.createElement;
    const { useEffect, useLayoutEffect, useRef, useState } = react;

    const ACTION = 'knowledge-studio-action';
    const PAGE = 'knowledge-studio-page';
    const PAGE_STORE = 'dsh-knowledge-page';

    function readStoredPage() {
      try {
        return window.localStorage.getItem(PAGE_STORE) !== '0';
      } catch {
        return true;
      }
    }

    window.__KS_PAGE__ = readStoredPage();

    const STYLE = `
      .ks-footer { display:flex; flex-direction:column; gap:2px; width:calc(100% + 4px); margin:2px -2px; }
      .ks-footer[data-rail="1"] { width:36px; margin:8px 0 4px; }
      .ks-trigger {
        box-sizing:border-box; cursor:pointer; width:100%; min-width:0; height:42px;
        color:var(--dsw-alias-label-primary); background:transparent; border:none;
        border-radius:12px; align-items:center; gap:8px; margin:0;
        padding:0 10px 0 8px; font:inherit; font-size:14px; line-height:22px;
        display:flex; overflow:hidden;
      }
      .ks-trigger:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .ks-trigger[data-rail="1"] {
        width:36px; height:36px; border-radius:50%; flex:none; justify-content:center;
        gap:0; margin:0; padding:0; position:relative;
      }
      .ks-dot {
        flex:none; width:8px; height:8px; margin-left:auto; border-radius:50%;
        box-shadow:0 0 0 2px var(--dsw-alias-bg-primary, #fff);
      }
      .ks-dot[data-on="1"] { background:#22c55e; }
      .ks-dot[data-on="0"] { background:#ef4444; }
      .ks-trigger[data-rail="1"] .ks-dot {
        position:absolute; right:2px; bottom:2px; margin:0;
      }
      .ks-dialog {
        position:fixed; z-index:91; box-sizing:border-box;
        display:flex; flex-direction:column; padding:16px 16px 14px; overflow:hidden;
        color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-primary, #fff));
        border:1px solid rgba(127,127,127,.16); border-radius:16px;
        box-shadow:0 16px 40px rgba(0,0,0,.12);
        font:13px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      }
      .ks-dialog h2 { margin:0; font-size:16px; line-height:22px; }
      .ks-sheet-head { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .ks-sheet-body {
        flex:1 1 auto; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:12px;
        margin:12px 0; padding-right:2px;
      }
      .ks-dialog label { display:flex; flex-direction:column; gap:6px; color:var(--dsw-alias-label-secondary); }
      .ks-dialog input {
        box-sizing:border-box; width:100%; border-radius:10px; border:1px solid rgba(127,127,127,.24);
        background:transparent; color:var(--dsw-alias-label-primary); padding:8px 10px; font:inherit;
      }
      .ks-path-row {
        display:flex; flex-direction:column; align-items:flex-start; gap:8px;
        padding:8px 10px; border-radius:10px;
        background:rgba(127,127,127,.08);
      }
      .ks-path {
        width:100%; min-width:0; overflow-wrap:anywhere; word-break:break-all;
        white-space:normal; user-select:text; color:var(--dsw-alias-label-primary);
      }
      .ks-path-actions { display:flex; flex-wrap:wrap; gap:12px; }
      .ks-path-open {
        border:none; padding:0; color:#4d6bfe; background:transparent;
        font:inherit; cursor:pointer;
      }
      .ks-path-open:disabled { opacity:.5; cursor:default; }
      .ks-file-link { color:#4d6bfe; cursor:pointer; text-decoration:underline; }
      .ks-hint { margin:0; color:var(--dsw-alias-label-secondary); font-size:12px; }
      .ks-sources { display:flex; flex-direction:column; gap:6px; }
      .ks-source {
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        min-width:0; padding:8px 10px; border-radius:10px; background:rgba(127,127,127,.08);
      }
      .ks-source > div { min-width:0; flex:1; }
      .ks-source strong {
        display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600;
      }
      .ks-source .ks-path-open { color:#4d6bfe; }
      .ks-source button, .ks-sheet-actions button, .ks-sheet-head button {
        flex:none; border:none; background:transparent; color:var(--dsw-alias-label-secondary);
        font:inherit; cursor:pointer; padding:0;
      }
      .ks-sheet-actions { flex:none; display:flex; flex-wrap:wrap; gap:8px; }
      .ks-sheet-actions button[data-primary="1"] {
        border-radius:10px; padding:8px 12px; color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-interactive-bg-hover);
      }
      .ks-sheet-actions button[data-build="1"] {
        border-radius:10px; padding:8px 12px; background:#4d6bfe; color:#fff;
      }
      .ks-add-source {
        align-self:flex-start; border:none; padding:2px 0; color:#4d6bfe;
        background:transparent; font:inherit; cursor:pointer;
      }
      .ks-setup {
        margin:0; padding:8px 10px; border-radius:10px;
        background:rgba(77,107,254,.1); color:var(--dsw-alias-label-primary);
      }
      .ks-error { margin:0; color:#c43c3c; }
      .ks-toast {
        position:fixed; right:24px; bottom:88px; z-index:92; width:min(360px, calc(100vw - 48px));
        padding:12px 14px; border-radius:14px; display:flex; flex-direction:column; gap:8px;
        color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-primary, #fff));
        box-shadow:0 12px 32px rgba(0,0,0,.16);
        font:13px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      }
      .ks-toast-row { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
      .ks-toast-text { min-width:0; flex:1; }
      .ks-pct {
        flex:none; min-width:3.2em; text-align:right; font-variant-numeric:tabular-nums;
        font-weight:600; color:var(--dsw-alias-label-primary);
      }
      .ks-toast-meta { margin:0; color:var(--dsw-alias-label-secondary); font-size:12px; }
      .ks-toast[hidden] { display:none; }
      .ks-toast[data-kind="ok"] .ks-toast-text { color:#1f8a4c; }
      .ks-toast[data-kind="error"] .ks-toast-text { color:#c43c3c; }
      .ks-bar { height:6px; border-radius:999px; background:rgba(127,127,127,.16); overflow:hidden; }
      .ks-bar > i { display:block; height:100%; background:#4d6bfe; border-radius:inherit; transition:width .35s linear; }
      .ks-bar[data-wait="1"] > i {
        width:28% !important; animation:ks-bar-wait 1.1s ease-in-out infinite;
      }
      @keyframes ks-bar-wait {
        0% { transform:translateX(-120%); }
        100% { transform:translateX(360%); }
      }
      .ks-toast-cancel, .ks-toast-close {
        flex:none; align-self:flex-start; border:none; background:transparent; padding:0;
        color:var(--dsw-alias-label-secondary); font:inherit; cursor:pointer;
      }
      .ks-gate {
        position:fixed; z-index:90; box-sizing:border-box; pointer-events:none;
      }
      .ks-gate[hidden] { display:none; }
      .ks-gate-card {
        position:absolute; left:50%; bottom:176px; transform:translateX(-50%);
        pointer-events:auto; box-sizing:border-box;
        width:min(360px, calc(100% - 48px)); padding:12px 14px; border-radius:12px;
        color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-primary, #fff));
        box-shadow:0 10px 28px rgba(0,0,0,.14);
      }
      .ks-gate-card strong { display:block; font-size:14px; font-weight:600; }
      .ks-gate-card span { display:block; margin-top:4px; color:var(--dsw-alias-label-secondary); font-size:12px; }
      .ks-gate-card .ks-bar { margin-top:10px; }
      .ks-gate-shield {
        position:absolute; left:0; right:0; bottom:0; height:168px;
        pointer-events:auto;
      }
      knowledge_context { display:none !important; }
      .ks-context-hidden > * { display:none !important; }
      .ks-context-hidden::before {
        content:attr(data-ks-visible-text); white-space:pre-wrap;
      }
      .ks-sources-bar {
        position:relative; z-index:8; box-sizing:border-box; min-height:40px; flex:none; align-self:center;
        width:min(var(--dsh-composer-card-max-width), calc(100% - 2 * var(--dsh-composer-side-clearance, 16px)));
        margin:12px auto 2px; padding:12px 8px 10px;
        display:grid; grid-template-columns:auto minmax(0, 1fr) auto; align-items:center; gap:10px;
        color:var(--dsw-alias-label-primary);
        border-top:.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.18));
        background:transparent;
        font:15px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      }
      .ks-sources-bar[hidden] { display:none; }
      .ks-sources-bar b { font-weight:650; white-space:nowrap; letter-spacing:.01em; }
      .ks-sources-bar .ks-src-list {
        min-width:0; display:flex; align-items:center; gap:10px; overflow-x:auto;
        scrollbar-width:none;
      }
      .ks-sources-bar .ks-src-list::-webkit-scrollbar { display:none; }
      .ks-sources-bar .ks-src {
        max-width:min(360px, 56vw); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        flex:none; color:#4d6bfe; background:none; border:none; padding:0; font:inherit; cursor:pointer;
      }
      .ks-sources-bar .ks-src-close {
        width:26px; height:26px; border-radius:50%; display:grid; place-items:center;
        color:var(--dsw-alias-label-tertiary); background:none; border:none; padding:0;
        font:18px/1 -apple-system, BlinkMacSystemFont, sans-serif; cursor:pointer;
      }
      .ks-sources-bar .ks-src-close:hover { background:var(--dsw-alias-interactive-bg-hover); }
    `;

    function ensureStyle() {
      let tag = document.querySelector('style[data-plugin-css="dsh-knowledge-studio"]');
      if (!tag) {
        tag = document.createElement('style');
        tag.dataset.pluginCss = 'dsh-knowledge-studio';
        document.head.appendChild(tag);
      }
      if (tag.textContent !== STYLE) tag.textContent = STYLE;
    }

    function conversationPaneRect() {
      const pane = document.querySelector('.wSkVaW_root');
      if (pane) return pane.getBoundingClientRect();
      const sidebar = document.querySelector('aside') || document.querySelector('nav');
      const left = sidebar ? sidebar.getBoundingClientRect().right : 260;
      return {
        left,
        top: 0,
        width: Math.max(320, window.innerWidth - left),
        height: window.innerHeight,
      };
    }

    function BookIcon({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 3.5h5.5A2.5 2.5 0 0 1 11 6v7H5.5A2.5 2.5 0 0 0 3 10.5z' }),
        h('path', { d: 'M13 3.5H7.5A2.5 2.5 0 0 0 5 6v7h5.5A2.5 2.5 0 0 1 13 10.5z' }),
      );
    }

    function setKnowledgePage(open) {
      const next = Boolean(open);
      if (window.__KS_PAGE__ === next) return;
      window.__KS_PAGE__ = next;
      try {
        window.localStorage.setItem(PAGE_STORE, next ? '1' : '0');
      } catch {
        // private mode
      }
      window.dispatchEvent(new CustomEvent(PAGE, { detail: { open: next } }));
      fetch('/sidebar-editor/ui-state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ knowledgePage: next }),
      }).catch(() => {});
    }

    function useKnowledgePage() {
      const [open, setOpen] = useState(() => window.__KS_PAGE__ === true);
      useEffect(() => {
        const sync = (event) => {
          setOpen(event?.detail && 'open' in event.detail ? event.detail.open === true : window.__KS_PAGE__ === true);
        };
        window.addEventListener(PAGE, sync);
        const timer = window.setInterval(() => {
          setOpen((current) => {
            const next = window.__KS_PAGE__ === true;
            return current === next ? current : next;
          });
        }, 400);
        return () => {
          window.removeEventListener(PAGE, sync);
          clearInterval(timer);
        };
      }, []);
      return open;
    }

    function pickMaterialsInApp() {
      return new Promise((resolve, reject) => {
        const handler = window.webkit?.messageHandlers?.dshPickMaterials;
        if (!handler) {
          reject(new Error('no-native'));
          return;
        }
        window.__dshPickedMaterials = (paths) => {
          window.__dshPickedMaterials = undefined;
          if (!Array.isArray(paths) || paths.length === 0) reject(new Error('已取消'));
          else resolve(paths);
        };
        handler.postMessage('materials');
      });
    }

    function revealInFolder(path) {
      if (!path) return Promise.resolve();
      const handler = window.webkit?.messageHandlers?.dshRevealInFinder;
      if (handler) {
        handler.postMessage(path);
        return Promise.resolve();
      }
      return api('/knowledge-studio/reveal', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
    }

    function fileResourceAddress(absPath, sessionId) {
      const id = encodeURIComponent(sessionId);
      const segs = String(absPath || '')
        .replace(/^\/+/, '')
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent);
      return `dsh-resource://file/session/${id}//${segs.join('/')}`;
    }

    function openKnowledgeFile(file, inFinder) {
      if (!file) return;
      if (!inFinder) {
        const sessionId = window.__KS_SESSION_ID__ || '';
        const open = window.__ksOpenInSidebar;
        if (sessionId && typeof open === 'function') {
          try {
            if (open(fileResourceAddress(file, sessionId))) return;
          } catch {
            // fall through to Finder
          }
        }
      }
      revealInFolder(file);
    }

    function fileFromHref(href) {
      if (!href) return '';
      if (href.startsWith('file:')) {
        try {
          return decodeURIComponent(new URL(href).pathname);
        } catch {
          return '';
        }
      }
      if (href.startsWith('/Users/') || href.startsWith('/home/')) return href;
      return '';
    }

    let visibleSources = [];

    function sourceForHref(href) {
      const exact = visibleSources.find((source) => source.open === href);
      if (exact) return exact;
      const candidates = visibleSources.filter(
        (source) => source.open?.startsWith(href) || href.startsWith(source.open || '\0'),
      );
      return candidates.length === 1 ? candidates[0] : null;
    }

    function bindSourceOpens() {
      if (window.__KS_OPEN_BOUND__) return;
      window.__KS_OPEN_BOUND__ = true;
      document.addEventListener(
        'click',
        (event) => {
          const node = event.target?.closest?.('a[href], [data-ks-open]');
          if (!node) return;
          const file = node.getAttribute('data-ks-open') || fileFromHref(node.getAttribute('href') || node.href);
          if (!file || !(file.startsWith('/Users/') || file.startsWith('/home/'))) return;
          event.preventDefault();
          event.stopPropagation();
          openKnowledgeFile(file, event.altKey || event.metaKey);
        },
        true,
      );

      const visiblePromptOf = (text) => {
        const raw = String(text || '');
        const start = raw.indexOf('<knowledge_context');
        if (start < 0) {
          const alt = raw.search(/These passages were already retrieved|Retrieval found no reliable match/);
          return alt < 0 ? raw : raw.slice(0, alt).trimEnd();
        }
        const end = raw.indexOf('</knowledge_context>');
        const prefix = raw.slice(0, start).trimEnd();
        const suffix = end >= 0 ? raw.slice(end + '</knowledge_context>'.length).trim() : '';
        return [prefix, suffix].filter(Boolean).join('\n\n');
      };
      const looksAugmentedPrompt = (text) =>
        /<knowledge_context|These passages were already retrieved|Retrieval found no reliable match/.test(String(text || ''));
      document.addEventListener(
        'copy',
        (event) => {
          const selected = window.getSelection()?.toString() || '';
          const node = window.getSelection()?.anchorNode?.parentElement;
          const bubble = node?.closest?.('.ks-context-hidden');
          if (looksAugmentedPrompt(selected)) {
            event.preventDefault();
            event.clipboardData?.setData('text/plain', visiblePromptOf(selected));
            return;
          }
          if (bubble?.dataset.ksVisibleText) {
            event.preventDefault();
            event.clipboardData?.setData('text/plain', bubble.dataset.ksVisibleText);
          }
        },
        true,
      );
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function' && !clipboard.__ksPromptPatched) {
        const writeText = clipboard.writeText.bind(clipboard);
        clipboard.writeText = (text) => writeText(looksAugmentedPrompt(text) ? visiblePromptOf(text) : text);
        clipboard.__ksPromptPatched = true;
      }

      const pathRe =
        /file:\/\/[^\s)\]>'"]+|\/Users\/[^\s)\]>'"]+\.(?:pdf|md|txt|docx?|pptx?|xlsx?|html?|rtf|epub)/g;

      function prettyFileName(value) {
        const raw = String(value || '').split('/').pop() || String(value || '');
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      }

      function looksRawPath(text) {
        const value = String(text || '').trim();
        return /file:\/\//i.test(value) || /%E[0-9A-F]/i.test(value) || /\/Users\/|\/home\//.test(value);
      }

      const linkify = (root) => {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walk.nextNode()) nodes.push(walk.currentNode);
        for (const node of nodes) {
          if (node.parentElement?.closest('a, textarea, input, [contenteditable], [data-ks-open]')) continue;
          const text = node.nodeValue || '';
          if (text.includes('<knowledge_context') || text.includes('These passages were already retrieved')) continue;
          if (text.length > 4000 && /file:\/\/|\/Users\//.test(text)) continue;
          if (!pathRe.test(text)) continue;
          pathRe.lastIndex = 0;
          const frag = document.createDocumentFragment();
          let last = 0;
          let match;
          while ((match = pathRe.exec(text))) {
            if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
            const raw = match[0];
            const source = sourceForHref(raw);
            const target = source?.open || raw;
            const file = fileFromHref(target) || target;
            const a = document.createElement('a');
            a.className = 'ks-file-link';
            a.setAttribute('data-ks-open', file);
            a.href = target.startsWith('file:') ? target : `file://${encodeURI(file)}`;
            a.title = '点击在侧栏预览，⌥点击在文件夹中显示';
            a.textContent = source?.name || prettyFileName(file) || raw;
            frag.appendChild(a);
            last = match.index + raw.length;
          }
          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
          node.parentNode?.replaceChild(frag, node);
        }
      };

      const polishFileAnchors = (root) => {
        for (const a of root.querySelectorAll('a[href]')) {
          const href = a.getAttribute('href') || a.href || '';
          if (!href.includes('file:') && !href.startsWith('/Users/') && !href.startsWith('/home/')) continue;
          const file = fileFromHref(href);
          if (!file) continue;
          const source = sourceForHref(href) || sourceForHref(file);
          a.classList.add('ks-file-link');
          a.setAttribute('data-ks-open', file);
          const text = (a.textContent || '').trim();
          if (!text || looksRawPath(text)) a.textContent = source?.name || prettyFileName(file);
        }
      };

      const maskContextBubbles = (root) => {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walk.nextNode()) nodes.push(walk.currentNode);
        for (const node of nodes) {
          const text = node.nodeValue || '';
          if (!text.includes('<knowledge_context')) continue;
          const slot = node.parentElement?.closest('[data-slot="conversation.chat.node"]');
          if (!slot?.closest('[data-chat-flow-kind="user"]')) continue;
          const ancestors = [];
          for (let el = node.parentElement; el && el !== slot; el = el.parentElement) ancestors.push(el);
          const bubble = ancestors.at(-3);
          if (!(bubble instanceof HTMLElement)) continue;
          const full = bubble.textContent || '';
          const start = full.indexOf('<knowledge_context');
          if (start < 0) continue;
          bubble.dataset.ksVisibleText = full.slice(0, start).trimEnd();
          bubble.classList.add('ks-context-hidden');
        }
      };

      const hideContext = (root) => {
        maskContextBubbles(root);
        for (const el of root.querySelectorAll('knowledge_context')) {
          el.setAttribute('hidden', '');
          el.style.display = 'none';
        }
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walk.nextNode()) nodes.push(walk.currentNode);
        for (const node of nodes) {
          if (node.parentElement?.closest('textarea, input, [contenteditable], .ks-sources-bar, .ks-context-hidden')) continue;
          const text = node.nodeValue || '';
          const start = text.indexOf('<knowledge_context');
          if (start < 0) continue;
          const end = text.indexOf('</knowledge_context>');
          if (end < 0 || end < start) continue;
          const close = end + '</knowledge_context>'.length;
          node.nodeValue = `${text.slice(0, start).trimEnd()}${text.slice(close)}`.trim();
        }
      };

      let polishing = false;
      let quietUntil = 0;
      let scanTimer = 0;
      let contextMaskFrame = 0;
      const queueContextMask = () => {
        if (contextMaskFrame) return;
        contextMaskFrame = requestAnimationFrame(() => {
          contextMaskFrame = 0;
          const host = document.querySelector('[data-conversation-scroll]');
          if (host) maskContextBubbles(host);
        });
      };
      const observer = new MutationObserver(() => {
        queueContextMask();
        if (!polishing) scheduleScan();
      });
      const scan = () => {
        const host = document.querySelector('[data-conversation-scroll]');
        if (!host || polishing) return;
        maskContextBubbles(host);
        if (Date.now() < quietUntil) {
          clearTimeout(scanTimer);
          scanTimer = setTimeout(scan, quietUntil - Date.now() + 16);
          return;
        }
        polishing = true;
        try {
          hideContext(host);
          polishFileAnchors(host);
          linkify(host);
        } finally {
          polishing = false;
        }
      };
      const scheduleScan = () => {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(scan, 80);
      };
      window.addEventListener('ks-session', () => {
        quietUntil = Date.now() + 800;
        const bindCurrentHost = () => {
          watch();
          queueContextMask();
        };
        let frames = 0;
        const followSessionMount = () => {
          bindCurrentHost();
          frames += 1;
          if (frames < 12) requestAnimationFrame(followSessionMount);
        };
        followSessionMount();
        scheduleScan();
      });
      const watch = () => {
        const host = document.querySelector('[data-conversation-scroll]');
        if (!host || host.dataset.ksLinkify === '1') return;
        host.dataset.ksLinkify = '1';
        observer.observe(host, { childList: true, subtree: true });
        queueContextMask();
        scheduleScan();
      };
      watch();
      setInterval(watch, 2000);
    }

    async function pickMaterialPaths() {
      try {
        return await pickMaterialsInApp();
      } catch (error) {
        if (String(error.message || error) === '已取消') return [];
        const picked = await api('/knowledge-studio/pick-folder', { method: 'POST' });
        if (picked.cancelled) return [];
        return picked.paths || (picked.path ? [picked.path] : []);
      }
    }

    const lastQueryBySession = new Map();
    const sourceBarBySession = new Map();
    const SOURCE_BAR_STORE = 'ks-source-bar-v1';
    const SOURCE_BAR_EVENT = 'ks-source-bar';
    let pendingSourceBar = null;

    function sessionKey() {
      return window.__KS_SESSION_ID__ || '';
    }

    function snapshotSourceBar(state) {
      if (!state || state.hidden) return null;
      return {
        loading: state.loading === true,
        error: state.error === true,
        refuse: state.refuse === true,
        sources: Array.isArray(state.sources) ? state.sources : [],
      };
    }

    function loadSourceBars() {
      if (sourceBarBySession.size) return;
      try {
        const rows = JSON.parse(sessionStorage.getItem(SOURCE_BAR_STORE) || '[]');
        for (const [id, state] of rows) {
          if (id && state) sourceBarBySession.set(id, state);
        }
      } catch {
        // private mode
      }
    }

    function persistSourceBars() {
      try {
        sessionStorage.setItem(SOURCE_BAR_STORE, JSON.stringify([...sourceBarBySession]));
      } catch {
        // private mode
      }
    }

    function rememberSourceBar(state, sessionId = sessionKey()) {
      const snapshot = snapshotSourceBar(state);
      if (!sessionId) {
        pendingSourceBar = snapshot;
        return;
      }
      if (snapshot) sourceBarBySession.set(sessionId, snapshot);
      else sourceBarBySession.delete(sessionId);
      pendingSourceBar = null;
      persistSourceBars();
    }

    function flushPendingSourceBar(sessionId = sessionKey()) {
      if (!sessionId || !pendingSourceBar || sourceBarBySession.has(sessionId)) {
        if (sessionId) pendingSourceBar = null;
        return;
      }
      sourceBarBySession.set(sessionId, pendingSourceBar);
      pendingSourceBar = null;
      persistSourceBars();
    }

    function notifySourceBar() {
      window.dispatchEvent(new CustomEvent(SOURCE_BAR_EVENT));
    }

    function showSourceBar(state, sessionId = sessionKey()) {
      rememberSourceBar(state, sessionId);
      notifySourceBar();
    }

    function restoreSourceBarForSession(sessionId = sessionKey()) {
      if (!sessionId) return;
      loadSourceBars();
      flushPendingSourceBar(sessionId);
      notifySourceBar();
    }

    function KnowledgeSourceBar(props) {
      const sessionId = props.sessionId || sessionKey() || '';
      const [, setRev] = useState(0);
      useEffect(() => {
        ensureStyle();
        loadSourceBars();
        const bump = () => setRev((n) => n + 1);
        window.addEventListener(SOURCE_BAR_EVENT, bump);
        window.addEventListener('ks-session', bump);
        window.addEventListener(PAGE, bump);
        return () => {
          window.removeEventListener(SOURCE_BAR_EVENT, bump);
          window.removeEventListener('ks-session', bump);
          window.removeEventListener(PAGE, bump);
        };
      }, []);
      const state = sessionId ? sourceBarBySession.get(sessionId) : null;
      useEffect(() => {
        visibleSources = Array.isArray(state?.sources) ? state.sources : [];
      });
      if (window.__KS_PAGE__ !== true || !state) return null;
      let title = '已检索';
      if (state.loading) title = '正在检索本库…';
      else if (state.error) title = '检索失败，仍按原问题发送';
      else if (state.refuse) title = '本库没有足够相关的内容';
      return h(
        'div',
        { className: 'ks-sources-bar', 'data-ks-source-bar': sessionId },
        h('b', null, title),
        h(
          'span',
          { className: 'ks-src-list' },
          ...(state.loading || state.error || state.refuse
            ? []
            : (state.sources || []).map((source) =>
                h(
                  'button',
                  {
                    type: 'button',
                    key: source.open || source.path || source.name,
                    className: 'ks-src',
                    title: '点击在侧栏预览，⌥点击在文件夹中显示',
                    onClick: (event) => {
                      const file = fileFromHref(source.open) || '';
                      if (file) openKnowledgeFile(file, event.altKey || event.metaKey);
                    },
                  },
                  source.name || source.path,
                ),
              )),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'ks-src-close',
            title: '关闭检索信息',
            'aria-label': '关闭检索信息',
            onClick: () => showSourceBar({ hidden: true }, sessionId),
          },
          '×',
        ),
      );
    }

    window.__ksPreparePrompt = async function ksPreparePrompt(text, meta = {}) {
      if (!text || text.includes('<knowledge_context')) return text;
      const sessionId = meta.sessionId || window.__KS_SESSION_ID__ || '';
      const previous = lastQueryBySession.get(sessionId) || '';
      lastQueryBySession.set(sessionId, text.trim());
      showSourceBar({ loading: true }, sessionId);
      try {
        const body = await api('/knowledge-studio/retrieve', {
          method: 'POST',
          body: JSON.stringify({
            query: text.trim(),
            previous,
            root: meta.cwd || window.__KS_SESSION_CWD__ || undefined,
          }),
        });
        showSourceBar({
          refuse: body.refuse === true,
          sources: body.sources || [],
        }, sessionId);
        if (body.prompt) return `${text.trim()}\n\n${body.prompt}`;
      } catch (error) {
        showSourceBar({ error: true }, sessionId);
      }
      return text;
    };

    async function api(path, opts) {
      const res = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...opts,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && body.ok !== true) {
        throw new Error(body.message || body.code || `HTTP ${res.status}`);
      }
      return body;
    }

    function openSettings(vaultId) {
      window.dispatchEvent(new CustomEvent(ACTION, { detail: { kind: 'settings', vaultId } }));
    }

    let dialogDismissAfter = 0;
    function guardDialogDismiss(ms = 900) {
      dialogDismissAfter = Date.now() + ms;
    }

    async function startIndexUpdate(vaultId) {
      const before = await api('/knowledge-studio/status').catch(() => null);
      if (before) applyChatGate({ ...before, rebuild: { ...(before.rebuild || {}), status: 'running' } });
      try {
        await api('/knowledge-studio/rebuild', {
          method: 'POST',
          body: JSON.stringify({ vaultId, force: false }),
        });
      } catch (error) {
        if (!/已有重建/.test(String(error.message || error))) throw error;
      }
      window.dispatchEvent(new CustomEvent(ACTION, { detail: { kind: 'watch-rebuild' } }));
    }

    function publishVaults(detail) {
      const vaults = Array.isArray(detail?.vaults) && detail.vaults.length > 0 ? detail.vaults : null;
      window.dispatchEvent(new CustomEvent('knowledge-studio-config', {
        detail: vaults ? { ...detail, vaults } : detail,
      }));
    }

    function displaySources(vault) {
      if (!vault) return [];
      if (vault.sources?.length) return vault.sources.map((source) => ({ ...source, implicit: false }));
      if (vault.managed) return [];
      return [{ path: vault.root, name: '库内资料', slug: '', implicit: true }];
    }

    function placeDialog(height = 360) {
      const pane = conversationPaneRect();
      const maxWidth = Math.min(520, Math.max(320, pane.width - 48));
      const maxHeight = Math.min(560, Math.max(260, pane.height - 48));
      return {
        left: pane.left + Math.max(32, (pane.width - maxWidth) / 2),
        top: pane.top + Math.max(20, (pane.height - Math.min(height, maxHeight)) / 2),
        width: maxWidth,
        maxHeight,
      };
    }

    function refreshToast() {
      window.dispatchEvent(new CustomEvent(ACTION, { detail: { kind: 'refresh-toast' } }));
    }

    function SettingsSheet() {
      ensureStyle();
      const [open, setOpen] = useState(false);
      const [vaultId, setVaultId] = useState(null);
      const [config, setConfig] = useState(null);
      const [name, setName] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [setup, setSetup] = useState(false);
      const [box, setBox] = useState(() => placeDialog());
      const dialogRef = useRef(null);
      const closeSheet = () => {
        setOpen(false);
        requestAnimationFrame(refreshToast);
      };

      const load = async (id) => {
        const next = await api('/knowledge-studio/config');
        setConfig(next);
        publishVaults(next);
        const vault =
          (next.vaults || []).find((item) => item.id === id) ||
          (next.vaults || []).find((item) => item.isActive) ||
          next.vaults?.[0];
        setVaultId(vault?.id || null);
        setName(vault?.name || '');
        return vault;
      };

      useEffect(() => {
        const onAction = (event) => {
          if (event.detail?.kind !== 'settings' && event.detail?.kind !== 'setup') return;
          const setupMode = event.detail.kind === 'setup';
          guardDialogDismiss(1200);
          setSetup(setupMode);
          setOpen(true);
          setError('');
          load(event.detail.vaultId)
            .then((vault) => {
              if (!setupMode || !vault) return undefined;
              return startIndexUpdate(vault.id);
            })
            .catch((reason) => {
              setError(String(reason.message || reason));
            });
        };
        window.addEventListener(ACTION, onAction);
        return () => window.removeEventListener(ACTION, onAction);
      }, []);

      useLayoutEffect(() => {
        if (!open) return undefined;
        const update = () => {
          const height = dialogRef.current?.getBoundingClientRect().height || 360;
          setBox(placeDialog(height));
        };
        update();
        const frame = requestAnimationFrame(update);
        window.addEventListener('resize', update);
        return () => {
          cancelAnimationFrame(frame);
          window.removeEventListener('resize', update);
        };
      }, [open, setup, vaultId, config, error]);

      useEffect(() => {
        const frame = requestAnimationFrame(refreshToast);
        return () => cancelAnimationFrame(frame);
      }, [open]);

      useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
          if (Date.now() < dialogDismissAfter) return;
          if (event.target?.closest?.('.ks-dialog')) return;
          closeSheet();
        };
        const onKey = (event) => {
          if (event.key === 'Escape') closeSheet();
        };
        document.addEventListener('pointerdown', onPointer, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
          document.removeEventListener('pointerdown', onPointer, true);
          document.removeEventListener('keydown', onKey, true);
        };
      }, [open]);

      if (!open) return null;
      const vault = (config?.vaults || []).find((item) => item.id === vaultId);
      const sources = displaySources(vault);

      const run = async (work) => {
        setBusy(true);
        setError('');
        try {
          await work();
        } catch (reason) {
          setError(String(reason.message || reason));
        } finally {
          setBusy(false);
        }
      };

      const sheet = h(
          'div',
          {
            ref: dialogRef,
            className: 'ks-dialog',
            role: 'dialog',
            'aria-label': '知识库设置',
            style: box,
          },
          h(
            'div',
            { className: 'ks-sheet-head' },
            h('h2', null, setup ? '配置新知识库' : '知识库设置'),
            h('button', { type: 'button', onClick: closeSheet }, '关闭'),
          ),
          h(
            'div',
            { className: 'ks-sheet-body' },
            vault
              ? h(
                  react.Fragment,
                  null,
                  setup
                    ? h('p', { className: 'ks-setup' }, '资料已挂上，正在构建索引。建好之前不能提问，否则搜不到这些资料。')
                    : null,
                  h(
                    'label',
                    null,
                    '名称',
                    h('input', {
                      value: name,
                      disabled: busy,
                      onChange: (event) => setName(event.target.value),
                      onBlur: () => {
                        const next = name.replace(/\s+/g, ' ').trim();
                        if (!next || next === vault.name) return;
                        run(async () => {
                          const saved = await api('/knowledge-studio/config', {
                            method: 'POST',
                            body: JSON.stringify({ action: 'rename', id: vault.id, name: next }),
                          });
                          await load(vault.id);
                          publishVaults(saved);
                        });
                      },
                    }),
                  ),
                  h(
                        react.Fragment,
                        null,
                        h(
                          'label',
                          null,
                          '库文件夹（索引在这里，不会改你的资料）',
                          h(
                            'div',
                            { className: 'ks-path-row' },
                            h('div', { className: 'ks-path' }, vault.root),
                            h(
                              'p',
                              { className: 'ks-hint' },
                              vault.index?.ready
                                ? `索引已建：${vault.index.chunks} 段 · ${vault.index.files} 个文件。向量在库文件夹里的 index/。`
                                : vault.index?.hasVectors === false && vault.index?.chunks
                                  ? '分块在，但还没有向量文件。请再点一次「更新索引」。'
                                  : '还没有向量索引。点「更新索引」构建。',
                            ),
                            h(
                              'div',
                              { className: 'ks-path-actions' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'ks-path-open',
                                  disabled: busy,
                                  onClick: () =>
                                    run(async () => {
                                      await revealInFolder(vault.root);
                                    }),
                                },
                                '打开库文件夹',
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'ks-path-open',
                                  disabled: busy,
                                  onClick: () =>
                                    run(async () => {
                                      await revealInFolder(
                                        vault.index?.indexDir || `${vault.root.replace(/\/+$/, '')}/index`,
                                      );
                                    }),
                                },
                                '打开索引文件夹',
                              ),
                            ),
                          ),
                        ),
                        h(
                          'p',
                          { className: 'ks-hint' },
                          vault.managed
                            ? '资料只读引用，原文件不会被改动。'
                            : '自带知识库：资料就在这个文件夹里。也可以再挂外部资料。',
                        ),
                      ),
                  h(
                    'div',
                    { className: 'ks-sources' },
                    h('div', null, sources.length ? `资料 ${sources.length} 项` : '资料'),
                    sources.length === 0
                      ? h('p', { className: 'ks-hint' }, '还没有资料。添加文件或文件夹后，索引会只读它们。')
                      : sources.map((source) =>
                          h(
                            'div',
                            { className: 'ks-source', key: source.path, title: source.path },
                            h('div', null, h('strong', null, source.name || '资料')),
                            h(
                              'div',
                              { className: 'ks-path-actions' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'ks-path-open',
                                  disabled: busy,
                                  onClick: () =>
                                    run(async () => {
                                      await revealInFolder(source.path);
                                    }),
                                },
                                '打开',
                              ),
                              source.implicit
                                ? null
                                : h(
                                    'button',
                                    {
                                      type: 'button',
                                      disabled: busy,
                                      onClick: () =>
                                        run(async () => {
                                          const saved = await api('/knowledge-studio/config', {
                                            method: 'POST',
                                            body: JSON.stringify({
                                              action: 'source-remove',
                                              id: vault.id,
                                              path: source.path,
                                            }),
                                          });
                                          await load(vault.id);
                                          publishVaults(saved);
                                        }),
                                    },
                                    '移除',
                                  ),
                            ),
                          ),
                        ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'ks-add-source',
                        disabled: busy,
                        onClick: () =>
                          run(async () => {
                            const paths = await pickMaterialPaths();
                            guardDialogDismiss(1200);
                            if (paths.length === 0) return;
                            const saved = await api('/knowledge-studio/config', {
                              method: 'POST',
                              body: JSON.stringify({
                                action: 'source-add',
                                id: vault.id,
                                paths,
                              }),
                            });
                            await load(vault.id);
                            publishVaults(saved);
                            setSetup(true);
                            setOpen(true);
                            await startIndexUpdate(vault.id);
                          }),
                      },
                      '添加文件或文件夹',
                    ),
                  ),
                )
              : h('p', { className: 'ks-hint' }, '正在读取知识库…'),
            error ? h('p', { className: 'ks-error' }, error) : null,
            setup
              ? null
              : h('p', { className: 'ks-hint' }, '更新索引只补新增或改过的文件。'),
          ),
          h(
            'div',
            { className: 'ks-sheet-actions' },
            setup
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    'data-build': '1',
                    disabled: busy || !vault,
                    onClick: () =>
                      run(async () => {
                        await api('/knowledge-studio/rebuild', {
                          method: 'POST',
                          body: JSON.stringify({ vaultId: vault.id, force: false }),
                        });
                        closeSheet();
                        window.dispatchEvent(new CustomEvent(ACTION, { detail: { kind: 'watch-rebuild' } }));
                      }),
                  },
                  '更新索引',
                ),
            h(
              'button',
              { type: 'button', 'data-primary': '1', onClick: closeSheet },
              '完成',
            ),
          ),
      );
      return reactDom.createPortal(sheet, document.body);
    }

    function KnowledgeTrigger({ wide, onClose }) {
      ensureStyle();
      const open = useKnowledgePage();
      const toggle = () => {
        setKnowledgePage(!open);
        if (typeof onClose === 'function') onClose();
      };
      return h(
        'div',
        { className: 'ks-footer', 'data-rail': wide ? undefined : '1' },
        h(
          'button',
          {
            type: 'button',
            className: 'ks-trigger',
            'data-rail': wide ? undefined : '1',
            title: open ? '知识库（已进入）' : '知识库（未进入）',
            'aria-label': open ? '返回工作区' : '打开知识库',
            onClick: toggle,
          },
          h(BookIcon, { size: wide ? 16 : 18 }),
          wide ? '知识库' : null,
          h('span', { className: 'ks-dot', 'data-on': open ? '1' : '0', 'aria-hidden': 'true' }),
        ),
      );
    }

    function KnowledgeChrome(props) {
      return h(react.Fragment, null, h(KnowledgeTrigger, props), h(SettingsSheet));
    }

    function ensureToast() {
      ensureStyle();
      let el = document.getElementById('ks-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'ks-toast';
        el.className = 'ks-toast';
        el.hidden = true;
        (document.body || document.documentElement).appendChild(el);
      }
      if (!el.querySelector('.ks-toast-text')) {
        el.innerHTML =
          '<div class="ks-toast-row"><div class="ks-toast-text"></div><div class="ks-pct" hidden></div><button type="button" class="ks-toast-close" hidden>关闭</button></div>' +
          '<p class="ks-toast-meta" hidden></p>' +
          '<div class="ks-bar" hidden><i></i></div>' +
          '<button type="button" class="ks-toast-cancel" hidden>取消更新</button>';
        el.querySelector('.ks-toast-close').addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          dismissNotice();
        });
        el.querySelector('.ks-toast-cancel').addEventListener('click', () => {
          api('/knowledge-studio/rebuild', {
            method: 'POST',
            body: JSON.stringify({ cancel: true }),
          }).catch(() => {});
        });
      }
      return el;
    }

    const PHASE_SPAN = {
      extract: [0, 30],
      load: [30, 38],
      embed: [38, 96],
      write: [96, 100],
    };

    function parseProgress(log) {
      if (!log?.length) return null;
      for (let i = log.length - 1; i >= 0; i--) {
        const line = String(log[i]);
        const tagged = line.match(/progress\s+(\w+)\s+(\d+)\/(\d+)(?:\s+(\d+)%)?/);
        if (tagged && Number(tagged[3]) > 0) {
          const phase = tagged[1];
          const done = Number(tagged[2]);
          const total = Number(tagged[3]);
          const local = tagged[4] ? Number(tagged[4]) : Math.round((done / total) * 100);
          const span = PHASE_SPAN[phase] || [0, 100];
          const pct = Math.min(100, Math.round(span[0] + ((span[1] - span[0]) * local) / 100));
          return { phase, done, total, local, pct };
        }
        const legacy = line.match(/(\d+)\/(\d+)/);
        if (legacy && Number(legacy[2]) > 0) {
          const done = Number(legacy[1]);
          const total = Number(legacy[2]);
          const local = Math.round((done / total) * 100);
          return { phase: 'embed', done, total, local, pct: Math.min(96, 38 + Math.round(local * 0.58)) };
        }
      }
      return null;
    }

    function lastLogLine(log) {
      if (!log?.length) return '';
      for (let i = log.length - 1; i >= 0; i--) {
        const line = String(log[i]).trim();
        if (line) return line;
      }
      return '';
    }

    function phaseLabel(phase) {
      if (phase === 'extract') return '正在提取文本';
      if (phase === 'load') return '正在加载向量模型';
      if (phase === 'embed') return '正在生成向量';
      if (phase === 'write') return '正在写入索引';
      return '正在更新索引';
    }

    function humanizeLog(line, progress) {
      if (progress) {
        return `${phaseLabel(progress.phase)} ${progress.done}/${progress.total}`;
      }
      const text = String(line || '').trim();
      if (!text) return '';
      if (/loading embedding model/i.test(text)) return '正在加载向量模型…';
      if (/reusing .+ embedding/i.test(text)) return '正在生成向量…';
      if (/found \d+ files/i.test(text)) return '正在扫描资料…';
      if (/previous index|vault:|model:/i.test(text)) return '正在准备索引…';
      if (/index is current/i.test(text)) return '资料没有变化，索引已是最新。';
      if (/wrote index/i.test(text)) return '索引已写好。';
      if (/nothing to index/i.test(text)) return '没有可索引的资料。';
      return /[\u4e00-\u9fff]/.test(text) ? text : '正在更新索引…';
    }

    function dialogOpen() {
      return Boolean(document.querySelector('.ks-dialog'));
    }

    let lastProgress = null;

    function rememberProgress(progress) {
      if (progress) lastProgress = progress;
      return progress || lastProgress;
    }

    function blockSendWhileBuilding(event) {
      const el = document.getElementById('ks-gate');
      if (!el || el.hidden) return;
      if (event.target?.closest?.('.ks-dialog, .ks-toast, .ks-gate-card')) return;
      if (event.type === 'keydown') {
        if (!(event.key === 'Enter' && !event.shiftKey)) return;
        const root = document.querySelector('.wSkVaW_root');
        if (root && !root.contains(event.target)) return;
      } else {
        const root = document.querySelector('.wSkVaW_root');
        if (!root || !root.contains(event.target)) return;
        const btn = event.target.closest?.('button');
        if (!btn) return;
        const label = `${btn.getAttribute('aria-label') || ''} ${btn.textContent || ''}`;
        if (!(btn.type === 'submit' || /send|发送|提交|stop|停止/i.test(label))) return;
      }
      event.preventDefault();
      event.stopPropagation();
    }

    function ensureGate() {
      ensureStyle();
      let el = document.getElementById('ks-gate');
      if (!el) {
        el = document.createElement('div');
        el.id = 'ks-gate';
        el.className = 'ks-gate';
        el.hidden = true;
        el.innerHTML =
          '<div class="ks-gate-card"><strong></strong><span></span><div class="ks-bar"><i></i></div></div>' +
          '<div class="ks-gate-shield"></div>';
        (document.body || document.documentElement).appendChild(el);
      }
      return el;
    }

    function placeGate() {
      const pane = conversationPaneRect();
      const height = Math.min(240, pane.height);
      return {
        left: pane.left,
        top: pane.top + Math.max(0, pane.height - height),
        width: pane.width,
        height,
      };
    }

    function paintBar(bar, progress) {
      if (!bar) return;
      const fill = bar.querySelector('i');
      if (!fill) return;
      if (progress) {
        delete bar.dataset.wait;
        fill.style.width = `${progress.pct}%`;
      } else {
        bar.dataset.wait = '1';
        fill.style.width = '28%';
      }
    }

    function setChatGate(on, title, detail, progress) {
      const el = ensureGate();
      const wasOn = !el.hidden;
      el.hidden = !on;
      const card = el.querySelector('.ks-gate-card');
      const head = card?.querySelector('strong');
      const sub = card?.querySelector('span');
      if (head) head.textContent = title || '索引还在构建，完成后才能提问';
      if (sub) {
        sub.textContent = detail || '';
        sub.hidden = !detail;
      }
      paintBar(card?.querySelector('.ks-bar'), progress);
      if (on) {
        Object.assign(el.style, placeGate());
        if (!wasOn) {
          document.addEventListener('keydown', blockSendWhileBuilding, true);
          document.addEventListener('pointerdown', blockSendWhileBuilding, true);
        }
      } else {
        if (wasOn) {
          document.removeEventListener('keydown', blockSendWhileBuilding, true);
          document.removeEventListener('pointerdown', blockSendWhileBuilding, true);
        }
        el.style.left = '';
        el.style.top = '';
        el.style.width = '';
        el.style.height = '';
        lastProgress = null;
      }
    }

    function applyChatGate(status) {
      try {
        const onPage = window.__KS_PAGE__ === true;
        const running = status?.rebuild?.status === 'running';
        const built = status?.rebuild?.status === 'ok';
        const ready = (status?.hasIndex === true && !running) || built;
        const waiting = Boolean(onPage && status && (!ready || running));
        const progress = running ? rememberProgress(parseProgress(status?.rebuild?.log)) : null;
        setChatGate(
          waiting,
          running
            ? progress
              ? `请等构建完成再提问  ${progress.pct}%`
              : '请等构建完成再提问'
            : '这个库还没有索引，先等构建完成再提问',
          progress ? humanizeLog('', progress) : running ? '正在更新索引…' : '',
          progress,
        );
        return waiting;
      } catch {
        return false;
      }
    }

    let notice = null;
    let dismissTimer = null;
    let pollTimer = null;

    function dismissNotice() {
      notice = null;
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
      render();
    }

    function showNotice(next, lingerMs) {
      notice = next;
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
      if (next?.kind === 'ok') setChatGate(false);
      if (next?.kind === 'ok' || next?.kind === 'error') {
        dismissTimer = setTimeout(() => {
          if (notice === next) notice = null;
          render();
        }, lingerMs ?? (next.kind === 'error' ? 10000 : 4000));
      }
      render();
    }

    function render(rebuild) {
      const el = ensureToast();
      if (dialogOpen()) {
        el.hidden = true;
        return;
      }
      const running = rebuild?.status === 'running';
      const progress = running ? rememberProgress(parseProgress(rebuild?.log)) : null;
      const text = running
        ? `正在构建「${rebuild.vaultName || '知识库'}」`
        : notice?.text;
      if (!text) {
        el.hidden = true;
        return;
      }
      const textEl = el.querySelector('.ks-toast-text');
      const pct = el.querySelector('.ks-pct');
      const close = el.querySelector('.ks-toast-close');
      const meta = el.querySelector('.ks-toast-meta');
      const bar = el.querySelector('.ks-bar');
      const cancel = el.querySelector('.ks-toast-cancel');
      if (!textEl || !pct || !close || !meta || !bar || !cancel) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.dataset.kind = running ? 'working' : notice?.kind || 'working';
      textEl.textContent = text;
      pct.hidden = !running;
      close.hidden = running;
      meta.hidden = !running;
      bar.hidden = !running;
      cancel.hidden = !running;
      if (running) {
        pct.textContent = progress ? `${progress.pct}%` : '…';
        meta.textContent = humanizeLog(lastLogLine(rebuild?.log), progress) || '正在准备索引…';
        paintBar(bar, progress);
      }
    }

    function stopPoll() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }

    async function tickRebuild() {
      try {
        const next = await api('/knowledge-studio/status');
        const state = next.rebuild?.status;
        applyChatGate(next);
        if (state === 'running') {
          render(next.rebuild);
          return true;
        }
        stopPoll();
        if (state === 'ok') {
          const log = lastLogLine(next.rebuild?.log);
          showNotice({
            kind: 'ok',
            text: /index is current/.test(log)
              ? '资料没有变化，索引已是最新。'
              : '索引已建好，可以开始提问了。',
          });
        } else if (state === 'cancelled') {
          showNotice({ kind: 'ok', text: '已取消更新' });
        } else if (state === 'error') {
          showNotice({ kind: 'error', text: next.rebuild?.error || '更新失败' });
        } else {
          render();
        }
        return false;
      } catch (error) {
        stopPoll();
        showNotice({ kind: 'error', text: String(error.message || error) });
        return false;
      }
    }

    async function watchRebuild() {
      if (await tickRebuild()) {
        pollTimer = setInterval(() => {
          tickRebuild();
        }, 700);
      }
    }

    async function handleAction(detail) {
      if (!detail || detail.kind === 'settings' || detail.kind === 'setup') return;
      if (detail.kind === 'working' || detail.kind === 'ok' || detail.kind === 'error') {
        showNotice(detail, detail.kind === 'working' ? 60000 : undefined);
        return;
      }
      if (detail.kind === 'refresh-toast') {
        await tickRebuild();
        return;
      }
      if (detail.kind === 'watch-rebuild') {
        showNotice({ kind: 'working', text: '正在扫描变更并更新索引…' }, 60000);
        await watchRebuild();
      }
    }

    const zh = { trigger: '知识库' };
    const en = { trigger: 'Knowledge' };
    const inject = ['slots', 'layout', 'locale', 'sidebarRight'];

    function apply(ctx) {
      window.__ksOpenInSidebar = (address) => {
        if (!address || typeof ctx.sidebarRight?.openResource !== 'function') return false;
        ctx.sidebarRight.openResource(address);
        return true;
      };
      ctx.effect(() => ctx.locale.register('knowledge-studio', { zh, en }), 'knowledge-studio: locale');
      ctx.effect(
        () =>
          ctx.slots.inject('conversation.input.preamble', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.preamble',
                id: 'knowledge-sources',
                order: 0,
                inject: (sessionId) => ({ sessionId }),
              },
              KnowledgeSourceBar,
            ),
          ),
        'knowledge-studio: source bar',
      );
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              {
                name: 'sidebar.footer.action',
                id: 'knowledge-studio',
                order: 10,
                locale: 'knowledge-studio',
                inject: () => ({
                  onClose: () => ctx.layout.selectPanel(null),
                }),
              },
              KnowledgeChrome,
            ),
          ),
        'knowledge-studio: page button',
      );

      const syncGate = () => {
        api('/knowledge-studio/status')
          .then((status) => {
            applyChatGate(status);
            if (status.rebuild?.status === 'running') watchRebuild();
          })
          .catch(() => {});
      };

      const onAction = (event) => {
        handleAction(event.detail);
      };
      window.addEventListener(ACTION, onAction);

      // Do not touch the DOM or dispatch page events during plugin apply.
      // The previous gate did that on boot and WKWebView never painted.
      window.setTimeout(() => {
        try {
          ensureToast();
          bindSourceOpens();
          setKnowledgePage(readStoredPage());
          fetch('/sidebar-editor/ui-state')
            .then((res) => res.json())
            .catch(() => ({}))
            .then((body) => {
              const saved = body?.state?.knowledgePage;
              setKnowledgePage(typeof saved === 'boolean' ? saved : readStoredPage());
              syncGate();
            });
          loadSourceBars();
          restoreSourceBarForSession();
          window.addEventListener(PAGE, () => {
            notifySourceBar();
            syncGate();
          });
          window.addEventListener('ks-session', (event) => {
            const id = event.detail?.sessionId || sessionKey();
            if (!id) return;
            restoreSourceBarForSession(id);
          });
          window.addEventListener('knowledge-studio-config', syncGate);
          window.addEventListener('resize', () => {
            const gate = document.getElementById('ks-gate');
            if (gate && !gate.hidden) Object.assign(gate.style, placeGate());
          });
        } catch {
          // chrome after first paint must not take down the shell
        }
      }, 800);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
