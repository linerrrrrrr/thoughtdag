import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import DOMPurify from 'dompurify';
import type { PluggableList } from 'unified';
import { fmt, t } from '../i18n';
import FileAttachmentHeader from '../components/FileAttachmentHeader';
import PdfDocumentView from '../components/PdfDocumentView';
import { NotebookCells } from '../components/NotebookView';
import type { Attachment, ThoughtData, ThoughtNode } from '../types';
import { activeSummary, formatStamp } from '../utils';
import { isDocxDocument, documentCopyText } from './document-copy';
import { loadAttachmentContent, loadDocumentContent } from './attachment-vault';
import { rehypeUserHighlights } from './rehype-user-highlights';
import { sanitizeDocumentHtml } from './html-material';
import { isNotebook, parseNotebook } from './notebook';
import { renderPdfReadingPages } from './canvas-html-pdf';
import { normalizeMath } from './markdown-math';
import { foldToolCalls } from './tool-markup';
import { activeAgentActivity, originalQuestionBeforeInstructions } from './agent-activity';
import { embeddedImage, type canvasHtmlAssets } from './canvas-html-assets';
import { basenameOf, localTargetOf, rehypeLocalFiles } from './local-target';
import { docxPagePictures, htmlPagePictures } from './canvas-html-document-pages';
import { remarkFileCitations } from './remark-file-citations';
import { remarkSourceListNumbers } from './remark-source-list-numbers';
import { findHighlightedPassage, highlightedTextRuns } from './highlight-navigation';
import { findRichHighlightRange } from './document-highlights';
import { overviewRulerMarks } from './overview-ruler';
import { attachmentHighlights, conversationHighlightTexts } from './highlight-match';

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function readingUrl(value?: string, base?: string): string | undefined {
  if (!value?.trim()) return;
  try {
    const url = new URL(value, base && /^https?:\/\//i.test(base) ? base : undefined);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return url.href;
  } catch { /* Relative references without a web source remain plain text. */ }
}

function link(label: string, value?: string): string {
  const url = readingUrl(value);
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
}

// Only <img> receives embedded file data. Never turn an attachment into a
// navigable data URL, a plugin document, or an iframe in the shared page.
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
    ol: ['start'], li: ['value'], td: ['colSpan', 'rowSpan'], th: ['colSpan', 'rowSpan'],
    input: [['type', 'checkbox'], 'checked'],
  },
  protocols: { ...defaultSchema.protocols, src: ['data', 'http', 'https'] },
};

// These plugins run in the exporter. Only their passive markup travels.
const readingRemarkPlugins = [remarkGfm, remarkMath, remarkFileCitations];
const questionRemarkPlugins = [...readingRemarkPlugins, remarkSourceListNumbers];

function readingMarkdown(source: string, highlights: string[] = [], base?: string, remarkPlugins: PluggableList = readingRemarkPlugins) {
  const plugins: PluggableList = [rehypeRaw, rehypeLocalFiles, [rehypeSanitize, readingSchema],
    rehypeHighlight, rehypeKatex];
  if (highlights.length) plugins.push([rehypeUserHighlights, highlights]);
  const text = foldToolCalls(normalizeMath(source), names =>
    `\n\n> ⚙ ${fmt(t('md.toolCallFolded'), { names: names.map(name => '`' + name + '`').join(', ') || '?' })}\n\n`);
  return <ReactMarkdown remarkPlugins={remarkPlugins}
    rehypePlugins={plugins} urlTransform={url => url} components={{
      a: ({ href, children }) => {
        const url = readingUrl(href, base);
        return url ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
      },
      img: ({ src, alt }) => {
        if (typeof src === 'string' && embeddedImage.test(src)) return <img loading="lazy" src={src} alt={alt ?? ''} />;
        const url = typeof src === 'string' ? readingUrl(src, base) : undefined;
        const local = !url && typeof src === 'string' ? localTargetOf(src, base) : null;
        if (local) return <img loading="lazy" data-reading-local={local.path} alt={alt || basenameOf(local.path)} />;
        return url && /^https?:/.test(url)
          ? <img loading="lazy" data-reading-image={url} alt={alt || url} />
          : <>{alt || (typeof src === 'string' ? src : '')}</>;
      },
      input: ({ type, checked }) => type === 'checkbox' ? <span>{checked ? '☑' : '☐'}</span> : null,
    }}>{text}</ReactMarkdown>;
}

function markdown(source: string, highlights: string[] = [], base?: string, remarkPlugins?: PluggableList): string {
  return source.trim() ? renderToStaticMarkup(readingMarkdown(source, highlights, base, remarkPlugins)) : '';
}

// The application document sanitizer preserves the saved formatting. Limit its
// output to passive reading elements and attributes before joining the viewer.
async function richBody(source: string, base?: string): Promise<string> {
  const fragment = DOMPurify.sanitize(await sanitizeDocumentHtml(source), {
    ALLOWED_TAGS: readingTags,
    ALLOWED_ATTR: ['alt', 'colspan', 'height', 'href', 'rowspan', 'src', 'start', 'style', 'width'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true,
  });
  for (const anchor of fragment.querySelectorAll('a')) {
    const url = readingUrl(anchor.getAttribute('href') ?? '', base);
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
      const text = await richBody(await restoreDocxImageSizes(arrayBuffer, value));
      const pages = await docxPagePictures(att, new Uint8Array(arrayBuffer)).catch(() => '');
      return pages ? pages + disclosure(t('reader.viewText'), text) : text;
    } catch { /* An older or damaged document can still have a readable saved copy. */ }
  }
  if (!revised && att.documentHtml !== undefined) return richBody(att.documentHtml);
  const saved = revised ? att.editedText : att.extractedText ?? (att.type.startsWith('text/') ? att.content : undefined);
  return saved !== undefined ? markdown(saved) : escapeHtml(t('richDocument.loadFailed'));
}

function disclosure(label: string, body: string): string {
  return body ? `<details><summary>${escapeHtml(label)}</summary>${body}</details>` : '';
}

async function htmlMaterial(source: string, assets: ReturnType<typeof canvasHtmlAssets>, base?: string) {
  // Resolve article images before the document sanitizer drops external URLs.
  // This same self-contained source feeds both the original layout and reading text.
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(source, { WHOLE_DOCUMENT: true, ADD_TAGS: ['style', 'link'],
    FORBID_TAGS: ['meta', 'base', 'iframe', 'object', 'embed', 'form', 'button', 'input', 'textarea', 'select'] }), 'text/html');
  for (const style of doc.querySelectorAll('style')) style.textContent = await assets.inlineCss(style.textContent ?? '', base);
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', await assets.inlineCss(el.getAttribute('style')!, base));
  for (const ref of doc.querySelectorAll('link')) {
    const url = readingUrl(ref.getAttribute('href') ?? '', base);
    const css = ref.relList.contains('stylesheet') && url && /^https?:/.test(url) ? await assets.stylesheet(url) : undefined;
    if (!css) { ref.remove(); continue; }
    const style = doc.createElement('style');
    style.textContent = css;
    style.media = ref.media;
    ref.replaceWith(style);
  }
  for (const img of doc.querySelectorAll('img')) {
    const raw = img.getAttribute('src') ?? '';
    img.removeAttribute('srcset');
    if (embeddedImage.test(raw)) continue;
    const url = readingUrl(raw, base);
    const src = url && /^https?:/.test(url) ? await assets.imageSource(url) : undefined;
    if (src) img.src = src;
    else if (url) {
      const a = doc.createElement('a');
      a.href = url;
      a.textContent = img.alt || url;
      img.replaceWith(a);
    } else img.replaceWith(doc.createTextNode(img.alt));
  }
  source = doc.documentElement.outerHTML;
  const text = await richBody(source, base);
  const pages = await htmlPagePictures(source).catch(() => '');
  return pages ? `<div class="flex flex-col items-center py-6 px-4"><div class="w-full max-w-[860px]">${pages}</div></div>` + disclosure(t('reader.viewText'), text) : text;
}

async function attachmentBody(nodeId: string, att: Attachment, highlights: string[], assets: ReturnType<typeof canvasHtmlAssets>): Promise<string> {
  if (isDocxDocument(att)) return docxBody(att);
  if (att.type === 'application/pdf') {
    const pages = await renderPdfReadingPages(att);
    const copy = markdown(documentCopyText(att), highlights);
    const text = copy && `<div data-pdf-text>${copy}</div>`;
    return pages.includes('pdf-sheet') ? renderToStaticMarkup(<PdfDocumentView nodeId={nodeId} attachment={att} savedPages={pages} />)
      + disclosure(t('reader.viewText'), text) : pages + text;
  }
  const saved = att.editedText ?? att.extractedText;
  if (att.type.startsWith('image/')) {
    const content = await loadAttachmentContent(att);
    const src = content ? `data:${att.type};base64,${content}` : att.thumbnailUrl ?? '';
    return imageHtml(src, att.name) + markdown(saved ?? '', highlights);
  }
  if (att.type === 'text/html' || /\.x?html?$/i.test(att.name)) {
    if (att.editedHtml !== undefined) return htmlMaterial(att.editedHtml, assets);
    if (att.editedText !== undefined) return markdown(att.editedText, highlights);
    const original = await loadAttachmentContent(att);
    return original ? htmlMaterial(original, assets) : markdown(saved ?? '', highlights);
  }
  if (isNotebook(att)) {
    if (att.editedText === undefined) {
      const source = await loadAttachmentContent(att);
      if (source) {
        try {
          return renderToStaticMarkup(<NotebookCells notebook={parseNotebook(source)} renderMarkdown={text => readingMarkdown(text, highlights)} />);
        } catch { if (!saved) return `<pre>${escapeHtml(source)}</pre>`; }
      }
    }
    return markdown(saved ?? '', highlights) + (att.figures ?? [])
      .map((fig, i) => imageHtml(`data:${fig.mimeType};base64,${fig.data}`, `${att.name} · ${i + 1}`)).join('');
  }
  if (saved !== undefined) return markdown(saved, highlights);
  const content = await loadAttachmentContent(att);
  if (highlights.length || /\.(?:md|markdown)$/i.test(att.name) || att.type === 'text/markdown') return markdown(content, highlights);
  return content ? `<pre>${escapeHtml(content)}</pre>` : '';
}

function conversation(data: ThoughtData): string {
  const base = data.agentSession?.cwd ?? data.importSource?.cwd;
  const questions = [...conversationHighlightTexts(data.highlights, 'question')];
  const responses = [...conversationHighlightTexts(data.highlights, 'response')];
  const pair = (question: string, answer: string, current: boolean, reasoning?: string | null) => !question && !answer && !reasoning ? '' :
    '<div class="reading-turn">' + (question ? `<div class="conversation-question"><div class="conversation-user-message question-md markdown-body"${current ? ' data-reading-question' : ''}>${markdown(question, current ? questions : [], base, questionRemarkPlugins)}</div></div>` : '') +
    (reasoning ? disclosure(t('node.reasoning'), markdown(reasoning)) : '') +
    (answer.trim() ? `<div class="conversation-answer markdown-body"${current ? ' data-reading-answer' : ''}>${markdown(answer, current ? responses : [], base)}</div>` : '') + '</div>';
  const activity = activeAgentActivity(data);
  const reasoning = data.reasonings?.[data.responseIndex] ?? (data.isLoading ? data.reasoning : undefined);
  let body = pair(originalQuestionBeforeInstructions(data.question ?? '', activity), data.response ?? '', true, reasoning);
  if (activity.length) body += disclosure(fmt(t('activity.events'), { count: activity.length }), activity.map(entry => {
    const heading = entry.title || t('activity.event');
    const command = entry.command ? `<pre>${escapeHtml(entry.command)}</pre>` : '';
    const output = entry.output ? `<pre>${escapeHtml(entry.output)}</pre>` : '';
    const text = entry.kind === 'user' && entry.status === 'completed'
      ? `<div data-reading-question>${markdown(entry.text ?? '', questions, base)}</div>` : markdown(entry.text ?? '');
    return `<section><strong>${escapeHtml(heading)}</strong>${command}${text}${output}</section>`;
  }).join(''));
  const versions = data.responses ?? [];
  const at = data.generatedAts?.[data.responseIndex];
  if (at) body += `<time class="card-model" datetime="${escapeHtml(at)}">${escapeHtml(formatStamp(at))}</time>`;
  if (versions.length > 1) {
    body += disclosure(t('actions.responseVersions'), versions.map((response, index) => {
      if (index === data.responseIndex) return '';
      return disclosure(`${index + 1} / ${versions.length}`, pair(data.questions?.[index] ?? data.question, response, false, data.reasonings?.[index]));
    }).join(''));
  }
  const references = data.references ?? [];
  if (references.length) body += disclosure(t('mp.sources'), `<ol>${references.map(ref =>
    `<li>${link(ref.title || ref.url || '', ref.url)}</li>`).join('')}</ol>`);
  return body;
}

/** Mark each text run separately so formatted passages can span links or table cells. */
function anchorReadingRange(range: Range, index: number, color?: string, nativeFormatting = false) {
  const runs = highlightedTextRuns(range, nativeFormatting);
  const anchor = document.createElement('span');
  anchor.dataset.rulerTarget = String(index);
  if (!runs.length) { range.collapse(true); range.insertNode(anchor); return; }
  for (const [i, { text, from, to }] of runs.entries()) {
    if (to < text.length) text.splitText(to);
    const highlighted = from ? text.splitText(from) : text;
    if (i === 0) highlighted.before(anchor);
    if (highlighted.parentElement?.closest('mark')) continue;
    const mark = document.createElement('mark');
    if (color && CSS.supports('color', color)) mark.style.backgroundColor = color;
    highlighted.replaceWith(mark);
    mark.append(highlighted);
  }
}

/** Render a node from the snapshot, reading bulky attachments only as needed. */
export async function renderNodeReadingHtml({ id, data }: ThoughtNode, isParadigmStep: boolean, assets: ReturnType<typeof canvasHtmlAssets>): Promise<string> {
  const highlights = (data.highlights ?? []).filter(mark => !mark.attachmentId).map(mark => mark.text).filter(Boolean);
  let body = '';
  switch (data.stepKind) {
    case 'note':
      if (data.question?.trim()) body = `<div data-reading-primary>${markdown(data.question, highlights)}</div>`;
      break;
    case 'link':
      if (data.linkUrl) body = `<p>${link(data.linkUrl, data.linkUrl)}</p>`;
      if (data.linkSnapshotHtml) body += `<div data-reading-primary>${await htmlMaterial(data.linkSnapshotHtml, assets, data.linkUrl)}</div>`;
      if (data.question) {
        const text = markdown(data.question, highlights, data.linkUrl);
        body += data.linkSnapshotHtml ? disclosure(t('reader.viewText'), text) : `<div data-reading-primary>${text}</div>`;
      }
      break;
    case 'file': body = markdown(data.question ?? '', highlights); break;
    case 'frame': break;
    default:
      if (data.instruction && (isParadigmStep || data.instruction !== data.question)) body = markdown(data.instruction);
      if (!isParadigmStep) body += conversation(data);
  }
  for (const att of data.attachments ?? []) {
    const marks = attachmentHighlights(data, att.id);
    const content = await attachmentBody(id, att, marks.map(mark => mark.text), assets);
    const header = renderToStaticMarkup(<FileAttachmentHeader attachment={att} />);
    body += `<section class="reading-attachment">${header}<div data-reading-file="${escapeHtml(att.id)}">${content}</div>${disclosure(t('reader.digest'), markdown(att.digest ?? ''))}</section>`;
  }
  if (highlights.length) body += disclosure(t('highlight.title'), `<ul>${highlights.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`);
  const summary = data.displaySummary ?? activeSummary(data);
  if (summary?.trim()) body = disclosure(t('node.summaryLabel'), `<p class="reading-summary">${escapeHtml(summary)}</p>`) + body;
  if (!body) return `<p>${escapeHtml(t('reader.empty'))}</p>`;
  const marks = overviewRulerMarks(data);
  // Resolve the anchors while exporting, using the same passage matching as
  // the canvas. The standalone viewer only has to open and scroll to an anchor.
  const template = document.createElement('template');
  template.innerHTML = body;
  await assets.embed(template.content);
  marks.forEach((mark, index) => {
    if (mark.source === 'question') {
      const scope = template.content.querySelectorAll<HTMLElement>('[data-reading-question]');
      const range = findHighlightedPassage(scope, mark.text, mark.occurrence);
      if (range) anchorReadingRange(range, index, mark.color);
      return;
    }
    const scope = template.content.querySelector<HTMLElement>(mark.attachmentId
      ? `[data-reading-file="${CSS.escape(mark.attachmentId)}"]` : '[data-reading-primary], [data-reading-answer]');
    if (!scope) return;
    if (mark.page && mark.documentMarkId) {
      const ink = scope.querySelector<HTMLElement>(`[data-pdf-mark="${CSS.escape(mark.documentMarkId)}"]`);
      if (ink) ink.dataset.rulerTarget = String(index);
      return;
    }
    const file = mark.documentMarkId && data.attachments?.find(att => att.id === mark.attachmentId);
    const saved = file ? file.documentHighlights?.find(item => item.id === mark.documentMarkId) : undefined;
    const nativeRange = saved && findRichHighlightRange(scope, saved);
    const range = nativeRange || findHighlightedPassage([scope.querySelector<HTMLElement>('[data-pdf-text]') ?? scope], mark.text, mark.occurrence);
    if (range) anchorReadingRange(range, index, mark.color, !!nativeRange);
  });
  return template.innerHTML;
}
