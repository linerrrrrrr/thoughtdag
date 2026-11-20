import { canvasHtmlAssets } from './canvas-html-assets';

// Material, graph geometry and camera navigation are supplied by the exporter.
// The surrounding application is copied without React, the store or native actions.
const graphLayers = '.react-flow__nodes, .react-flow__edges, .react-flow__edgelabel-renderer';
const omitted = [
  'script', 'noscript', 'link', 'base', 'meta', 'object', 'embed', 'portal', 'template',
  'input[type="file"]', 'input[type="hidden"]', 'input[type="password"]',
  'animate', 'animateMotion', 'animateTransform', 'set', 'audio', 'video',
  '[data-toolbar-more-panel]', '[data-project-menu]', '[data-model-picker-panel]',
  '[data-agent-cwd-menu]', '[data-agent-permission-menu]',
  '[data-provider-key]', '[data-settings-section]', '[role="tooltip"]',
  '.react-flow__a11y-descriptions', '.react-flow__aria-live',
].join(',');

type Assets = ReturnType<typeof canvasHtmlAssets>;
type CopyOptions = { document: Document; assets: Assets; shell?: boolean };

function presentationAttributes(source: Element, copy: Element) {
  for (const { name, value } of [...copy.attributes]) {
    if (/^on/i.test(name) || /^(?:srcdoc|srcset|autofocus|form|formaction|action|ping|target|download|draggable|autoplay|nonce|contenteditable)$/i.test(name)
      || (name === 'value' && source.matches('input,button,select,textarea,option'))) {
      copy.removeAttribute(name);
    } else if (/^(?:href|xlink:href|src|poster|background)$/i.test(name) && !value.startsWith('#')) {
      copy.removeAttribute(name);
    }
  }
  if (copy.matches('button')) {
    copy.setAttribute('type', 'button');
    copy.setAttribute('tabindex', '-1');
  }
  if (copy.matches('[data-agent-cwd]')) copy.removeAttribute('data-tooltip');
  if (copy.matches('input,textarea,select')) {
    copy.setAttribute('inert', '');
    if (source instanceof HTMLInputElement) {
      copy.toggleAttribute('checked', source.checked);
      if (['range', 'color'].includes(source.type)) copy.setAttribute('value', source.value);
    }
  }
  if (source instanceof HTMLAnchorElement && source.hasAttribute('href')) {
    try {
      const url = new URL(source.getAttribute('href')!, source.baseURI);
      if (/^(?:https?:|mailto:)$/.test(url.protocol)) {
        copy.setAttribute('href', url.href);
        copy.setAttribute('target', '_blank');
        copy.setAttribute('rel', 'noopener noreferrer');
      }
    } catch { /* Keep the label of an unresolvable link. */ }
  }
  if (source.scrollTop) copy.setAttribute('data-export-scroll-top', String(source.scrollTop));
  if (source.scrollLeft) copy.setAttribute('data-export-scroll-left', String(source.scrollLeft));
}

async function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function inlineImage(src: string, base: string, assets: Assets) {
  if (/^data:image\//i.test(src)) return src;
  try {
    const url = new URL(src, base);
    if (url.protocol === 'blob:') {
      const blob = await (await fetch(url.href)).blob();
      return /^image\//i.test(blob.type) ? await blobData(blob) : undefined;
    }
    if (/^https?:$/.test(url.protocol)) return await assets.imageSource(url.href);
  } catch { /* An unavailable image retains its original alternate text. */ }
}

function asPicture(original: Element, copy: Element, source: string | undefined, doc: Document) {
  const img = doc.createElement('img');
  for (const { name, value } of [...copy.attributes]) img.setAttribute(name, value);
  if (source) img.setAttribute('src', source);
  img.alt = copy.getAttribute('aria-label') ?? copy.getAttribute('title') ?? '';
  // A document page may style its canvas/iframe by tag. Keep its CSS box
  // even after replacing that tag with a self-contained bitmap.
  const style = getComputedStyle(original);
  for (const key of ['display', 'position', 'inset', 'width', 'height', 'max-width', 'max-height',
    'margin', 'padding', 'box-sizing', 'border', 'border-radius', 'vertical-align', 'object-fit', 'background-color']) {
    img.style.setProperty(key, style.getPropertyValue(key));
  }
  return img;
}

async function passiveCopy(source: Node, ctx: CopyOptions): Promise<Node | null> {
  if (source.nodeType === Node.TEXT_NODE) return ctx.document.createTextNode(source.textContent ?? '');
  if (!(source instanceof Element) || source.matches(omitted)) return null;
  const copy = source instanceof HTMLFormElement ? ctx.document.createElement('div') : ctx.document.importNode(source, false);
  if (source instanceof HTMLFormElement) {
    for (const { name, value } of [...source.attributes]) copy.setAttribute(name, value);
  }
  presentationAttributes(source, copy);
  if (ctx.shell && source.matches(graphLayers)) return copy;
  if (source instanceof HTMLCanvasElement) {
    let picture: string | undefined;
    try { picture = source.toDataURL('image/png'); } catch { /* Detached or tainted canvas. */ }
    const img = asPicture(source, copy, picture, ctx.document);
    // PDF.js retains default-sized canvases for virtualized pages it has not painted.
    if (source.matches('.pdf-document-canvas') && (!source.width || !source.height ||
      (source.width === 300 && source.height === 150 && !source.closest('[data-pdf-page]')?.querySelector('.tdag-textlayer span')))) {
      img.setAttribute('data-export-missing-pdf-page', '');
    }
    return img;
  }
  if (source instanceof HTMLIFrameElement) {
    // The material reader's original-document frames have no scripts. Capture
    // the visible page as pixels, including any authored stylesheet and SVG.
    let picture: string | undefined;
    try {
      const body = source.hasAttribute('srcdoc') && source.contentDocument?.body;
      if (body) {
        const { toPng } = await import('html-to-image');
        picture = await toPng(body, { width: source.clientWidth, height: source.clientHeight, pixelRatio: 1,
          preferredFontFormat: 'woff2', style: { margin: '0', transform: 'translateY(-' + source.contentWindow!.scrollY + 'px)' } });
      }
    } catch { /* Cross-origin frames cannot be read back. */ }
    return asPicture(source, copy, picture, ctx.document);
  }
  if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement || source.matches('[contenteditable="true"],[contenteditable="plaintext-only"]')) return copy;
  if (source.localName === 'style') {
    copy.textContent = (await ctx.assets.inlineCss(source.textContent ?? '', source.baseURI)).replace(/<\/style/gi, '<\\/style');
    return copy;
  }
  const pending: Promise<void>[] = [];
  const inlineStyle = source.getAttribute('style');
  if (inlineStyle && /url\(/i.test(inlineStyle)) pending.push(ctx.assets.inlineCss(inlineStyle, source.baseURI).then(css => copy.setAttribute('style', css)));
  if (source instanceof HTMLImageElement || source instanceof SVGImageElement) {
    const raw = source instanceof HTMLImageElement ? source.currentSrc || source.getAttribute('src') : source.href.baseVal;
    if (raw) pending.push(inlineImage(raw, source.baseURI, ctx.assets).then(url => {
      if (url) copy.setAttribute(source instanceof HTMLImageElement ? 'src' : 'href', url);
    }));
  }
  const children = await Promise.all([...source.childNodes].map(child => passiveCopy(child, ctx)));
  for (const child of children) if (child) copy.appendChild(child);
  if (source.shadowRoot) {
    const tpl = ctx.document.createElement('template');
    tpl.setAttribute('shadowrootmode', 'open');
    const inner = await Promise.all([...source.shadowRoot.childNodes].map(child => passiveCopy(child, ctx)));
    for (const child of inner) if (child) tpl.content.appendChild(child);
    // Constructed sheets follow the shadow root's own sheets in the cascade.
    if (source.shadowRoot.adoptedStyleSheets.length) {
      const sheet = ctx.document.createElement('style');
      sheet.textContent = await stylesFor(source.shadowRoot.adoptedStyleSheets, ctx.assets);
      tpl.content.appendChild(sheet);
    }
    copy.prepend(tpl);
  }
  await Promise.all(pending);
  return copy;
}

/** Clone rendered content without form values, executable elements or external media. */
export async function clonePassiveElement(source: Element, assets = canvasHtmlAssets(document.documentElement.dataset.theme === 'dark')): Promise<Element | null> {
  const copy = await passiveCopy(source, { document: document.implementation.createHTMLDocument(''), assets });
  return copy as Element | null;
}

async function stylesFor(sheets: CSSStyleSheet[], assets: Assets): Promise<string> {
  const css = await Promise.all(sheets.filter(sheet => !sheet.disabled).map(async sheet => {
    const base = sheet.href || document.baseURI;
    let rules: string;
    try {
      // CSSOM includes dynamically inserted rules and retains @layer order.
      rules = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
      rules = await assets.inlineCss(rules, base);
    } catch {
      rules = sheet.href ? await assets.stylesheet(sheet.href) ?? '' : '';
    }
    return sheet.media?.mediaText ? '@media ' + sheet.media.mediaText + '{' + rules + '}' : rules;
  }));
  return css.join('\n').replace(/<\/style/gi, '<\\/style');
}

function outerAttributes(el: HTMLElement): string {
  const attrs = [...el.attributes].filter(a => /^(?:class|style|dir|lang|data-theme|data-paper|data-type-surface)$/i.test(a.name));
  return attrs.map(({ name, value }) => name + '="' + value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') + '"').join(' ');
}

/** Snapshot the active canvas only. Its sibling app roots can contain settings,
 * confirmations and notifications unrelated to the shared canvas. */
export async function captureCanvasSurface(assets = canvasHtmlAssets(document.documentElement.dataset.theme === 'dark')) {
  const root = document.getElementById('root');
  const flow = root?.querySelector<HTMLElement>('.react-flow');
  const viewport = flow?.querySelector<HTMLElement>('.react-flow__viewport');
  if (!root || !flow || !viewport) return null;
  let surface: HTMLElement = flow;
  while (surface.parentElement && surface.parentElement !== root) surface = surface.parentElement;
  const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
  const camera = { x: matrix.e, y: matrix.f, zoom: matrix.a };
  const doc = document.implementation.createHTMLDocument('');
  const htmlAttributes = outerAttributes(document.documentElement), bodyAttributes = outerAttributes(document.body);
  const [copy, css] = await Promise.all([
    passiveCopy(surface, { document: doc, assets, shell: true }),
    stylesFor([...document.styleSheets, ...document.adoptedStyleSheets], assets),
  ]);
  if (!copy) return null;
  const wrapper = doc.importNode(root, false);
  wrapper.appendChild(copy);
  wrapper.querySelector('[data-toolbar-more]')?.setAttribute('aria-expanded', 'false');
  return { root: wrapper, css, camera, htmlAttributes, bodyAttributes };
}
