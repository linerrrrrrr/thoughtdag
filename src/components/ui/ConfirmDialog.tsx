import { useRef, useId } from 'react';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useUiStore } from '../../lib/ui-store';
import { useT } from '../../i18n';

export default function ConfirmDialog() {
  const request = useUiStore((s) => s.confirmRequest);
  const resolveConfirm = useUiStore((s) => s.resolveConfirm);
  const t = useT();

  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  useDismissableLayer({ open: !!request, refs: [ref], onDismiss: () => resolveConfirm(false), modal: true });

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/25 flex items-center justify-center animate-fade-in"
    >
      <div
        ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={request.title ? titleId : undefined} aria-describedby={messageId} tabIndex={-1}
        className="bg-card border border-line rounded-panel shadow-lg w-[380px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {request.title && (
          <h3 id={titleId} className="text-sm font-semibold text-ink mb-1.5">{request.title}</h3>
        )}
        <p id={messageId} className="text-sm text-ink-muted leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{request.message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={() => resolveConfirm(false)}
            autoFocus={request.danger}
            className="text-xs text-ink-muted hover:text-ink px-4 py-2 rounded-control hover:bg-wash transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => resolveConfirm(true)}
            autoFocus={!request.danger}
            className={`text-xs text-white px-4 py-2 rounded-control transition-colors ${
              request.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-action hover:bg-action-strong'
            }`}
          >
            {request.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
