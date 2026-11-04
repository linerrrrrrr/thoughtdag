import { useRef, useState } from 'react';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useProjects } from '../store/projects';
import { createPortal } from 'react-dom';
import { Eye, Split, X } from 'lucide-react';
import { useStore } from '../store';
import { effectiveRoles } from '../lib/role-templates';
import { useUiStore } from '../lib/ui-store';
import { useI18n, useT, fmt } from '../i18n';

// Perspectives dialog: N roles, ONE mechanism, two run policies.
//   once   → each role answers the question once, blind to its siblings
//            (the rule-in/rule-out candidate pool)
//   follow → each role becomes a reviewer on a sliding watch edge that
//            auto-reruns whenever the thread grows (the old "attach
//            evaluator" is exactly this with N=1)
// Roles come from the template library (toggle chips) and/or free-form
// lines ("Name: prompt"). Used from the panel and from fan-out
// placeholder nodes instantiated out of paradigms.
export default function FanOutModal({
  parentId,
  initialQuestion,
  initialRoles,
  onClose,
}: {
  parentId: string;
  initialQuestion: string;
  initialRoles?: { name: string; prompt: string }[];
  onClose: () => void;
}) {
  const fanOut = useStore((s) => s.fanOut);
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const projectId = useProjects(s => s.activeId) ?? 'default';
  const draftKey = `fan-out:${projectId}:${parentId}`;
  const [saved] = useState(() => {
    try { return JSON.parse(useUiStore.getState().drafts[draftKey] ?? 'null') as { mode: 'once' | 'follow'; rounds: number; question: string; picked: string[]; customText: string } | null; }
    catch { return null; }
  });
  const [mode, setMode] = useState<'once' | 'follow'>(saved?.mode ?? 'once');
  const [rounds, setRounds] = useState(saved?.rounds ?? 1);
  const [question, setQuestion] = useState(saved?.question ?? initialQuestion);
  const [picked, setPicked] = useState<Set<string>>(new Set(saved?.picked ?? []));
  const [customText, setCustomText] = useState(
    saved?.customText ?? (initialRoles ?? []).map((r) => `${r.name}: ${r.prompt}`).join('\n')
  );
  const layerRef = useRef<HTMLDivElement>(null);
  const close = () => {
    useUiStore.getState().setDraft(draftKey, JSON.stringify({ mode, rounds, question, picked: [...picked], customText }));
    onClose();
  };
  useDismissableLayer({ open: true, refs: [layerRef], onDismiss: close, modal: true });

  const switchMode = (m: 'once' | 'follow') => {
    setMode(m);
    // Each mode has its natural task: the shared question vs a standing critique
    setQuestion(m === 'follow' ? t('fanout.critiqueInstruction') : initialQuestion);
  };

  const customRoles = customText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      return idx > 0
        ? { name: line.slice(0, idx).trim(), prompt: line.slice(idx + 1).trim() }
        : { name: line.slice(0, 24), prompt: line };
    });

  const roleLib = useUiStore((s) => s.roleLib);
  const library = effectiveRoles(lang, roleLib);
  const templateRoles = library.filter((tpl) => picked.has(tpl.id)).map((tpl) => ({
    name: tpl.name,
    prompt: tpl.prompt,
  }));

  const roles = [...templateRoles, ...customRoles];

  const run = () => {
    if (!question.trim() || roles.length === 0) return;
    void fanOut(parentId, question.trim(), roles, { follow: mode === 'follow', rounds });
    useUiStore.getState().setDraft(draftKey, '');
    onClose();
  };

  return createPortal((
    <div className="fixed inset-0 z-50 bg-ink/30 flex items-center justify-center p-6">
      <div ref={layerRef} role="dialog" aria-modal="true" aria-label={t('fanout.title')} tabIndex={-1} className="bg-card border border-line rounded-panel shadow-lg w-full max-w-lg flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink flex items-center gap-2">
              <Split size={16} strokeWidth={1.75} className="text-warm" /> {t('fanout.title')}
            </h2>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">{t('fanout.subtitle')}</p>
          </div>
          <button onClick={close} className="text-ink-faint hover:text-ink transition-colors shrink-0 mt-0.5">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          {/* Run policy: answer once (candidates) vs keep reviewing (watchers) */}
          <div>
            <div className="flex gap-1.5">
              {([
                { m: 'once' as const, icon: <Split size={14} strokeWidth={1.75} />, label: t('fanout.modeOnce') },
                { m: 'follow' as const, icon: <Eye size={14} strokeWidth={1.75} />, label: t('fanout.modeFollow') },
              ]).map(({ m, icon, label }) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`text-xs px-3 py-2 rounded-control transition-colors flex items-center gap-1.5 ${
                    mode === m
                      ? (m === 'follow' ? 'bg-watch/10 text-watch font-medium ring-1 ring-watch/30' : 'bg-warm/15 text-warm font-medium ring-1 ring-warm/30')
                      : 'bg-wash text-ink-muted hover:bg-line'
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
            <p className="text-2xs text-ink-faint mt-1.5 leading-relaxed">
              {mode === 'once' ? t('fanout.modeOnceHint') : t('fanout.modeFollowHint')}
            </p>
            {mode === 'follow' && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-2xs text-ink-muted">{t('fanout.rounds')}</span>
                {[1, 2, 3].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRounds(r)}
                    className={`text-2xs w-7 h-6 rounded-control transition-colors ${
                      rounds === r ? 'bg-watch/10 text-watch font-medium ring-1 ring-watch/30' : 'bg-wash text-ink-muted hover:bg-line'
                    }`}
                  >
                    {r}×
                  </button>
                ))}
                <span className="text-2xs text-ink-faint">{t('fanout.roundsHint')}</span>
              </div>
            )}
          </div>

          <div>
            <label className="text-2xs text-ink-faint uppercase tracking-wider font-medium block mb-1.5">{t(mode === 'follow' ? 'fanout.instruction' : 'fanout.question')}</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              className="w-full text-sm border border-line rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent bg-surface resize-none leading-relaxed"
            />
          </div>

          <div>
            <label className="text-2xs text-ink-faint uppercase tracking-wider font-medium block mb-1.5">{t('fanout.templates')}</label>
            <div className="flex flex-wrap gap-1.5">
              {library.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(tpl.id)) next.delete(tpl.id);
                    else next.add(tpl.id);
                    return next;
                  })}
                  className={`text-2xs px-2.5 py-1.5 rounded-tag transition-colors ${
                    picked.has(tpl.id) ? 'bg-warm/15 text-warm font-medium' : 'bg-wash hover:bg-line text-ink-muted'
                  }`}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-2xs text-ink-faint uppercase tracking-wider font-medium block mb-1.5">{t('fanout.custom')}</label>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              rows={4}
              placeholder={t('fanout.customPlaceholder')}
              className="w-full text-xs border border-line rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent bg-surface resize-y leading-relaxed font-mono"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-line flex justify-end gap-2">
          <button onClick={() => { useUiStore.getState().setDraft(draftKey, ''); onClose(); }} className="text-xs text-ink-muted hover:text-ink px-4 py-2 rounded-control hover:bg-wash transition-colors">
            {t('common.cancel')}
          </button>
          <button
            onClick={run}
            disabled={!question.trim() || roles.length === 0}
            className={`text-xs text-white px-5 py-2 rounded-control transition-colors disabled:opacity-30 ${
              mode === 'follow' ? 'bg-watch/90 hover:bg-watch' : 'bg-warm hover:bg-warm/90'
            }`}
          >
            {fmt(t(mode === 'follow' ? 'fanout.confirmFollow' : 'fanout.confirm'), { n: roles.length })}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
