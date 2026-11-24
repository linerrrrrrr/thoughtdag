import { useId, useRef, useState } from 'react';
import { Check, FileDown, FileJson, Folder, Inbox, X } from 'lucide-react';
import { fmt, useT } from '../i18n';
import { exportProjectFolder, folderArchiveEntries } from '../lib/canvas-library-files';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { createProject, createProjectFolder, moveProjectToFolder, useProjects } from '../store/projects';
import { isImeComposing } from '../utils';

export type LibraryAction =
  | { type: 'new-folder' }
  | { type: 'new-canvas'; folderId: string | null }
  | { type: 'move'; projectId: string }
  | { type: 'export'; folderId: string };

interface Props {
  action: LibraryAction;
  onClose: () => void;
  onFolderCreated: (id: string) => void;
}

export default function CanvasLibraryDialog({ action, onClose, onFolderCreated }: Props) {
  const t = useT();
  const { projects, folders } = useProjects();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDismissableLayer({ open: true, refs: [ref], modal: true, dismissOnEscape: !busy,
    onDismiss: () => { if (!pending.current) onClose(); } });

  const title = t(action.type === 'new-folder' ? 'library.newFolder' : action.type === 'new-canvas'
    ? 'switcher.newCanvas' : action.type === 'move' ? 'library.moveTitle' : 'library.exportFolder');
  const targetId = 'folderId' in action ? action.folderId : null;
  const folder = folders.find(item => item.id === targetId);
  const project = action.type === 'move' ? projects.find(item => item.id === action.projectId) : undefined;
  const archive = action.type === 'export'
    ? folderArchiveEntries(projects.filter(item => item.folderId === action.folderId)) : [];

  async function apply(destination?: string | null) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (action.type === 'new-folder') {
        if (!name.trim()) return;
        onFolderCreated(await createProjectFolder(name.trim()));
      } else if (action.type === 'new-canvas') {
        if (!name.trim()) return;
        await createProject(name.trim(), 'chat', { folderId: action.folderId, activate: false });
      } else if (action.type === 'move') {
        if (destination === undefined) return;
        await moveProjectToFolder(action.projectId, destination);
      } else {
        if (!await exportProjectFolder(action.folderId)) return;
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('library.actionFailed'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-black/40 p-3">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} data-library-dialog={action.type}
        className="w-full max-w-sm max-h-full overflow-y-auto rounded-panel border border-line bg-card shadow-lg p-4 text-control text-ink">
        <header className="flex items-center justify-between gap-3 mb-3">
          <h2 id={titleId} className="text-heading font-semibold">{title}</h2>
          <button type="button" className="canvas-library-icon-button" disabled={busy} aria-label={t('common.close')}
            data-library-dismiss onClick={onClose}><X size={16} /></button>
        </header>
        {(action.type === 'new-folder' || action.type === 'new-canvas') && (
          <form onSubmit={event => { event.preventDefault(); if (!pending.current && name.trim()) void apply(); }}>
            <label className="grid gap-1.5">
              <span className="font-medium">{t(action.type === 'new-folder' ? 'library.folderName' : 'library.canvasName')}</span>
              <input autoFocus required value={name} disabled={busy} data-library-name
                onChange={event => setName(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && isImeComposing(event)) event.preventDefault(); }}
                className="min-w-0 rounded-control border border-line bg-surface px-2 py-1.5 text-control text-ink" />
            </label>
            {action.type === 'new-canvas' && <p className="mt-1 text-control text-ink-muted">
              {fmt(t('library.destination'), { name: folder?.name ?? t('library.unfiled') })}
            </p>}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className="canvas-library-button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
              <button type="submit" data-library-create disabled={!name.trim() || busy}
                className="rounded-control px-3 py-1.5 bg-action text-white disabled:opacity-50">{t('library.create')}</button>
            </div>
          </form>
        )}
        {action.type === 'move' && (
          <>
            <p className="text-ink-muted mb-2 break-words">{project?.name}</p>
            {[...folders, { id: '', name: t('library.unfiled') }].map(item => (
              <button className="canvas-library-nav-row" type="button" key={item.id}
                disabled={!project || busy} data-library-move-to={item.id} onClick={() => void apply(item.id || null)}>
                {item.id ? <Folder size={16} /> : <Inbox size={16} />}
                <span className="truncate">{item.name}</span>
                {item.id === (project?.folderId ?? '') && <Check size={14} className="ml-auto text-accent" />}
              </button>
            ))}
          </>
        )}
        {action.type === 'export' && (
          <>
            <p className="text-ink-muted break-words">{fmt(t('library.exportScope'), { name: folder?.name ?? '', n: archive.length })}</p>
            <ul className="my-3">
              {archive.map(({ project: member, filename }) => (
                <li key={member.id} className="flex items-center gap-2 py-1">
                  <FileJson size={15} className="shrink-0 text-ink-muted" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{filename}</span>
                  {member.archived && <span className="ml-auto shrink-0 text-meta text-ink-muted">{t('library.archived')}</span>}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button type="button" className="canvas-library-button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
              <button type="button" data-library-download disabled={busy || !folder} onClick={() => void apply()}
                className="flex items-center gap-2 rounded-control bg-action px-3 py-1.5 text-white disabled:opacity-50">
                <FileDown size={15} />{t('library.downloadZip')}
              </button>
            </div>
          </>
        )}
        {error && <p role="alert" className="mt-2 text-danger [overflow-wrap:anywhere]">{error}</p>}
      </div>
    </div>
  );
}
