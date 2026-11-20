import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { useT } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { hasWhy } from '../../lib/why-bridge';
import MemoryPage from './MemoryPage';

export default function MemoryManagerModal() {
  const t = useT();
  const open = useUiStore((s) => s.memoryManagerOpen);
  const setOpen = useUiStore((s) => s.setMemoryManagerOpen);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { setQuery(''); setOpen(false); };
  useDismissableLayer({ open, refs: [ref], onDismiss: close, modal: true });
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-ink/30 flex items-center justify-center p-6" data-type-surface="portal" data-memory-manager>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('memory.managerTitle')} tabIndex={-1} className="bg-surface border border-line rounded-panel shadow-lg w-full max-w-[980px] h-[min(680px,calc(90*var(--ui-vh)))] flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-line">
          <div className="flex-1 min-w-0">
            <div className="text-page font-semibold text-ink">{t('memory.managerTitle')}</div>
            <div className="text-control text-ink-muted mt-0.5">{t('mp.subtitle')}</div>
          </div>
          <button onClick={close} aria-label={t('common.close')} className="text-ink-faint hover:text-ink p-1.5 rounded-control hover:bg-wash transition-colors">
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        {hasWhy() && (
          <div className="px-5 py-2 border-b border-line shrink-0">
            <div className="flex items-center gap-1.5 border border-line rounded-content px-2.5 py-1 bg-card max-w-[520px]">
              <Search size={13} strokeWidth={1.75} className="text-ink-faint shrink-0" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('memory.searchPlaceholder')} aria-label={t('memory.searchPlaceholder')} className="text-control bg-transparent focus:outline-none w-full text-ink placeholder:text-ink-faint" />
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <MemoryPage query={query}
            onOpened={() => { close(); window.dispatchEvent(new CustomEvent('td:project-switched')); }}
            onConfigureJudge={() => { close(); useUiStore.getState().setApiKeyModalOpen(true, 'judge'); }} />
        </div>
      </div>
    </div>, document.body,
  );
}
