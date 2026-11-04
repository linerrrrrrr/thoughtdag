import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, Plus, Sparkles, Square, Tags, Trash2 } from 'lucide-react';
import { whyBridge, hasWhy } from '../../lib/why-bridge';
import { judgeCall } from '../../lib/judge';
import { proposeTopics, startLabeling, LABEL_CHUNK } from '../../lib/topics';
import { useUiStore } from '../../lib/ui-store';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';
import { HitCards } from './RecallResults';
import { useT, fmt } from '../../i18n';

// The topic table and its labelling job, on the memory page. The person
// names the topics (or takes the model's proposals), the judge labels
// every past turn in the host in the background, and each topic can be
// browsed here. Recall and the side panel's related conversations then
// reach turns by topic as well as by shared words.

type Draft = { id?: string; name: string; description: string };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DRAFT_KEY = 'memory-topics-edit';
const cachedDraft = (): Draft[] | null => {
  const raw = useUiStore.getState().drafts[DRAFT_KEY];
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => item && typeof item === 'object' && typeof item.name === 'string' && typeof item.description === 'string' && (item.id === undefined || typeof item.id === 'string')) ? parsed : null;
  } catch { return null; }
};

export default function TopicsPanel({ onOpened, onChanged }: { onOpened?: () => void; onChanged?: () => void }) {
  const t = useT();
  const judgeCfg = useUiStore((s) => s.judge);
  const canLabel = !!judgeCall(judgeCfg);
  const [info, setInfo] = useState<WhyTopics | null>(null);
  const [draft, setDraftState] = useState<Draft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const setDraft = (next: Draft[]) => {
    setDraftState(next);
    useUiStore.getState().setDraft(DRAFT_KEY, JSON.stringify(next), true);
  };
  const cancelEdit = () => { useUiStore.getState().setDraft(DRAFT_KEY, ''); setDraftState(null); };
  const { onBlur } = useInlineEditDismiss({ active: draft !== null, ref: editorRef, onOutside: () => setDraftState(null), onCancel: cancelEdit });
  const [proposing, setProposing] = useState(false);
  const [proposed, setProposed] = useState<Draft[] | null>(null);
  const [browse, setBrowse] = useState<{ id: string; hits: WhyFindHit[]; total: number } | { id: string; loading: true } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const b = whyBridge(); if (!b) return;
    try { setInfo(await b.topics()); } catch (e) { setError(msg(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const running = !!info?.status.running;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void refresh(), 1500);
    return () => { window.clearInterval(id); onChanged?.(); };
  }, [running, refresh, onChanged]);
  if (!hasWhy()) return null;

  const topics = info?.topics ?? [];
  const save = async (list: Draft[], fromEditor = false) => {
    if (saving) return;
    const b = whyBridge()!;
    setError(null);
    setSaving(true);
    try {
      await b.setTopics(list.filter((d) => d.name.trim()));
      if (fromEditor && useUiStore.getState().drafts[DRAFT_KEY] === JSON.stringify(list)) {
        useUiStore.getState().setDraft(DRAFT_KEY, '');
        setDraftState(null);
      }
      await refresh(); onChanged?.();
    } catch (e) { setError(msg(e)); } finally { setSaving(false); }
  };
  const propose = async () => {
    setProposing(true); setError(null);
    try { setProposed(await proposeTopics(topics.map((x) => x.name))); } catch (e) { setError(msg(e)); } finally { setProposing(false); }
  };
  const addProposed = async (items: Draft[]) => {
    await save([...topics.map((x) => ({ id: x.id, name: x.name, description: x.description })), ...items]);
    setProposed((p) => (p ?? []).filter((x) => !items.includes(x)));
  };
  const label = async () => {
    setError(null);
    try { await startLabeling(); await refresh(); } catch (e) { setError(msg(e)); }
  };
  const stop = async () => { try { await whyBridge()!.labelStop(); await refresh(); } catch (e) { setError(msg(e)); } };
  const open = async (id: string) => {
    if (browse && browse.id === id) { setBrowse(null); return; }
    setBrowse({ id, loading: true });
    try { const r = await whyBridge()!.byTopic([id], { limit: 60 }); setBrowse({ id, hits: r.hits, total: r.total }); } catch (e) { setError(msg(e)); setBrowse(null); }
  };
  const st = info?.status;
  const allLabeled = !!info && info.turns > 0 && info.labeled >= info.turns;

  return (
    <section className="mt-8 border-t border-line pt-5" data-topics-panel>
      <div className="flex items-center gap-2">
        <Tags size={14} strokeWidth={1.75} className="text-accent" />
        <span className="text-sm font-semibold text-ink">{t('topics.title')}</span>
        <span className="flex-1" />
        {!draft && (
          <>
            <button onClick={() => void propose()} disabled={proposing} className="text-xs px-2.5 py-1 rounded-control text-accent hover:bg-accent/10 disabled:opacity-50 flex items-center gap-1" data-topics-propose>
              {proposing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} strokeWidth={1.75} />} {proposing ? t('topics.proposing') : t('topics.propose')}
            </button>
            <button onClick={() => setDraft(cachedDraft() ?? (topics.length ? topics.map((x) => ({ id: x.id, name: x.name, description: x.description })) : [{ name: '', description: '' }]))} className="text-xs px-2.5 py-1 rounded-control text-ink-muted hover:bg-wash flex items-center gap-1" data-topics-edit>
              <Pencil size={12} strokeWidth={1.75} /> {t('topics.edit')}
            </button>
          </>
        )}
      </div>
      <p className="text-2xs text-ink-faint mt-0.5 mb-3 leading-relaxed max-w-[720px]">{t('topics.hint')}</p>

      {draft ? (
        <div ref={editorRef} onBlur={onBlur} className="space-y-1.5 max-w-[720px]" data-topics-editor>
          {draft.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <input autoFocus={i === 0} value={d.name} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={t('topics.name')} className="w-[180px] bg-wash border border-line rounded-control px-2 py-1 text-xs text-ink" data-topic-name />
              <input value={d.description} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder={t('topics.description')} className="flex-1 bg-wash border border-line rounded-control px-2 py-1 text-xs text-ink" data-topic-description />
              <button onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="text-ink-faint hover:text-red-500 p-1" title={t('topics.remove')}><Trash2 size={12} strokeWidth={1.75} /></button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => setDraft([...draft, { name: '', description: '' }])} className="text-xs px-2 py-1 rounded-control text-ink-muted hover:bg-wash flex items-center gap-1" data-topics-add><Plus size={12} /> {t('topics.add')}</button>
            <span className="flex-1" />
            <button onClick={cancelEdit} className="text-xs px-3 py-1 rounded-control text-ink-muted hover:bg-wash">{t('topics.cancel')}</button>
            <button onClick={() => void save(draft, true)} disabled={saving} className="text-xs px-3 py-1 rounded-control bg-action text-white hover:bg-action-strong disabled:opacity-40" data-topics-save>{t('topics.save')}</button>
          </div>
        </div>
      ) : topics.length === 0 ? (
        <p className="text-xs text-ink-faint italic" data-topics-none>{t('topics.none')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" data-topics-list>
          {topics.map((x) => (
            <button key={x.id} onClick={() => void open(x.id)} title={x.description} className={`text-xs px-2.5 py-1 rounded-tag border transition-colors ${browse?.id === x.id ? 'bg-accent/10 border-accent/40 text-accent' : 'border-line text-ink hover:bg-wash'}`} data-topic-chip={x.id}>
              {x.name} <span className="text-ink-faint font-mono">{fmt(t('topics.count'), { n: x.count })}</span>
            </button>
          ))}
        </div>
      )}

      {proposed && !draft && (
        <div className="mt-3" data-topics-proposed>
          <div className="text-2xs text-ink-muted mb-1">{proposed.length ? t('topics.proposed') : t('topics.proposedNone')}</div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {proposed.map((p) => (
              <button key={p.name} onClick={() => void addProposed([p])} title={p.description} className="text-xs px-2.5 py-1 rounded-tag border border-dashed border-accent/50 text-accent hover:bg-accent/10" data-topic-proposed>+ {p.name}</button>
            ))}
            {proposed.length > 1 && <button onClick={() => void addProposed(proposed)} className="text-2xs text-accent hover:underline ml-1" data-topics-add-all>{t('topics.addAll')}</button>}
          </div>
        </div>
      )}

      {topics.length > 0 && !draft && info && (
        <div className="mt-3 flex items-center gap-3 text-2xs text-ink-muted flex-wrap" data-topics-status>
          <span data-topics-labeled>{fmt(t('topics.labeled'), { n: info.labeled, m: info.turns })}</span>
          {st?.running ? (
            <>
              <span className="flex items-center gap-1 text-accent"><Loader2 size={11} className="animate-spin" /> {fmt(t('topics.running'), { a: st.done, b: st.total })}</span>
              <button onClick={() => void stop()} className="text-xs px-2 py-0.5 rounded-control border border-line hover:bg-wash flex items-center gap-1" data-topics-stop><Square size={10} /> {t('topics.stop')}</button>
            </>
          ) : allLabeled ? (
            <span>{t('topics.labelDone')}</span>
          ) : (
            <button onClick={() => void label()} disabled={!canLabel} title={canLabel ? undefined : t('topics.needJudge')} className="text-xs px-2.5 py-1 rounded-control bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50" data-topics-label>
              {info.labeled ? fmt(t('topics.labelMore'), { n: LABEL_CHUNK }) : t('topics.label')}
            </button>
          )}
          {!canLabel && !st?.running && <span className="text-ink-faint">{t('topics.needJudge')}</span>}
          {st?.lastError && <span className="text-amber-600">{fmt(t('topics.lastError'), { e: st.lastError })}</span>}
        </div>
      )}
      {error && <p className="text-2xs text-red-500 mt-2" data-topics-error>{error}</p>}

      {browse && (
        <div className="mt-4" data-topics-browse>
          {'loading' in browse ? <Loader2 size={12} className="animate-spin text-ink-faint" /> : (
            <>
              <div className="text-2xs font-medium text-ink-muted px-1 pb-1">{fmt(t('topics.browse'), { name: topics.find((x) => x.id === browse.id)?.name ?? '', n: browse.total })}</div>
              {browse.hits.length === 0 ? <p className="text-xs text-ink-faint italic px-1">{t('topics.browseNone')}</p>
                : <HitCards hits={browse.hits} onOpened={onOpened} extra={(h) => { const p = (h as WhyFindHit & { topics?: Record<string, number> }).topics?.[browse.id]; return p !== undefined ? <span className="text-accent">{p.toFixed(2)}</span> : null; }} />}
            </>
          )}
        </div>
      )}
    </section>
  );
}
