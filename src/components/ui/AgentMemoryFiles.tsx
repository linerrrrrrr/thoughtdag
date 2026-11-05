import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Quote, Download } from 'lucide-react';
import { whyBridge } from '../../lib/why-bridge';
import { citeHit } from '../../lib/recall';
import { useStore } from '../../store';
import { toast, useUiStore } from '../../lib/ui-store';
import { generateId } from '../../utils';
import { useT, fmt } from '../../i18n';

// What the other agents on this machine wrote down for themselves, read-only:
// the memory files the why index holds, grouped by runner, each unfolding
// into its entries. An entry can be cited onto the canvas (a note with its
// source) or imported into ThoughtDAG's own library (an 'imported' entry
// naming where it came from) — the person picks; nothing syncs by itself.

const IMPORT_CAP = 800;

export default function AgentMemoryFiles() {
  const t = useT();
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const inbox = useUiStore((s) => s.memoryInbox);
  const setInbox = useUiStore((s) => s.setMemoryInbox);
  const [files, setFiles] = useState<WhyMemoryFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, WhyRecalledTurn | 'loading'>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const bridge = whyBridge();
    if (!bridge) { setFiles([]); return; }
    let alive = true;
    bridge.memories().then((m) => { if (alive) setFiles(m); }).catch((e: unknown) => { if (alive) { setFiles([]); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { alive = false; };
  }, []);

  const entryKey = (f: WhyMemoryFile, i: number) => `${f.id}#${i}`;
  const unfold = async (f: WhyMemoryFile, i: number) => {
    const k = entryKey(f, i);
    if (entries[k]) { setEntries((e) => { const n = { ...e }; delete n[k]; return n; }); return; }
    setEntries((e) => ({ ...e, [k]: 'loading' }));
    try { const r = await whyBridge()!.recall(f.id, i); setEntries((e) => ({ ...e, [k]: r })); }
    catch { setEntries((e) => { const n = { ...e }; delete n[k]; return n; }); }
  };
  const cite = async (f: WhyMemoryFile, i: number) => {
    const k = entryKey(f, i); setBusy(k);
    try { await citeHit({ session: f.id, turn: i, open: `thoughtdag://open?memory=${encodeURIComponent(f.file)}&entry=${i}` }, selectedNodeId); } finally { setBusy(null); }
  };
  const importEntry = async (f: WhyMemoryFile, i: number) => {
    const k = entryKey(f, i); setBusy(k);
    try {
      const r = await whyBridge()!.recall(f.id, i);
      const body = r.response.trim().length > IMPORT_CAP ? r.response.trim().slice(0, IMPORT_CAP).trimEnd() + ' …' : r.response.trim();
      const text = body ? `${r.question.trim()}\n${body}` : r.question.trim();
      setInbox([...inbox, { id: generateId(), text, at: new Date().toISOString(), from: `${r.runner} · ${r.title}` }]);
      toast('success', t('memory.importedOne'), 4000);
    } finally { setBusy(null); }
  };

  const groups = new Map<string, WhyMemoryFile[]>();
  for (const f of files ?? []) groups.set(f.runner, [...(groups.get(f.runner) ?? []), f]);

  return (
    <section className="flex flex-col min-h-0" data-agent-memories>
      <div className="pb-2">
        <div className="text-title font-semibold text-ink">{t('memory.agentFiles')}</div>
        <div className="text-control text-ink-faint mt-0.5">{t('memory.agentFilesHint')}</div>
      </div>
      {files === null && <div className="text-control text-ink-faint flex items-center gap-2 py-2"><Loader2 size={13} className="animate-spin" /></div>}
      {error && <p className="text-control text-red-500 py-1">{error}</p>}
      {files !== null && files.length === 0 && !error && <p className="text-control text-ink-faint italic py-2" data-agent-memories-none>{t('memory.agentFilesNone')}</p>}
      {[...groups.entries()].map(([runner, list]) => (
        <div key={runner} className="mb-3" data-agent-memories-runner={runner}>
          <div className="text-meta font-mono text-ink-faint px-1 pb-1 flex items-center gap-1.5"><span className="border border-line rounded-tag px-1 py-px">{runner}</span><span>{list.length}</span></div>
          <div className="space-y-1">
            {list.map((f) => {
              const isOpen = openFile === f.id;
              return (
                <div key={f.id} className="border border-line rounded-content bg-card" data-agent-memory-file={f.id}>
                  <button onClick={() => setOpenFile(isOpen ? null : f.id)} className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-wash/60 rounded-control transition-colors">
                    {isOpen ? <ChevronDown size={12} className="text-ink-faint shrink-0" /> : <ChevronRight size={12} className="text-ink-faint shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-control text-ink truncate">{f.title}</span>
                      <span className="block text-control text-ink-faint truncate font-mono">{f.cwd || f.file}</span>
                    </span>
                    <span className="text-meta text-ink-faint shrink-0">{fmt(t('memory.entriesN'), { n: f.entries })}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-line/60 px-2 py-1.5 space-y-0.5">
                      {f.headings.map((h, i) => {
                        const k = entryKey(f, i); const u = entries[k];
                        return (
                          <div key={k} className="rounded-content hover:bg-wash/60" data-agent-memory-entry={i}>
                            <div className="flex items-start gap-1.5 px-1.5 py-1">
                              <button onClick={() => void unfold(f, i)} className="flex-1 min-w-0 text-left text-control text-ink flex items-start gap-1.5">
                                {u ? <ChevronDown size={11} className="mt-0.5 shrink-0 text-ink-faint" /> : <ChevronRight size={11} className="mt-0.5 shrink-0 text-ink-faint" />}
                                <span className="break-words">{h}</span>
                              </button>
                              <button onClick={() => void cite(f, i)} disabled={busy === k} className="shrink-0 text-control text-accent hover:bg-accent/10 px-1.5 py-0.5 rounded-tag flex items-center gap-1 disabled:opacity-50" title={t('recall.cite')} data-agent-memory-cite>
                                <Quote size={10} strokeWidth={1.75} /> {t('recall.cite')}
                              </button>
                              <button onClick={() => void importEntry(f, i)} disabled={busy === k} className="shrink-0 text-control text-ink-muted hover:text-ink hover:bg-wash px-1.5 py-0.5 rounded-tag flex items-center gap-1 disabled:opacity-50" title={t('recall.import')} data-agent-memory-import>
                                <Download size={10} strokeWidth={1.75} /> {t('recall.import')}
                              </button>
                            </div>
                            {u && (
                              <div className="mx-1.5 mb-1.5 text-body text-ink-muted whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto border-l-2 border-line pl-2" data-agent-memory-body>
                                {u === 'loading' ? <Loader2 size={11} className="animate-spin" /> : u.response}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
