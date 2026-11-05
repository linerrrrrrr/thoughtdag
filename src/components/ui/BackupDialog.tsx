import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderSync, X } from 'lucide-react';
import { useUiStore, toast } from '../../lib/ui-store';
import { backupCapable, enableAutoBackup, disableAutoBackup, backupActiveProject } from '../../lib/local-backup';
import { useT, fmt } from '../../i18n';

// Auto-backup control center: status (folder, last write), backup-now for
// EVERY canvas, change folder, stop. The automatic write itself is
// change-triggered (debounced ~1 min after an edit), not a fixed timer.

export default function BackupDialog() {
  const open = useUiStore((s) => s.backupDialogOpen);
  const dir = useUiStore((s) => s.autoBackupDir);
  const lastAt = useUiStore((s) => s.lastAutoBackupAt);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const close = () => useUiStore.getState().setBackupDialogOpen(false);
  const layerRef = useRef<HTMLDivElement>(null);
  useDismissableLayer({ open: open && backupCapable(), refs: [layerRef], onDismiss: close, modal: true });
  if (!open || !backupCapable()) return null;

  // Absolute clock time keeps the render pure (no Date.now() while rendering)
  const rel = lastAt
    ? fmt(t('backup.lastAt'), { time: new Date(lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
    : t('backup.lastNever');

  return createPortal((
    <div className="fixed inset-0 z-[80] bg-ink/25 flex items-center justify-center animate-fade-in" data-backup-dialog>
      <div ref={layerRef} role="dialog" aria-modal="true" aria-label={t('backup.dialogTitle')} tabIndex={-1} className="bg-surface rounded-panel shadow-lg border border-line w-[min(440px,92vw)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div className="text-title font-semibold text-ink flex items-center gap-2">
            <FolderSync size={15} strokeWidth={1.75} className={dir ? 'text-emerald-600' : 'text-accent'} /> {t('backup.dialogTitle')}
          </div>
          <button onClick={close} className="w-7 h-7 rounded-control text-ink-faint hover:bg-wash hover:text-ink flex items-center justify-center transition-colors">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
        <p className="text-control text-ink-muted mb-3">{t('backup.dialogHow')}</p>

        {dir ? (
          <>
            <div className="text-control bg-wash border border-line rounded-content px-3 py-2 mb-3 space-y-0.5">
              <div className="text-ink"><span className="text-ink-faint">{t('backup.folder')}</span> {dir}</div>
              <div className="text-ink-muted">{rel}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setBusy(true); void backupActiveProject().then((name) => { if (name) toast('success', fmt(t('backup.wroteActive'), { name })); }).catch((err) => { toast('error', String(err?.message ?? err)); }).finally(() => setBusy(false)); }}
                disabled={busy}
                className="text-control bg-action hover:bg-action-strong text-white px-4 py-2 rounded-control transition-colors disabled:opacity-40"
                data-backup-now
              >
                {t('backup.now')}
              </button>
              <button onClick={() => void enableAutoBackup()} className="text-control border border-line text-ink-muted hover:bg-wash px-3 py-2 rounded-control transition-colors">
                {t('backup.changeFolder')}
              </button>
              <button onClick={() => { void disableAutoBackup(); }} className="text-control border border-line text-ink-muted hover:bg-wash hover:text-red-600 px-3 py-2 rounded-control transition-colors">
                {t('backup.stop')}
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={() => void enableAutoBackup().then((ok) => { if (ok) close(); })}
            className="text-control bg-action hover:bg-action-strong text-white px-4 py-2 rounded-control transition-colors"
          >
            {t('backup.autoSetup')}
          </button>
        )}
      </div>
    </div>
  ), document.body);
}
