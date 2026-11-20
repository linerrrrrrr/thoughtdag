import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, ImageDown, Share2, X } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { exportActiveProjectJson } from '../../lib/export';
import { useT } from '../../i18n';

// Share a canvas as a file or a thought-map image.
export default function ShareDialog() {
  const open = useUiStore((s) => s.shareDialogOpen);
  const t = useT();
  const [readonlyMark, setReadonlyMark] = useState(true);
  const close = () => useUiStore.getState().setShareDialogOpen(false);

  const layerRef = useRef<HTMLDivElement>(null);
  useDismissableLayer({ open, refs: [layerRef], onDismiss: close, modal: true });

  if (!open) return null;

  return createPortal((
    <div className="fixed inset-0 z-[80] bg-ink/25 flex items-center justify-center animate-fade-in" data-type-surface="portal" data-share-dialog>
      <div ref={layerRef} role="dialog" aria-modal="true" aria-label={t('share.dialogTitle')} tabIndex={-1} className="bg-surface rounded-panel shadow-lg border border-line w-[min(480px,calc(92*var(--ui-vw)))] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="text-title font-semibold text-ink flex items-center gap-2">
            <Share2 size={15} strokeWidth={1.75} className="text-accent" /> {t('share.dialogTitle')}
          </div>
          <button onClick={close} aria-label={t('common.close')} className="w-7 h-7 rounded-control text-ink-faint hover:bg-wash hover:text-ink flex items-center justify-center transition-colors">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        <p className="text-control text-ink-muted mb-3">{t('share.fileNote')}</p>
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => void exportActiveProjectJson({ sharedReadonly: readonlyMark })}
            data-share-fullfile
            data-tooltip={t('share.fullFile')}
            className="text-control px-3 py-1.5 rounded-control border border-line text-ink-muted hover:bg-wash hover:text-ink transition-colors flex items-center gap-1.5"
          >
            <FileDown size={13} strokeWidth={1.75} />
            {t('share.exportCanvas')}
          </button>
          <label data-cursor="action" className="flex items-center gap-1.5 text-control text-ink-muted select-none">
            <input type="checkbox" checked={readonlyMark} onChange={(e) => setReadonlyMark(e.target.checked)}
              className="accent-[color:var(--color-accent)]" />
            {t('share.readonlyMark')}
          </label>
        </div>

        {/* The thought-map console owns image export and captions. */}
        <div className="border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { close(); useUiStore.getState().setThoughtMapOpen(true); }}
              data-share-thought-map
              className="text-control px-3 py-1.5 rounded-control bg-accent/10 text-accent hover:bg-accent/20 transition-colors flex items-center gap-1.5 font-medium"
            >
              <ImageDown size={13} strokeWidth={1.75} />
              {t('tmap.export')}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
