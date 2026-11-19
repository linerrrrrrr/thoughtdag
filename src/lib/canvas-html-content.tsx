import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import DOMPurify from 'dompurify';
import type { PluggableList } from 'unified';
import { t } from '../i18n';
import type { Attachment, ThoughtData, ThoughtNode } from '../types';
import { activeSummary } from '../utils';
import { isDocxDocument, documentCopyText } from './document-copy';
import { loadAttachmentContent, loadDocumentContent } from './attachment-vault';
import { rehypeUserHighlights } from './rehype-user-highlights';
import { sanitizeDocumentHtml } from './html-material';
import { isNotebook, notebookMaterial, parseNotebook } from './notebook';
import { renderPdfReadingPages } from './canvas-html-pdf';
import { normalizeMath } from './markdown-math';
import { remarkFileCitations } from './remark-file-citations';

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function readingUrl(value?: string, base?: string): string | undefined {
  if (!value?.trim()) return;
  try {
    const url = new URL(value, base);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return url.href;
  } catch { /* Relative references without a web source remain plain text. */ }
}

function link(label: string, value?: string): string {
  const url = readingUrl(value);
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
}

// Only <img> receives embedded file data. Never turn an attachment into a
// navigable data URL, a plugin document, or an iframe in the shared page.
const embeddedImage = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[a-z\d+/=\s]+$/i;

function imageHtml(src: string, alt: string): string {
  return embeddedImage.test(src)
    ? `<img loading="lazy" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`
    : escapeHtml(alt);
}

const readingTags = ['a', 'abbr', 'article', 'b', 'blockquote', 'br', 'caption', 'code',
  'col', 'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd',
  'li', 'mark', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'];

const readingSchema = {
  ...defaultSchema,
  tagNames: [...readingTags, 'input'],
  attributes: {
    a: ['href'], img: ['src', 'alt'], code: [['className', /^language-./, 'math-inline', 'math-display']],
    ol: ['start'], td: ['colSpan', 'rowSpan'], th: ['colSpan', 'rowSpan'],
    input: [['type', 'checkbox'], 'checked'],
  },
  protocols: { ...defaultSchema.protocols, src: ['data', 'http', 'https'] },
};

// Generate real markup while exporting. MathML, saved marks and task list
// glyphs need neither a renderer nor editable controls on the reader's device.
function markdown(source: string, highlights: string[] = [], base?: string): string {
  if (!source.trim()) return '';
  const plugins: PluggableList = [rehypeRaw, [rehypeSanitize, readingSchema],
    [rehypeKatex, { output: 'mathml' }]];
  if (highlights.length) plugins.push([rehypeUserHighlights, highlights]);
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkFileCitations]}
    rehypePlugins={plugins} urlTransform={url => url} components={{
      a: ({ href, children }) => {
        const url = readingUrl(href, base);
        return url ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
      },
      img: ({ src, alt }) => {
        if (typeof src === 'string' && embeddedImage.test(src)) return <img loading="lazy" src={src} alt={alt ?? ''} />;
        const url = typeof src === 'string' ? readingUrl(src, base) : undefined;
        return url ? <a href={url} target="_blank" rel="noopener noreferrer">{alt || url}</a> : <>{alt}</>;
      },
      input: ({ type, checked }) => type === 'checkbox' ? <span>{checked ? '☑' : '☐'}</span> : null,
    }}>{normalizeMath(source)}</ReactMarkdown>);
}

// The application document sanitizer preserves the saved formatting. Limit its
// output to passive reading elements and attributes before joining the viewer.
async function richBody(source: string): Promise<string> {
  const fragment = DOMPurify.sanitize(await sanitizeDocumentHtml(source), {
    ALLOWED_TAGS: readingTags,
    ALLOWED_ATTR: ['alt', 'colspan', 'height', 'href', 'rowspan', 'src', 'start', 'style', 'width'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true,
  });
  for (const anchor of fragment.querySelectorAll('a')) {
    const url = readingUrl(anchor.getAttribute('href') ?? '');
    if (url) { anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
    else anchor.replaceWith(...anchor.childNodes);
  }
  for (const img of fragment.querySelectorAll('img')) img.loading = 'lazy';
  const template = document.createElement('template');
  template.content.append(fragment);
  return template.innerHTML;
}

async function docxBody(att: Attachment): Promise<string> {
  const revised = att.editedDocxContent !== undefined || !!att.editedDocxRevision || !!att.editedDocxSavedAt;
  if (!revised) {
    if (att.editedHtml !== undefined) return richBody(att.editedHtml);
    if (att.editedText !== undefined) return markdown(att.editedText);
    if (att.documentHtml !== undefined) return richBody(att.documentHtml);
  }
  const nativeSource = revised ? !!att.editedDocxRevision || att.editedDocxContent !== undefined
    : !att.type.startsWith('text/') && (!!att.content || !!att.contentInVault);
  if (nativeSource) {
    try {
      const bytes = await loadDocumentContent(att);
      if (!bytes) throw new Error('Document source missing');
      const [mammoth, { restoreDocxImageSizes }] = await Promise.all([import('mammoth'), import('./docx-image-sizes')]);
      const arrayBuffer = Uint8Array.from(atob(bytes), char => char.charCodeAt(0)).buffer;
      const { value } = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: ['highlight => mark', 'u => u'] });
      return await richBody(await restoreDocxImageSizes(arrayBuffer, value));
    } catch { /* An older or damaged document can still have a readable saved copy. */ }
  }
  const saved = revised ? att.editedText : att.extractedText ?? (att.type.startsWith('text/') ? att.content : undefined);
  return saved !== undefined ? markdown(saved) : escapeHtml(t('richDocument.loadFailed'));
}

function disclosure(label: string, body: string): string {
  return body ? `<details><summary>${escapeHtml(label)}</summary>${body}</details>` : '';
}

async function attachmentBody(att: Attachment, highlights: string[]): Promise<string> {
  if (isDocxDocument(att)) return docxBody(att);
  if (att.type === 'application/pdf') {
    const pages = await renderPdfReadingPages(att);
    const text = markdown(documentCopyText(att), highlights);
    return pages ? pages + disclosure(t('reader.viewText'), text) : text;
  }
  const saved = att.editedText ?? att.extractedText;
  if (att.type.startsWith('image/')) {
    const content = await loadAttachmentContent(att);
    const src = content ? `data:${att.type};base64,${content}` : att.thumbnailUrl ?? '';
    return imageHtml(src, att.name) + markdown(saved ?? '', highlights);
  }
  if (att.type === 'text/html' || /\.x?html?$/i.test(att.name)) {
    return saved !== undefined && (saved || att.editedText !== undefined)
      ? markdown(saved, highlights) : richBody(await loadAttachmentContent(att));
  }
  if (isNotebook(att)) {
    let material: ReturnType<typeof notebookMaterial> | undefined;
    if (saved === undefined) {
      const source = await loadAttachmentContent(att);
      if (source) {
        try { material = notebookMaterial(parseNotebook(source)); }
        catch { return `<pre>${escapeHtml(source)}</pre>`; }
      }
    }
    return markdown(saved ?? material?.text ?? '', highlights) + (att.figures ?? material?.figures ?? [])
      .map((fig, i) => imageHtml(`data:${fig.mimeType};base64,${fig.data}`, `${att.name} · ${i + 1}`)).join('');
  }
  if (saved !== undefined) return markdown(saved, highlights);
  const content = await loadAttachmentContent(att);
  if (/\.(?:md|markdown)$/i.test(att.name) || att.type === 'text/markdown') return markdown(content, highlights);
  return content ? `<pre>${escapeHtml(content)}</pre>` : '';
}

function conversation(data: ThoughtData, highlights: string[]): string {
  const pair = (question: string, answer: string, marks: string[]) =>
    (question ? `<div class="reading-question">${markdown(question)}</div>` : '') + markdown(answer, marks);
  let body = pair(data.question ?? '', data.response ?? '', highlights);
  const versions = data.responses ?? [];
  if (versions.length > 1) {
    body += disclosure(t('actions.responseVersions'), versions.map((response, index) => {
      if (index === data.responseIndex) return '';
      return disclosure(`${index + 1} / ${versions.length}`, pair(data.questions?.[index] ?? data.question, response, []));
    }).join(''));
  }
  const references = data.references ?? [];
  if (references.length) body += disclosure(t('mp.sources'), `<ol>${references.map(ref =>
    `<li>${link(ref.title || ref.url || '', ref.url)}</li>`).join('')}</ol>`);
  return body;
}

/** Render a node from the snapshot, reading bulky attachments only as needed. */
export async function renderNodeReadingHtml({ data }: ThoughtNode, isParadigmStep = false): Promise<string> {
  const highlights = (data.highlights ?? []).map(mark => mark.text).filter(Boolean);
  let body = '';
  switch (data.stepKind) {
    case 'note': body = markdown(data.question ?? '', highlights); break;
    case 'link':
      if (data.linkUrl) body = `<p>${link(data.linkUrl, data.linkUrl)}</p>`;
      if (data.question) body += markdown(data.question, highlights, data.linkUrl);
      else if (data.linkSnapshotHtml) body += await richBody(data.linkSnapshotHtml);
      break;
    case 'file': body = markdown(data.question ?? '', highlights); break;
    case 'frame': break;
    default:
      if (data.instruction && (isParadigmStep || data.instruction !== data.question)) body = markdown(data.instruction);
      if (!isParadigmStep) body += conversation(data, highlights);
  }
  for (const att of data.attachments ?? []) {
    const content = await attachmentBody(att, highlights);
    body += `<section class="reading-attachment"><h3>${escapeHtml(att.name)}</h3>${content}${disclosure(t('reader.digest'), markdown(att.digest ?? ''))}</section>`;
  }
  if (highlights.length) body += disclosure(t('highlight.title'), `<ul>${highlights.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`);
  const summary = data.displaySummary ?? activeSummary(data);
  if (summary?.trim()) body = disclosure(t('node.summaryLabel'), `<p class="reading-summary">${escapeHtml(summary)}</p>`) + body;
  return body || `<p>${escapeHtml(t('reader.empty'))}</p>`;
}

export const canvasReadingStyles = `
.reading-question{margin:0 0 1rem auto;padding:.75rem 1rem;width:fit-content;max-width:90%;background:var(--conversation-user-bg,#edf2fa);color:var(--conversation-user-ink,#263851);border-radius:8px 8px 4px 8px}
.reading-question>:first-child{margin-top:0}.reading-question>:last-child{margin-bottom:0}
.reading-summary{white-space:pre-wrap}
.reading-attachment{margin-block:1.25rem;min-width:0}.reading-attachment>h3{overflow-wrap:anywhere}
.reading-attachment img{max-width:100%;height:auto}
.reading-content mark{color:var(--color-amber-800,#7a4800);background:var(--color-amber-100,#ffefb0)}
.pdf-sheet{position:relative}.pdf-sheet img{display:block;width:100%;height:auto}.pdf-sheet i{position:absolute;pointer-events:none;opacity:.35;mix-blend-mode:multiply}
`;
