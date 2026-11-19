import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Attachment } from '../types';
import type { FileEditPreview } from '../lib/document-edit-preview';
import { loadDocumentContent } from '../lib/attachment-vault';
import { useT } from '../i18n';
import './DocumentRichBody.css';

/** Work on a detached reading copy. The native editor, its undo stack and
 * any draft stay intact while a tool streams the replacement. */
function markReplacement(html: string, preview: FileEditPreview): string | null {
  if (!preview.before) return null;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const blocks = [...body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th')];
  const matches = blocks.filter(block => !block.querySelector('p,li,td,th') && block.textContent?.includes(preview.before));
  if (matches.length !== 1) return null;
  const block = matches[0], plain = block.textContent!;
  const start = plain.indexOf(preview.before), end = start + preview.before.length;
  if (plain.indexOf(preview.before, start + 1) >= 0) return null;
  const range = body.ownerDocument.createRange();
  const walker = body.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const next = offset + node.length;
    if (offset <= start && start < next) range.setStart(node, start - offset);
    if (offset < end && end <= next) { range.setEnd(node, end - offset); break; }
    offset = next;
  }
  range.deleteContents();
  const mark = body.ownerDocument.createElement('mark');
  mark.dataset.fileEditReplacement = '';
  mark.textContent = preview.after;
  range.insertNode(mark);
  return body.innerHTML;
}

export default function DocumentEditPreview({ attachment, preview }: { attachment: Attachment; preview: FileEditPreview }) {
  const t = useT();
  const [source, setSource] = useState<string>();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const render = async () => {
      const { sanitizeDocumentHtml } = await import('../lib/html-material');
      let html = attachment.documentHtml;
      if (!html || attachment.editedDocxRevision || attachment.editedDocxContent !== undefined) {
        const content = await loadDocumentContent(attachment);
        const bytes = Uint8Array.from(atob(content), c => c.charCodeAt(0));
        const mammoth = await import('mammoth');
        html = (await mammoth.convertToHtml({ arrayBuffer: bytes.buffer })).value;
      }
      const safe = await sanitizeDocumentHtml(html);
      if (active) setSource(safe);
    };
    setSource(undefined);
    void render().catch(() => {});
    return () => { active = false; };
  }, [attachment]);
  const html = useMemo(() => source ? markReplacement(source, preview) : null, [source, preview]);
  const visible = html !== null;
  useLayoutEffect(() => {
    const scroller = viewport.current, mark = scroller?.querySelector<HTMLElement>('mark[data-file-edit-replacement]');
    if (scroller && mark) scroller.scrollTop = mark.offsetTop - scroller.clientHeight / 3;
  }, [preview.before, visible]);
  if (html === null) return null;
  return <div className="docx-edit-preview" data-document-edit-preview={attachment.id}>
    <span className="text-meta text-ink-muted">{t('document.editPreview')}</span>
    <div ref={viewport} className="docx-edit-preview-body document-rich-body text-body text-ink"
      dangerouslySetInnerHTML={{ __html: html }} />
  </div>;
}
