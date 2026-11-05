import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { whyBridge, hasWhy } from '../../lib/why-bridge';
import { recallTerms } from '../../lib/recall';
import { expandTerms, topicsOf, TOPIC_BAR } from '../../lib/topics';
import { judgeAvailable } from '../../lib/judge';
import { useUiStore } from '../../lib/ui-store';
import { useProjects } from '../../store/projects';
import { HitCards } from '../ui/RecallResults';
import { useT, fmt } from '../../i18n';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';
import { isImeComposing } from '../../utils';

// On demand, for one node: the past conversations related to it. One row
// of chips — the node's own terms (hollow) and the topics it is about
// (solid; the judge picks them when there is one, the person can pick by
// hand) — and one button that asks the model for more terms. Results are
// cards with the two actions; nothing here enters the context by itself.

const LIMIT = 40;
const SHOWN = 6;
const keyOf = (h: WhyFindHit) => `${h.session}#${h.turn}`;

export default function RelatedSection({ question, answer }: { question: string; answer: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<string[]>(() => recallTerms(question));
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const addRef = useRef<HTMLDivElement>(null);
  const [suggested, setSuggested] = useState<{ term: string; count: number }[] | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [table, setTable] = useState<WhyTopics['topics'] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [judged, setJudged] = useState(false);
  const [hits, setHits] = useState<(WhyFindHit & { topics?: Record<string, number> })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeId = useProjects((s) => s.activeId);
  const judgeCfg = useUiStore((s) => s.judge);
  const hasJudge = judgeAvailable(judgeCfg);

  // the topic table, and the judge's pick of the node's topics, once the section opens
  useEffect(() => {
    if (!open || table) return;
    const b = whyBridge(); if (!b) return;
    let alive = true;
    b.topics().then(async (i) => {
      if (!alive) return;
      const topics = i.labeled ? i.topics : [];
      setTable(topics);
      if (topics.length && hasJudge && !judged) {
        setJudged(true);
        try { const of = await topicsOf(`${question}\n\n${answer}`, topics); if (alive) setPicked(topics.filter((x) => (of[x.id] ?? 0) >= TOPIC_BAR).map((x) => x.id)); } catch { /* by hand then */ }
      }
    }).catch(() => setTable([]));
    return () => { alive = false; };
  }, [open, table, hasJudge, judged, question, answer]);

  useEffect(() => {
    if (!open) return;
    const b = whyBridge(); if (!b) return;
    if (!terms.length && !picked.length) { setHits([]); return; }
    let alive = true;
    setBusy(true);
    const id = window.setTimeout(async () => {
      const found = new Map<string, WhyFindHit & { topics?: Record<string, number>; score: number }>();
      const add = (h: WhyFindHit & { topics?: Record<string, number> }, w: number) => {
        if (h.runner === 'thoughtdag' && h.session === activeId) return;
        const k = keyOf(h);
        const cur = found.get(k);
        if (cur) { cur.score += w; if (h.topics) cur.topics = { ...cur.topics, ...h.topics }; } else found.set(k, { ...h, score: w });
      };
      await Promise.all([
        ...terms.map((term) => b.find(term, { limit: 30 }).then((r) => r.hits.forEach((h) => add(h, 1))).catch(() => undefined)),
        picked.length ? b.byTopic(picked, { limit: 40 }).then((r) => r.hits.forEach((h) => add(h, 1))).catch(() => undefined) : Promise.resolve(),
      ]);
      if (!alive) return;
      setHits([...found.values()].sort((a, c) => c.score - a.score || (c.at ?? '').localeCompare(a.at ?? '')).slice(0, LIMIT));
      setBusy(false);
    }, 300);
    return () => { alive = false; window.clearTimeout(id); };
  }, [open, terms, picked, activeId]);

  const addTerm = (term: string) => { const v = term.trim(); if (!v || terms.some((x) => x.toLowerCase() === v.toLowerCase())) return; setTerms([...terms, v]); setSuggested((s) => s?.filter((x) => x.term !== v) ?? null); };
  const finishAdding = () => { addTerm(input); setInput(''); setAdding(false); };
  const termEdit = useInlineEditDismiss({
    active: open && adding, ref: addRef, onOutside: finishAdding,
    onCancel: () => { setInput(''); setAdding(false); },
  });
  if (!hasWhy()) return null;
  const expand = async () => {
    setExpanding(true); setError(null);
    try { setSuggested(await expandTerms(question, answer, terms)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setExpanding(false); }
  };
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const shown = all ? hits ?? [] : (hits ?? []).slice(0, SHOWN);
  const nameOf = (id: string) => table?.find((x) => x.id === id)?.name ?? id;

  return (
    <section className="px-4 py-3 border-b border-line" data-related-section>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left" data-related-toggle>
        {open ? <ChevronDown size={14} strokeWidth={1.75} className="text-ink-faint" /> : <ChevronRight size={14} strokeWidth={1.75} className="text-ink-faint" />}
        <Link2 size={14} strokeWidth={1.75} className="text-accent" />
        <span className="text-control font-medium text-ink flex-1">{t('panel.related')}</span>
        {open && hits && <span className="text-meta text-ink-faint font-mono" data-related-count>{fmt(t('panel.relatedCount'), { n: hits.length })}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div ref={addRef} onBlur={termEdit.onBlur} className="flex flex-wrap items-center gap-1" data-related-chips>
            {terms.map((term) => (
              <span key={term} className="inline-flex items-center gap-1 text-control px-2 py-0.5 rounded-tag border border-line bg-wash text-ink" data-related-term={term}>
                {term}<button onClick={() => setTerms(terms.filter((x) => x !== term))} className="text-ink-faint hover:text-ink"><X size={10} /></button>
              </span>
            ))}
            {picked.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 text-control px-2 py-0.5 rounded-tag border border-accent/40 bg-accent/10 text-accent" data-related-topic={id} aria-pressed="true">
                {nameOf(id)}<button onClick={() => togglePick(id)} className="hover:text-ink"><X size={10} /></button>
              </span>
            ))}
            {adding ? (
              <input
                value={input}
                autoFocus
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isImeComposing(e)) { e.preventDefault(); e.stopPropagation(); finishAdding(); } }}
                placeholder={t('panel.relatedTermPlaceholder')}
                className="text-control bg-transparent border-b border-accent focus:outline-none px-1 py-0.5 w-[90px] text-ink placeholder:text-ink-faint"
                data-related-input
              />
            ) : (
              <button onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 text-control px-2 py-0.5 rounded-tag border border-dashed border-line text-ink-faint hover:text-ink hover:border-line-strong" data-related-add><Plus size={10} /> {t('panel.relatedAddChip')}</button>
            )}
            <button onClick={() => void expand()} disabled={expanding} className="ml-auto text-control text-accent hover:bg-accent/10 px-1.5 py-0.5 rounded-tag disabled:opacity-50 flex items-center gap-1" data-related-expand>
              {expanding ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} strokeWidth={1.75} />} {expanding ? t('panel.relatedExpanding') : t('panel.relatedExpandBtn')}
            </button>
            {adding && (
              <div className="flex w-full flex-wrap items-center gap-1 pt-1" data-related-topic-picker>
                <span className="text-control text-ink-faint">{t('panel.relatedPickTopic')}</span>
                {(table ?? []).filter((x) => !picked.includes(x.id)).map((x) => (
                  <button key={x.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { togglePick(x.id); finishAdding(); }} title={x.description} className="text-control px-2 py-0.5 rounded-tag border border-line text-ink-muted hover:bg-wash" data-related-topic-option={x.id}>{x.name}</button>
                ))}
              </div>
            )}
          </div>
          {suggested && (
            <div className="flex flex-wrap items-center gap-1" data-related-suggested>
              {suggested.length > 0 && <p className="w-full text-control text-ink-faint">{t('panel.relatedSuggested')}</p>}
              {suggested.length === 0 && <span className="text-control text-ink-faint">{t('panel.relatedNoSuggest')}</span>}
              {suggested.map((s) => (
                <button key={s.term} onClick={() => addTerm(s.term)} className="text-control px-2 py-0.5 rounded-tag border border-dashed border-accent/50 text-accent hover:bg-accent/10" data-related-suggest={s.term}>+ {s.term} ({s.count})</button>
              ))}
            </div>
          )}
          {error && <p className="text-control text-red-500">{error}</p>}
          <div className="nowheel">
            {busy && <div className="text-control text-ink-faint flex items-center gap-1 px-1"><Loader2 size={10} className="animate-spin" /> {t('recall.searching')}</div>}
            {!busy && hits && hits.length === 0 && (terms.length > 0 || picked.length > 0) && <p className="text-control text-ink-faint italic px-1" data-related-none>{t('panel.relatedNone')}</p>}
            {hits && hits.length > 0 && <HitCards hits={shown} />}
            {hits && hits.length > SHOWN && (
              <p className="text-control text-ink-faint px-1 mt-1">{all ? '' : `${fmt(t('panel.relatedMore'), { n: hits.length - SHOWN })} · `}<button onClick={() => setAll((v) => !v)} className="text-accent hover:underline" data-related-all>{all ? t('panel.relatedFewer') : t('panel.relatedAll')}</button></p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
