/**
 * Browser half of the session importer.
 *
 * Settings → General hosts a picker: choose Cursor / Claude Code / Codex, then
 * import that product's workspaces and conversations into the sidebar.
 * Already-imported sessions are skipped. The row talks to `/session-import/*`
 * with same-origin `fetch`.
 *
 * Loaded by `window.__ModuleLoader__`, so this file is plain ES2022 with a
 * CommonJS-shaped factory: no bundler, no JSX.
 *
 * @module @alex/dsh-session-import/client
 */

window.__ModuleLoader__.load({
  id: '@alex/dsh-session-import',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require('react');
    const h = react.createElement;
    const { useCallback, useEffect, useRef, useState } = react;

    const PREFIX = '/session-import';
    const SOURCE_IDS = ['cursor', 'claude', 'codex'];
    const SOURCE_LABEL = { cursor: 'Cursor', claude: 'Claude Code', codex: 'Codex' };

    const STRINGS = {
      zh: {
        'settings.title': '导入会话',
        'settings.description': '从 Cursor、Claude Code 或 Codex 导入，已有的会跳过。',
        'settings.source': '选择来源',
        'panel.import': '导入',
        'panel.importing': '导入中…',
        'panel.loading': '正在扫描…',
        'panel.empty': '这个来源没有可导入的会话',
        'panel.done': '已导入 {imported} 条，跳过 {skipped} 条',
        'panel.failed': '，失败 {failed} 条',
        'panel.counts': '{pending} 条新对话 · {workspaces} 个工作区',
        'panel.option': '{label}（{pending}）',
        'panel.error': '导入失败：{message}',
      },
      en: {
        'settings.title': 'Import sessions',
        'settings.description': 'Import from Cursor, Claude Code, or Codex. Already imported items are skipped.',
        'settings.source': 'Choose source',
        'panel.import': 'Import',
        'panel.importing': 'Importing…',
        'panel.loading': 'Scanning…',
        'panel.empty': 'Nothing left to import from this source',
        'panel.done': 'Imported {imported}, skipped {skipped}',
        'panel.failed': ', {failed} failed',
        'panel.counts': '{pending} new chats · {workspaces} workspaces',
        'panel.option': '{label} ({pending})',
        'panel.error': 'Import failed: {message}',
      },
    };

    const STYLE = `
      .si-row {
        box-sizing:border-box; width:100%;
        border-bottom:.5px solid var(--dsw-alias-border-l2);
        align-items:center; gap:8px; padding:16px 0; display:flex;
      }
      .si-text { flex-direction:column; flex:1; gap:4px; min-width:0; padding-right:48px; display:flex; }
      .si-title { color:var(--dsw-alias-label-primary); font-size:14px; font-weight:400; line-height:22px; }
      .si-desc { margin:0; color:var(--dsw-alias-label-tertiary); font-size:12px; font-weight:400; line-height:18px; }
      .si-desc.is-err { color:var(--dsw-alias-state-error-primary, #e5484d); }
      .si-actions { flex:none; display:inline-flex; align-items:center; gap:8px; }
      .si-picker { position:relative; flex:none; }
      .si-pill {
        box-sizing:border-box;
        background:var(--dsw-alias-bg-module-platform);
        height:36px; font:inherit; color:var(--dsw-alias-label-primary);
        cursor:pointer; border:none; border-radius:18px;
        align-items:center; gap:12px; padding:0 14px;
        font-size:14px; line-height:22px; display:inline-flex; white-space:nowrap;
      }
      .si-pill:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .si-pill:disabled { opacity:.4; cursor:default; }
      .si-chevron {
        width:10px; height:10px; flex:none; opacity:.45;
        border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor;
        transform:rotate(45deg) translateY(-2px);
      }
      .si-menu {
        position:absolute; right:0; bottom:calc(100% + 6px);
        min-width:220px; padding:6px; border-radius:12px; z-index:40;
        background:var(--dsw-alias-bg-container, #fff);
        box-shadow:0 8px 28px rgba(15,17,21,.12);
      }
      .si-option {
        width:100%; text-align:left; border:none; background:none;
        border-radius:8px; padding:8px 10px; font:inherit; font-size:14px; line-height:22px;
        color:var(--dsw-alias-label-primary); cursor:pointer;
      }
      .si-option:hover, .si-option.is-on { background:var(--dsw-alias-interactive-bg-hover); }
    `;

    function ensureStyle() {
      let tag = document.querySelector('style[data-plugin-css="dsh-session-import"]');
      if (!tag) {
        tag = document.createElement('style');
        tag.dataset.pluginCss = 'dsh-session-import';
        document.head.appendChild(tag);
      }
      if (tag.textContent !== STYLE) tag.textContent = STYLE;
    }

    function api(path, init) {
      return fetch(`${PREFIX}${path}`, init).then((response) =>
        response.json().catch(() => {
          throw new Error(`HTTP ${response.status}`);
        }),
      );
    }

    function format(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, (match, key) => (vars?.[key] === undefined ? match : String(vars[key])));
    }

    function emptySummaries() {
      return SOURCE_IDS.map((id) => ({ id, label: SOURCE_LABEL[id], total: 0, imported: 0, pending: 0, workspaces: [] }));
    }

    function SourcePicker({ value, summaries, disabled, t, onChange }) {
      const [open, setOpen] = useState(false);
      const rootRef = useRef(null);
      const selected = summaries.find((item) => item.id === value);
      const label = selected ? (SOURCE_LABEL[selected.id] ?? selected.label) : t('settings.source');

      useEffect(() => {
        if (!open) return undefined;
        const onDoc = (event) => {
          if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
      }, [open]);

      return h(
        'div',
        { className: 'si-picker', ref: rootRef },
        h(
          'button',
          {
            type: 'button',
            className: 'si-pill',
            disabled,
            'aria-label': t('settings.source'),
            'aria-expanded': open,
            'aria-haspopup': 'listbox',
            onClick: () => setOpen((current) => !current),
          },
          h('span', null, label),
          h('span', { className: 'si-chevron', 'aria-hidden': true }),
        ),
        open
          ? h(
              'div',
              { className: 'si-menu', role: 'listbox' },
              summaries.map((item) =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    role: 'option',
                    className: item.id === value ? 'si-option is-on' : 'si-option',
                    onClick: () => {
                      onChange(item.id);
                      setOpen(false);
                    },
                  },
                  format(t('panel.option'), {
                    label: SOURCE_LABEL[item.id] ?? item.label,
                    pending: item.pending,
                  }),
                ),
              ),
            )
          : null,
      );
    }

    function ImportSettingsRow({ t }) {
      const [status, setStatus] = useState('idle');
      const [error, setError] = useState('');
      const [summaries, setSummaries] = useState(emptySummaries);
      const [source, setSource] = useState('');
      const [busy, setBusy] = useState(false);
      const [outcome, setOutcome] = useState(null);

      const load = useCallback(() => {
        setStatus('loading');
        api('/discover', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
          .then((payload) => {
            if (payload?.ok !== true) throw new Error(payload?.message ?? payload?.code ?? 'discover failed');
            setSummaries(Array.isArray(payload.summaries) ? payload.summaries : emptySummaries());
            setStatus('ready');
            setError('');
          })
          .catch((cause) => {
            setStatus('error');
            setError(cause instanceof Error ? cause.message : String(cause));
          });
      }, []);

      useEffect(() => {
        ensureStyle();
        load();
      }, [load]);

      const selected = summaries.find((item) => item.id === source);
      const pending = selected?.pending ?? 0;
      const desc =
        error.length > 0
          ? format(t('panel.error'), { message: error })
          : outcome !== null
            ? format(t('panel.done'), {
                imported: outcome.imported,
                skipped: outcome.skipped,
              }) + (outcome.failed > 0 ? format(t('panel.failed'), { failed: outcome.failed }) : '')
            : source && status === 'ready' && pending === 0
              ? t('panel.empty')
              : t('settings.description');

      const runImport = () => {
        if (!source || pending === 0 || busy) return;
        setBusy(true);
        setOutcome(null);
        setError('');
        api('/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sources: [source] }),
        })
          .then((payload) => {
            if (payload?.ok !== true) throw new Error(payload?.message ?? payload?.code ?? 'import failed');
            setOutcome(payload);
            load();
          })
          .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setBusy(false));
      };

      return h(
        'div',
        { className: 'si-row' },
        h(
          'div',
          { className: 'si-text' },
          h('div', { className: 'si-title' }, t('settings.title')),
          h('p', { className: error.length > 0 ? 'si-desc is-err' : 'si-desc' }, desc),
        ),
        h(
          'div',
          { className: 'si-actions' },
          h(SourcePicker, {
            value: source,
            summaries,
            disabled: busy,
            t,
            onChange: (next) => {
              setSource(next);
              setOutcome(null);
              setError('');
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'si-pill',
              disabled: busy || !source || pending === 0,
              onClick: runImport,
            },
            busy ? t('panel.importing') : t('panel.import'),
          ),
        ),
      );
    }

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register('session-import', STRINGS), 'session-import: locale');
      ctx.effect(
        () =>
          ctx.slots.inject('settings.general.item', () =>
            ctx.slots.register(
              {
                name: 'settings.general.item',
                id: 'session-import',
                order: 70,
                locale: 'session-import',
              },
              ImportSettingsRow,
            ),
          ),
        'session-import: settings',
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
