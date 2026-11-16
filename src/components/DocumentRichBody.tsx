import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import type { Attachment } from '../types';
import { documentRichHtml } from '../lib/document-copy';
import { useT } from '../i18n';
import './DocumentRichBody.css';

/** The saved document and the visual editor use the same HTML reading surface. */
export default function DocumentRichBody({ attachment }: { attachment: Attachment }) {
  const t = useT();
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void documentRichHtml(attachment).then(html => {
      if (!cancelled) { setContent(DOMPurify.sanitize(html)); setFailed(false); }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attachment]);
  if (failed) return <p className="text-control text-ink-faint">{t('richDocument.loadFailed')}</p>;
  if (content === null) return <p className="text-control text-ink-faint">{t('richDocument.loading')}</p>;
  return <div className="document-rich-body text-body text-ink" data-document-rich-body={attachment.id}
    dangerouslySetInnerHTML={{ __html: content }} />;
}
