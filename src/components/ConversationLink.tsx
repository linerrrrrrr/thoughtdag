import { useEffect, useRef, useState, type AnchorHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardCopy, ExternalLink, FileText, FolderOpen, X } from 'lucide-react';
import { useT, fmt } from '../i18n';
import { localTargetOf, localFileHref, basenameOf, safeMarkdownUrl, type LocalTarget } from '../lib/local-target';
import { openLocalPath } from '../lib/local-path';
import { toast } from '../lib/ui-store';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import './ConversationLink.css';

interface Preview { target: LocalTarget; text: string; truncated: boolean }

function FilePreview({ value, onClose }: { value: Preview; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLSpanElement>(null);
  useDismissableLayer({ open: true, refs: [ref], onDismiss: onClose, modal: true });
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[data-file-preview-close]')?.focus();
    selected.current?.scrollIntoView({ block: 'center' });
  }, []);
  return createPortal(<div className="file-preview-backdrop nodrag nopan" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
    <div ref={ref} className="file-preview" role="dialog" aria-modal="true" aria-label={t('local.preview')} data-file-preview>
      <header>
        <FileText size={17} />
        <div className="file-preview-heading"><strong>{basenameOf(value.target.path)}</strong><span data-tooltip={value.target.path} data-tooltip-overflow>{value.target.path}</span></div>
        <button type="button" data-tooltip={t('local.reveal')} aria-label={t('local.reveal')} onClick={() => void reveal(value.target.path)}><FolderOpen size={17} /></button>
        <button type="button" aria-label={t('common.close')} data-file-preview-close onClick={onClose}><X size={18} /></button>
      </header>
      {value.truncated && <div className="file-preview-notice">{t('local.previewTruncated')}</div>}
      <pre tabIndex={0} className="file-preview-content" aria-label={basenameOf(value.target.path)}>{value.text.split('\n').map((line, i) =>
        <span key={i} ref={i + 1 === value.target.line ? selected : undefined} data-file-line={i + 1} data-selected={i + 1 === value.target.line || undefined}><span aria-hidden="true">{i + 1}</span><code>{line || ' '}</code></span>,
      )}</pre>
    </div>
  </div>, document.body);
}

async function reveal(path: string) {
  const bridge = window.desktopLocal;
  if (!bridge?.reveal) return openLocalPath(path);
  try {
    const result = await bridge.reveal(path);
    if (!result.ok) throw new Error(result.reason);
  } catch { const { t } = await import('../i18n'); toast('error', fmt(t('local.failed'), { path }), 7000); }
}

/** One link behavior is shared by answers, commentary, and tool file references. */
export function ConversationLink({ base, title, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { base?: string }) {
  const t = useT();
  const href = safeMarkdownUrl(props.href ?? '');
  const target = localTargetOf(href, base);
  const linkHref = target ? localFileHref(target) : href;
  const anchor = useRef<HTMLAnchorElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useDismissableLayer({ open: !!point, refs: [menu], restoreFocusRef: anchor, onDismiss: () => setPoint(null), dismissOnFocusOutside: true });
  useEffect(() => { if (point) menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }, [point]);
  const open = async () => {
    if (!target) { if (href) window.open(href, '_blank', 'noopener,noreferrer'); return; }
    if (busy) return;
    const bridge = window.desktopLocal;
    if (!bridge?.read) return openLocalPath(target.path);
    setBusy(true);
    try {
      const result = await bridge.read(target.path);
      if (!alive.current) return;
      if (result.ok && typeof result.text === 'string') setPreview({ target, text: result.text, truncated: !!result.truncated });
      else if (result.reason === 'not-text') await openLocalPath(target.path);
      else toast('error', fmt(t(result.reason === 'missing' ? 'local.missing' : 'local.failed'), { path: target.path }), 7000);
    } catch { if (alive.current) toast('error', fmt(t('local.failed'), { path: target.path }), 7000); }
    finally { if (alive.current) setBusy(false); }
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); }
    catch { toast('error', t('local.copyFailed')); }
  };
  const action = (fn: () => void) => { setPoint(null); anchor.current?.focus({ preventScroll: true }); fn(); };
  return <>
    <a {...props} href={linkHref || undefined} ref={anchor} target={target || !href ? undefined : '_blank'} rel={target ? undefined : 'noreferrer noopener'}
      className={[props.className, 'conversation-link nodrag nopan', target ? 'conversation-file-link' : ''].filter(Boolean).join(' ')}
      data-local-path={target?.path} data-file-line-ref={target?.line} aria-busy={busy || undefined}
      data-tooltip={target ? `${target.path}${target.line ? `:${target.line}${target.column ? `:${target.column}` : ''}` : ''}` : title}
      onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); if (!href) e.preventDefault(); else if (target) { e.preventDefault(); void open(); } }}
      onAuxClick={e => { if (target) { e.preventDefault(); e.stopPropagation(); if (e.button === 1) void open(); } }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setPoint({ x: e.clientX, y: e.clientY }); }}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault(); e.stopPropagation(); const r = anchor.current?.getBoundingClientRect();
          if (r) setPoint({ x: r.left, y: r.bottom });
        }
      }}
    />
    {point && createPortal(<div ref={menu} role="menu" aria-label={target ? t('local.open') : t('local.openLink')} data-file-menu
      className="conversation-link-menu nodrag nopan" style={{ left: Math.max(8, Math.min(point.x, window.innerWidth - 240)), top: Math.max(8, Math.min(point.y, window.innerHeight - (target ? 250 : 105))) }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
      {target && <div className="conversation-link-menu-path" data-tooltip={target.path}>{basenameOf(target.path)}{target.line ? `:${target.line}` : ''}</div>}
      <button type="button" role="menuitem" onClick={() => action(() => void open())}>{target ? <FileText size={15} /> : <ExternalLink size={15} />}{t(target ? 'local.open' : 'local.openLink')}</button>
      {target && <>
        <button type="button" role="menuitem" onClick={() => action(() => void reveal(target.path))}><FolderOpen size={15} />{t('local.reveal')}</button>
        <button type="button" role="menuitem" onClick={() => action(() => void copy(target.path))}><ClipboardCopy size={15} />{t('local.copyPath')}</button>
        <button type="button" role="menuitem" onClick={() => action(() => void copy(basenameOf(target.path)))}><ClipboardCopy size={15} />{t('local.copyName')}</button>
      </>}
      <button type="button" role="menuitem" onClick={() => action(() => void copy(linkHref))}><ClipboardCopy size={15} />{t('local.copyLink')}</button>
    </div>, document.body)}
    {preview && <FilePreview value={preview} onClose={() => { setPreview(null); anchor.current?.focus({ preventScroll: true }); }} />}
  </>;
}
