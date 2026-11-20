import { useLayoutEffect, useRef } from 'react';
import type { Attachment } from '../types';
import { useProjects } from '../store/projects';
import { useT } from '../i18n';
import { previewTextParts, useFileEditPreview } from '../lib/document-edit-preview';

const viewportClass = 'relative min-h-0 flex-auto overflow-auto overscroll-contain nowheel nopan';

export function StreamingFileText({ parts, canvas = false, fill = false }: {
  parts: NonNullable<ReturnType<typeof previewTextParts>>; canvas?: boolean; fill?: boolean;
}) {
  const t = useT();
  const viewport = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const target = mark.current, block = viewport.current;
    if (block && target) block.scrollTop = target.offsetTop - block.clientHeight / 3;
  }, [parts.leading]);
  return <>
    <span className="shrink-0 text-meta text-ink-muted">{t('document.editPreview')}</span>
    <div ref={viewport} className={`${viewportClass} ${fill ? '' : 'max-h-[380px]'}`} data-content-body={canvas || undefined}>
      <pre data-cursor="text" className="whitespace-pre-wrap break-words text-control text-ink font-mono">
        {parts.leading}<mark ref={mark} data-file-preview-original={parts.original} className="bg-material-file-wash text-material-file-ink">{parts.replacement}</mark>{parts.trailing}
      </pre>
    </div>
  </>;
}

export default function FileTextPreview({ nodeId, attachment, fill }: { nodeId: string; attachment: Attachment; fill?: boolean }) {
  const project = useProjects(state => state.activeId) ?? 'default';
  const preview = useFileEditPreview(project, nodeId, attachment.id);
  const text = attachment.extractedText || attachment.content;
  const parts = previewTextParts(text, preview);
  if (parts) return <StreamingFileText parts={parts} canvas fill={fill} />;
  return text ? <div className={`${viewportClass} ${fill ? '' : 'max-h-[380px]'}`} data-content-body>
    <pre data-file-text-preview={attachment.id}
      data-cursor="text" className="whitespace-pre-wrap break-words text-control text-ink-muted font-mono">{text.slice(0, 12000)}</pre>
  </div> : null;
}
