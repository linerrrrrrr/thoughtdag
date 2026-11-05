import type { RefObject } from 'react';
import { Highlighter } from 'lucide-react';
import { useT } from '../../i18n';

export default function HighlighterButton({ active, onClick, buttonRef, className = '' }: {
  active: boolean;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      ref={buttonRef}
      type="button"
      data-highlighter-toggle
      aria-label={t('highlight.pen')}
      aria-pressed={active}
      title={t(active ? 'highlight.penActive' : 'highlight.penHint')}
      onClick={event => { event.stopPropagation(); onClick(); }}
      className={`highlighter-toggle nodrag nopan rounded-control flex items-center justify-center transition-colors ${className}`}
    >
      <Highlighter size={15} strokeWidth={1.75} />
    </button>
  );
}
