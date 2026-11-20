import katexCss from 'katex/dist/katex.min.css?raw';
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline';
import mono from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?inline';
import { renderMarkdownDiagram } from './markdown-diagram';
import { basenameOf } from './local-target';

export const embeddedImage = /^data:image\/(?:(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[a-z\d+/=\s]+$|svg\+xml(?:;charset=[\w-]+|;utf8)?,)/i;

const mathFonts = import.meta.glob<string>('/node_modules/katex/dist/fonts/*.woff2', {
  eager: true, query: '?inline', import: 'default',
});

export const canvasFonts = `@font-face{font-family:'Inter Variable';font-weight:100 900;src:url(${inter}) format('woff2')}
@font-face{font-family:'JetBrains Mono Variable';font-weight:100 800;src:url(${mono}) format('woff2')}`;

export const mathStyles = katexCss.replace(/src:url\(fonts\/([^)]*\.woff2)\)[^}]+/g,
  (_, name: string) => `src:url(${mathFonts['/node_modules/katex/dist/fonts/' + name]}) format('woff2')`);

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Resolve media while exporting. The recipient never contacts an image host. */
export function canvasHtmlAssets(dark: boolean) {
  const resources = new Map<string, Promise<{ kind: 'image' | 'font' | 'css'; text: string } | undefined>>();
  const localImages = new Map<string, Promise<string | undefined>>();
  const diagrams = new Map<string, Promise<string | undefined>>();
  let hasMath = false;
  const resource = (url: string) => {
    let result = resources.get(url);
    if (!result) {
      result = (async () => {
        const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000) });
        if (!response.ok) return;
        const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
        if (mime === 'text/css') return { kind: 'css' as const, text: await response.text() };
        const kind = /^image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(mime) ? 'image'
          : /^(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-woff|vnd\.ms-fontobject))$/.test(mime) ? 'font' : undefined;
        if (!kind) return;
        const blob = await response.blob();
        return { kind, text: await dataUrl(blob) } as const;
      })().catch(() => undefined);
      resources.set(url, result);
    }
    return result;
  };
  const imageSource = async (url: string) => {
    const asset = await resource(url);
    return asset?.kind === 'image' ? asset.text : undefined;
  };
  // Resolve styles against their own URL before the authored page is rendered
  // in isolation. Skip comments, literal CSS strings and document fragment IDs.
  async function inlineCss(css: string, base?: string, parents = new Set<string>()): Promise<string> {
    const pattern = /\/\*[\s\S]*?\*\/|(@import\s+)(?:"([^"]*)"|'([^']*)')|(@import\s+)?url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;
    const parts: (string | Promise<string>)[] = [];
    let last = 0;
    for (const match of css.matchAll(pattern)) {
      const raw = (match[2] ?? match[3] ?? match[5] ?? match[6] ?? match[7])?.trim();
      if (!raw || /^(?:#|data:)/i.test(raw)) continue;
      let url: URL;
      try { url = new URL(raw, base); } catch { continue; }
      if (!/^https?:$/.test(url.protocol)) continue;
      parts.push(css.slice(last, match.index));
      const prefix = match[1] || match[4] || '';
      parts.push((async () => {
        const asset = await resource(url.href);
        let value = 'data:,';
        if (prefix && asset?.kind === 'css' && !parents.has(url.href)) {
          const nested = await inlineCss(asset.text, url.href, new Set([...parents, url.href]));
          value = await dataUrl(new Blob([nested], { type: 'text/css' }));
        } else if (!prefix && asset && asset.kind !== 'css') value = asset.text;
        return prefix + 'url("' + value + '")';
      })());
      last = match.index + match[0].length;
    }
    parts.push(css.slice(last));
    return (await Promise.all(parts)).join('');
  }
  return {
    imageSource, inlineCss,
    async stylesheet(url: string) {
      const asset = await resource(url);
      return asset?.kind === 'css' ? inlineCss(asset.text, url, new Set([url])) : undefined;
    },
    get hasMath() { return hasMath; },
    async embed(root: DocumentFragment) {
      hasMath ||= !!root.querySelector('.katex');
      for (const code of root.querySelectorAll('pre > code.language-mermaid')) {
        const source = code.textContent ?? '';
        if (!diagrams.has(source)) diagrams.set(source, renderMarkdownDiagram(source, dark, true)
          .then(svg => svg && dataUrl(new Blob([svg], { type: 'image/svg+xml' }))).catch(() => undefined));
        const src = await diagrams.get(source);
        if (!src) continue; // Keep the complete source of an invalid diagram.
        const img = document.createElement('img');
        img.src = src;
        img.alt = source;
        img.className = 'reading-diagram';
        img.loading = 'lazy';
        code.parentElement!.replaceWith(img);
      }
      for (const img of root.querySelectorAll<HTMLImageElement>('img[data-reading-image]')) {
        const url = img.dataset.readingImage!;
        delete img.dataset.readingImage;
        const src = await imageSource(url);
        if (src) img.src = src;
        else {
          const a = document.createElement('a');
          a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.textContent = img.alt || url;
          img.replaceWith(a);
        }
      }
      for (const img of root.querySelectorAll<HTMLImageElement>('img[data-reading-local]')) {
        const path = img.dataset.readingLocal!;
        delete img.dataset.readingLocal;
        if (!localImages.has(path)) localImages.set(path, window.desktopLocal?.image(path)
          .then(value => value && embeddedImage.test(value) ? value : undefined).catch(() => undefined) ?? Promise.resolve(undefined));
        const src = await localImages.get(path);
        if (src) img.src = src;
        else img.replaceWith(document.createTextNode(img.alt || basenameOf(path)));
      }
    },
  };
}
