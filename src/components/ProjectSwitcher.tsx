import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, Dna, FolderOpen, Loader2, Minimize2, PanelsTopLeft, Pencil, Plus, RefreshCw, Trash2, FileUp } from 'lucide-react';
import HarnessViewSwitch from './ui/HarnessViewSwitch';
import { useProjects, switchProject, createProject, renameProject, deleteProject, setProjectArchived, refreshProjectIndex } from '../store/projects';
import { useI18n } from '../i18n';
import { copyText, parseImportFile } from '../lib/export';
import ImportChatModal from './ImportChatModal';
import type { ImportableConversation } from '../lib/import-chat';
import { confirmDialog, toast } from '../lib/ui-store';
import { isImeComposing } from '../utils';
import { useT, t as ti, fmt } from '../i18n';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { useCanvasToolCard } from '../lib/use-canvas-tool-card';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';

const CanvasLibrary = lazy(() => import('./CanvasLibrary'));

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return ti('switcher.justNow');
  if (min < 60) return fmt(ti('switcher.minAgo'), { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return fmt(ti('switcher.hourAgo'), { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return fmt(ti('switcher.dayAgo'), { n: d });
  return new Date(ts).toLocaleDateString(useI18n.getState().lang === 'zh' ? 'zh-CN' : 'en-US');
}

function ProjectUuid({ id }: { id: string }) {
  const t = useT();
  const label = t('switcher.copyUuid');
  return (
    <button
      type="button"
      className="flex min-w-0 basis-full items-baseline gap-1 text-left text-meta text-ink-muted hover:text-accent focus-visible:text-accent"
      data-tooltip={label} aria-label={`${label} ${id}`}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(id).catch(() => toast('error', t('local.copyFailed')));
      }}
    >
      <span className="shrink-0">UUID</span>
      <code className="min-w-0 select-all [overflow-wrap:anywhere]">{id}</code>
    </button>
  );
}

export default function ProjectSwitcher({ onSwitched, children }: { onSwitched: () => void; children?: ReactNode }) {
  const t = useT();
  const projects = useProjects((s) => s.projects);
  const activeId = useProjects((s) => s.activeId);
  const switching = useProjects((s) => s.switching);
  const activeIsParadigm = projects.find((p) => p.id === activeId)?.kind === 'paradigm';
  const [requestedOpen, setOpen] = useState(false);
  const open = useCanvasToolCard('projects', requestedOpen, () => setOpen(false));
  const [libraryRequested, setLibraryRequested] = useState(false);
  const libraryOpen = useCanvasToolCard('canvas-library', libraryRequested, () => setLibraryRequested(false));
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) void refreshProjectIndex().catch(() => undefined); }, [open]);
  const panelPosition = useCanvasPanelPosition(open, 'left');
  // Windows and Linux shells: keep running in the tray when the window
  // closes (#77); the tray menu speaks the page's language
  const lang = useI18n((s) => s.lang);
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null);
  useEffect(() => {
    const tray = window.desktop?.tray;
    if (!tray) return;
    let alive = true;
    void tray({ labels: { open: ti('tray.open'), quit: ti('tray.quit') } }).then((r) => { if (alive) setCloseToTray(r.closeToTray); }).catch(() => undefined);
    return () => { alive = false; };
  }, [lang]);
  const [chatImport, setChatImport] = useState<ImportableConversation[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const active = projects.find((p) => p.id === activeId);
  const sorted = projects.filter((p) => !p.archived).sort((a, b) => b.updatedAt - a.updatedAt);
  const archived = projects.filter((p) => p.archived).sort((a, b) => b.updatedAt - a.updatedAt);

  const confirmDelete = async (p: (typeof projects)[number]) => {
    const ok = await confirmDialog({
      title: ti('confirm.deleteCanvasTitle'),
      message: fmt(ti('confirm.deleteNative'), { name: p.name }),
      confirmLabel: ti('common.delete'),
      danger: true,
    });
    if (ok) void deleteProject(p.id).then(onSwitched);
  };

  useDismissableLayer({ open, refs: [rootRef], onDismiss: () => setOpen(false), dismissOnFocusOutside: true });
  const commitRename = () => {
    const name = renameValue.trim();
    if (renamingId && name) void renameProject(renamingId, name);
    setRenamingId(null);
  };
  const renameEdit = useInlineEditDismiss({
    active: open && renamingId !== null, ref: renameRef,
    onOutside: commitRename, onCancel: () => setRenamingId(null),
  });

  const doSwitch = async (id: string) => {
    setOpen(false);
    await switchProject(id);
    onSwitched();
  };
  const openLibrary = () => {
    setOpen(false);
    setLibraryRequested(true);
  };

  return (
    // z-20: the open dropdown must cover the content palette below (both
    // live on the left edge; the palette is z-10)
    <div ref={rootRef} className="relative z-20 min-w-0 max-w-full" data-project-switcher>
      <div className="canvas-toolbar canvas-toolbar-main">
        <button
          ref={triggerRef}
          onClick={event => { if (event.detail <= 1) setOpen(!open); }}
          onDoubleClick={openLibrary}
          data-tooltip={active?.name} data-tooltip-overflow data-tooltip-icon-only aria-label={active?.name} aria-expanded={open}
          disabled={switching}
          className="canvas-toolbar-button canvas-project-button touch-manipulation disabled:opacity-60"
        >
          {switching
            ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin shrink-0 text-accent" />
            : activeIsParadigm
              ? <Dna size={16} strokeWidth={1.75} className="shrink-0 text-accent" />
              : <FolderOpen size={16} strokeWidth={1.75} className="shrink-0 text-ink-muted" />}
          <span className="truncate font-medium">{active?.name ?? '…'}</span>
          <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-faint" />
        </button>
        {/* inside the harness: the view switch shares this row (see HarnessViewSwitch) */}
        <HarnessViewSwitch />
        {children}
      </div>

      {open && (
        <div className="canvas-tool-panel canvas-tool-menu py-1.5 animate-fade-in" style={panelPosition} data-project-menu>
          <div className="px-3 pt-1 pb-0.5 text-meta text-ink-muted">{t('library.recentCanvases')}</div>
          <div className="max-h-[320px] overflow-y-auto">
            {sorted.map((p) => (
              <div
                key={p.id}
                data-cursor={renamingId === p.id || p.id === activeId ? 'neutral' : 'action'}
                className={`group flex flex-wrap items-center gap-x-1 px-3 py-2 hover:bg-wash transition-colors ${p.id === activeId ? 'bg-accent/5' : ''}`}
                onClick={() => { if (renamingId !== p.id && p.id !== activeId) void doSwitch(p.id); }}
              >
                {renamingId === p.id ? (
                  <input
                    ref={renameRef}
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isImeComposing(e)) {
                        e.preventDefault(); e.stopPropagation(); commitRename();
                      }
                    }}
                    onBlur={renameEdit.onBlur}
                    className="min-w-0 flex-1 text-control text-ink border border-accent/40 rounded-control px-2 py-1 bg-surface focus:outline-none"
                    data-project-name-editor
                  />
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className={`text-control truncate ${p.id === activeId ? 'text-accent font-medium' : 'text-ink'}`}>
                        {p.name}
                      </div>
                      <div className="text-meta text-ink-faint flex items-center gap-1.5">
                        <span>{relativeTime(p.updatedAt)}</span>
                      </div>
                    </div>
                    <button
                      aria-label={t('switcher.rename')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-ink p-1 rounded-control transition-all shrink-0"
                      onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); setRenameValue(p.name); }}
                    >
                      <Pencil size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      aria-label={t('confirm.deleteCanvasTitle')}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-control transition-all shrink-0 object-action-danger" data-icon-only
                      onClick={(e) => { e.stopPropagation(); void confirmDelete(p); }}
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      data-tooltip={t('switcher.archive')} aria-label={t('switcher.archive')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-amber-600 p-1 rounded-control transition-all shrink-0"
                      onClick={(e) => { e.stopPropagation(); void setProjectArchived(p.id, true).then(onSwitched); }}
                      data-archive-canvas
                    >
                      <Archive size={14} strokeWidth={1.75} />
                    </button>
                  </>
                )}
                <ProjectUuid id={p.id} />
              </div>
            ))}
            {archived.length > 0 && (
              <div className="border-t border-line mt-1 pt-1">
                <button type="button" className="w-full text-left px-3 py-2 text-control text-ink-muted hover:bg-wash flex items-center gap-2" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived} data-archived-canvases>
                  <Archive size={14} strokeWidth={1.75} /> {fmt(t('switcher.archivedCanvases'), { n: archived.length })}
                </button>
                {showArchived && archived.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-x-2 px-3 py-2 text-control text-ink-muted">
                    <span className="flex-1 truncate">{p.name}</span>
                    <button type="button" aria-label={t('switcher.restoreCanvas')} data-restore-canvas className="p-1 rounded-control hover:bg-wash hover:text-ink" onClick={() => { void setProjectArchived(p.id, false).then(() => doSwitch(p.id)); }}>
                      <ArchiveRestore size={14} strokeWidth={1.75} />
                    </button>
                    <ProjectUuid id={p.id} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-line mt-1 pt-1">
            <button type="button" data-open-canvas-library aria-haspopup="dialog" data-tooltip={t('library.shortcutHint')}
              className="w-full text-left px-3 py-2 text-control font-medium text-accent hover:bg-wash flex items-center gap-2"
              onClick={openLibrary}>
              <PanelsTopLeft size={15} strokeWidth={1.75} /> {t('library.open')}
              <ChevronRight size={14} strokeWidth={1.75} className="ml-auto" />
            </button>
            <button
              onClick={() => { setOpen(false); void createProject().then(onSwitched); }}
              className="w-full text-left px-3 py-2 text-control text-accent hover:bg-wash transition-colors flex items-center gap-2"
            >
              <Plus size={15} strokeWidth={1.75} /> {t('switcher.newCanvas')}
            </button>
            <button
              onClick={() => importFileRef.current?.click()}
              className="w-full text-left px-3 py-2 text-control text-ink-muted hover:bg-wash transition-colors flex items-center gap-2"
            >
              <FileUp size={15} strokeWidth={1.75} /> {t('switcher.importBackup')}
            </button>
            {window.desktop && (
              <button
                onClick={() => { setOpen(false); void window.desktop!.checkForUpdates(); }}
                className="w-full text-left px-3 py-2 text-control text-ink-muted hover:bg-wash transition-colors flex items-center gap-2"
                data-check-updates
              >
                <RefreshCw size={15} strokeWidth={1.75} /> {t('update.checkMenu')}
                {/* the one place that answers "which version am I on" at a glance */}
                <span className="ml-auto text-meta text-ink-faint">
                  v{new URLSearchParams(window.location.search).get('dv')}
                </span>
              </button>
            )}
            {window.desktop?.tray && closeToTray !== null && (
              <button
                onClick={() => {
                  const on = !closeToTray;
                  setCloseToTray(on);
                  void window.desktop!.tray!({ on }).then((r) => setCloseToTray(r.closeToTray)).catch(() => setCloseToTray(!on));
                }}
                className="w-full text-left px-3 py-2 text-control text-ink-muted hover:bg-wash transition-colors flex items-center gap-2"

                data-close-to-tray={closeToTray ? 'on' : 'off'}
              >
                <Minimize2 size={15} strokeWidth={1.75} /> {t('switcher.closeToTray')}
                {closeToTray && <Check size={14} strokeWidth={2} className="ml-auto text-accent" />}
              </button>
            )}
            <input
              ref={importFileRef}
              type="file"
              accept=".json,.jsonl,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  // Every failure path must surface — a silently swallowed
                  // rejection here reads as "the import does nothing".
                  void parseImportFile(f).then((r) => {
                    if (r.kind === 'own' && r.ok) { setOpen(false); onSwitched(); }
                    else if (r.kind === 'chat') { setOpen(false); setChatImport(r.conversations); }
                  }).catch((err) => {
                    toast('error', fmt(ti('toast.importFailedGeneric'), { msg: err instanceof Error ? err.message : String(err) }));
                  });
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}
      {libraryOpen && (
        <Suspense fallback={null}>
          <CanvasLibrary onClose={() => setLibraryRequested(false)} onSwitched={onSwitched} triggerRef={triggerRef} />
        </Suspense>
      )}
      {chatImport && (
        <ImportChatModal
          conversations={chatImport}
          onClose={() => setChatImport(null)}
          onDone={() => { setChatImport(null); onSwitched(); }}
        />
      )}
    </div>
  );
}
