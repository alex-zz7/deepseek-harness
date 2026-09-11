// Injected into the app's WKWebView only.
//
// The sidebar's session rows expose no extension slot: the whole browsing
// region is `sidebar.workspaces`, a single-occupant hole owned by
// `dsh-client-ui-workspace`. So the only way to add row affordances is to
// augment the rendered DOM from the side that owns the web view — and because
// only this app injects the script, the browser surface is untouched.
//
// Two facts make it work:
//
//   * Every row already ends in a `span[class*="rowActions"]` container that
//     the shell reveals on hover, so buttons inserted there inherit that
//     behaviour instead of reimplementing it.
//   * A row carries no session id in its markup — the id lives in the render
//     closure. Walking the React fiber up to `SessionNodeItem` recovers both
//     the node and the row's own handlers, so each action runs the product's
//     code path (`onArchive(id)`, `onFork(id)`, ...) rather than a
//     reimplementation that would drift.
//
// Fragility is accepted deliberately and bounded: this runs only inside the
// app, so the worst case is that the buttons stop appearing, never that the
// product breaks.

let sidebarActionsScript = #"""
(() => {
  'use strict';
  if (window.__DSH_SIDEBAR_ACTIONS__) return;
  window.__DSH_SIDEBAR_ACTIONS__ = true;

  const PINS_ROUTE = '/sidebar-editor/pins';
  const UI_STATE_ROUTE = '/sidebar-editor/ui-state';
  const MENU_CLASS = 'dsh-row-menu';
  const BUTTON_ATTR = 'data-dsh-action';

  /** Session ids currently pinned, kept in sync with the host. */
  const pinned = new Set();

  const STYLE = `
    /* A row label is a label, not content: a right-click must not start a
       selection, and nothing in this list is worth copying. */
    [role="treeitem"] { user-select: none; -webkit-user-select: none; }
    .dsh-action-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      opacity: .55;
      cursor: pointer;
      flex: none;
    }
    .dsh-action-button:hover { opacity: 1; background: rgba(127,127,127,.16); }
    /* The brand row lays out [wordmark] … [collapse toggle]; this sits between
       them, right of the wordmark. */
    .dsh-brand-action { margin-left: 2px; flex: none; }
    /* The mic sits in the composer's trailing row, left of Send. */
    .dsh-mic { margin-right: 2px; }
    .dsh-mic[data-state="listening"] { opacity: 1; color: #4d6bfe; }
    .dsh-mic[data-state="starting"] { opacity: 1; }
    .dsh-mic[data-state="failed"] { opacity: 1; color: #e5484d; }
    .dsh-action-button[data-pinned="true"] { opacity: 1; color: var(--dsw-alias-brand-primary, #4d6bfe); }
    /* Cursor-style dictation: a full-width pill *inside* the composer card.
       × throws the transcript away, the bars show the live level, ↑ keeps it. */
    [data-composer-card].dsh-voice-active { position: relative; }
    [data-composer-card].dsh-voice-active [class*="scroll"] { padding-top: 52px; }
    .dsh-voice {
      position: absolute;
      z-index: 8;
      left: 12px;
      right: 12px;
      top: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
      width: auto;
      height: 40px;
      padding: 0 8px;
      box-sizing: border-box;
      border-radius: 20px;
      background: linear-gradient(135deg, #4d86ff, #2f5fe0);
      box-shadow: 0 8px 20px rgba(47,95,224,.28);
      opacity: 0;
      pointer-events: none;
      transform: translateY(4px);
      transition: opacity .16s ease, transform .16s ease;
      font: 12px/1 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    }
    .dsh-voice[data-open="1"] { opacity: 1; pointer-events: auto; transform: none; }
    .dsh-voice button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 30px;
      height: 30px;
      padding: 0;
      border: none;
      border-radius: 15px;
      background: rgba(255,255,255,.22);
      color: #fff;
      cursor: pointer;
    }
    .dsh-voice button:hover { background: rgba(255,255,255,.34); }
    .dsh-voice-bars {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      flex: 1;
      height: 24px;
      min-width: 0;
    }
    .dsh-voice-bars i {
      width: 2px;
      height: 4px;
      border-radius: 1px;
      background: rgba(255,255,255,.92);
      /* No transition on purpose: a live meter gets a new height ~30 times a
         second, and a transition freezes at its start value whenever the page
         is not being rendered — which is exactly how the meter first shipped
         looking dead. */
    }
    .${MENU_CLASS} {
      position: fixed;
      z-index: 2147483000;
      min-width: 168px;
      padding: 4px;
      border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-primary, #111);
      box-shadow: 0 8px 28px rgba(0,0,0,.18);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    }
    .${MENU_CLASS} button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .${MENU_CLASS} button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16)); }
    .${MENU_CLASS} hr { margin: 4px 6px; border: none; border-top: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22)); }
  `;

  const PIN_PATH =
    '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>';
  const ARCHIVE_PATH =
    '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>';

  /** Build a 24x24 stroke icon; `filled` fills the glyph for the pinned state. */
  function icon(paths, filled) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', filled ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = paths;
    return svg;
  }

  /**
   * Recover one session row's node and its own action handlers.
   * Returns null for anything that is not a session row.
   */
  function rowInfo(row) {
    const key = Object.keys(row).find((k) => k.startsWith('__reactFiber$'));
    if (!key) return null;
    let fiber = row[key];
    for (let depth = 0; fiber && depth < 25; depth += 1) {
      const props = fiber.memoizedProps;
      if (
        props &&
        typeof props === 'object' &&
        props.node &&
        typeof props.node.id === 'string' &&
        props.node.id.startsWith('session-')
      ) {
        return { node: props.node, handlers: props };
      }
      fiber = fiber.return;
    }
    return null;
  }

  // ── workspace expand/collapse persistence ─────────────────────────────
  //
  // The product keeps group expansion in component state, so a fresh page load
  // — and therefore every app launch — starts from its default and the user's
  // layout is lost. There is no host-side setting for it, so the state is kept
  // through the plugin's own state bag and re-applied on load.
  //
  // Deliberately NOT `localStorage`: that is scoped to the page origin, and the
  // origin includes the port. `dsh web` binds a fresh random port on each start
  // here, so a restart silently moves the app to a different origin and every
  // stored key disappears. The host bag lives under `~/.dsh` and does not care
  // how the surface was reached.
  //
  // Identity is the workspace id (`group.key`), which is durable, rather than
  // the display label, which the product explicitly allows to repeat.

  const EXPANSION_FIELD = 'expansion';

  /** Workspaces already reconciled this load, so a toggle is never re-issued. */
  const reconciled = new Set();

  /** Last known persisted map; empty until the host answers. */
  let expansionSaved = {};
  /** Nothing is recorded before this flips, or the first scan would overwrite
   *  the saved layout with whatever the product happened to default to. */
  let expansionLoaded = false;
  let pendingWrite = null;

  async function loadExpansion() {
    try {
      const response = await fetch(UI_STATE_ROUTE, { headers: { accept: 'application/json' } });
      const body = await response.json();
      const saved = body?.state?.[EXPANSION_FIELD];
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) expansionSaved = saved;
    } catch {
      /* host not up yet; the empty map just means "nothing to restore" */
    }
    expansionLoaded = true;
    scheduleScan();
  }

  /** Coalesced write: the latest map wins, one request in flight at a time. */
  function saveExpansion() {
    if (pendingWrite !== null) clearTimeout(pendingWrite);
    pendingWrite = setTimeout(() => {
      pendingWrite = null;
      fetch(UI_STATE_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [EXPANSION_FIELD]: expansionSaved }),
      }).catch(() => {
        /* the next change retries; a lost write is not worth a broken UI */
      });
    }, 250);
  }

  /**
   * Recover a workspace row's durable key and its own toggle.
   *
   * Matched on props shape rather than component name, because this runs
   * against a production bundle where a display name is not a contract.
   */
  function projectInfo(row) {
    const key = Object.keys(row).find((k) => k.startsWith('__reactFiber$'));
    if (!key) return null;
    let fiber = row[key];
    for (let depth = 0; fiber && depth < 25; depth += 1) {
      const props = fiber.memoizedProps;
      if (
        props &&
        typeof props === 'object' &&
        props.group &&
        typeof props.group.key === 'string' &&
        typeof props.onToggle === 'function'
      ) {
        return { key: props.group.key, onToggle: props.onToggle };
      }
      fiber = fiber.return;
    }
    return null;
  }

  /** Restore saved expansion once per workspace, then record every later change. */
  function syncExpansion() {
    if (!expansionLoaded) return;

    const rows = [...document.querySelectorAll('[role="treeitem"]')].filter((row) =>
      (row.className || '').toString().includes('projectRow'),
    );
    if (rows.length === 0) return;

    let dirty = false;

    for (const row of rows) {
      const info = projectInfo(row);
      if (!info) continue;
      const expanded = row.getAttribute('aria-expanded') === 'true';

      if (!reconciled.has(info.key)) {
        reconciled.add(info.key);
        const wanted = expansionSaved[info.key];
        if (typeof wanted === 'boolean' && wanted !== expanded) {
          // React re-renders; the next pass records the resulting state.
          info.onToggle();
          continue;
        }
      }

      if (expansionSaved[info.key] !== expanded) {
        expansionSaved[info.key] = expanded;
        dirty = true;
      }
    }

    if (dirty) saveExpansion();
  }

  /** Last order handed to the patched bundle, so polls do not re-render it. */
  let publishedPins = [];
  let hasPublished = false;

  /**
   * Hand the pinned order to the patched workspace bundle, which renders the
   * Pinned section.
   *
   * The bundle reads this only when the app's own flag is present, so a browser
   * — which never receives this script — stays exactly as shipped.
   *
   * @param ids - pinned session ids, most-important first.
   */
  function publishPins(ids) {
    window.__DSH_PIN_IDS__ = ids;
    const unchanged =
      hasPublished && ids.length === publishedPins.length && ids.every((id, i) => id === publishedPins[i]);
    publishedPins = ids.slice();
    hasPublished = true;
    if (unchanged) return;
    window.dispatchEvent(new CustomEvent('dsh-pins-changed', { detail: { ids: publishedPins } }));
  }

  // ── brand-row browser button ──────────────────────────────────────────
  //
  // The product's brand row already lays out `[wordmark] … [collapse toggle]`,
  // leaving a natural slot between them. A web page cannot open the user's
  // browser itself, so the click is handed to the shell over a script message.
  //
  // The project picker is NOT here: it belongs in the workspace menu above the
  // composer, next to the other ways of choosing where work happens. That row
  // is provided by plugins/conversation-fork (always visible) and
  // plugins/workspace-fork (the "从 GitHub 克隆…" entry).

  const BROWSER_PATH =
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>';

  /** One small icon button in the brand row. */
  function brandButton(kind, label, paths, message) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dsh-action-button dsh-brand-action';
    button.setAttribute('data-dsh-brand-action', kind);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.appendChild(icon(paths, false));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const handler = window.webkit?.messageHandlers?.[message];
      if (handler !== undefined) handler.postMessage('open');
    });
    return button;
  }

  function decorateBrandRow() {
    const row = document.querySelector('[class*="logoRow"]');
    if (row === null || row.querySelector('[data-dsh-brand-action]') !== null) return;

    const browser = brandButton('browser', '在浏览器中打开', BROWSER_PATH, 'dshOpenInBrowser');

    // Directly right of the wordmark and left of the collapse toggle the
    // product already places at the row's end.
    const brand = row.querySelector('[class*="brand"]');
    if (brand !== null && brand.parentElement === row) {
      row.insertBefore(browser, brand.nextSibling)
    } else {
      row.appendChild(browser)
    }
  }

  // ── hover-opened submenus ─────────────────────────────────────────────
  //
  // Provided by the model-select-fork client plugin (packages/client/
  // ui-model-selection fork at plugins/model-select-fork): the model/effort
  // picker renders a right-side flyout that opens on hover while the root
  // menu stays open. No injection is needed here anymore.

  // ── voice input ───────────────────────────────────────────────────────
  //
  // The mic belongs to the composer's bottom-right row, just left of Send.
  // Recognition runs in the shell — WebKit has no dependable speech API — so the
  // button reports intent and the shell streams the transcript back in.

  const MIC_PATH =
    '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>';

  /** The composer's field — the product renders it as a contenteditable div. */
  function composerField() {
    return (
      document.querySelector('[class*="scroll"] [contenteditable="true"]') ??
      document.querySelector('[class*="scroll"] textarea') ??
      document.querySelector('[contenteditable="true"]') ??
      document.querySelector('textarea')
    );
  }

  /** Read a field's text, whichever kind it is. */
  function composerValue(field) {
    return field.isContentEditable ? (field.textContent ?? '') : (field.value ?? '');
  }

  /**
   * Write into the field so the product notices.
   *
   * A contenteditable is driven through the editing pipeline: select it all and
   * let `insertText` replace the selection, which keeps React's own input
   * handling and the undo stack intact. A textarea needs its prototype setter,
   * because assigning `.value` directly is swallowed by React's value tracker.
   */
  function setComposerValue(field, value) {
    field.focus();
    if (field.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(field);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, value);
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter !== undefined) setter.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Text that was already in the composer when this session started. */
  let voiceBase = null;
  /** Running transcript for this session only — never re-read from the field. */
  let dictated = '';

  function voicePrefix() {
    const prefix = voiceBase ?? '';
    if (!prefix || !dictated) return prefix;
    if (/\s$/.test(prefix) || /^\s/.test(dictated)) return prefix;
    return prefix + ' ';
  }

  function writeTranscript(text) {
    const field = composerField();
    if (field === undefined || field === null) return;
    dictated = text;
    setComposerValue(field, voicePrefix() + text);
  }

  /** Remove this session's dictated words, leaving anything typed alone. */
  function dropDictated() {
    const field = composerField();
    if (field !== undefined && field !== null && voiceBase !== null) {
      setComposerValue(field, voiceBase);
    }
    dictated = '';
    voiceBase = null;
  }

  // ── the dictation bar ─────────────────────────────────────────────────
  //
  // Shown while the shell is listening: × throws the transcript away, the bars
  // show the live input level, ↑ keeps it. Recognition is native, so the page
  // only renders what the shell reports — a level in, three intents out. It is
  // positioned from the composer card's own rect, so it tracks resizes and
  // layout changes without knowing anything about the shell's geometry.

  const VOICE_CANCEL_PATH = '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>';
  const VOICE_ARROW_PATH = '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>';
  const VOICE_BAR_COUNT = 48;

  const voiceLevels = new Array(VOICE_BAR_COUNT).fill(0);
  let voiceBar = null;
  let voiceLevel = 0;

  function postVoice(name) {
    const handler = window.webkit?.messageHandlers?.[name];
    if (handler !== undefined) handler.postMessage(name);
  }

  function composerCard() {
    return document.querySelector('[data-composer-card]');
  }

  function ensureVoiceBar() {
    const card = composerCard();
    if (card === null) return voiceBar;
    if (voiceBar !== null && voiceBar.parentElement === card) return voiceBar;
    if (voiceBar !== null) voiceBar.remove();

    const bar = document.createElement('div');
    bar.className = 'dsh-voice';
    bar.setAttribute('data-open', '0');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '语音输入');

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.title = '取消这次听写';
    cancel.setAttribute('aria-label', '取消这次听写');
    cancel.appendChild(icon(VOICE_CANCEL_PATH, false));
    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropDictated();
      closeVoiceBar();
      postVoice('dshVoiceCancel');
    });

    const bars = document.createElement('div');
    bars.className = 'dsh-voice-bars';
    for (let i = 0; i < VOICE_BAR_COUNT; i++) bars.appendChild(document.createElement('i'));

    const finish = document.createElement('button');
    finish.type = 'button';
    finish.title = '结束听写，保留文字';
    finish.setAttribute('aria-label', '结束听写，保留文字');
    finish.appendChild(icon(VOICE_ARROW_PATH, false));
    finish.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dictated = '';
      closeVoiceBar();
      postVoice('dshVoiceFinish');
    });

    bar.appendChild(cancel);
    bar.appendChild(bars);
    bar.appendChild(finish);
    card.insertBefore(bar, card.firstChild);
    voiceBar = bar;
    return bar;
  }

  function openVoiceBar() {
    const bar = ensureVoiceBar();
    if (bar === null) return;
    bar.setAttribute('data-open', '1');
    composerCard()?.classList.add('dsh-voice-active');
  }

  function closeVoiceBar() {
    if (voiceBar === null) return;
    voiceBar.setAttribute('data-open', '0');
    composerCard()?.classList.remove('dsh-voice-active');
    voiceLevels.fill(0);
    voiceLevel = 0;
  }

  /**
   * Live input level from the shell, 0…1.
   *
   * Rendered on arrival rather than from a `requestAnimationFrame` loop: the
   * shell pushes ~30 samples a second for as long as it is listening, and a
   * frame loop silently does nothing when the window is occluded — the meter
   * froze on the first test run because of exactly that. The smoothing the
   * decay used to provide now happens per sample.
   */
  window.__dshVoiceLevel = (level) => {
    const value = Number(level);
    const sample = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    voiceLevel = voiceLevel * 0.45 + sample * 0.55;
    voiceLevels.shift();
    voiceLevels.push(voiceLevel);
    if (voiceBar === null || voiceBar.getAttribute('data-open') !== '1') return;
    const bars = voiceBar.querySelectorAll('.dsh-voice-bars i');
    for (let i = 0; i < bars.length && i < voiceLevels.length; i++) {
      bars[i].style.height = `${Math.round(4 + voiceLevels[i] * 18)}px`;
    }
  };

  /** Stop recognition because the message is being sent. */
  function stopDictationForSend() {
    if (voiceBar === null || voiceBar.getAttribute('data-open') !== '1') return;
    // The composer already holds the text, so release the span and tell the
    // shell to stop silently — republishing would rewrite the field mid-send.
    dictated = '';
    voiceBase = null;
    closeVoiceBar();
    postVoice('dshVoiceFinish');
  }

  /** Replace the running transcript against the captured prefix, not the field. */
  window.__dshVoiceText = (text) => {
    writeTranscript(typeof text === 'string' ? text : '');
  };

  /** Reflect the recorder's state on the button. */
  window.__dshVoiceState = (state, message) => {
    for (const button of document.querySelectorAll('[data-dsh-mic]')) {
      button.dataset.state = state;
      const label =
        state === 'listening'
          ? '停止听写'
          : state === 'starting'
            ? '正在启动…'
            : state === 'failed'
              ? message || '语音不可用'
              : '语音输入';
      button.title = label;
      button.setAttribute('aria-label', label);
    }
    if (state === 'listening' || state === 'starting') {
      if (voiceBase === null) {
        const field = composerField();
        voiceBase = field ? composerValue(field) : '';
      }
      openVoiceBar();
    } else {
      closeVoiceBar();
    }
    if (state === 'failed') console.warn('[voice]', message);
    if (state === 'idle' || state === 'failed') {
      dictated = '';
      voiceBase = null;
    }
  };

  function decorateComposer() {
    const row = document.querySelector('[class*="trailing"]');
    if (row === null || row.querySelector('[data-dsh-mic]') !== null) return;
    const send = row.querySelector('button[class*="primary"]');
    if (send === null) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dsh-action-button dsh-mic';
    button.setAttribute('data-dsh-mic', '1');
    button.dataset.state = 'idle';
    button.title = '语音输入';
    button.setAttribute('aria-label', '语音输入');
    button.appendChild(icon(MIC_PATH, false));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const handler = window.webkit?.messageHandlers?.dshVoiceToggle;
      if (handler !== undefined) handler.postMessage('toggle');
    });
    row.insertBefore(button, send);
  }

  /**
   * Sending has to stop recognition too.
   *
   * The composer is read and then cleared by the page; a transcript arriving
   * after that would land in the next draft. Capture phase, so the shell is
   * told before the page's own handler runs.
   */
  function decorateSendGuard() {
    const row = document.querySelector('[class*="trailing"]');
    const send = row?.querySelector('button[class*="primary"]');
    if (send !== undefined && send !== null && send.dataset.dshVoiceSend !== '1') {
      send.dataset.dshVoiceSend = '1';
      send.addEventListener('pointerdown', stopDictationForSend, true);
      send.addEventListener('click', stopDictationForSend, true);
    }
    const field = composerField();
    if (field !== undefined && field !== null && field.dataset.dshVoiceEnter !== '1') {
      field.dataset.dshVoiceEnter = '1';
      field.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter' && !event.shiftKey) stopDictationForSend();
        },
        true,
      );
    }
  }

  async function refreshPins() {
    try {
      const response = await fetch(PINS_ROUTE, { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!Array.isArray(body?.pinned)) return;
      pinned.clear();
      for (const id of body.pinned) pinned.add(id);
      syncPinnedState();
      publishPins(body.pinned);
    } catch {
      /* the host may not be up yet; the next scan retries */
    }
  }

  async function setPinned(sessionId, next) {
    try {
      await fetch(PINS_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, pinned: next }),
      });
    } finally {
      await refreshPins();
    }
  }

  /** Reflect the pinned set on every button already in the DOM. */
  function syncPinnedState() {
    for (const button of document.querySelectorAll('[' + BUTTON_ATTR + '="pin"]')) {
      const id = button.dataset.sessionId;
      const isPinned = id ? pinned.has(id) : false;
      button.dataset.pinned = String(isPinned);
      button.title = isPinned ? '取消置顶' : '置顶';
      button.setAttribute('aria-label', button.title);
      const filled = isPinned;
      button.replaceChildren(icon(PIN_PATH, filled));
    }
  }

  function closeMenu() {
    const open = document.querySelector('.' + MENU_CLASS);
    if (open) open.remove();
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    document.removeEventListener('keydown', onDocumentKeyDown, true);
  }

  function onDocumentPointerDown(event) {
    const menu = document.querySelector('.' + MENU_CLASS);
    if (menu && !menu.contains(event.target)) closeMenu();
  }

  function onDocumentKeyDown(event) {
    if (event.key === 'Escape') closeMenu();
  }

  function openMenu(row, info, x, y) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = MENU_CLASS;

    const isPinned = pinned.has(info.node.id);
    const entries = [
      { label: '打开', run: () => info.handlers.onOpen?.(info.node.id) },
      { label: '重命名', run: () => info.handlers.onRename?.(info.node.id, info.node.title) },
      { label: '分叉会话', run: () => info.handlers.onFork?.(info.node.id) },
      { separator: true },
      {
        label: isPinned ? '取消置顶' : '置顶',
        run: () => setPinned(info.node.id, !isPinned),
      },
      { separator: true },
      { label: '归档会话', run: () => info.handlers.onArchive?.(info.node.id) },
    ];

    for (const entry of entries) {
      if (entry.separator) {
        menu.appendChild(document.createElement('hr'));
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.label;
      button.addEventListener('click', () => {
        closeMenu();
        try {
          entry.run();
        } catch (error) {
          console.warn('[sidebar-actions]', entry.label, error);
        }
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);
    // Clamp so the menu never opens off-screen.
    const box = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - box.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - box.height - 8) + 'px';

    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
  }

  function makeButton(kind, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dsh-action-button';
    button.setAttribute(BUTTON_ATTR, kind);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', (event) => {
      // The row's own click opens the session; an action must not.
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function decorate(row) {
    const actions = row.querySelector('span[class*="rowActions"]');
    if (!actions) return;
    // React may rebuild this container on a re-render, so presence is checked
    // every scan rather than remembered on the row.
    if (actions.querySelector('[' + BUTTON_ATTR + ']')) return;

    const info = rowInfo(row);
    if (!info) return;

    const isPinned = pinned.has(info.node.id);

    const pin = makeButton('pin', isPinned ? '取消置顶' : '置顶', () =>
      setPinned(info.node.id, !pinned.has(info.node.id)),
    );
    pin.dataset.sessionId = info.node.id;
    pin.dataset.pinned = String(isPinned);
    pin.appendChild(icon(PIN_PATH, isPinned));

    const archive = makeButton('archive', '归档会话', () => info.handlers.onArchive?.(info.node.id));
    archive.dataset.sessionId = info.node.id;
    archive.appendChild(icon(ARCHIVE_PATH, false));

    // Left of the row's own "more" button, which stays last by convention.
    actions.insertBefore(archive, actions.firstChild);
    actions.insertBefore(pin, actions.firstChild);

    row.addEventListener('contextmenu', (event) => {
      const current = rowInfo(row);
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu(row, current, event.clientX, event.clientY);
    });
  }

  function scan() {
    for (const row of document.querySelectorAll('[role="treeitem"]')) {
      if (!(row.className || '').toString().includes('sessionRow')) continue;
      decorate(row);
    }
    decorateBrandRow();
    decorateComposer();
    decorateSendGuard();
    syncExpansion();
  }

  const style = document.createElement('style');
  style.textContent = STYLE;
  (document.head || document.documentElement).appendChild(style);

  // React mounting mutates the document thousands of times, so the observer
  // must not do real work per mutation. Two guards keep it cheap:
  //
  //   * coalesce to one scan per frame, and
  //   * do the "already decorated" check in JS rather than as a `:not(:has())`
  //     selector, which scans the whole document on every evaluation and was
  //     enough to wedge the page's main thread mid-mount.
  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });

  scan();
  refreshPins();
  loadExpansion();
  // New sessions can arrive without a mutation we act on; a slow poll keeps the
  // pinned set honest without watching every keystroke.
  setInterval(refreshPins, 20000);
})();
"""#
