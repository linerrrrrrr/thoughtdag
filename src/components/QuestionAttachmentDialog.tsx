import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize, Minimize, X } from 'lucide-react';
import type { Attachment } from '../types';
import { useProjects } from '../store/projects';
import { useT } from '../i18n';
import { isImeComposing } from '../utils';
import { questionAttachmentPatch, questionAttachmentText } from '../lib/question-attachment-edit';
import { isEditableDocument } from '../lib/document-copy';
import { isNotebook } from '../lib/notebook';
import { useSessionDraft } from '../lib/use-session-draft';
import { useUiStore } from '../lib/ui-store';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import './QuestionAttachmentDialog.css';

interface Props {
  attachment: Attachment;
  scopeKey?: string;
  onClose: () => void;
  onSave: (patch: Partial<Attachment>) => void;
}

export default function QuestionAttachmentDialog({ attachment, scopeKey = '', onClose, onSave }: Props) {
  const t = useT();
  const heading = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);
  const image = useRef<HTMLImageElement>(null);
  const [originalWidth, setOriginalWidth] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const isImage = attachment.type.startsWith('image/');
  const textLabel = isImage ? 'attach.imageDescription'
    : isEditableDocument(attachment) || isNotebook(attachment) || attachment.type === 'text/html'
      ? 'attach.modelText' : 'attach.fileText';
  const imageUrl = isImage && (attachment.content ? `data:${attachment.type};base64,${attachment.content}` : attachment.thumbnailUrl);
  const lastDot = attachment.name.lastIndexOf('.');
  const extension = lastDot > 0 ? attachment.name.slice(lastDot) : '';
  const stem = extension ? attachment.name.slice(0, lastDot) : attachment.name;
  const projectId = useProjects(state => state.activeId);
  const draftKey = JSON.stringify([projectId, scopeKey, attachment.id]);
  const nameKey = `question-attachment-name:${draftKey}`;
  const textKey = `question-attachment-text:${draftKey}`;
  const [name, setName] = useSessionDraft(nameKey, stem);
  const savedText = questionAttachmentText(attachment);
  const [text, setText] = useSessionDraft(textKey, savedText);
  const canSave = !!name.trim() && (name.trim() !== stem || text !== savedText);
  const discardAndClose = () => {
    useUiStore.getState().setDraft(nameKey, '');
    useUiStore.getState().setDraft(textKey, '');
    onClose();
  };
  const save = () => {
    if (!canSave) return;
    onSave(questionAttachmentPatch(attachment, name.trim() + extension, text));
    discardAndClose();
  };

  // The backdrop belongs to the modal too. Dismissing it must not dismiss
  // a question editor underneath or send the click through to the canvas.
  useDismissableLayer({ open: true, refs: [backdrop], modal: true, priority: 50,
    onDismiss: reason => { if (reason === 'escape') discardAndClose(); else onClose(); } });

  return createPortal(<div ref={backdrop} className="question-attachment-backdrop nodrag nopan nowheel"
    data-type-surface="portal" data-cursor="neutral"
    onPointerDown={event => { pressedBackdrop.current = event.target === event.currentTarget; event.stopPropagation(); }}
    onClick={event => {
      event.stopPropagation();
      if (pressedBackdrop.current && event.target === event.currentTarget) onClose();
    }}
    onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <div role="dialog" aria-modal="true" aria-labelledby={heading} data-question-attachment-dialog
      className="question-attachment-dialog" onKeyDown={event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isImeComposing(event)) {
          event.preventDefault();
          event.stopPropagation();
          save();
        }
      }}>
      <header>
        <h2 id={heading} className="text-title font-semibold truncate" data-tooltip={attachment.name} data-tooltip-overflow>{attachment.name}</h2>
        <button type="button" aria-label={t('common.close')} onClick={onClose} className="question-attachment-icon"><X size={18} aria-hidden /></button>
      </header>
      <div className="question-attachment-fields">
        {isImage && <div className="question-attachment-image-frame">
          {imageUrl && !imageFailed ? <>
            <div className="question-attachment-image-scroll" data-actual-size={!!originalWidth || undefined}>
              <img ref={image} src={imageUrl} alt={attachment.name} data-attachment-original onError={() => setImageFailed(true)}
                style={originalWidth ? { width: `calc(${originalWidth}px / var(--ui-scale))` } : undefined} />
            </div>
            <button type="button" aria-label={t(originalWidth ? 'attach.fitImage' : 'attach.actualSize')}
              data-tooltip={t(originalWidth ? 'attach.fitImage' : 'attach.actualSize')}
              className="question-attachment-icon" onClick={() => setOriginalWidth(originalWidth ? 0 : image.current?.naturalWidth ?? 0)}>
              {originalWidth ? <Minimize size={16} aria-hidden /> : <Maximize size={16} aria-hidden />}
            </button>
          </> : <p className="p-4 text-control text-ink-muted" role="status">{t('attach.imageUnavailable')}</p>}
        </div>}
        <label className="question-attachment-field text-control">
          <span>{t('attach.fileName')}</span>
          <span className="question-attachment-name-field">
            <input data-attachment-name value={name} aria-label={t('attach.fileName')} onChange={event => setName(event.target.value)} />
            {extension && <span aria-hidden="true">{extension}</span>}
          </span>
        </label>
        <label className="question-attachment-field text-control">
          <span>{t(textLabel)}</span>
          <textarea rows={isImage ? 2 : 9} value={text} data-attachment-text className="text-body"
            disabled={!!attachment.isExtracting} placeholder={attachment.isExtracting ? t('attach.extracting') : undefined}
            onChange={event => setText(event.target.value)} />
        </label>
      </div>
      <footer className="text-control">
        <button type="button" onClick={discardAndClose} className="hover:bg-wash text-ink-muted">{t('common.cancel')}</button>
        <button type="button" data-attachment-save disabled={!canSave} onClick={save}
          className="bg-action text-white hover:bg-action-strong disabled:opacity-40">{t('common.save')}</button>
      </footer>
    </div>
  </div>, document.body);
}
