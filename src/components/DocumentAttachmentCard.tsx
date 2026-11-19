import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Attachment } from '../types';
import { useT } from '../i18n';
import { hasNativeDocxSource, isDocxDocument } from '../lib/document-copy';
import { isViewerMode } from '../lib/viewer';
import FileAttachmentHeader from './FileAttachmentHeader';
import DocumentRichBody from './DocumentRichBody';
const SuperDocEditor = lazy(() => import('./SuperDocEditor'));
const PdfDocumentView = lazy(() => import('./PdfDocumentView'));

export default function DocumentAttachmentCard({ nodeId, attachment, fill, onRemove, onAnnotationEditingChange, onNativeEditingChange, actionsHost }: {
  nodeId: string; attachment: Attachment; fill?: boolean;
  onRemove: () => void;
  onAnnotationEditingChange?: (active: boolean) => void;
  onNativeEditingChange?: (attachmentId: string, active: boolean) => void;
  actionsHost?: HTMLElement | null;
}) {
  const t = useT();
  const cardRef = useRef<HTMLElement>(null);
  const [statusHost, setStatusHost] = useState<HTMLSpanElement | null>(null);
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
    className={`min-w-0 ${fill ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : ''}`}
    onDoubleClick={event => event.stopPropagation()}>
    <FileAttachmentHeader attachment={attachment} onRemove={onRemove} statusRef={setStatusHost} />
    <Suspense fallback={<p className="text-control text-ink-faint">{t('reader.loading')}</p>}>
      {attachment.type === 'application/pdf'
        ? <PdfDocumentView nodeId={nodeId} attachment={attachment} compact onEditingChange={onAnnotationEditingChange} actionsHost={actionsHost} statusHost={statusHost} />
        : nativeDocx
          ? <SuperDocEditor nodeId={nodeId} attachment={attachment} compact readOnly={isViewerMode}
            onEditingChange={onNativeEditingChange} actionsHost={actionsHost} statusHost={statusHost} />
          : <div data-document-body={attachment.id}>
            {!isViewerMode && isDocx && <p className="text-control text-ink-faint mb-3">{t('document.legacySource')}</p>}
            <DocumentRichBody attachment={attachment} />
          </div>}
    </Suspense>
  </section>;
}
