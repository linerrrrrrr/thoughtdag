import type { RefObject } from 'react';
import { Highlighter } from 'lucide-react';
import { useT } from '../../i18n';

export default function HighlighterButton({ active, onClick, buttonRef, className = '', disabled = false }: {
  active: boolean;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  className?: string;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      data-highlighter-toggle
      aria-label={t('highlight.pen')}
      aria-pressed={active}

      onClick={event => { event.stopPropagation(); onClick(); }}
      className={`highlighter-toggle nodrag nopan rounded-control flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-default ${className}`}
    >
      <Highlighter size={15} strokeWidth={1.75} />
    </button>
  );
}
