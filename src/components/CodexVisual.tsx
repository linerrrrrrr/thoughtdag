import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { basenameOf } from '../lib/local-path';
import { useAppearance } from '../lib/appearance';
import documentTypography from '../design-system/typography-document.css?raw';
import cursorStyles from '../../runtime/design-system/cursors.css?raw';

// This policy belongs to the reader, including when the entire saved document
// came from a shared canvas. Never let a snapshot set its own access policy.
const libraries = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://esm.sh https://unpkg.com https://persistent.oaistatic.com/plugins/visualize/';
const policy = `default-src 'none'; script-src 'unsafe-inline' ${libraries}; style-src 'unsafe-inline' ${libraries} https://fonts.googleapis.com https://fonts.bunny.net; img-src data: blob:; font-src data: https://fonts.gstatic.com https://fonts.bunny.net; media-src data: blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const heightMessage = 'thoughtdag:visual-size';
const themeMessage = 'thoughtdag:visual-theme';

function previewDocument(html: string, label: string) {
  // The fixed outer document restricts navigation of the guest frame as
  // well as its initial source. Both frames have unique opaque origins.
  const head = (frames: string) => `<!doctype html><html data-type-surface="document-frame"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}; frame-src ${frames}"><meta name="referrer" content="no-referrer"><style>${documentTypography}\n${cursorStyles}</style>`;
  const syncTheme = `addEventListener('message', e => {
    if (e.source !== parent || e.data?.type !== '${themeMessage}' || !['light', 'dark'].includes(e.data.theme)) return;
    document.documentElement.dataset.theme = e.data.theme;
    document.documentElement.style.colorScheme = e.data.theme;
    const guest = document.getElementById('visual-guest');
    if (guest?.contentWindow) { guest.style.colorScheme = e.data.theme; guest.contentWindow.postMessage(e.data, '*'); }
  });`;
  const measure = `<script>${syncTheme}addEventListener('DOMContentLoaded', () => {
    const measure = () => parent.parent.postMessage({ type: '${heightMessage}', height: Math.ceil(document.body.getBoundingClientRect().height + Math.max(0, document.body.offsetTop) * 2) }, '*');
    new ResizeObserver(measure).observe(document.body);
    measure();
  }, { once: true });</script>`;
  const attr = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const guest = head("'none'") + measure + html;
  return head('about:') + `<style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><script>${syncTheme}</script></head><body><iframe id="visual-guest" aria-label="${attr(label)}" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${attr(guest)}"></iframe></body></html>`;
}

export function CodexVisual({ path, title, html }: { path: string; title?: string; html?: string }) {
  const t = useT();
  const theme = useAppearance(state => state.resolved);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const label = title || t('md.interactivePreview');
  const srcDoc = useMemo(() => html ? previewDocument(html, label) : undefined, [html, label]);
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: themeMessage, theme }, '*');
  }, [srcDoc, theme]);
  useEffect(() => {
    if (!srcDoc) return;
    const resize = (event: MessageEvent) => {
      const outer = frameRef.current?.contentWindow;
      if (!outer || event.origin !== 'null' || event.source !== outer[0] || event.data?.type !== heightMessage) return;
      const next = event.data.height;
      if (typeof next === 'number' && Number.isFinite(next)) setHeight(Math.min(720, Math.max(64, Math.ceil(next))));
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, [srcDoc]);
  if (!srcDoc) return <p className="text-control text-ink-muted" data-codex-visual-missing>
    {t('md.previewUnavailable')} · {title || basenameOf(path)}
  </p>;
  return <iframe ref={frameRef} data-codex-visual data-type-surface="native-document"
    aria-label={label} sandbox="allow-scripts" referrerPolicy="no-referrer"
    onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: themeMessage, theme }, '*')}
    className="nodrag nopan nowheel block w-full min-w-0 my-2 rounded-content border-0"
    style={{ height, colorScheme: theme }} srcDoc={srcDoc} />;
}
