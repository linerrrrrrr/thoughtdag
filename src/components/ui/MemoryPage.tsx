import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileDown, ExternalLink, Loader2, RefreshCw, Sparkles, Tags } from 'lucide-react';
import { useUiStore, toast } from '../../lib/ui-store';
import { useInlineEditDismiss } from '../../lib/use-inline-edit-dismiss';
import { whyBridge, hasWhy } from '../../lib/why-bridge';
import { docLines, lineNote, setDocText, migrateLegacyMemories, removeInbox, type ProfileKind, type LineNote } from '../../lib/profile';
import { buildDossier, updateDossier, rebuildDossier, editDossierSection, dossierEmpty, SECTION_ORDER, SECTION_KEY, AUTO_MERGE_PENDING, type DossierSection } from '../../lib/dossier';
import { openWhyLink } from '../../lib/atlas/live-mirror';
import { downloadFile } from '../../lib/export';
import AgentMemoryFiles from './AgentMemoryFiles';
import TopicsPanel from './TopicsPanel';
import RecallResults from './RecallResults';
import { useT, fmt } from '../../i18n';

// The memory page: settings, you, projects, sources. "You" is two
// documents (preferences, identity); "projects" is one dossier per topic,
// built from the labelled conversations and updated as they grow; the
// inbox holds project facts no topic claimed; sources are the read-only
// materials (the index, other agents' memory files). Search sits above
// everything and answers over all of it.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '');
const autoMerged = new Set<string>();
const EVIDENCE_KEY = { stated: 'mp.evidenceStated', inferred: 'mp.evidenceInferred', manual: 'mp.evidenceManual', folded: 'mp.evidenceFolded' } as const satisfies Record<LineNote['evidence'], string>;

function Toggle({ on, onChange, testId }: { on: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative w-9 h-5 rounded-control transition-colors shrink-0 ${on ? 'bg-accent' : 'bg-line-strong'}`} data-mp-toggle={testId}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 shape-circle bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function Fold({ label, open, onToggle, children, testId }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <div className="mt-2" data-mp-fold={testId}>
      <button onClick={onToggle} className="flex items-center gap-1.5 text-control text-ink-muted hover:text-ink py-1">
        {open ? <ChevronDown size={12} strokeWidth={1.75} className="text-ink-faint" /> : <ChevronRight size={12} strokeWidth={1.75} className="text-ink-faint" />}
        {label}
      </button>
      {open && <div className="pl-4 pt-1">{children}</div>}
    </div>
  );
}

// ── you: one document ──
function ProfileDrawer({ kind, onClose }: { kind: ProfileKind; onClose: () => void }) {
  const t = useT();
  const doc = useUiStore((s) => s.profile[kind]);
  const draftKey = `memory-profile-edit:${kind}`;
  const [text, setText] = useState(() => useUiStore.getState().drafts[draftKey] ?? docLines(doc).join('\n'));
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const cancel = () => { useUiStore.getState().setDraft(draftKey, ''); setEditing(false); };
  const { onBlur } = useInlineEditDismiss({ active: editing, ref: editorRef, onOutside: () => setEditing(false), onCancel: cancel });
  const lines = docLines(doc);
  return (
    <div className="border border-line rounded-content bg-surface px-4 py-3 mt-3" data-mp-profile-drawer={kind}>
      <div className="flex items-baseline gap-3 flex-wrap mb-2">
        <span className="text-title font-semibold text-ink">{t(kind === 'preferences' ? 'mp.preferences' : 'mp.identity')}</span>
        {doc.updatedAt && <span className="text-meta text-ink-faint">{fmt(t('mp.updatedAt'), { d: day(doc.updatedAt) })}</span>}
        <span className="flex-1" />
        {!editing && <button onClick={() => { setText(useUiStore.getState().drafts[draftKey] ?? lines.join('\n')); setEditing(true); }} className="text-control px-2.5 py-1 rounded-control border border-line hover:bg-wash" data-mp-profile-edit>{t('mp.edit')}</button>}
        {lines.length > 0 && <button onClick={() => downloadFile(`thoughtdag-${kind}.json`, JSON.stringify({ kind, lines, notes: doc.notes ?? [], updatedAt: doc.updatedAt, changelog: doc.changelog }, null, 2), 'application/json')} title={t('mp.export')} className="text-control px-2 py-1 rounded-control text-ink-faint hover:text-ink flex items-center gap-1"><FileDown size={12} strokeWidth={1.75} /> {t('common.export')}</button>}
        <button onClick={onClose} className="text-control px-2 py-1 rounded-control text-ink-muted hover:bg-wash">{t('common.close')}</button>
      </div>
      {editing ? (
        <div ref={editorRef} onBlur={onBlur}>
          <textarea autoFocus value={text} onChange={(e) => { setText(e.target.value); useUiStore.getState().setDraft(draftKey, e.target.value, true); }} rows={Math.max(4, text.split('\n').length + 1)} className="w-full bg-wash border border-accent rounded-control p-3 text-body text-ink resize-y focus:outline-none" data-mp-profile-text />
          <p className="text-control text-ink-faint mt-1">{t('mp.docHint')}</p>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={cancel} className="text-control px-3 py-1 rounded-control text-ink-muted hover:bg-wash">{t('common.cancel')}</button>
            <button onClick={() => { setDocText(kind, text, t('mp.editedNote')); useUiStore.getState().setDraft(draftKey, ''); setEditing(false); }} className="text-control px-3 py-1 rounded-control bg-action text-white" data-mp-profile-save>{t('mp.save')}</button>
          </div>
        </div>
      ) : lines.length === 0 ? (
        <p className="text-control text-ink-faint italic">{t('mp.docEmpty')}</p>
      ) : (
        <ul className="text-body text-ink list-disc pl-5 max-w-[68ch]" data-mp-profile-lines>
          {lines.map((l, i) => {
            // each line names where it came from, like a dossier sentence names its sources
            const n = lineNote(doc, l);
            return (
              <li key={i}>
                <span>{l}</span>
                {n && <span className="ml-1.5 align-baseline inline-flex font-mono text-meta text-ink-faint border border-line rounded-tag px-1 whitespace-nowrap" title={n.was ? fmt(t('mp.lineWas'), { t: n.was }) : undefined} data-mp-line-note={n.evidence}>{[n.from, day(n.at), t(EVIDENCE_KEY[n.evidence])].filter(Boolean).join(' · ')}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {doc.changelog.length > 0 && (
        <div className="mt-3 pt-2 border-t border-dashed border-line-strong text-control text-ink-muted space-y-0.5">
          <div className="text-ink-faint">{t('mp.changelog')}</div>
          {doc.changelog.slice(-6).reverse().map((c, i) => <div key={i}><span className="font-mono text-ink mr-2">{day(c.at)}</span>{c.note}</div>)}
        </div>
      )}
    </div>
  );
}

// ── projects: one dossier ──
function DossierDrawer({ topicId, name, onClose, onChanged, onOpened }: { topicId: string; name: string; onClose: () => void; onChanged: () => void; onOpened?: () => void }) {
  const t = useT();
  const [d, setD] = useState<WhyDossier | null | undefined>(undefined);
  const [busy, setBusy] = useState<'build' | 'update' | 'rebuild' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editSec, setEditSec] = useState<DossierSection | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const sectionDraftKey = (sec: DossierSection) => `memory-dossier-edit:${topicId}:${sec}`;
  const startEdit = (sec: DossierSection, text: string) => {
    setEditText(useUiStore.getState().drafts[sectionDraftKey(sec)] ?? text);
    setEditSec(sec);
  };
  const cancelEdit = () => {
    if (editSec) useUiStore.getState().setDraft(sectionDraftKey(editSec), '');
    setEditSec(null);
  };
  const { onBlur: onEditBlur } = useInlineEditDismiss({ active: editSec !== null, ref: editorRef, onOutside: () => setEditSec(null), onCancel: cancelEdit });
  const [summary, setSummary] = useState<WhyDossierSummary | null>(null);
  const load = useCallback(async () => {
    const b = whyBridge(); if (!b) return;
    try { const [dd, all] = await Promise.all([b.dossier(topicId), b.dossiers()]); setD(dd); setSummary(all.find((x) => x.topicId === topicId) ?? null); } catch (e) { setError(msg(e)); }
  }, [topicId]);
  useEffect(() => { void load(); }, [load]);
  const run = async (what: 'build' | 'update' | 'rebuild') => {
    setBusy(what); setError(null);
    try {
      const next = what === 'build' ? await buildDossier(topicId) : what === 'update' ? await updateDossier(topicId) : await rebuildDossier(topicId);
      setD(next); await load(); onChanged();
    } catch (e) { setError(msg(e)); } finally { setBusy(null); }
  };
  const saveSection = async () => {
    if (!editSec || saving) return;
    const sec = editSec;
    const key = sectionDraftKey(sec);
    const savedText = editText;
    setSaving(true);
    try {
      const next = await editDossierSection(topicId, sec, savedText.split('\n'));
      setD(next);
      if (useUiStore.getState().drafts[key] === savedText || useUiStore.getState().drafts[key] === undefined) {
        useUiStore.getState().setDraft(key, '');
        setEditSec((current) => current === sec ? null : current);
      }
      onChanged();
    } catch (e) { setError(msg(e)); } finally { setSaving(false); }
  };
  const openSource = async (key: string) => {
    const s = d?.sources[key]; if (!s || s.kind !== 'turn') return;
    if (await openWhyLink(s.open)) onOpened?.();
  };
  const built = !!d?.builtAt && !dossierEmpty(d);
  return (
    <div className="border border-line rounded-content bg-surface px-4 py-3 mt-3" data-mp-dossier={topicId}>
      <div className="flex items-baseline gap-3 flex-wrap mb-2">
        <span className="text-title font-semibold text-ink">{name}</span>
        <span className="text-meta text-ink-faint">{built ? `${fmt(t('mp.fromTurns'), { n: d!.covered.length })} · ${fmt(t('mp.updatedAt'), { d: day(d!.updatedAt) })}` : t('mp.notBuilt')}</span>
        <span className="flex-1" />
        {busy ? (
          <span className="text-control text-accent flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> {t('mp.building')}</span>
        ) : (
          <>
            {built
              ? <button onClick={() => void run('update')} disabled={!summary || (summary.newTurns === 0 && summary.pending === 0)} className="text-control px-2.5 py-1 rounded-control bg-action text-white disabled:opacity-40 flex items-center gap-1" data-mp-dossier-update><RefreshCw size={12} strokeWidth={1.75} /> {summary?.newTurns ? fmt(t('mp.updateN'), { n: summary.newTurns }) : t('mp.update')}</button>
              : <button onClick={() => void run('build')} className="text-control px-2.5 py-1 rounded-control bg-action text-white flex items-center gap-1" data-mp-dossier-build><Sparkles size={12} strokeWidth={1.75} /> {t('mp.build')}</button>}
            {built && <button onClick={() => void run('rebuild')} className="text-control px-2.5 py-1 rounded-control text-ink-muted hover:bg-wash">{t('mp.rebuild')}</button>}
          </>
        )}
        <button onClick={onClose} className="text-control px-2 py-1 rounded-control text-ink-muted hover:bg-wash">{t('common.close')}</button>
      </div>
      {error && <p className="text-control text-red-500 mb-2" data-mp-dossier-error>{error}</p>}
      {d === undefined ? <Loader2 size={14} className="animate-spin text-ink-faint" /> : (
        <div className="grid gap-3 max-w-[72ch]">
          {SECTION_ORDER.map((sec) => {
            const lines = d?.sections[sec] ?? [];
            if (!lines.length && built && editSec !== sec) return (
              <div key={sec} className="group"><div className="text-control font-semibold text-ink-faint tracking-wide flex items-center gap-2">{t(SECTION_KEY[sec])}<button onClick={() => startEdit(sec, '')} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-accent font-normal">{t('mp.edit')}</button></div><p className="text-control text-ink-faint italic">—</p></div>
            );
            if (!lines.length && !built) return null;
            return (
              <div key={sec} className="group" data-mp-dossier-section={sec}>
                <div className="text-control font-semibold text-ink-faint tracking-wide flex items-center gap-2">{t(SECTION_KEY[sec])}
                  {editSec !== sec && <button onClick={() => startEdit(sec, lines.map((l) => l.text).join('\n'))} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-accent font-normal">{t('mp.edit')}</button>}
                </div>
                {editSec === sec ? (
                  <div ref={editorRef} onBlur={onEditBlur}>
                    <textarea autoFocus value={editText} onChange={(e) => { setEditText(e.target.value); useUiStore.getState().setDraft(sectionDraftKey(sec), e.target.value, true); }} rows={Math.max(3, editText.split('\n').length + 1)} className="w-full bg-wash border border-accent rounded-control p-2 text-body text-ink resize-y focus:outline-none" />
                    <div className="flex justify-end gap-2 mt-1"><button onClick={cancelEdit} className="text-control px-3 py-1 rounded-control text-ink-muted hover:bg-wash">{t('common.cancel')}</button><button onClick={() => void saveSection()} disabled={saving} className="text-control px-3 py-1 rounded-control bg-action text-white disabled:opacity-40">{t('mp.save')}</button></div>
                  </div>
                ) : (
                  <ul className="text-body text-ink space-y-0.5">
                    {lines.map((s, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                        <span>{s.text}</span>
                        {s.src.map((k) => { const src = d!.sources[k]; return src ? <button key={k} onClick={() => void openSource(k)} title={`${src.title} · ${t('mp.sourceOpen')}`} className="inline-flex items-center gap-0.5 font-mono text-control text-ink-faint border border-line rounded-tag px-1 hover:text-accent hover:border-accent/40" data-mp-source>{src.runner} · {day(src.at)}{src.kind === 'turn' && <ExternalLink size={9} />}</button> : k.startsWith('filed:') ? <span key={k} className="font-mono text-control text-ink-faint border border-line rounded-tag px-1">{t('mp.filedTag')}</span> : null; })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {!built && !busy && <p className="text-control text-ink-faint italic">{summary?.labeled ? fmt(t('mp.buildHint'), { n: summary.labeled }) : t('dossier.nothingToRead')}</p>}
          {!!d?.pending.length && (
            <div className="text-control text-ink-muted border-t border-dashed border-line-strong pt-2" data-mp-dossier-pending>
              <div className="text-ink-faint mb-0.5">{t('mp.pendingList')} · {d.pending.length}</div>
              {d.pending.map((p) => <div key={p.id}><span className="font-mono text-ink mr-2">{day(p.at)}</span>{p.text}</div>)}
            </div>
          )}
          {!!d?.changelog.length && (
            <div className="text-control text-ink-muted border-t border-dashed border-line-strong pt-2">
              <div className="text-ink-faint mb-0.5">{t('mp.changelog')}</div>
              {d.changelog.slice(-6).reverse().map((c, i) => <div key={i}><span className="font-mono text-ink mr-2">{day(c.at)}</span>{c.note}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MemoryPage({ query, onOpened }: { query: string; onOpened: () => void }) {
  const t = useT();
  const recallEnabled = useUiStore((s) => s.recallEnabled);
  const setRecallEnabled = useUiStore((s) => s.setRecallEnabled);
  const memoryEnabled = useUiStore((s) => s.memoryEnabled);
  const setMemoryEnabled = useUiStore((s) => s.setMemoryEnabled);
  const profile = useUiStore((s) => s.profile);
  const inbox = useUiStore((s) => s.memoryInbox);
  const [openDoc, setOpenDoc] = useState<ProfileKind | null>(null);
  const [dossiers, setDossiers] = useState<WhyDossierSummary[] | null>(null);
  const [topicInfo, setTopicInfo] = useState<WhyTopics | null>(null);
  const [openDossier, setOpenDossier] = useState<string | null>(null);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [memFiles, setMemFiles] = useState<number | null>(null);
  const canWhy = hasWhy();
  useEffect(() => { migrateLegacyMemories(); }, []);
  // one counter drives every reload (children ask for one after they change something)
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    const b = whyBridge(); if (!b) return;
    let alive = true;
    void (async () => {
      try {
        const [ds, ti] = await Promise.all([b.dossiers(), b.topics()]);
        if (!alive) return;
        setDossiers(ds); setTopicInfo(ti);
        // a dossier with enough filed facts merges by itself, once per session
        for (const s of ds) if (s.built && s.pending >= AUTO_MERGE_PENDING && !autoMerged.has(s.topicId)) { autoMerged.add(s.topicId); void updateDossier(s.topicId).then(() => setTick((n) => n + 1)).catch(() => undefined); }
      } catch { if (alive) setDossiers([]); }
    })();
    return () => { alive = false; };
  }, [tick]);
  useEffect(() => {
    if (!sourcesOpen || memFiles !== null) return;
    whyBridge()?.memories().then((f) => setMemFiles(f.length)).catch(() => setMemFiles(0));
  }, [sourcesOpen, memFiles]);
  const previews = useMemo(() => ({ preferences: docLines(profile.preferences), identity: docLines(profile.identity) }), [profile]);
  const fileTo = async (id: string, topicId: string) => {
    const b = whyBridge(); const item = inbox.find((i) => i.id === id); if (!b || !item) return;
    try { await b.dossierPending(topicId, { text: item.text, ...(item.from ? { from: item.from } : {}) }); removeInbox(id); toast('success', fmt(t('mp.filed'), { name: topicInfo?.topics.find((x) => x.id === topicId)?.name ?? '' })); void refresh(); } catch (e) { toast('error', msg(e)); }
  };
  const searching = query.trim().length >= 2;

  return (
    <div data-memory-page>
      {searching && <RecallResults phrase={query} onOpened={onOpened} dossiers={dossiers ?? []} onOpenDossier={(id) => setOpenDossier(id)} />}
      {searching && openDossier && <DossierDrawer topicId={openDossier} name={dossiers?.find((x) => x.topicId === openDossier)?.name ?? ''} onClose={() => setOpenDossier(null)} onChanged={refresh} onOpened={onOpened} />}
      {!searching && (
        <div className="max-w-[860px]">
          {/* settings */}
          <section className="mb-6" data-mp-section="settings">
            <h4 className="text-title font-semibold uppercase tracking-wide text-ink-faint mb-1">{t('mp.settings')}</h4>
            <div className="border-t border-line">
              <div className="flex items-center gap-4 py-2.5 border-b border-line"><div className="flex-1 min-w-0"><div className="text-control text-ink font-medium">{t('mp.recallOn')}</div><div className="text-control text-ink-faint">{t('mp.recallOnHint')}</div></div><Toggle on={recallEnabled} onChange={setRecallEnabled} testId="recall" /></div>
              <div className="flex items-center gap-4 py-2.5 border-b border-line"><div className="flex-1 min-w-0"><div className="text-control text-ink font-medium">{t('mp.memoryOn')}</div><div className="text-control text-ink-faint">{t('mp.memoryOnHint')}</div></div><Toggle on={memoryEnabled} onChange={setMemoryEnabled} testId="memory" /></div>
              <div className="flex items-center gap-4 py-2.5 border-b border-line"><div className="flex-1 min-w-0"><div className="text-control text-ink font-medium">{t('mp.judgeRow')}</div><div className="text-control text-ink-faint">{t('mp.judgeRowHint')}</div></div><button onClick={() => useUiStore.getState().setApiKeyModalOpen(true, 'judge')} className="text-control text-accent hover:underline" data-judge-configure>{t('mp.open')}</button></div>
            </div>
          </section>

          {/* you */}
          <section className="mb-6" data-mp-section="you">
            <h4 className="text-title font-semibold uppercase tracking-wide text-ink-faint mb-1">{t('mp.you')}</h4>
            <div className="border-t border-line">
              {(['preferences', 'identity'] as ProfileKind[]).map((k) => (
                <button key={k} onClick={() => setOpenDoc(openDoc === k ? null : k)} className={`w-full grid grid-cols-[110px_minmax(0,1fr)_auto] gap-3 items-center py-2.5 border-b border-line text-left hover:bg-wash -mx-2 px-2 ${openDoc === k ? 'bg-wash' : ''}`} data-mp-doc={k}>
                  <span className="text-control text-ink font-medium">{t(k === 'preferences' ? 'mp.preferences' : 'mp.identity')}</span>
                  <span className="text-control text-ink-muted truncate">{previews[k].length ? previews[k].join(' · ') : t('mp.docEmpty')}</span>
                  <span className="text-meta text-ink-faint whitespace-nowrap">{profile[k].updatedAt ? fmt(t('mp.updatedAt'), { d: day(profile[k].updatedAt) }) : ''}</span>
                </button>
              ))}
            </div>
            {openDoc && <ProfileDrawer kind={openDoc} onClose={() => setOpenDoc(null)} />}
          </section>

          {/* projects */}
          <section className="mb-6" data-mp-section="projects">
            <div className="flex items-center gap-3 mb-1">
              <h4 className="text-title font-semibold uppercase tracking-wide text-ink-faint">{t('mp.projects')}</h4>
              <span className="flex-1" />
              {canWhy && topicInfo && topicInfo.topics.length > 0 && <span className="text-meta text-ink-faint" data-mp-label-state>{fmt(t('mp.labelState'), { n: topicInfo.labeled, m: topicInfo.turns })}{topicInfo.status.running ? ` · ${fmt(t('topics.running'), { a: topicInfo.status.done, b: topicInfo.status.total })}` : ''}</span>}
              {canWhy && <button onClick={() => setTopicsOpen((v) => !v)} className="text-control text-ink-muted hover:text-ink flex items-center gap-1 px-2 py-1 rounded-control hover:bg-wash" data-mp-edit-topics><Tags size={12} strokeWidth={1.75} /> {t('mp.editTopics')}</button>}
            </div>
            {!canWhy ? <p className="text-control text-ink-faint italic border-t border-line pt-2">{t('mp.needIndex')}</p> : (
              <>
                {topicsOpen && <div className="border border-line rounded-content px-4 pb-3 mb-3 bg-surface"><TopicsPanel onOpened={onOpened} onChanged={refresh} /></div>}
                <div className="border-t border-line">
                  {dossiers === null ? <div className="py-3"><Loader2 size={14} className="animate-spin text-ink-faint" /></div>
                    : dossiers.length === 0 ? <p className="text-control text-ink-faint italic py-2" data-mp-no-topics>{t('mp.noTopics')}</p>
                      : dossiers.map((s) => (
                        <button key={s.topicId} onClick={() => setOpenDossier(openDossier === s.topicId ? null : s.topicId)} className={`w-full grid grid-cols-[150px_minmax(0,1fr)_auto] gap-3 items-center py-2.5 border-b border-line text-left hover:bg-wash -mx-2 px-2 ${openDossier === s.topicId ? 'bg-wash' : ''}`} data-mp-project={s.topicId}>
                          <span className="text-control text-ink font-medium truncate">{s.name}</span>
                          <span className="text-control text-ink-muted truncate">{s.built ? s.lead : <span className="text-ink-faint italic">{t('mp.notBuilt')}{s.labeled ? ` · ${fmt(t('mp.labeledTurns'), { n: s.labeled })}` : ''}</span>}</span>
                          <span className="text-meta text-ink-faint whitespace-nowrap flex items-center gap-1.5">
                            {s.built && s.newTurns > 0 && <span className="px-1.5 py-px rounded-tag border border-warm/60 text-warm bg-warm/10">{fmt(t('mp.newTurns'), { n: s.newTurns })}</span>}
                            {s.pending > 0 && <span className="px-1.5 py-px rounded-tag border border-accent/40 text-accent bg-accent/10">{fmt(t('mp.pending'), { n: s.pending })}</span>}
                            {s.built && fmt(t('mp.updatedAt'), { d: day(s.updatedAt) })}
                          </span>
                        </button>
                      ))}
                </div>
                {openDossier && !searching && <DossierDrawer topicId={openDossier} name={dossiers?.find((x) => x.topicId === openDossier)?.name ?? ''} onClose={() => setOpenDossier(null)} onChanged={refresh} onOpened={onOpened} />}
              </>
            )}
            {inbox.length > 0 && (
              <Fold label={fmt(t('mp.inbox'), { n: inbox.length })} open={inboxOpen} onToggle={() => setInboxOpen((v) => !v)} testId="inbox">
                <div className="space-y-1.5">
                  {inbox.map((i) => (
                    <div key={i.id} className="flex items-center gap-2 text-control" data-mp-inbox-item>
                      <span className="flex-1 min-w-0 text-ink truncate">{i.text}</span>
                      <span className="text-meta text-ink-faint whitespace-nowrap">{i.from ? `${i.from} · ` : ''}{day(i.at)}</span>
                      {canWhy && !!topicInfo?.topics.length && (
                        <select defaultValue="" onChange={(e) => { if (e.target.value) void fileTo(i.id, e.target.value); }} className="text-control bg-wash border border-line rounded-control px-1.5 py-0.5" data-mp-inbox-file>
                          <option value="">{t('mp.fileTo')}</option>
                          {topicInfo.topics.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => removeInbox(i.id)} aria-label={t('actions.deleteInboxItem')} className="text-control object-action-danger px-1.5 py-0.5 rounded-tag">{t('common.delete')}</button>
                    </div>
                  ))}
                </div>
              </Fold>
            )}
          </section>

          {/* sources */}
          {canWhy && (
            <section className="mb-4" data-mp-section="sources">
              <h4 className="text-title font-semibold uppercase tracking-wide text-ink-faint mb-1">{t('mp.sources')}</h4>
              <Fold label={fmt(t('mp.sourcesN'), { n: 1 + (memFiles ?? 0) })} open={sourcesOpen} onToggle={() => setSourcesOpen((v) => !v)} testId="sources">
                <div className="text-control text-ink-muted mb-3 flex items-center gap-3"><span className="text-ink font-medium">{t('mp.index')}</span><span>{topicInfo ? fmt(t('mp.indexLine'), { n: topicInfo.turns }) : '…'}</span></div>
                <AgentMemoryFiles />
              </Fold>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
