import { useI18n, useT } from '../../i18n';

// Compact switch for standalone controls, full-width segments for settings menus.
export default function LangSwitch({ variant = 'compact' }: { variant?: 'compact' | 'menu' }) {
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  const t = useT();
  const inMenu = variant === 'menu';

  return (
    <div role="group" aria-label={t('lang.label')} className={`flex border border-line rounded-control overflow-hidden ${inMenu ? 'w-full text-control' : 'h-control-size items-center bg-card'}`}>
      {(['en', 'zh'] as const).map((l, i) => (
        <button
          type="button"
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={inMenu ? `flex-1 px-1 py-1.5 transition-colors ${i > 0 ? 'border-l border-line' : ''} ${
            lang === l ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-wash'
          }` : `w-8 h-full text-control font-medium transition-colors ${
            lang === l ? 'bg-action text-white' : 'text-ink-muted hover:bg-wash'
          }`}
        >
          {l === 'en' ? inMenu ? 'English' : 'EN' : inMenu ? '中文' : '中'}
        </button>
      ))}
    </div>
  );
}
