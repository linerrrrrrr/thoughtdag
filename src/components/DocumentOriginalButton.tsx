import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { Attachment } from '../types';
import { loadAttachmentContent } from '../lib/attachment-vault';
import { toast } from '../lib/ui-store';
import { useT } from '../i18n';

/** The imported bytes stay separate from the editable reading copy. */
export default function DocumentOriginalButton({ attachment, compact = false }: { attachment: Attachment; compact?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const content = await loadAttachmentContent(attachment);
      if (!content && (attachment.size > 0 || attachment.contentInVault)) throw new Error('Missing original');
      const binary = attachment.type.startsWith('image/') || attachment.type === 'application/pdf'
        || attachment.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const data = binary ? Uint8Array.from(atob(content), char => char.charCodeAt(0)) : content;
      const url = URL.createObjectURL(new Blob([data], { type: attachment.type || 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast('error', t('document.originalUnavailable'));
    } finally { setBusy(false); }
  };
  return <button type="button" onClick={() => void download()} disabled={busy}
    aria-label={t('document.downloadOriginal')} data-tooltip={t('document.downloadOriginal')}
    data-document-original={attachment.id}
    className={`${compact ? 'w-6 h-6' : 'w-8 h-8'} shrink-0 flex items-center justify-center rounded-control text-ink-muted hover:bg-wash hover:text-ink disabled:opacity-40`}>
    {busy ? <Loader2 size={compact ? 13 : 15} className="animate-spin" /> : <Download size={compact ? 13 : 15} strokeWidth={1.75} />}
  </button>;
}
