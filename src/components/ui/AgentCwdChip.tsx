import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronRight, Copy, FolderOpen } from 'lucide-react';
import { useT } from '../../i18n';
import { ensureCanvasWorkspace } from '../../lib/canvas-workspace';
import { copyText } from '../../lib/export';
import { openLocalPath } from '../../lib/local-path';
import { toast } from '../../lib/ui-store';
import { useProjects } from '../../store/projects';

export default function AgentCwdChip({ open, onOpenChange, triggerRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const activeId = useProjects(s => s.activeId);
  const [workspace, setWorkspace] = useState<{ canvasId: string; path: string | null } | null>(null);
  const menuId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) panelRef.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => {
    if (!activeId || !open) return;
    let active = true;
    void ensureCanvasWorkspace(activeId).catch(() => null).then(path => {
      if (active) setWorkspace({ canvasId: activeId, path });
    });
    return () => { active = false; };
  }, [activeId, open]);

  if (!activeId) return null;
  const path = workspace?.canvasId === activeId ? workspace.path : null;
  return <div className="node-metadata">
    <button ref={triggerRef} type="button" onClick={() => onOpenChange(!open)}
      className="node-metadata-toggle" data-agent-cwd="workspace"
      data-tooltip={path ?? t('agent.cwd')} aria-expanded={open} aria-controls={menuId}>
      {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      <span>{t('agent.cwd')}</span>
      <span className="agent-connection-setting-value">{t('agent.cwdWorkspace')}</span>
    </button>
    {open && <div id={menuId} ref={panelRef} tabIndex={-1} aria-label={t('agent.cwd')}
      className="node-metadata-fields agent-connection-setting-menu" data-agent-cwd-menu>
      {path ? <>
        <p className="px-3 py-1.5 text-control font-mono text-ink break-all select-text" data-agent-cwd-path>{path}</p>
        <div className="flex flex-wrap gap-1 px-2 pb-1">
          {window.desktopLocal && <button type="button" onClick={() => void openLocalPath(path)}
            className="node-metadata-action inline-flex items-center gap-1.5">
            <FolderOpen size={14} aria-hidden="true" />{t('agent.openDir')}
          </button>}
          <button type="button" onClick={() => void copyText(path).catch(() => toast('error', t('local.copyFailed')))}
            className="node-metadata-action inline-flex items-center gap-1.5">
            <Copy size={14} aria-hidden="true" />{t('local.copyPath')}
          </button>
        </div>
      </> : <p role="status" className="px-3 py-1.5 text-control text-ink-muted">
        {t(workspace?.canvasId === activeId ? 'agent.cwdUnavailable' : 'agent.cwdLoading')}
      </p>}
    </div>}
  </div>;
}
