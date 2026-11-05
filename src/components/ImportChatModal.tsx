import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useRef, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import type { ImportableConversation } from '../lib/import-chat';
import { importChatConversations } from '../lib/export';
import { useT, fmt } from '../i18n';

// Conversation picker for ChatGPT/Claude exports: each checked conversation
// becomes its own canvas.
export default function ImportChatModal({
  conversations,
  onClose,
  onDone,
}: {
  conversations: ImportableConversation[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const layerRef = useRef<HTMLDivElement>(null);
  useDismissableLayer({ open: true, refs: [layerRef], onDismiss: onClose, modal: true, dismissOnOutside: !busy, dismissOnEscape: !busy });

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const allSelected = checked.size === conversations.length;

  const doImport = async () => {
    if (checked.size === 0 || busy) return;
    setBusy(true);
    await importChatConversations([...checked].sort((a, b) => a - b).map((i) => conversations[i]));
    setBusy(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/30 flex items-center justify-center p-6">
      <div
        ref={layerRef} role="dialog" aria-modal="true" aria-label={t('import.title')} tabIndex={-1}
        className="bg-card border border-line rounded-panel shadow-lg w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-line flex items-start justify-between gap-4">
          <div>
            <h2 className="text-section font-semibold text-ink">{t('import.title')}</h2>
            <p className="text-control text-ink-muted mt-1">{t('import.subtitle')}</p>
          </div>
          <button disabled={busy} onClick={onClose} className="text-ink-faint hover:text-ink transition-colors shrink-0 mt-0.5">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-6 py-2 border-b border-line/60">
          <label className="flex items-center gap-2 text-control text-ink-muted cursor-pointer select-none py-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setChecked(allSelected ? new Set() : new Set(conversations.map((_, i) => i)))}
              className="rounded-control border-line text-accent focus:ring-accent w-3.5 h-3.5"
            />
            {t('import.selectAll')}
            <span className="ml-auto text-meta text-ink-faint uppercase tracking-wider">{conversations[0]?.source}</span>
          </label>
        </div>

        <ul className="flex-1 overflow-y-auto py-1">
          {conversations.map((c, i) => (
            <li key={i}>
              <label className="flex items-center gap-3 px-6 py-2 hover:bg-wash transition-colors cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checked.has(i)}
                  onChange={() => toggle(i)}
                  className="rounded-control border-line text-accent focus:ring-accent w-3.5 h-3.5 shrink-0"
                />
                <MessageSquare size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" />
                <span className="text-control text-ink truncate flex-1">{c.title}</span>
                <span className="text-meta text-ink-faint shrink-0">{fmt(t('import.messages'), { n: c.messageCount })}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="px-6 py-4 border-t border-line flex justify-end gap-2">
          <button disabled={busy} onClick={onClose} className="text-control text-ink-muted hover:text-ink px-4 py-2 rounded-control hover:bg-wash transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void doImport()}
            disabled={checked.size === 0 || busy}
            className="text-control bg-action hover:bg-action-strong text-white px-5 py-2 rounded-control transition-colors disabled:opacity-30"
          >
            {busy ? '…' : fmt(t('import.confirm'), { n: checked.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
