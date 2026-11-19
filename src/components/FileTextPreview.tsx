import { useLayoutEffect, useRef } from 'react';
import type { Attachment } from '../types';
import { useProjects } from '../store/projects';
import { useT } from '../i18n';
import { previewTextParts, useFileEditPreview } from '../lib/document-edit-preview';

export function StreamingFileText({ parts }: { parts: NonNullable<ReturnType<typeof previewTextParts>> }) {
  const t = useT();
  const mark = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const target = mark.current, block = target?.parentElement;
    if (block && target) block.scrollTop = target.offsetTop - block.clientHeight / 3;
  }, [parts.leading]);
  return <>
    <span className="text-meta text-ink-muted">{t('document.editPreview')}</span>
    <pre className="relative max-h-[380px] overflow-auto nowheel nopan whitespace-pre-wrap break-words text-control text-ink font-mono">
      {parts.leading}<mark ref={mark} className="bg-material-file-wash text-material-file-ink">{parts.replacement}</mark>{parts.trailing}
    </pre>
  </>;
}

export default function FileTextPreview({ nodeId, attachment }: { nodeId: string; attachment: Attachment }) {
  const project = useProjects(state => state.activeId) ?? 'default';
  const preview = useFileEditPreview(project, nodeId, attachment.id);
  const text = attachment.extractedText || attachment.content;
  const parts = previewTextParts(text, preview);
  if (parts) return <StreamingFileText parts={parts} />;
  return text ? <pre data-file-text-preview={attachment.id}
    className="max-h-[380px] overflow-auto nowheel nopan whitespace-pre-wrap break-words text-control text-ink-muted font-mono cursor-text">{text.slice(0, 12000)}</pre> : null;
}
