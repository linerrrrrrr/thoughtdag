import { useEffect, useRef, useState } from 'react';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useCanvasPanelPosition } from '../../lib/use-canvas-panel-position';
import { useCanvasToolCard } from '../../lib/use-canvas-tool-card';
import { Check, ChevronDown, ShieldCheck, ShieldEllipsis, ShieldOff, X } from 'lucide-react';
import { useT, type MessageKey as TKey } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { useProjects } from '../../store/projects';
import { isAgentModel, runtimeOf, setGuardMode, allowLocation } from '../../lib/agents/agent-runtime';
import { isHarnessAgentModel } from '../../lib/atlas/dsh-bridge';
import { IN_HARNESS } from '../../lib/embedded';
import { API_BASE } from '../../lib/constants';
import CanvasToolbarOverflowAction from '../CanvasToolbarOverflowAction';
import { restoreCanvasToolbarFocus } from '../../lib/use-responsive-canvas-header';
import type { AgentPermissionMode } from '../../types';

// How freely the agents this canvas starts may act, on the toolbar beside
// the working directory: ask before risky steps, let the runtime's own
// review decide, or ask nothing. One switch per canvas; each runtime maps it
// onto its own modes, so the menu says what each choice means for the agent
// that is picked. Questions the agent puts to the person are not affected:
// they always reach the node.

type Lane = 'claude-code' | 'codex' | 'pi' | 'harness';

const ASK_HINT: Record<Lane, TKey> = {
  'claude-code': 'agent.permAskClaude', codex: 'agent.permAskCodex', pi: 'agent.permAskPi', harness: 'agent.permAskHarness',
};
const AUTO_HINT: Record<Lane, TKey> = {
  'claude-code': 'agent.permAutoClaude', codex: 'agent.permAutoCodex', pi: 'agent.permAutoNone', harness: 'agent.permAutoHarness',
};
const ICON = { ask: ShieldCheck, auto: ShieldEllipsis, allow: ShieldOff } as const;
const LABEL: Record<AgentPermissionMode, TKey> = { ask: 'agent.permAsk', auto: 'agent.permAuto', allow: 'agent.permAllow' };

export default function AgentPermissionChip() {
  const t = useT();
  const selectedModel = useUiStore((s) => s.selectedModel);
  const activeId = useProjects((s) => s.activeId);
  const guard = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.agentGuard);
  const [requestedOpen, setOpen] = useState(false);
  const open = useCanvasToolCard('permissions', requestedOpen, () => setOpen(false));
  const panelPosition = useCanvasPanelPosition(open, 'left');
  // inside the harness: whether its Auto review is installed (null = not asked yet)
  const [hostAuto, setHostAuto] = useState<boolean | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) panelRef.current?.focus({ preventScroll: true }); }, [open]);
  const harness = IN_HARNESS && !!window.desktopSessions && isHarnessAgentModel(selectedModel);
  const visible = !!window.desktopAgents && (isAgentModel(selectedModel) || harness);
  const lane: Lane = harness ? 'harness' : (runtimeOf(selectedModel) ?? 'pi');

  useDismissableLayer({ dismissOnFocusOutside: true, open, refs: [rootRef], restoreFocus: false, onDismiss: reason => {
    setOpen(false);
    if (reason === 'escape') restoreCanvasToolbarFocus(rootRef.current?.querySelector('[data-agent-permission-chip]') ?? null);
  } });

  useEffect(() => {
    if (!open || lane !== 'harness') return;
    let alive = true;
    void fetch(`${API_BASE}/api/permission-modes`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setHostAuto(!!j?.auto); }).catch(() => { if (alive) setHostAuto(false); });
    return () => { alive = false; };
  }, [open, lane]);

  if (!visible || !activeId) return null;
  const mode: AgentPermissionMode = guard?.mode ?? 'ask';
  const autoOff = lane === 'pi' || (lane === 'harness' && hostAuto === false);
  // a saved 'auto' on an agent without a review of its own runs as 'ask'
  const shown: AgentPermissionMode = mode === 'auto' && lane === 'pi' ? 'ask' : mode;
  const Icon = ICON[shown];
  const choose = async (m: AgentPermissionMode) => { await setGuardMode(m); setOpen(false); };
  const allowed = guard?.allow ?? [];

  const row = (m: AgentPermissionMode, hint: TKey, disabled = false) => {
    const RowIcon = ICON[m];
    return (
      <button
        onClick={() => { if (!disabled) void choose(m); }}
        disabled={disabled}
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
    <div ref={rootRef} className="contents">
      <CanvasToolbarOverflowAction label={`${t('agent.perm')} · ${t(LABEL[shown])}`} icon={<Icon size={14} />}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`bg-card border rounded-control h-8 px-2.5 flex items-center gap-1.5 hover:bg-wash transition-colors text-control ${shown === 'allow' ? 'border-amber-400/70 text-amber-700 dark:text-amber-300' : 'border-line text-ink'}`}
        data-tooltip={`${t('agent.perm')} · ${t(LABEL[shown])}`} aria-label={`${t('agent.perm')} · ${t(LABEL[shown])}`} data-tooltip-icon-only
        data-agent-permission-chip={shown}
        aria-expanded={open}
      >
        <Icon size={14} strokeWidth={1.75} className={`shrink-0 ${shown === 'allow' ? '' : 'text-ink-faint'}`} />
        <span className="whitespace-nowrap">{t(LABEL[shown])}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="text-ink-faint shrink-0" />
      </button>
      </CanvasToolbarOverflowAction>
      {open && (
        <div ref={panelRef} tabIndex={-1} className="canvas-tool-panel canvas-tool-menu py-1.5" style={panelPosition} onClick={(e) => e.stopPropagation()} data-agent-permission-menu>
          <p className="text-control text-ink-faint uppercase tracking-wider font-medium px-3 pt-1 pb-1">{t('agent.perm')} · {t('agent.permScope')}</p>
          {row('ask', ASK_HINT[lane])}
          {row('auto', lane === 'harness' && hostAuto === false ? 'agent.permAutoHarnessOff' : AUTO_HINT[lane], autoOff)}
          {row('allow', lane === 'harness' ? 'agent.permAllowHarness' : 'agent.permAllowHint')}
          {lane === 'pi' && allowed.length > 0 && (
            <>
              <div className="border-t border-line/60 my-1" />
              <p className="text-control text-ink-faint px-3 pt-1 pb-1">{t('agent.guardAllowed')}</p>
              {allowed.map((a) => (
                <div key={a} className="px-3 py-1 text-control flex items-center gap-2 min-w-0" data-agent-guard-allowed={a}>
                  <span className="flex-1 min-w-0 truncate text-ink-muted font-mono" data-tooltip={a} data-tooltip-overflow>{a}</span>
                  <button onClick={() => void allowLocation(a, true)} className="text-ink-faint hover:text-red-500 shrink-0" data-tooltip={t('agent.guardRemove')} aria-label={t('agent.guardRemove')}>
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </>
          )}
          <div className="border-t border-line/60 my-1" />
          <p className="px-3 py-1 text-control text-ink-faint">{t('agent.permQuestions')}</p>
        </div>
      )}
    </div>
  );
}
