import { useEffect, useId, useRef, type RefObject } from 'react';
import { Check, ChevronDown, ChevronRight, ShieldCheck, ShieldEllipsis, ShieldOff } from 'lucide-react';
import { useT, type MessageKey as TKey } from '../../i18n';
import { useProjects } from '../../store/projects';
import { setGuardMode } from '../../lib/agents/agent-runtime';
import type { AgentPermissionMode } from '../../types';

// The connected Agent page configures Codex approvals for the active canvas.
const ICON = { ask: ShieldCheck, auto: ShieldEllipsis, allow: ShieldOff } as const;
const LABEL: Record<AgentPermissionMode, TKey> = { ask: 'agent.permAsk', auto: 'agent.permAuto', allow: 'agent.permAllow' };

export default function AgentPermissionChip({ open, onOpenChange, triggerRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const activeId = useProjects((s) => s.activeId);
  const guard = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.agentGuard);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => { if (open) panelRef.current?.focus({ preventScroll: true }); }, [open]);
  const visible = !!window.desktopAgents;

  if (!visible || !activeId) return null;
  const mode: AgentPermissionMode = guard?.mode ?? 'ask';
  const shown = mode;
  const choose = async (m: AgentPermissionMode) => { await setGuardMode(m); onOpenChange(false); };

  const row = (m: AgentPermissionMode, hint: TKey, disabled = false) => {
    const RowIcon = ICON[m];
    return (
      <button
        onClick={() => { if (!disabled) void choose(m); }}
        disabled={disabled} aria-pressed={mode === m}
        className="w-full text-left px-3 py-1.5 text-control hover:bg-wash disabled:hover:bg-transparent disabled:opacity-50 flex items-start gap-2"
        data-agent-permission={m}
      >
        <RowIcon size={14} strokeWidth={1.75} className={`shrink-0 mt-0.5 ${m === 'allow' ? 'text-amber-600 dark:text-amber-400' : 'text-ink-faint'}`} />
        <span className="flex-1 min-w-0"><span className="block text-ink">{t(LABEL[m])}</span><span className="block text-control text-ink-faint">{t(hint)}</span></span>
        {mode === m && <Check size={13} strokeWidth={2} className="shrink-0 mt-0.5 text-accent" />}
      </button>
    );
  };

  return (
    <div className="node-metadata">
      <button ref={triggerRef} type="button"
        onClick={(e) => { e.stopPropagation(); onOpenChange(!open); }}
        className="node-metadata-toggle"
        data-tooltip={`${t('connection.approvals')} · ${t(LABEL[shown])}`} aria-label={`${t('connection.approvals')} · ${t(LABEL[shown])}`} data-tooltip-icon-only
        data-agent-permission-chip={shown}
        aria-expanded={open}
        aria-controls={menuId}
      >
        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        <span>{t('connection.approvals')}</span>
        <span className="agent-connection-setting-value">{t(LABEL[shown])}</span>
      </button>
      {open && (
        <div id={menuId} ref={panelRef} tabIndex={-1} aria-label={t('connection.approvals')} className="node-metadata-fields agent-connection-setting-menu" onClick={(e) => e.stopPropagation()} data-agent-permission-menu>
          {row('ask', 'agent.permAskCodex')}
          {row('auto', 'agent.permAutoCodex')}
          {row('allow', 'agent.permAllowHint')}
          <div className="border-t border-line/60 my-1" />
          <p className="px-3 py-1 text-control text-ink-faint">{t('agent.permQuestions')}</p>
        </div>
      )}
    </div>
  );
}
