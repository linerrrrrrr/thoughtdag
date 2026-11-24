import type { ReactNode, RefCallback } from 'react';
import { X } from 'lucide-react';
import type { Attachment } from '../types';
import { useT } from '../i18n';
import { fileIdentity, fileSizeLabel } from '../lib/file-identity';
import { isViewerMode } from '../lib/viewer';
import FileIdentity from './FileIdentity';

export default function FileAttachmentHeader({ attachment, onRemove, statusRef, children }: {
  attachment: Attachment; onRemove?: () => void;
  statusRef?: RefCallback<HTMLSpanElement>;
  children?: ReactNode;
}) {
  const t = useT();
  const extension = fileIdentity(attachment.name).extension.slice(1).toUpperCase();
  return <div className="material-file-row material-file-header nodrag nopan" data-file-header={attachment.id}
    onDoubleClick={event => event.stopPropagation()}>
    <FileIdentity name={attachment.name} mime={attachment.type} />
    <div className="material-file-details min-w-0 flex-1">
      <div className="material-file-name" data-tooltip={attachment.name} data-tooltip-overflow>{attachment.name}</div>
      <div className="material-file-meta">
        {extension && <span>{extension}</span>}
        {fileSizeLabel(attachment.size) && <span>{fileSizeLabel(attachment.size)}</span>}
        {attachment.isExtracting && <span className="text-accent">{t('attach.extracting')}</span>}
        {attachment.numPages != null && <span>{attachment.numPages}p</span>}
        {statusRef && <span ref={statusRef} />}
      </div>
    </div>
    {children}
    {!isViewerMode && onRemove && <button type="button" data-export-omit="edit" onClick={event => { event.stopPropagation(); onRemove(); }}
      aria-label={t('actions.removeAttachment')} data-tooltip={t('actions.removeAttachment')}
      className="w-8 h-8 shrink-0 rounded-control flex items-center justify-center text-ink-faint hover:bg-wash hover:text-red-500">
      <X size={15} strokeWidth={1.75} />
    </button>}
  </div>;
}
