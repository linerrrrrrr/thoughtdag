import { appSettings } from '../../lib/disk-storage';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useCanvasPanelPosition } from '../../lib/use-canvas-panel-position';
import { useCanvasToolCard } from '../../lib/use-canvas-tool-card';
import { uiRect, uiViewport } from '../../lib/ui-scale';
import { ArrowLeft, Check, ChevronDown, Cpu, Loader2, ChevronRight, RotateCcw, Zap } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { useModels, ensureAgentsFresh, recheckAgents, type ModelInfo } from '../../lib/use-models';
import { AGENT_PROVIDER, AGENT_RUNTIMES, LIVE_RUNTIMES, isAgentModel, runtimeLabelOf } from '../../lib/agents/agent-runtime';
import CanvasModelMenu from './CanvasModelMenu';
import CanvasModelList from './CanvasModelList';
import { defaultModelId, displayModelName, modelName } from '../../lib/model-sources';

// Agent-run models fold by runtime: each runtime lists many models, so only
// the runtime holding the current pick opens by itself; the others show their
// name, count and a chevron. Which are open is remembered.
const OPEN_RUNTIMES_KEY = 'thoughtdag.pickerOpenRuntimes';
const loadOpenRuntimes = (): Set<string> => { try { const v = JSON.parse(appSettings.getItem(OPEN_RUNTIMES_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
import { fmt, useT } from '../../i18n';
import type { NodeExecutionKind } from '../../lib/node-execution';
import type { AgentTurnOptions } from '../../types';

interface PickerProps {
  /** Node mode: controlled value (undefined = inherit global) + change handler. */
  value?: string;
  onChange?: (id: string | undefined) => void;
  /** Compact styling for embedding in panel rows. */
  compact?: boolean;
  /** Available choices and inherited default for the node's execution type. */
  execution?: {
    kind: NodeExecutionKind;
    models: ModelInfo[];
    inheritedModel?: string;
    agentOptions?: AgentTurnOptions;
    onAgentOptionsChange?: (options: AgentTurnOptions | undefined) => void;
  };
}

function NodePickerPortal({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? createPortal(children, document.body) : children;
}

// Dropdown listing every model the server registered (driven by which API
// keys exist in .env), grouped by provider. Without props it edits the
// GLOBAL selection; with value/onChange it edits a per-node override and
// offers an "inherit" entry.
export default function ModelPicker({ value, onChange, compact, execution }: PickerProps) {
  const t = useT();
  const nodeMode = !!onChange;
  const selectedModel = useUiStore((s) => s.selectedModel);
  const setSelectedModel = useUiStore((s) => s.setSelectedModel);
  const data = useModels();
  const [requestedOpen, setOpen] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const cardOpen = useCanvasToolCard('model', requestedOpen && !nodeMode, () => setOpen(false));
  const open = nodeMode ? requestedOpen : cardOpen;
  const panelPosition = useCanvasPanelPosition(open && !nodeMode, 'left');
  const agentEffort = useUiStore((s) => s.agentEffort);
  const [openRuntimes, setOpenRuntimes] = useState<Set<string>>(loadOpenRuntimes);
  const toggleRuntime = (label: string) => setOpenRuntimes((prev) => { const next = new Set(prev); if (next.has(label)) next.delete(label); else next.add(label); try { appSettings.setItem(OPEN_RUNTIMES_KEY, JSON.stringify([...next])); } catch { /* per-session then */ } return next; });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const viewFocusRef = useRef<HTMLButtonElement>(null);
  const hasAgentControls = execution?.kind === 'codex' && !!execution.onAgentOptionsChange
    && execution.models.some(model => model.efforts?.length || model.supportsFast);

  useLayoutEffect(() => {
    if (!nodeMode || !open) return;
    let frame = 0;
    // A node can scroll, move, or zoom while its menu is open. Keep the
    // screen-space portal attached to its trigger and inside the viewport.
    const place = () => {
      const anchor = triggerRef.current, menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = uiRect(anchor), viewport = uiViewport();
      const inset = 8, gap = 6;
      const belowSpace = Math.max(0, viewport.height - rect.bottom - gap - inset);
      const aboveSpace = Math.max(0, rect.top - gap - inset);
      const heightLimit = Math.max(0, Math.min(viewport.height * 0.6, viewport.height - inset * 2));
      const contentHeight = Math.min(heightLimit, menu.scrollHeight + menu.offsetHeight - menu.clientHeight);
      const fitsAbove = aboveSpace >= contentHeight;
      const fitsBelow = belowSpace >= contentHeight;
      const below = (fitsBelow && (!hasAgentControls || !fitsAbove))
        || (!fitsAbove && belowSpace >= aboveSpace);
      const maxHeight = `${Math.min(heightLimit, below ? belowSpace : aboveSpace)}px`;
      if (menu.style.maxHeight !== maxHeight) menu.style.maxHeight = maxHeight;
      const width = menu.offsetWidth, height = menu.offsetHeight;
      const left = Math.max(inset, Math.min(rect.right - width, viewport.width - width - inset));
      const top = Math.max(inset, Math.min(below ? rect.bottom + gap : rect.top - height - gap, viewport.height - height - inset));
      if (menu.style.left !== `${left}px`) menu.style.left = `${left}px`;
      if (menu.style.top !== `${top}px`) menu.style.top = `${top}px`;
      if (menu.style.visibility !== 'visible') menu.style.visibility = 'visible';
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [nodeMode, open, hasAgentControls]);

  // the runtimes are asked for their catalogs the first time a picker
  // opens, not at launch: a CLI to start is seconds and memory the launch
  // should not pay for
  useEffect(() => { if (open) ensureAgentsFresh(); }, [open]);

  useDismissableLayer({
    dismissOnFocusOutside: true, open, refs: [rootRef, menuRef], restoreFocusRef: triggerRef,
    restoreFocus: !(hasAgentControls && showModels),
    onDismiss: reason => {
      if (reason === 'escape' && hasAgentControls && showModels) {
        setShowModels(false);
      } else {
        setOpen(false);
        setShowModels(false);
      }
    },
  });

  useEffect(() => {
    if (!open || !hasAgentControls) return;
    if (menuRef.current) menuRef.current.scrollTop = 0;
    viewFocusRef.current?.focus({ preventScroll: true });
  }, [open, hasAgentControls, showModels]);

  // A successful connect pings the GLOBAL picker open: the user lands on
  // their fresh model list instead of wondering whether anything happened.
  // (adjust-during-render, same pattern as FocusPanel's node switch)
  const ping = useUiStore((s) => s.modelPickerPing);
  const [pingSeen, setPingSeen] = useState(ping);
  if (ping !== pingSeen) {
    setPingSeen(ping);
    if (!nodeMode) setOpen(true);
  }

  const executionKind = execution?.kind;
  const models = execution?.models ?? data?.models ?? [];
  // A generic node picker needs alternatives; execution-specific pickers
  // retain their setup action when their lane has no available model.
  if (nodeMode && !executionKind && models.length < 2) return null;

  const globalId = nodeMode && execution ? execution.inheritedModel
    : defaultModelId(data, selectedModel);
  const activeId = nodeMode ? (value ?? null) : globalId;
  const displayed = models.find(model => model.id === (activeId ?? globalId));
  const agentOptions = execution?.agentOptions;
  const levels = displayed?.efforts ?? [];
  const defaultEffort = displayed?.defaultEffort;
  const inheritedEffort = levels.includes(agentEffort) ? agentEffort : defaultEffort && levels.includes(defaultEffort) ? defaultEffort : undefined;
  const effort = agentOptions?.effort && levels.includes(agentOptions.effort) ? agentOptions.effort : inheritedEffort;
  const sliderLevels = inheritedEffort ? levels : ['', ...levels];
  const effortIndex = sliderLevels.indexOf(effort ?? '');
  const effortLabel = effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : t('model.effortDefault');
  const fast = displayed?.supportsFast === true && (agentOptions?.fast ?? displayed.defaultFast) === true;
  const optionsView = hasAgentControls && !showModels;
  const providers = [...new Set(models.map((m) => m.provider))];
  // the agent group is listed while the runtimes are still answering, so the
  // picker has somewhere to say so
  if (executionKind !== 'api' && data?.agentsPending && !providers.includes(AGENT_PROVIDER)) providers.push(AGENT_PROVIDER);
  // a host that looked for runtimes and found none still gets the group: that is where the "not found" rows live
  if (executionKind !== 'api' && !providers.includes(AGENT_PROVIDER) && data?.runtimes && Object.values(data.runtimes).some((s) => s && !s.installed)) providers.push(AGENT_PROVIDER);

  const pick = (id: string | null) => {
    if (nodeMode) onChange!(id ?? undefined);
    else setSelectedModel(id === data?.default ? null : id);
    if (hasAgentControls) {
      setShowModels(false);
    } else {
      setOpen(false);
    }
  };
  // the level the next turn will run at, as far as the runtime told us
  const effortWord = (m: ModelInfo | null | undefined): string => {
    if (!m || !isAgentModel(m.id) || !m.efforts?.length) return '';
    return m.efforts.includes(agentEffort) ? agentEffort : (m.defaultEffort ?? '');
  };
  const withEffort = (m: ModelInfo) => {
    const suffix = ` (${m.provider})`;
    const name = !nodeMode && m.name.endsWith(suffix) ? m.name.slice(0, -suffix.length) : m.name;
    const effort = effortWord(m);
    const label = displayModelName(m.id, name);
    return effort ? `${label} · ${effort}` : label;
  };

  let label;
  if (displayed) {
    label = hasAgentControls ? displayModelName(displayed.id, displayed.name) : withEffort(displayed);
  } else if (activeId) {
    const defaultLabel = nodeMode && activeId.endsWith('/default')
      ? `${runtimeLabelOf(activeId)} · ${t('agent.defaultModel')}` : undefined;
    label = displayModelName(activeId, defaultLabel);
  } else if (nodeMode) {
    label = t(executionKind === 'codex' ? 'agent.defaultModel' : executionKind ? 'nodeExecution.chooseModel' : 'model.inherit');
  } else {
    label = t('model.catalogTab');
  }

  const triggerLabel = [label, hasAgentControls && effort ? effortLabel : null, fast ? t('model.fast') : null].filter(Boolean).join(' · ');
  const tooltip = nodeMode && !value && !hasAgentControls
    ? t('model.inherit') : `${t('toolbar.model')} · ${triggerLabel || t('model.none')}`;

  return (
    <div ref={rootRef} className="relative">
      <button ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setShowModels(false);
          setOpen((v) => !v);
        }}
        className={compact
          ? `text-control px-3 py-2 rounded-control transition-colors flex items-center gap-1.5 max-w-[200px] ${value ? 'bg-accent/10 text-accent' : 'bg-wash hover:bg-line text-ink-muted'}`
          : 'bg-card border border-line rounded-control h-8 px-2.5 flex items-center gap-1.5 hover:bg-wash transition-colors text-ink-muted max-w-[190px]'}
        data-tooltip={tooltip}
        data-tooltip-icon-only={!(nodeMode && !value && !hasAgentControls) || undefined}
        data-tooltip-overflow={!(nodeMode && !value && !hasAgentControls) || undefined}
        aria-label={`${t('toolbar.model')} · ${triggerLabel || t('model.none')}`}
        aria-expanded={open}
        data-model-picker-trigger
        type="button"
      >
        {!hasAgentControls && <Cpu size={14} strokeWidth={1.75} className={`shrink-0 ${compact && !value ? '' : 'text-accent'}`} />}
        {fast && <Zap size={14} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />}
        <span className="text-control truncate font-medium">{label}</span>
        {hasAgentControls && effort && <span className="text-control shrink-0 text-accent">{effortLabel}</span>}
        <ChevronDown size={12} strokeWidth={1.75} className="shrink-0" />
      </button>

      {open && (
        <NodePickerPortal enabled={nodeMode}>
        <div ref={menuRef} className={nodeMode ? 'fixed z-[90] bg-card border border-line rounded-overlay shadow-lg py-1.5 w-80 max-w-[calc(calc(100*var(--ui-vw))-16px)] overflow-y-auto overscroll-contain nodrag nopan nowheel' : 'canvas-tool-panel canvas-model-menu'}
          style={nodeMode ? { visibility: 'hidden' } : panelPosition} data-type-surface="portal" data-model-picker-panel
          onPointerDown={event => { if (nodeMode) event.stopPropagation(); }}
          onDoubleClick={event => { if (nodeMode) event.stopPropagation(); }}
          onKeyDown={event => { if (hasAgentControls && event.key !== 'Escape') event.stopPropagation(); }}>
          {optionsView && (
            <div className="px-3 py-2" data-agent-model-options>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-start gap-2">
                {displayed?.supportsFast
                  ? <button type="button" className={`flex size-8 items-center justify-center rounded-control hover:bg-wash ${fast ? 'bg-accent/10 text-accent' : 'text-ink-muted'}`}
                      aria-pressed={fast} aria-label={t('model.fast')} data-tooltip={t('model.fast')} data-agent-fast
                      onClick={() => execution?.onAgentOptionsChange?.({ ...agentOptions, fast: !fast })}>
                      <Zap size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                  : <span />}
                <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
                  <span className="text-title font-medium text-accent" data-agent-effort-label>{effortLabel}</span>
                  <button ref={viewFocusRef} type="button" className="flex min-h-8 max-w-full items-center gap-1 rounded-control px-2 text-control text-ink-muted hover:bg-wash hover:text-ink"
                    onClick={() => setShowModels(true)} aria-label={`${t('model.chooseModel')} · ${label}`} data-agent-model-list>
                    <span className="truncate">{label}</span><ChevronRight size={14} className="shrink-0" aria-hidden />
                  </button>
                </div>
                {levels.length > 0 && <button type="button" className="flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-wash disabled:opacity-40"
                    disabled={!agentOptions?.effort} aria-label={t('model.resetEffort')} data-tooltip={t('model.resetEffort')} data-agent-effort-reset
                    onClick={() => execution?.onAgentOptionsChange?.({ ...agentOptions, effort: '' })}>
                    <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
                  </button>}
              </div>
              {sliderLevels.length > 1 && <input type="range" min={0} max={sliderLevels.length - 1} step={1} value={Math.max(0, effortIndex)}
                aria-label={t('model.effort')} aria-valuetext={effortLabel} data-agent-effort-slider data-cursor="resize-width"
                className="mt-1 block min-h-8 w-full accent-accent"
                onChange={event => execution?.onAgentOptionsChange?.({ ...agentOptions, effort: sliderLevels[event.currentTarget.valueAsNumber] })} />}
            </div>
          )}
          {hasAgentControls && showModels && (
            <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
              <button ref={viewFocusRef} type="button" className="flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-wash"
                onClick={() => setShowModels(false)} aria-label={t('model.backToOptions')} data-agent-model-back>
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
              </button>
              <span className="text-control font-medium text-ink">{t('model.chooseModel')}</span>
            </div>
          )}
          {nodeMode && !optionsView && (
            <button
              onClick={() => pick(null)}
              aria-pressed={!value}
              className={`w-full text-left px-3 py-1.5 text-control flex items-center gap-2 transition-colors hover:bg-wash ${!value ? 'text-accent font-medium' : 'text-ink'}`}
            >
              <span className="truncate flex-1">{t(executionKind ? 'nodeExecution.typeDefault' : 'model.inherit')}</span>
              {!value && <Check size={13} strokeWidth={2} className="shrink-0" />}
            </button>
          )}
          {hasAgentControls && showModels && models.map(model => (
            <button key={model.id} type="button" onClick={() => pick(model.id)}
              aria-pressed={model.id === activeId}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-control hover:bg-wash ${model.id === activeId ? 'font-medium text-accent' : 'text-ink'}`}>
              <span className="flex-1 break-words leading-snug">{displayModelName(model.id, model.name)}</span>
              {model.id === activeId && <Check size={13} strokeWidth={2} className="shrink-0" aria-hidden />}
            </button>
          ))}
          {nodeMode && !hasAgentControls && providers.map((provider) => (
            <div key={provider}>
              <p className="text-control text-ink-faint uppercase tracking-wider font-medium px-3 pt-2 pb-1 flex items-center gap-1.5" >
                {provider === AGENT_PROVIDER ? t('model.agentGroup') : provider}
                {provider === AGENT_PROVIDER && data?.agentsPending && <Loader2 size={11} className="animate-spin text-ink-faint" data-agent-group-pending />}
              </p>
              {provider === AGENT_PROVIDER && data?.agentsPending && models.filter((m) => m.provider === AGENT_PROVIDER).length === 0 && (
                <p className="text-control text-ink-faint px-3 pb-1.5">{t('model.agentGroupLoading')}</p>
              )}
              {provider === AGENT_PROVIDER ? (() => {
                const agentModels = models.filter((m) => m.provider === AGENT_PROVIDER);
                const groups = new Map<string, ModelInfo[]>();
                for (const m of agentModels) { const label = runtimeLabelOf(m.id); const list = groups.get(label) ?? []; list.push(m); groups.set(label, list); }
                const activeLabel = activeId ? runtimeLabelOf(activeId) : null;
                // runtimes the host looked for and did not find: named, with where it looked, and a way to ask again
                const missing = LIVE_RUNTIMES.filter((rt) => (!executionKind || (executionKind === 'codex' ? rt === 'codex' : rt !== 'codex')) && data?.runtimes?.[rt] && !data.runtimes[rt]!.installed && !groups.has(AGENT_RUNTIMES[rt].label));
                const missingRows = missing.map((rt) => {
                  const def = AGENT_RUNTIMES[rt];
                  return (
                    <div key={`missing-${rt}`} className="px-3 py-1.5 text-control flex items-center gap-2 text-ink-faint"  data-runtime-missing={rt}>
                      <span className="w-3 shrink-0" />
                      <span className="truncate">{fmt(t('model.runtimeMissing'), { name: def.label })}</span>
                      <button onClick={(e) => { e.stopPropagation(); void recheckAgents(); }} className="ml-auto text-control text-accent hover:underline shrink-0" data-runtime-recheck={rt}>{t('model.recheck')}</button>
                    </div>
                  );
                });
                return [...[...groups.entries()].map(([label, list]) => {
                  const isOpen = openRuntimes.has(label) || label === activeLabel || groups.size === 1;
                  const current = list.find((m) => m.id === activeId);
                  return (
                    <div key={label} data-runtime-group={label} data-runtime-open={isOpen ? 'open' : 'closed'}>
                      <button onClick={() => toggleRuntime(label)} className="w-full text-left px-3 py-1.5 text-control flex items-center gap-2 hover:bg-wash transition-colors text-ink-muted" data-runtime-toggle={label}>
                        {isOpen ? <ChevronDown size={12} strokeWidth={1.75} className="text-ink-faint shrink-0" /> : <ChevronRight size={12} strokeWidth={1.75} className="text-ink-faint shrink-0" />}
                        <span className="font-medium text-ink">{label}</span>
                        <span className="text-meta text-ink-faint">{list.length}</span>
                        {!isOpen && current && <span className="text-control text-accent truncate ml-auto max-w-[55%]">{modelName(current, { label, agent: true })}</span>}
                      </button>
                      {isOpen && list.map((m) => (
                        <button key={m.id} onClick={() => pick(m.id)}
                          aria-pressed={m.id === activeId}
                          className={`w-full text-left pl-8 pr-3 py-1.5 text-control flex items-center gap-2 transition-colors hover:bg-wash ${m.id === activeId ? 'text-accent font-medium' : 'text-ink'}`}>
                          <span className="flex-1 break-words leading-snug">{modelName(m, { label, agent: true })}</span>
                          {m.vision && <span className="text-control text-ink-faint shrink-0">{t('model.vision')}</span>}
                          {m.id === activeId && <Check size={13} strokeWidth={2} className="shrink-0" />}
                        </button>
                      ))}
                    </div>
                  );
                }), ...missingRows];
              })() : models.filter((m) => m.provider === provider).map((m) => (
                <button key={m.id}
                  onClick={() => pick(m.id)}
                  aria-pressed={m.id === activeId}
                  data-tooltip={m.name} data-tooltip-overflow
                  className={`w-full text-left px-3 py-1.5 text-control flex items-center gap-2 transition-colors hover:bg-wash ${
                    m.id === activeId ? 'text-accent font-medium' : 'text-ink'
                  }`}
                >
                  <span className="truncate flex-1">{m.name.replace(` (${m.provider})`, '')}</span>
                  {m.vision && <span className="text-control text-ink-faint shrink-0">{t('model.vision')}</span>}
                  {m.id === activeId && <Check size={13} strokeWidth={2} className="shrink-0" />}
                </button>
              ))}
            </div>
          ))}
          {nodeMode && executionKind && models.length === 0 && (executionKind === 'api' || !data?.agentsPending) && (
            <div className="px-3 py-2 text-control text-ink-muted" data-node-model-empty>
              <p>{t(executionKind === 'codex' ? 'nodeExecution.noCodexModels' : 'nodeExecution.noApiModels')}</p>
              <button type="button" className="mt-1 text-accent hover:underline" onClick={() => {
                setOpen(false);
                useUiStore.getState().setApiKeyModalOpen(true, executionKind === 'codex' ? 'agents' : 'providers');
              }}>{t(executionKind === 'codex' ? 'connection.agent' : 'connection.api')}</button>
            </div>
          )}
          {!nodeMode && <CanvasModelMenu
            models={<CanvasModelList models={models} activeId={activeId} pending={data?.agentsPending}
              onPick={pick} />}
            onSettings={() => { setOpen(false); useUiStore.getState().setApiKeyModalOpen(true, 'providers'); }}
          />}
        </div>
        </NodePickerPortal>
      )}
    </div>
  );
}
