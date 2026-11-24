import { appSettings } from '../../lib/disk-storage';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, RotateCcw, Zap } from 'lucide-react';
import { AgentSourceIcon, ApiSourceIcon, ModelIcon, SettingsIcon } from '../../lib/ui-icons';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useCanvasPanelPosition } from '../../lib/use-canvas-panel-position';
import { useCanvasToolCard } from '../../lib/use-canvas-tool-card';
import { followAnchoredMenu } from '../../lib/anchored-menu';
import { useUiStore } from '../../lib/ui-store';
import { useModels, ensureAgentsFresh, getModelsOnce, recheckAgents, type ModelInfo } from '../../lib/use-models';
import { isAgentModel, runtimeOf } from '../../lib/agents/agent-runtime';
import { defaultModelId, displayModelName, groupBySource, modelName } from '../../lib/model-sources';
import { fmt, useT } from '../../i18n';
import type { NodeExecutionKind } from '../../lib/node-execution';
import type { AgentTurnOptions } from '../../types';
import CanvasSettingSwitch from '../CanvasSettingSwitch';
import CanvasModelMenu from './CanvasModelMenu';
import CanvasModelList from './CanvasModelList';
import './AgentModelOptions.css';

export default function ModelPicker() {
  const t = useT();
  const selectedModel = useUiStore(s => s.selectedModel);
  const setSelectedModel = useUiStore(s => s.setSelectedModel);
  const agentEffort = useUiStore(s => s.agentEffort);
  const data = useModels();
  const [requestedOpen, setOpen] = useState(false);
  const open = useCanvasToolCard('model', requestedOpen, () => setOpen(false));
  const panelPosition = useCanvasPanelPosition(open, 'left');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) void ensureAgentsFresh(); }, [open]);
  useDismissableLayer({
    dismissOnFocusOutside: true, open, refs: [rootRef, menuRef], restoreFocusRef: triggerRef,
    onDismiss: () => setOpen(false),
  });

  const ping = useUiStore(s => s.modelPickerPing);
  const [pingSeen, setPingSeen] = useState(ping);
  if (ping !== pingSeen) {
    setPingSeen(ping);
    setOpen(true);
  }

  const models = data?.models ?? [];
  const activeId = defaultModelId(data, selectedModel);
  const displayed = models.find(model => model.id === activeId);
  let label = activeId ? displayModelName(activeId) : t('model.catalogTab');
  if (displayed) {
    const suffix = ' (' + displayed.provider + ')';
    const name = displayed.name.endsWith(suffix) ? displayed.name.slice(0, -suffix.length) : displayed.name;
    label = displayModelName(displayed.id, name);
    if (isAgentModel(displayed.id) && displayed.efforts?.length) {
      const effort = displayed.efforts.includes(agentEffort) ? agentEffort : displayed.defaultEffort;
      if (effort) label += ' · ' + effort;
    }
  }
  const description = t('toolbar.model') + ' · ' + label;
  return <div ref={rootRef} className="relative">
    <button ref={triggerRef} type="button" data-model-picker-trigger aria-expanded={open}
      className="bg-card border border-line rounded-control h-8 px-2.5 flex items-center gap-1.5 hover:bg-wash transition-colors text-ink-muted max-w-[190px]"
      data-tooltip={description} data-tooltip-icon-only data-tooltip-overflow aria-label={description}
      onClick={event => { event.stopPropagation(); setOpen(previous => !previous); }}>
      <ModelIcon size={14} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
      <span className="text-control truncate font-medium">{label}</span>
      <ChevronDown size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
    </button>
    {open && <div ref={menuRef} className="canvas-tool-panel canvas-model-menu" style={panelPosition}
      data-type-surface="portal" data-model-picker-panel>
      <CanvasModelMenu models={<CanvasModelList models={models} activeId={activeId} pending={data?.agentsPending}
        onPick={id => { setSelectedModel(id === data?.default ? null : id); setOpen(false); }} />}
        onSettings={() => { setOpen(false); useUiStore.getState().setApiKeyModalOpen(true, 'providers'); }} />
    </div>}
  </div>;
}

type ModelSource = ReturnType<typeof groupBySource>[number];
type SourceLane = 'api' | 'codex';
type SourceView = { lane: SourceLane; sourceKey?: string; direct?: boolean };
const SOURCE_MODEL_KEY = 'thoughtdag.lastDraftModelBySource';

function storedSourceModels(): Record<string, string> {
  try {
    const saved = JSON.parse(appSettings.getItem(SOURCE_MODEL_KEY) ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
  } catch { /* A fresh catalog still has source defaults. */ }
  return {};
}

function rememberSourceModel(sourceKey: string, modelId: string) {
  try { appSettings.setItem(SOURCE_MODEL_KEY, JSON.stringify({ ...storedSourceModels(), [sourceKey]: modelId })); }
  catch { /* The explicit choice is already in the draft. */ }
}

function effortName(level: string): string {
  return level.toLowerCase() === 'xhigh' ? 'XHigh' : level.charAt(0).toUpperCase() + level.slice(1);
}

function modelEffort(model: ModelInfo | undefined, options: AgentTurnOptions | undefined, preference: string) {
  const levels = model?.efforts ?? [];
  const defaultEffort = model?.defaultEffort;
  const inherited = levels.includes(preference) ? preference
    : defaultEffort && levels.includes(defaultEffort) ? defaultEffort : undefined;
  const effort = options?.effort && levels.includes(options.effort) ? options.effort : inherited;
  return { levels, inherited, effort };
}

function modelFast(model: ModelInfo | undefined, options?: AgentTurnOptions): boolean {
  return !!model?.supportsFast && (options?.fast ?? model.defaultFast) === true;
}

function AgentModelParameters({ model, options, preference, onChange }: {
  model?: ModelInfo;
  options?: AgentTurnOptions;
  preference: string;
  onChange: (options: AgentTurnOptions) => void;
}) {
  const t = useT();
  const { levels, inherited, effort } = modelEffort(model, options, preference);
  const sliderLevels = inherited ? levels : ['', ...levels];
  const effortIndex = Math.max(0, sliderLevels.indexOf(effort ?? ''));
  const effortLabel = effort ? effortName(effort) : t('model.effortDefault');
  const selectedLevel = levels.indexOf(effort ?? '');
  const fast = modelFast(model, options);
  const setEffort = (level: string) => onChange({ ...options, effort: level });

  return <div className="agent-options-parameters">
    <div className="agent-options-heading text-control">
      <span>{t('model.effort')}</span>
      {levels.length > 0 && <button type="button" className="agent-options-reset" data-agent-effort-reset
        disabled={!options?.effort} aria-label={t('model.resetEffort')} data-tooltip={t('model.resetEffort')}
        onClick={() => setEffort('')}>
        <RotateCcw size={15} strokeWidth={1.75} aria-hidden />
      </button>}
    </div>
    <span className="agent-options-value text-page" aria-live="polite" data-agent-effort-label>{effortLabel}</span>
    {levels.length > 0 && <div className="agent-options-bars" role="group" aria-label={t('model.effort')}>
      {levels.map((level, index) => (
        <button key={level} type="button" aria-label={effortName(level)} aria-pressed={level === effort}
          data-tooltip={effortName(level)} data-filled={index < selectedLevel || undefined} onClick={() => setEffort(level)}>
          <span style={{ height: ((index + 1) * 100 / levels.length) + '%' }} />
        </button>
      ))}
    </div>}
    {sliderLevels.length > 1 && <input type="range" min={0} max={sliderLevels.length - 1}
      step={1} value={effortIndex} aria-label={t('model.effort')} aria-valuetext={effortLabel}
      data-agent-effort-slider data-cursor="resize-width" className="agent-options-slider"
      style={{ '--effort-fill': (effortIndex * 100 / (sliderLevels.length - 1)) + '%' } as CSSProperties}
      onChange={event => setEffort(sliderLevels[event.currentTarget.valueAsNumber])} />}
    {model?.supportsFast && <div className="agent-options-speed">
      <Zap size={15} strokeWidth={1.75} aria-hidden />
      <CanvasSettingSwitch label="Fast" aria-label={t('model.fast')} checked={fast} data-agent-fast
        onChange={() => onChange({ ...options, fast: !fast })} />
    </div>}
  </div>;
}

interface DraftExecutionPickerProps {
  kind: NodeExecutionKind;
  models: ModelInfo[];
  value?: string;
  inheritedModel?: string;
  agentOptions?: AgentTurnOptions;
  onPick: (id: string) => void;
  onAgentOptionsChange: (options: AgentTurnOptions | undefined) => void;
  variant?: 'landing' | 'node';
}

export function DraftExecutionPicker({
  kind, models, value, inheritedModel, agentOptions, onPick, onAgentOptionsChange, variant = 'node',
}: DraftExecutionPickerProps) {
  const t = useT();
  const data = useModels();
  const preference = useUiStore(s => s.agentEffort);
  const [view, setView] = useState<SourceView | null>(null);
  const [apiPending, setApiPending] = useState(false);
  const [apiFailed, setApiFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const open = view !== null;
  const groups = groupBySource(models);
  const activeId = value ?? inheritedModel;
  const activeSource = groups.find(source => source.models.some(model => model.id === activeId));
  const activeModel = activeSource?.models.find(model => model.id === activeId);
  const viewSource = groups.find(source => source.key === view?.sourceKey);
  const visibleSources = groups.filter(source => source.agent === (view?.lane === 'codex'));
  const split = !!viewSource?.models.some(model => runtimeOf(model.id) === 'codex' && (model.efforts?.length || model.supportsFast));
  const pending = view?.lane === 'codex' ? data?.agentsPending : apiPending;
  const lane = kind === 'api' ? 'api' : 'codex';
  const effort = modelEffort(activeModel, agentOptions, preference).effort;
  const fast = modelFast(activeModel, agentOptions);
  const rememberedNames = view ? storedSourceModels() : {};
  const catalogModel = data?.models.find(model => model.id === activeId);
  const activeLabel = activeModel && activeSource ? modelName(activeModel, activeSource)
    : activeId && !activeId.endsWith('/default') ? displayModelName(activeId, catalogModel?.name) : t('model.chooseModel');
  const effortLabel = kind === 'codex' && effort ? effortName(effort) : undefined;
  const description = [t('toolbar.model'), activeLabel, effortLabel, fast ? t('model.fast') : undefined].filter(Boolean).join(' · ');

  function loadApiSources() {
    setApiPending(true);
    setApiFailed(false);
    void getModelsOnce().then(result => setApiFailed(!result), () => setApiFailed(true)).finally(() => setApiPending(false));
  }

  function browse(event: MouseEvent<HTMLButtonElement>, nextLane: SourceLane, sourceKey?: string, direct?: boolean) {
    openerRef.current = event.currentTarget;
    if (view?.lane === nextLane && view.sourceKey === sourceKey) {
      setView(null);
      return;
    }
    setView({ lane: nextLane, sourceKey, direct });
    if (nextLane === 'codex') void ensureAgentsFresh();
    else if (!data) loadApiSources();
  }

  function preferredModel(source: ModelSource): ModelInfo {
    return source.models.find(model => model.id === activeId)
      ?? source.models.find(model => model.id === rememberedNames[source.key])
      ?? source.models.find(model => model.sourceDefault)
      ?? source.models.find(model => model.id === data?.default)
      ?? source.models[0];
  }

  function chooseSource(source: ModelSource) {
    const picked = preferredModel(source);
    rememberSourceModel(source.key, picked.id);
    onPick(picked.id);
    setView({ lane: source.agent ? 'codex' : 'api', sourceKey: source.key });
  }

  function selectModel(source: ModelSource, model: ModelInfo) {
    rememberSourceModel(source.key, model.id);
    onPick(model.id);
    if (!split) {
      setView(null);
      openerRef.current?.focus({ preventScroll: true });
    }
  }

  function manageConnections(sourceLane: SourceLane) {
    // The settings dialog captures its opener before moving focus inside.
    openerRef.current?.focus({ preventScroll: true });
    setView(null);
    useUiStore.getState().setApiKeyModalOpen(true, sourceLane === 'api' ? 'providers' : 'agents');
  }

  const showSources = () => setView(current => current && { lane: current.lane });
  const escapeToSources = !!viewSource && !view?.direct;
  useDismissableLayer({
    dismissOnFocusOutside: true, open, refs: [rootRef, menuRef], restoreFocusRef: openerRef, restoreFocus: !escapeToSources,
    onDismiss: reason => { if (reason === 'escape' && escapeToSources) showSources(); else setView(null); },
  });

  useLayoutEffect(() => {
    const anchor = openerRef.current;
    const menu = menuRef.current;
    if (!view || !anchor || !menu) return;
    if (!split) return followAnchoredMenu(anchor, menu, anchor.hasAttribute('data-model-picker-trigger') ? 'end' : 'start');

    const composer = anchor.closest<HTMLElement>('.landing-composer, .node-question-composer, .focus-message-editor') ?? document.documentElement;
    let previousLayoutWidth: number | undefined;
    let centerFraction = 0.5;
    return followAnchoredMenu(anchor, menu, (rect, width) => {
      // Keep the split panel centered through label changes; a resized composer can wrap its trigger.
      const bounds = composer.getBoundingClientRect();
      if (composer.offsetWidth !== previousLayoutWidth && bounds.width > 0) {
        previousLayoutWidth = composer.offsetWidth;
        centerFraction = (rect.left + rect.width / 2 - bounds.left) / bounds.width;
      }
      return bounds.left + centerFraction * bounds.width - width / 2;
    });
  }, [view, split]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const next = menu?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      ?? menu?.querySelector<HTMLButtonElement>('button');
    const list = next?.closest<HTMLElement>('[data-draft-model-list]');
    if (list && next && list.classList.contains('agent-options-list')) {
      list.scrollTop = next.offsetTop - (list.clientHeight - next.offsetHeight) / 2;
    } else if (menu && next) {
      const targetBottom = next.getBoundingClientRect().bottom;
      const menuBottom = menu.getBoundingClientRect().bottom;
      if (targetBottom > menuBottom) menu.scrollTop += targetBottom - menuBottom;
    }
    next?.focus({ preventScroll: true });
  }, [open, view?.lane, viewSource?.key]);

  return <div ref={rootRef} className="contents">
    <div className={variant === 'landing' ? 'landing-execution-options' : 'draft-execution-options flex items-center gap-1'} role="group" aria-label={t('nodeExecution.type')}>
      {(['api', 'codex'] as const).map(option => {
        const SourceIcon = option === 'api' ? ApiSourceIcon : AgentSourceIcon;
        const label = t(option === 'api' ? 'nodeExecution.api' : 'settings.agents');
        const sourceLabel = option === lane ? activeSource?.label : undefined;
        const modeLabel = sourceLabel ? (option === 'api' ? 'API' : 'Agent') + ' · ' + sourceLabel : label;
        const selectedStyle = lane === option ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-line/50';
        return <button key={option} type="button" aria-label={sourceLabel ? label + ' · ' + sourceLabel : label} aria-pressed={lane === option}
          aria-controls={view?.lane === option && !view.direct ? panelId : undefined}
          aria-expanded={view?.lane === option && !view.direct && !viewSource}
          data-node-execution-option={option} data-tooltip={modeLabel} data-tooltip-overflow data-tooltip-icon-only
          className={variant === 'landing' ? 'draft-execution-button text-control' : 'draft-execution-button h-8 px-2.5 rounded-control text-control transition-colors ' + selectedStyle}
          onClick={event => browse(event, option)}>
          {variant === 'node' && <SourceIcon className="hidden" size={15} strokeWidth={1.75} aria-hidden />}
          <span className="draft-execution-label">{modeLabel}</span>
          <ChevronDown className="draft-execution-chevron shrink-0" size={12} strokeWidth={1.75} aria-hidden />
        </button>;
      })}
    </div>
    <div className="relative draft-model-trigger-anchor">
      <button type="button"
        className={'text-control px-3 py-2 rounded-control transition-colors flex items-center gap-1.5 max-w-[200px] ' + (value ? 'bg-accent/10 text-accent' : 'bg-wash hover:bg-line text-ink-muted')}
        aria-label={description} aria-expanded={open && !!view?.direct} aria-controls={view?.direct ? panelId : undefined}
        data-tooltip={description} data-tooltip-icon-only data-tooltip-overflow data-model-picker-trigger
        onClick={event => browse(event, lane, activeSource?.key, true)}>
        <ModelIcon size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
        <span className="truncate font-medium">{activeLabel}</span>
        {effortLabel && <span className="shrink-0 text-accent">{effortLabel}</span>}
        {fast && <Zap size={14} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />}
        <ChevronDown size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
      </button>
    </div>
    {view && createPortal(
      <div ref={menuRef} id={panelId}
        className={'fixed z-[90] bg-card border border-line rounded-overlay shadow-lg overflow-y-auto overscroll-contain nodrag nopan nowheel draft-source-panel' + (split ? ' agent-options-portal' : '')}
        data-type-surface="portal" data-model-picker-panel
        onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}>
        {viewSource ? <>
          <div className="draft-source-heading text-control">
            <button type="button" className="draft-source-back" data-draft-source-back
              aria-label={fmt(t('model.backToSources'), { source: view.lane === 'api' ? 'API' : 'Agent' })}
              onClick={showSources}>
              <ChevronLeft size={15} strokeWidth={1.75} aria-hidden />
              <span>{view.lane === 'api' ? 'API' : 'Agent'}</span>
            </button>
            <span className="draft-source-divider" aria-hidden>/</span>
            <span className="draft-source-title">{[viewSource.label, viewSource.detail].filter(Boolean).join(' · ')}</span>
          </div>
          <div className={split ? 'agent-options-grid' : undefined} data-agent-model-options={split || undefined}>
            <div className={split ? 'agent-options-catalog' : undefined}>
              {split && <div className="agent-options-heading text-control">{t('model.shortTitle')}</div>}
              <div className={split ? 'agent-options-list nowheel' : 'draft-source-list'} role="group" aria-label={t('model.chooseModel')}
                data-draft-model-list data-agent-model-list={split || undefined}>
                {viewSource.models.map(model => {
                  const selected = model.id === activeModel?.id;
                  const label = modelName(model, viewSource);
                  return <button key={model.id} type="button" className="agent-options-model text-control"
                    data-draft-model-option={model.id} aria-pressed={selected} data-tooltip={label} data-tooltip-overflow
                    onClick={() => selectModel(viewSource, model)}>
                    <span>{label}</span>{selected && <Check size={14} strokeWidth={1.75} aria-hidden />}
                  </button>;
                })}
              </div>
            </div>
            {split && <AgentModelParameters model={activeModel} options={agentOptions} preference={preference} onChange={onAgentOptionsChange} />}
          </div>
        </> : <div data-draft-source-list={view.lane}>
          <div className="draft-source-heading text-control">
            <span className="draft-source-title">{t(view.lane === 'api' ? 'model.chooseApiSource' : 'model.chooseAgentSource')}</span>
          </div>
          <div className="draft-source-list">
            {visibleSources.map(source => {
              const SourceIcon = source.agent ? AgentSourceIcon : ApiSourceIcon;
              const preview = preferredModel(source);
              const selected = source.key === activeSource?.key;
              const remembered = preview.id === rememberedNames[source.key] || preview.id === value;
              const previewLabel = fmt(t(remembered ? 'model.sourceLastUsed' : 'model.sourceDefault'), {
                model: modelName(preview, source),
              });
              return <button key={source.key} type="button" className="agent-options-model draft-source-option text-control"
                data-draft-model-source={source.key} aria-pressed={selected}
                onClick={() => chooseSource(source)}>
                <span className="draft-source-icon" aria-hidden>
                  <SourceIcon size={15} strokeWidth={1.75} />
                </span>
                <span className="draft-source-option-name">
                  <span className="font-medium">{source.label}</span>
                  <span className="text-meta text-ink-muted">{[source.detail, previewLabel].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="draft-source-trailing" aria-hidden>
                  {selected && <Check size={14} strokeWidth={1.75} />}
                  <ChevronRight size={14} strokeWidth={1.75} />
                </span>
              </button>;
            })}
            {pending && <div className="draft-source-status text-control" role="status">
              <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />{t('connection.checking')}
            </div>}
            {!pending && visibleSources.length === 0 && <div className="draft-source-status text-control" data-node-model-empty>
              <span>{t(view.lane === 'codex' ? 'connection.agentUnavailable'
                : apiFailed ? 'model.apiSourcesUnavailable' : 'nodeExecution.noApiModels')}</span>
              {(view.lane === 'codex' || apiFailed) && <button type="button" className="text-accent hover:underline shrink-0"
                data-draft-source-retry onClick={() => view.lane === 'codex' ? void recheckAgents() : loadApiSources()}>{t('model.recheck')}</button>}
            </div>}
          </div>
          <div className="draft-source-footer">
            <button type="button" className="agent-options-model text-control" data-draft-manage-connections
              onClick={() => manageConnections(view.lane)}>
              <SettingsIcon size={15} strokeWidth={1.75} aria-hidden /><span>{t('model.manageConnections')}</span>
            </button>
          </div>
        </div>}
      </div>,
      document.body,
    )}
  </div>;
}
