import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import type { Attachment } from '../types';
import { useT } from '../i18n';
import { hasNativeDocxSource, isDocxDocument } from '../lib/document-copy';
import { isViewerMode } from '../lib/viewer';
import FileAttachmentHeader from './FileAttachmentHeader';
import DocumentRichBody from './DocumentRichBody';
const SuperDocEditor = lazy(() => import('./SuperDocEditor'));
const PdfDocumentView = lazy(() => import('./PdfDocumentView'));

function DocumentAttachmentCard({ nodeId, attachment, fill, short, onRemove, onAnnotationEditingChange, onNativeEditingChange, actionsHost }: {
  nodeId: string; attachment: Attachment; fill?: boolean; short?: boolean;
  onRemove: (nodeId: string, attachmentId: string) => void;
  onAnnotationEditingChange?: (attachmentId: string, active: boolean) => void;
  onNativeEditingChange?: (attachmentId: string, active: boolean) => void;
  actionsHost?: HTMLElement | null;
}) {
  const t = useT();
  const cardRef = useRef<HTMLElement>(null);
  const [statusHost, setStatusHost] = useState<HTMLSpanElement | null>(null);
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // React Flow listens for native mousedown events above the card. Let the
    // document and browser handle middle-button auto-scroll before stopping
    // that event from starting a competing canvas pan.
    const onMouseDown = (event: MouseEvent) => { if (event.button === 1) event.stopPropagation(); };
    card.addEventListener('mousedown', onMouseDown);
    return () => card.removeEventListener('mousedown', onMouseDown);
  }, []);
  const isDocx = isDocxDocument(attachment);
  const nativeDocx = hasNativeDocxSource(attachment);
  return <section ref={cardRef} data-document-card={attachment.id} data-document-fill={fill || undefined}
    className={`flex min-w-0 min-h-0 flex-col ${fill ? 'flex-auto' : ''}`}
    onDoubleClick={event => event.stopPropagation()}>
    <FileAttachmentHeader attachment={attachment} onRemove={() => onRemove(nodeId, attachment.id)} statusRef={setStatusHost}>
      {short && !isViewerMode && attachment.type === 'application/pdf' && <div className="shrink-0 empty:hidden" ref={setToolsHost} />}
    </FileAttachmentHeader>
    <Suspense fallback={<p className="text-control text-ink-faint">{t('reader.loading')}</p>}>
      {attachment.type === 'application/pdf'
        ? <PdfDocumentView nodeId={nodeId} attachment={attachment} compact onEditingChange={active => onAnnotationEditingChange?.(attachment.id, active)} actionsHost={actionsHost} statusHost={statusHost} toolsHost={toolsHost} />
        : nativeDocx
          ? <SuperDocEditor nodeId={nodeId} attachment={attachment} compact readOnly={isViewerMode}
            onEditingChange={onNativeEditingChange} actionsHost={actionsHost} statusHost={statusHost} />
          : <>
            {!isViewerMode && isDocx && <p className={`shrink-0 text-control text-ink-faint ${short ? 'truncate' : 'mb-3'}`}>{t('document.legacySource')}</p>}
            <div data-content-body data-document-body={attachment.id} className="min-h-0 flex-auto overflow-auto overscroll-contain nowheel nopan">
              <DocumentRichBody attachment={attachment} />
            </div>
          </>}
    </Suspense>
  </section>;
}

export default memo(DocumentAttachmentCard);
