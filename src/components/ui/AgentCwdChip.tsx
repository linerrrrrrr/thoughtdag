import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useSessionDraft } from '../../lib/use-session-draft';
import { useUiStore } from '../../lib/ui-store';
import { FolderOpen, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '../../i18n';
import { useProjects, setProjectAgentCwd } from '../../store/projects';
import { useStore } from '../../store';
import { resolveAgentCwd, sourceCwd, type CwdChoice } from '../../lib/agents/agent-runtime';
import { parseAgentCwd } from '../../lib/agents/cwd-path';
import { isImeComposing } from '../../utils';

// Canvas-wide directory settings inside the connected Agent page.
// Its inline menu is a child layer; it never replaces the connection page.

const tail = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? p;

export default function AgentCwdChip({ open, onOpenChange, triggerRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const activeId = useProjects((s) => s.activeId);
  const projects = useProjects((s) => s.projects);
  const nodeCount = useStore((s) => s.nodes.length);
  const [choice, setChoice] = useState<CwdChoice | null>(null);
  const [sourceDirectory, setSourceDirectory] = useState<string | null>(null);
  const draftKey = `agent-cwd:${activeId}`;
  const [typed, setTyped] = useSessionDraft(draftKey);
  const [invalidPath, setInvalidPath] = useState(false);
  const pathErrorId = useId();
  const menuId = useId();
  const [, rerender] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) panelRef.current?.focus({ preventScroll: true }); }, [open]);
  const visible = !!window.desktopAgents;

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void resolveAgentCwd().then((c) => { if (alive) setChoice(c); });
    void sourceCwd().then((m) => { if (alive) setSourceDirectory(m); });
    return () => { alive = false; };
  }, [visible, activeId, projects, nodeCount]);

  if (!visible || !choice) return null;
  const meta = projects.find((p) => p.id === activeId);
  const recent = [...new Set(projects.map((p) => p.agentCwd).filter((c): c is string => !!c))].filter((c) => c !== meta?.agentCwd).slice(0, 5);

  const choose = async (cwd: string | undefined) => {
    if (!activeId) return;
    await setProjectAgentCwd(activeId, cwd);
    useUiStore.getState().setDraft(draftKey, '');
    onOpenChange(false);
  };
  const nativePicker = window.desktopAgents?.capabilities?.nativePicker !== false;
  const pick = async () => {
    const dir = await window.desktopAgents!.pickCwd();
    if (dir) await choose(dir);
    // the host found it has no dialog after all (capabilities flipped): show the typed field now
    else if (window.desktopAgents?.capabilities?.nativePicker === false) rerender((n) => n + 1);
  };
  const submitTyped = async () => {
    const cwd = parseAgentCwd(typed);
    setInvalidPath(cwd === null);
    if (cwd !== null) await choose(cwd);
  };

  return (
    <div className="node-metadata">
      <button ref={triggerRef} type="button"
        onClick={(e) => { e.stopPropagation(); onOpenChange(!open); }}
        className="node-metadata-toggle"
        data-tooltip={`${t('agent.cwd')} · ${choice.cwd}`}
        aria-label={`${t('agent.cwd')} · ${choice.cwd}`}
        data-agent-cwd={choice.kind}
        aria-expanded={open}
        aria-controls={menuId}
      >
        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        <span>{t('agent.cwd')}</span>
        <span className="agent-connection-setting-value">{choice.kind === 'workspace' ? t('agent.cwdWorkspace') : tail(choice.cwd)}</span>
      </button>
      {open && (
        <div id={menuId} ref={panelRef} tabIndex={-1} aria-label={t('agent.cwd')} className="node-metadata-fields agent-connection-setting-menu" onClick={(e) => e.stopPropagation()} data-agent-cwd-menu>
          <button aria-pressed={!meta?.agentCwd} onClick={() => void choose(undefined)} className="w-full text-left px-3 py-2 text-control hover:bg-wash flex items-center gap-2">
            <span className="flex-1 min-w-0">
              <span className="block text-ink">{sourceDirectory ? t('agent.cwdSource') : choice.kind === 'session' ? t('agent.cwdSession') : t('agent.cwdWorkspace')}</span>
              <span className="block text-control text-ink-faint truncate">{sourceDirectory ?? (choice.kind === 'session' ? choice.cwd : t('agent.cwdWorkspaceHint'))}</span>
            </span>
            {!meta?.agentCwd && <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />}
          </button>
          {meta?.agentCwd && (
            <button aria-pressed="true" onClick={() => void choose(meta.agentCwd)} className="w-full text-left px-3 py-2 text-control hover:bg-wash flex items-center gap-2">
              <span className="flex-1 min-w-0"><span className="block text-ink">{tail(meta.agentCwd)}</span><span className="block text-control text-ink-faint truncate">{meta.agentCwd}</span></span>
              <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />
            </button>
          )}
          {recent.length > 0 && <p className="text-control text-ink-faint uppercase tracking-wider font-medium px-3 pt-2 pb-1">{t('agent.cwdRecent')}</p>}
          {recent.map((c) => (
            <button key={c} onClick={() => void choose(c)} className="w-full text-left px-3 py-1.5 text-control hover:bg-wash flex items-center gap-2">
              <span className="flex-1 min-w-0"><span className="block text-ink">{tail(c)}</span><span className="block text-control text-ink-faint truncate">{c}</span></span>
            </button>
          ))}
          <div className="border-t border-line/60 my-1" />
          {nativePicker ? (
            <button onClick={() => void pick()} className="w-full text-left px-3 py-2 text-control text-ink hover:bg-wash flex items-center gap-2" data-agent-cwd-pick>
              <FolderOpen size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('agent.cwdPick')}
            </button>
          ) : (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2">
                <input
                  value={typed}
                  onChange={(e) => { setTyped(e.target.value); setInvalidPath(false); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !isImeComposing(e)) { e.preventDefault(); e.stopPropagation(); void submitTyped(); } }}
                  placeholder={t('agent.cwdType')}
                  aria-label={t('agent.cwdType')}
                  aria-invalid={invalidPath || undefined}
                  aria-describedby={invalidPath ? pathErrorId : undefined}
                  className="flex-1 min-w-0 min-h-8 text-control font-mono bg-wash/45 border border-transparent rounded-control px-2 py-1 hover:border-line focus:outline-none focus:border-accent"
                  data-agent-cwd-input
                />
                <button onClick={() => void submitTyped()} className="node-metadata-action node-metadata-save shrink-0">{t('agent.cwdUse')}</button>
              </div>
              {invalidPath && <p id={pathErrorId} role="alert" className="node-metadata-error mt-1.5 break-words">{t('agent.cwdInvalid')}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
