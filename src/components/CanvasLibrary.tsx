import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronRight, FileDown, FileUp, Folder, FolderOpen, FolderPlus, Inbox, LayoutGrid, PanelLeft, PanelsTopLeft, Plus, X } from 'lucide-react';
import { fmt, t as translate, useT } from '../i18n';
import { importLibraryCanvas } from '../lib/canvas-library-files';
import { toast } from '../lib/ui-store';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { refreshProjectIndex, switchProject, useProjects } from '../store/projects';
import CanvasLibraryCard from './CanvasLibraryCard';
import CanvasLibraryDialog, { type LibraryAction } from './CanvasLibraryDialog';
import './CanvasLibrary.css';

interface Props {
  onClose: () => void;
  onSwitched: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

function isFileDrag(event: DragEvent) {
  return event.dataTransfer.types.includes('Files');
}

export default function CanvasLibrary({ onClose, onSwitched, triggerRef }: Props) {
  const t = useT();
  const { projects, folders, activeId, switching } = useProjects();
  const activeFolder = projects.find(project => project.id === activeId)?.folderId;
  // null browses all canvases, while an empty string selects unfiled canvases.
  const [scope, setScope] = useState<string | null>(activeFolder ?? null);
  const [expanded, setExpanded] = useState(() => new Set(activeFolder ? [activeFolder] : []));
  const [mobileNav, setMobileNav] = useState(false);
  const [action, setAction] = useState<LibraryAction | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState('');
  const dragDepth = useRef(0);
  const importingRef = useRef(false);
  const pickerDestination = useRef<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useDismissableLayer({ open: true, refs: [pageRef], modal: true, dismissOnOutside: false,
    restoreFocusRef: triggerRef, onDismiss: onClose });
  useDismissableLayer({ open: mobileNav, refs: [navRef], modal: true, restoreFocusRef: navButton,
    dismissOnOutside: false, onDismiss: () => setMobileNav(false) });
  useEffect(() => {
    void refreshProjectIndex().catch(() => setStatus(translate('library.loadFailed')));
  }, []);

  const visible = useMemo(() => projects.filter(p => !p.archived).sort((a, b) => b.updatedAt - a.updatedAt), [projects]);
  const grouped = useMemo(() => {
    const result = new Map<string, typeof visible>();
    for (const project of visible) {
      const key = project.folderId ?? '';
      const group = result.get(key);
      if (group) group.push(project);
      else result.set(key, [project]);
    }
    return result;
  }, [visible]);
  const selected = folders.find(folder => folder.id === scope);
  const name = selected?.name ?? t(scope === '' ? 'library.unfiled' : 'library.all');
  const members = selected || scope === '' ? grouped.get(scope ?? '') ?? [] : visible;
  const destination = selected?.id ?? null;
  const destinationName = selected?.name ?? t('library.unfiled');

  const selectScope = (id: string | null) => {
    setScope(id);
    if (id) setExpanded(before => new Set(before).add(id));
    setMobileNav(false);
    setStatus('');
  };
  const toggleExpanded = (id: string) => setExpanded(before => {
    const next = new Set(before);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const openCanvas = async (id: string) => {
    if (switching) return;
    try {
      if (id !== activeId) {
        await switchProject(id);
        if (useProjects.getState().activeId !== id) return;
        onSwitched();
      }
      onClose();
    } catch (cause) {
      toast('error', cause instanceof Error ? cause.message : t('library.loadFailed'));
    }
  };
  const importFiles = async (files: File[], folderId: string | null) => {
    if (!files.length || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    setStatus('');
    const label = folders.find(folder => folder.id === folderId)?.name ?? t('library.unfiled');
    let imported = 0;
    const failed: string[] = [];
    try {
      // Some backups need explicit confirmation. Present one request at a time.
      for (const file of files) {
        try {
          const result = await importLibraryCanvas(file, folderId);
          if (result === 'imported') imported++;
          else if (typeof result === 'object') failed.push(fmt(t('library.fileIssue'), { file: file.name, reason: result.error }));
        } catch (cause) {
          failed.push(fmt(t('library.fileIssue'), { file: file.name, reason: cause instanceof Error ? cause.message : t('library.actionFailed') }));
        }
      }
      const notes = [];
      if (imported) notes.push(fmt(t('library.imported'), { n: imported, name: label }));
      if (failed.length) notes.push(fmt(t('library.importFailed'), { names: failed.join(t('library.listSeparator')) }));
      setStatus(notes.join(' '));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };
  const showAction = (next: LibraryAction) => { setMobileNav(false); setAction(next); };

  return createPortal(
    <div className="canvas-library-overlay text-control" data-type-surface="portal" data-canvas-library
      onDragOver={event => { if (isFileDrag(event)) { event.preventDefault(); event.stopPropagation(); } }}
      onDrop={event => { if (isFileDrag(event)) { event.preventDefault(); event.stopPropagation(); } }}>
      <div ref={pageRef} className={`canvas-library-page${mobileNav ? ' is-nav-open' : ''}`}
        role="dialog" aria-modal="true" aria-label={t('library.title')} tabIndex={-1}>
        {mobileNav && <button type="button" className="canvas-library-backdrop" aria-label={t('common.close')}
          onClick={() => setMobileNav(false)} />}
        <aside ref={navRef} className="canvas-library-nav" aria-label={t('library.navigation')}>
          <header className="canvas-library-nav-header">
            <PanelsTopLeft size={18} className="text-accent" /><h2 className="text-heading font-semibold">{t('library.title')}</h2>
            <button type="button" className="canvas-library-icon-button canvas-library-mobile-only ml-auto"
              aria-label={t('common.close')} onClick={() => setMobileNav(false)}><X size={16} /></button>
          </header>
          <button type="button" className={`canvas-library-nav-row${scope === null ? ' is-selected' : ''}`}
            aria-pressed={scope === null} data-library-folder="all" onClick={() => selectScope(null)}>
            <LayoutGrid size={16} />{t('library.all')}<span className="canvas-library-nav-count text-meta font-normal">{visible.length}</span>
          </button>
          <button type="button" className={`canvas-library-nav-row${scope === '' ? ' is-selected' : ''}`}
            aria-pressed={scope === ''} data-library-folder="" onClick={() => selectScope('')}>
            <Inbox size={16} />{t('library.unfiled')}<span className="canvas-library-nav-count text-meta font-normal">{grouped.get('')?.length ?? 0}</span>
          </button>
          <section className="canvas-library-nav-section">
            <div className="canvas-library-nav-label">
              <h3 className="text-control font-medium">{t('library.folders')}</h3>
              <button type="button" className="canvas-library-icon-button" data-library-new-folder aria-label={t('library.newFolder')}
                data-tooltip={t('library.newFolder')} onClick={() => showAction({ type: 'new-folder' })}><FolderPlus size={16} /></button>
            </div>
            {folders.map(folder => {
              const children = grouped.get(folder.id) ?? [];
              const open = expanded.has(folder.id);
              return <div key={folder.id}>
                <div className={`canvas-library-folder-row${scope === folder.id ? ' is-selected' : ''}`}>
                  <button type="button" className="canvas-library-icon-button" aria-expanded={open}
                    aria-label={fmt(t(open ? 'library.collapseFolder' : 'library.expandFolder'), { name: folder.name })}
                    onClick={() => toggleExpanded(folder.id)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                  <button type="button" className="canvas-library-nav-row" data-library-folder={folder.id}
                    aria-pressed={scope === folder.id} onClick={() => selectScope(folder.id)}>
                    {open ? <FolderOpen size={16} /> : <Folder size={16} />}
                    <span className="truncate">{folder.name}</span><span className="canvas-library-nav-count text-meta font-normal">{children.length}</span>
                  </button>
                </div>
                {open && <div className="canvas-library-folder-children">{children.map(p =>
                  <button type="button" key={p.id} className="canvas-library-nav-row" disabled={switching}
                    aria-current={p.id === activeId ? 'page' : undefined} onClick={() => void openCanvas(p.id)}>
                    <span className="truncate">{p.name}</span>
                  </button>)}</div>}
              </div>;
            })}
          </section>
          <section className="canvas-library-nav-section">
            <div className="canvas-library-nav-label"><h3 className="text-control font-medium">{t('library.recent')}</h3></div>
            {visible.slice(0, 5).map(p => <button key={p.id} type="button" disabled={switching}
              className="canvas-library-nav-row" onClick={() => void openCanvas(p.id)}><span className="truncate">{p.name}</span></button>)}
          </section>
        </aside>
        <main className="canvas-library-main">
          <header className="canvas-library-path">
            <div className="canvas-library-breadcrumb">
              <button type="button" ref={navButton} className="canvas-library-button canvas-library-mobile-only" data-library-nav-toggle
                aria-expanded={mobileNav} onClick={() => setMobileNav(true)}><PanelLeft size={16} />{t('library.navigation')}</button>
              <span className="canvas-library-desktop-only">{t('library.title')}</span><ChevronRight size={13} /><span className="truncate">{name}</span>
            </div>
            <button type="button" className="canvas-library-button" data-library-back onClick={onClose}><ArrowLeft size={16} />{t('library.back')}</button>
          </header>
          <div className="canvas-library-titlebar">
            <div className="canvas-library-title"><h1 className="text-section font-semibold">{name}</h1>
              <span className="canvas-library-count text-meta">{fmt(t('library.count'), { n: members.length })}</span></div>
            {selected && <button type="button" className="canvas-library-button border border-line" data-library-export
              onClick={() => showAction({ type: 'export', folderId: selected.id })}><FileDown size={16} />{t('library.exportFolder')}</button>}
          </div>
          <input ref={input} type="file" multiple accept=".json,application/json" hidden data-library-file-input
            onChange={event => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              void importFiles(files, pickerDestination.current);
            }} />
          <button type="button" data-library-upload className={`canvas-library-upload${dragging ? ' is-dragging' : ''}`}
            disabled={importing} aria-busy={importing} onClick={() => { pickerDestination.current = destination; input.current?.click(); }}
            onDragEnter={event => { if (isFileDrag(event)) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
            onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
            onDragOver={event => {
              if (!isFileDrag(event)) return;
              event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = importing ? 'none' : 'copy';
            }}
            onDrop={event => {
              event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragging(false);
              void importFiles(Array.from(event.dataTransfer.files), destination);
            }}>
            <span className="canvas-library-upload-icon"><FileUp size={24} /></span>
            <span className="canvas-library-upload-copy"><strong className="text-title font-semibold">{t(importing ? 'library.importing' : dragging ? 'library.release' : 'library.import')}</strong>
              <span className="text-ink-muted">{fmt(t('library.dropHint'), { name: destinationName })}</span></span>
            <span className="canvas-library-upload-choose">{t('library.chooseFiles')}</span>
          </button>
          <div role="status" aria-live="polite" className="canvas-library-status">{status}</div>
          <div className="canvas-library-sectionbar">
            <h2 className="text-title font-semibold">{t(selected ? 'library.folderCanvases' : 'library.canvases')}</h2>
            <button type="button" className="canvas-library-button" data-library-new-canvas
              onClick={() => showAction({ type: 'new-canvas', folderId: destination })}><Plus size={15} />{t('switcher.newCanvas')}</button>
          </div>
          {members.length ? <div className="canvas-library-grid">{members.map(p => <CanvasLibraryCard key={p.id}
            project={p} active={p.id === activeId} onOpen={() => void openCanvas(p.id)} onMove={() => showAction({ type: 'move', projectId: p.id })} />)}</div>
            : <p className="canvas-library-empty">{t('library.emptyFolder')}</p>}
        </main>
        {action && <CanvasLibraryDialog action={action} onClose={() => setAction(null)} onFolderCreated={selectScope} />}
      </div>
      <button type="button" tabIndex={-1} className="canvas-library-side-dismiss" onClick={onClose} aria-label={t('library.back')} />
    </div>, document.body,
  );
}
