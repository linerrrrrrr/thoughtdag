import { appSettings } from '../../lib/disk-storage';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useCanvasPanelPosition } from '../../lib/use-canvas-panel-position';
import { useCanvasToolCard } from '../../lib/use-canvas-tool-card';
import { uiRect, uiViewport } from '../../lib/ui-scale';
import { Check, ChevronDown, Cpu, Loader2, ChevronRight } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { useModels, ensureAgentsFresh, recheckAgents, type ModelInfo } from '../../lib/use-models';
import { AGENT_PROVIDER, AGENT_RUNTIMES, LIVE_RUNTIMES, isAgentModel, runtimeLabelOf } from '../../lib/agents/agent-runtime';
import CanvasModelMenu from './CanvasModelMenu';
import CanvasModelList from './CanvasModelList';
import CanvasModelSettings from './CanvasModelSettings';

// Agent-run models fold by runtime: each runtime lists many models, so only
// the runtime holding the current pick opens by itself; the others show their
// name, count and a chevron. Which are open is remembered.
const OPEN_RUNTIMES_KEY = 'thoughtdag.pickerOpenRuntimes';
const loadOpenRuntimes = (): Set<string> => { try { const v = JSON.parse(appSettings.getItem(OPEN_RUNTIMES_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
import { fmt } from '../../i18n';
import { useT } from '../../i18n';
import type { NodeExecutionKind } from '../../lib/node-execution';

interface PickerProps {
  /** Node mode: controlled value (undefined = inherit global) + change handler. */
  value?: string;
  onChange?: (id: string | undefined) => void;
  /** Compact styling for embedding in panel rows. */
  compact?: boolean;
  /** Available choices and inherited default for the node's execution type. */
  execution?: { kind: NodeExecutionKind; models: ModelInfo[]; inheritedModel?: string };
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
  const cardOpen = useCanvasToolCard('model', requestedOpen && !nodeMode, () => setOpen(false));
  const open = nodeMode ? requestedOpen : cardOpen;
  const panelPosition = useCanvasPanelPosition(open && !nodeMode, 'left');
  const anysearchKey = useUiStore(s => s.anysearchKey);
  // This credential draft lives only in this mounted control, never in the
  // generic draft cache. Outside dismissal suspends; Escape discards it.
  const [anysearchDraft, setAnysearchDraft] = useState(anysearchKey);
  // the effort step unfolded under a just-picked agent model (see pick); closes with the menu
  const [effortStepFor, setEffortStepFor] = useState<string | null>(null);
  const agentEffort = useUiStore((s) => s.agentEffort);
  const [openRuntimes, setOpenRuntimes] = useState<Set<string>>(loadOpenRuntimes);
  const toggleRuntime = (label: string) => setOpenRuntimes((prev) => { const next = new Set(prev); if (next.has(label)) next.delete(label); else next.add(label); try { appSettings.setItem(OPEN_RUNTIMES_KEY, JSON.stringify([...next])); } catch { /* per-session then */ } return next; });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!nodeMode || !open) return;
    let frame = 0;
    // A node can scroll, move, or zoom while its menu is open. Keep the
    // screen-space portal attached to its trigger and inside the viewport.
    const place = () => {
      const anchor = rootRef.current, menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = uiRect(anchor), viewport = uiViewport();
      const inset = 8, gap = 6;
      const belowSpace = Math.max(0, viewport.height - rect.bottom - gap - inset);
      const aboveSpace = Math.max(0, rect.top - gap - inset);
      const heightLimit = Math.max(0, Math.min(viewport.height * 0.6, viewport.height - inset * 2));
      const contentHeight = Math.min(heightLimit, menu.scrollHeight + menu.offsetHeight - menu.clientHeight);
      const below = belowSpace >= contentHeight || (aboveSpace < contentHeight && belowSpace >= aboveSpace);
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
  }, [nodeMode, open]);

  // the runtimes are asked for their catalogs the first time a picker
  // opens, not at launch: a CLI to start is seconds and memory the launch
  // should not pay for
  useEffect(() => { if (open) ensureAgentsFresh(); }, [open]);

  useDismissableLayer({ dismissOnFocusOutside: true, open, refs: [rootRef, menuRef], onDismiss: reason => {
    if (reason === 'escape') setAnysearchDraft(anysearchKey);
    setOpen(false);
  } });

  // A successful connect pings the GLOBAL picker open: the user lands on
  // their fresh model list instead of wondering whether anything happened.
  // (adjust-during-render, same pattern as FocusPanel's node switch)
  const ping = useUiStore((s) => s.modelPickerPing);
  const [pingSeen, setPingSeen] = useState(ping);
  if (ping !== pingSeen) {
    setPingSeen(ping);
    if (!nodeMode) { setEffortStepFor(null); setOpen(true); }
  }

  const executionKind = execution?.kind;
  const models = execution?.models ?? data?.models ?? [];
  // A generic node picker needs alternatives; execution-specific pickers
  // retain their setup action when their lane has no available model.
  if (nodeMode && !executionKind && models.length < 2) return null;

  const globalId = nodeMode && execution ? execution.inheritedModel
    : selectedModel && models.some((m) => m.id === selectedModel) ? selectedModel : data?.default;
  const activeId = nodeMode ? (value ?? null) : globalId;
  const active = activeId ? models.find((m) => m.id === activeId) : null;
  const providers = [...new Set(models.map((m) => m.provider))];
  // the agent group is listed while the runtimes are still answering, so the
  // picker has somewhere to say so
  if (executionKind !== 'api' && data?.agentsPending && !providers.includes(AGENT_PROVIDER)) providers.push(AGENT_PROVIDER);
  // a host that looked for runtimes and found none still gets the group: that is where the "not found" rows live
  if (executionKind !== 'api' && !providers.includes(AGENT_PROVIDER) && data?.runtimes && Object.values(data.runtimes).some((s) => s && !s.installed)) providers.push(AGENT_PROVIDER);


  // Picking an agent model that reports effort levels keeps the menu open and
  // unfolds the effort step right under the entry: the level is a decision the
  // person should see being made, not a row to discover later. OK closes.
  const pick = (id: string | null) => {
    if (nodeMode) onChange!(id ?? undefined);
    else setSelectedModel(id === data?.default ? null : id);
    const m = id ? models.find((x) => x.id === id) : null;
    if (m && isAgentModel(m.id) && (m.efforts?.length ?? 0) > 0) { setEffortStepFor(m.id); return; }
    setOpen(false);
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
    return effort ? `${name} · ${effort}` : name;
  };

  // a node without its own choice follows the global one: the button still
  // names that model in full (agent · model · effort), the tint says it is inherited
  const globalActive = globalId ? models.find((m) => m.id === globalId) : null;
  const label = nodeMode
    ? (active ? withEffort(active) : value ? (value.endsWith('/default') ? `${runtimeLabelOf(value)} · ${t('agent.defaultModel')}` : value) : (globalActive ? withEffort(globalActive) : executionKind === 'codex' ? t('nodeExecution.codexDefault') : executionKind ? t('nodeExecution.chooseModel') : t('model.inherit')))
    : (active ? withEffort(active) : activeId || t('model.catalogTab'));

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setEffortStepFor(null); setOpen((v) => !v);
        }}
        className={compact
          ? `text-control px-3 py-2 rounded-control transition-colors flex items-center gap-1.5 max-w-[200px] ${value ? 'bg-accent/10 text-accent' : 'bg-wash hover:bg-line text-ink-muted'}`
          : 'bg-card border border-line rounded-control h-8 px-2.5 flex items-center gap-1.5 hover:bg-wash transition-colors text-ink-muted max-w-[190px]'}
        data-tooltip={nodeMode && !value ? t('model.inherit') : `${t('toolbar.model')} · ${label ?? t('model.none')}`}
        data-tooltip-icon-only={!(nodeMode && !value) || undefined}
        data-tooltip-overflow={!(nodeMode && !value) || undefined}
        aria-label={`${t('toolbar.model')} · ${label ?? t('model.none')}`}
        aria-expanded={open}
        data-model-picker-trigger
      >
        <Cpu size={14} strokeWidth={1.75} className={`shrink-0 ${compact && !value ? '' : 'text-accent'}`} />
        <span className="text-control truncate font-medium">{label}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="shrink-0" />
      </button>

      {open && (
        <NodePickerPortal enabled={nodeMode}>
        <div ref={menuRef} className={nodeMode ? 'fixed z-[90] bg-card border border-line rounded-overlay shadow-lg py-1.5 w-80 max-w-[calc(calc(100*var(--ui-vw))-16px)] overflow-y-auto overscroll-contain nodrag nopan nowheel' : 'canvas-tool-panel canvas-model-menu'}
          style={nodeMode ? { visibility: 'hidden' } : panelPosition} data-model-picker-panel
          onPointerDown={event => { if (nodeMode) event.stopPropagation(); }}
          onDoubleClick={event => { if (nodeMode) event.stopPropagation(); }}>
          {nodeMode && (
            <button
              onClick={() => pick(null)}
              className={`w-full text-left px-3 py-1.5 text-control flex items-center gap-2 transition-colors hover:bg-wash ${!value ? 'text-accent font-medium' : 'text-ink'}`}
            >
              <span className="truncate flex-1">{t(executionKind ? 'nodeExecution.typeDefault' : 'model.inherit')}</span>
              {!value && <Check size={13} strokeWidth={2} className="shrink-0" />}
            </button>
          )}
          {nodeMode && providers.map((provider) => (
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
                        {!isOpen && current && <span className="text-control text-accent truncate ml-auto max-w-[55%]">{current.name.replace(`${label} · `, '')}</span>}
                      </button>
                      {isOpen && list.map((m) => (
                        <div key={m.id}>
                          <button
                            onClick={() => pick(m.id)}
                            className={`w-full text-left pl-8 pr-3 py-1.5 text-control flex items-center gap-2 transition-colors hover:bg-wash ${m.id === activeId ? 'text-accent font-medium' : 'text-ink'}`}
                          >
                            <span className="flex-1 break-words leading-snug">{m.name.replace(` (${m.provider})`, '').replace(`${label} · `, '')}</span>
                            {m.vision && <span className="text-control text-ink-faint shrink-0">{t('model.vision')}</span>}
                            {m.id === activeId && <Check size={13} strokeWidth={2} className="shrink-0" />}
                          </button>
                          {effortStepFor === m.id && <EffortStep model={m} onDone={() => { setEffortStepFor(null); setOpen(false); }} />}
                        </div>
                      ))}
                    </div>
                  );
                }), ...missingRows];
              })() : models.filter((m) => m.provider === provider).map((m) => (
                <div key={m.id}>
                <button
                  onClick={() => pick(m.id)}
                  data-tooltip={m.name} data-tooltip-overflow
                  className={`w-full text-left px-3 py-1.5 text-control flex items-center gap-2 transition-colors hover:bg-wash ${
                    m.id === activeId ? 'text-accent font-medium' : 'text-ink'
                  }`}
                >
                  {/* agent entries carry runtime · model · variant and tell apart only by
                      their tail, so they wrap instead of losing it to an ellipsis (#43) */}
                  <span className={provider === AGENT_PROVIDER ? 'flex-1 break-words leading-snug' : 'truncate flex-1'}>{m.name.replace(` (${m.provider})`, '')}</span>
                  {m.vision && <span className="text-control text-ink-faint shrink-0">{t('model.vision')}</span>}
                  {m.id === activeId && <Check size={13} strokeWidth={2} className="shrink-0" />}
                </button>
                {effortStepFor === m.id && <EffortStep model={m} onDone={() => { setEffortStepFor(null); setOpen(false); }} />}
              </div>
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
              onPick={pick} effortStepFor={effortStepFor}
              renderEffort={model => <EffortStep model={model} onDone={() => setOpen(false)} />} />}
            settings={<CanvasModelSettings anysearchDraft={anysearchDraft} setAnysearchDraft={setAnysearchDraft}
              onConnection={section => { setOpen(false); useUiStore.getState().setApiKeyModalOpen(true, section); }} />}
          />}
        </div>
        </NodePickerPortal>
      )}
    </div>
  );
}

// ── Effort step: unfolds under the agent model just picked ──
// The runtime's own levels, in its own words (read from the CLI, never
// translated). The first option is its default, named when it says. The
// choice is global like the model choice; OK closes the menu.
function EffortStep({ model, onDone }: { model: ModelInfo; onDone: () => void }) {
  const t = useT();
  const effort = useUiStore((s) => s.agentEffort);
  const setEffort = useUiStore((s) => s.setAgentEffort);
  const levels = model.efforts ?? [];
  const value = levels.includes(effort) ? effort : '';
  return (
    <div className="mx-3 mb-1.5 mt-0.5 rounded-content bg-wash/70 border border-line px-2 py-1.5 flex items-center gap-2" data-agent-effort>
      <span className="text-control text-ink-faint uppercase tracking-wider font-medium shrink-0">{t('model.effort')}</span>
      <select
        value={value}
        onChange={(e) => setEffort(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        autoFocus
        className="flex-1 min-w-0 text-control text-ink bg-card border border-line rounded-control px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent/40"
        data-agent-effort-select
        aria-label={t('model.effort')}
      >
        <option value="">{model.defaultEffort ? fmt(t('model.effortDefaultKnown'), { level: model.defaultEffort }) : t('model.effortDefault')}</option>
        {levels.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={(e) => { e.stopPropagation(); onDone(); }} className="text-control px-2 py-1 rounded-tag bg-action text-white hover:bg-action-strong transition-colors shrink-0" data-agent-effort-ok>{t('model.effortConfirm')}</button>
    </div>
  );
}
