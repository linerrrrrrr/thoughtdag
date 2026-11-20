import { useRef, useState } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import { fmt, useT } from '../i18n';
import type { Attachment } from '../types';
import { FILE_INPUT_ACCEPT } from '../lib/attachments';
import { fileSizeLabel } from '../lib/file-identity';
import FileIdentity from './FileIdentity';
import { nodeImportScope, removePendingAttachmentFile, usePendingAttachmentFiles, type PendingAttachmentFile } from '../lib/node-file-import';
import { useStore } from '../store';
import QuestionAttachmentDialog from './QuestionAttachmentDialog';
import './QuestionAttachments.css';

export function QuestionFilePicker({ onAttach }: { onAttach: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const t = useT();
  return <>
    <button type="button" className="question-attach-button" onClick={() => input.current?.click()}
      aria-label={t('landing.attach')} data-tooltip={t('landing.attach')}><Paperclip size={17} aria-hidden /></button>
    <input ref={input} hidden type="file" multiple accept={FILE_INPUT_ACCEPT}
      onChange={event => { onAttach(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
  </>;
}

interface TrayProps {
  scopeKey: string;
  files?: Attachment[];
  pendingFiles: PendingAttachmentFile[];
  onRemove: (id: string) => void;
  onSave: (id: string, patch: Partial<Attachment>) => void;
}

function QuestionAttachmentTile({ file, onOpen, onRemove }: {
  file: Attachment | PendingAttachmentFile;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const attachment = 'content' in file ? file : undefined;
  const busy = !attachment || !!attachment.isExtracting;
  const image = attachment?.type.startsWith('image/') &&
    (attachment.thumbnailUrl || (attachment.content && `data:${attachment.type};base64,${attachment.content}`));
  const detail = !attachment ? t('attach.readingFile') : attachment.isExtracting ? t('attach.extracting')
    : attachment.numPages != null ? fmt(t('attach.pages'), { n: attachment.numPages }) : fileSizeLabel(attachment.size);
  const contents = <>
    <span className="question-attachment-art" aria-hidden="true">
      {image ? <img src={image} alt="" /> : busy ? <Loader2 size={19} className="animate-spin" /> : <FileIdentity name={file.name} />}
    </span>
    <span className="question-file-copy">
      <span className="question-attachment-name text-control">{file.name}</span>
      <span className="question-attachment-detail text-meta" role={busy ? 'status' : undefined}
        aria-label={busy ? `${file.name} · ${detail}` : undefined}>{detail}</span>
    </span>
  </>;
  return <div className="question-attachment" data-question-attachment={attachment?.id}
    data-pending-attachment={attachment ? undefined : file.id}>
    {attachment ? <button type="button" className="question-attachment-face" data-attachment-open data-export-reading-label
      aria-haspopup="dialog" aria-label={fmt(t('inputRegion.open'), { name: file.name })}
      data-tooltip={file.name} onClick={() => onOpen(file.id)}>{contents}</button>
      : <div className="question-attachment-face">{contents}</div>}
    <button type="button" data-attachment-remove className="question-attachment-remove"
      aria-label={`${t('actions.removeAttachment')} · ${file.name}`} data-tooltip={t('actions.removeAttachment')}
      onClick={() => onRemove(file.id)}><X size={13} aria-hidden /></button>
  </div>;
}

export function QuestionAttachmentTray({ scopeKey, files, pendingFiles = [], onRemove, onSave }: TrayProps) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = files?.find(file => file.id === openId);
  // The read queue and the owning composer publish their updates separately.
  const unread = pendingFiles.filter(pending => !files?.some(file => file.id === pending.id));
  const items = [...(files ?? []), ...unread];
  if (!items.length) return null;
  return <>
    <div className="question-attachments nodrag nopan nowheel" data-question-attachments role="group" aria-label={t('attach.title')}>
      {items.map(file =>
        <QuestionAttachmentTile key={file.id} file={file} onOpen={setOpenId} onRemove={onRemove} />)}
    </div>
    {opened && <QuestionAttachmentDialog key={opened.id} scopeKey={scopeKey} attachment={opened}
      onClose={() => setOpenId(null)} onSave={patch => onSave(opened.id, patch)} />}
  </>;
}

/** Both question editors edit the same node attachments. */
export default function QuestionAttachments({ nodeId }: { nodeId: string }) {
  const files = useStore(state => state.nodes.find(node => node.id === nodeId)?.data.attachments);
  const scope = nodeImportScope(nodeId);
  const pendingFiles = usePendingAttachmentFiles(scope);
  return <QuestionAttachmentTray scopeKey={nodeId} files={files} pendingFiles={pendingFiles}
    onRemove={id => { if (!removePendingAttachmentFile(scope, id)) useStore.getState().removeAttachment(nodeId, id); }}
    onSave={(id, patch) => {
      const store = useStore.getState();
      store.pushHistory();
      store.setAttachmentData(nodeId, id, patch);
      store.pushHistory();
    }} />;
}
