import { useEffect, useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { fmt, useT } from '../../i18n';
import { apiVisionModels } from '../../lib/background-model';
import { runtimeOf } from '../../lib/agents/agent-runtime';
import { defaultModelId, groupBySource, modelName } from '../../lib/model-sources';
import { IN_HARNESS } from '../../lib/embedded';
import { effectiveProvider, JUDGE_LABELS, judgeConfigured, judgeTripped } from '../../lib/judge';
import { profileLines } from '../../lib/profile';
import { pushProviders, storedProviders } from '../../lib/runtime-providers';
import { toast, useUiStore } from '../../lib/ui-store';
import { ensureAgentsFresh, setModelsCache, useModels } from '../../lib/use-models';
import { isImeComposing } from '../../utils';
import CanvasSettingSwitch from '../CanvasSettingSwitch';
import '../CanvasLayoutPanel.css';
import './SettingsFields.css';

type ToolsSettingsProps = {
  anysearchDraft: string;
  setAnysearchDraft: (value: string) => void;
};

const fieldStyle = 'settings-field-control min-h-8 rounded-control border border-line bg-wash px-2 py-1 text-control text-ink focus-visible:outline-accent';

export function DefaultModelSettings() {
  const t = useT();
  const data = useModels();
  const selected = useUiStore(s => s.selectedModel);
  const descriptionId = useId();
  const models = data?.models ?? [];
  const sources = groupBySource(models);
  const active = defaultModelId(data, selected);

  useEffect(() => { void ensureAgentsFresh(); }, []);

  return <label className="settings-field-row" data-default-model-settings>
    <span>
      <span className="settings-field-title">{t('settingsAI.defaultModel')}</span>
      <span id={descriptionId} className="settings-field-hint">{t('settingsAI.defaultModelHint')}</span>
    </span>
    <select className={fieldStyle} value={active ?? ''} disabled={!models.length}
      aria-label={t('settingsAI.defaultModel')} aria-describedby={descriptionId}
      data-default-model-select onChange={event => {
        const id = event.target.value;
        useUiStore.getState().setSelectedModel(id === data?.default ? null : id);
      }}>
      {!active && <option value="" disabled>{t(models.length ? 'settingsAI.chooseModel' : 'model.none')}</option>}
      {active && !models.some(model => model.id === active) && <option value={active} disabled>{active}</option>}
      {sources.map(source => <optgroup key={source.key} label={source.label}>
        {source.models.map(model => <option key={model.id} value={model.id}>{modelName(model, source)}</option>)}
      </optgroup>)}
    </select>
  </label>;
}

export function AgentEffortSettings() {
  const t = useT();
  const data = useModels();
  const effort = useUiStore(s => s.agentEffort);
  const descriptionId = useId();
  const levels = [...new Set(data?.models.flatMap(model => {
    const runtime = runtimeOf(model.id);
    return runtime && window.desktopAgents && data.runtimes?.[runtime]?.installed ? model.efforts ?? [] : [];
  }))];

  return <label className="settings-field-row" data-agent-effort>
    <span>
      <span className="settings-field-title">{t('settingsAI.agentEffort')}</span>
      <span id={descriptionId} className="settings-field-hint">{t(levels.length ? 'settingsAI.effortHint' : 'settingsAI.effortUnavailable')}</span>
    </span>
    <select className={fieldStyle} value={effort} disabled={!levels.length && !effort} data-agent-effort-select
      aria-label={t('settingsAI.agentEffort')} aria-describedby={descriptionId}
      onChange={event => useUiStore.getState().setAgentEffort(event.target.value)}>
      <option value="">{t('settingsAI.runtimeDefault')}</option>
      {effort && !levels.includes(effort) && <option value={effort} disabled>{effort}</option>}
      {levels.map(level => <option key={level} value={level}>{level}</option>)}
    </select>
  </label>;
}

export function JudgeToggle() {
  const t = useT();
  const judge = useUiStore(s => s.judge);
  const setJudge = useUiStore(s => s.setJudge);
  const enabled = judge.provider !== 'off';
  const state = !enabled ? 'off' : !judgeConfigured(judge) ? 'no-api' : judgeTripped() ? 'tripped' : 'on';
  const status = state === 'on' ? JUDGE_LABELS[effectiveProvider(judge)]
    : state === 'no-api' ? t('model.settingsJudgeUnconfigured')
    : state === 'tripped' ? t('model.settingsJudgeUnavailable') : null;
  return <div data-picker-judge-row data-judge-state={state}>
    <CanvasSettingSwitch label={t('settingsAI.enableJudge')} checked={enabled} data-picker-judge-toggle
      description={status ?? undefined}
      onChange={() => setJudge(enabled ? { provider: 'off', prevProvider: judge.provider } : { provider: judge.prevProvider ?? 'none' })} />
  </div>;
}

export function ToolsSettings({ anysearchDraft, setAnysearchDraft }: ToolsSettingsProps) {
  const t = useT();
  const searchKeyId = useId();
  const engineHintId = useId();
  const data = useModels();
  const caps = data?.capabilities;
  const visionModels = apiVisionModels(data?.models ?? []);
  const visionPref = useUiStore(s => s.visionModelPref);
  const searchEngine = useUiStore(s => s.searchEnginePref);
  const anysearchKey = useUiStore(s => s.anysearchKey);
  const memoryEnabled = useUiStore(s => s.memoryEnabled);
  const memoryCount = useUiStore(s => profileLines(s.profile).length);
  const saveSearchKey = async () => {
    const key = anysearchDraft.trim();
    if (key === anysearchKey) return;
    useUiStore.getState().setAnysearchKey(key);
    setAnysearchDraft(key);
    toast('success', t(key ? 'caps.anysearchSaved' : 'caps.anysearchCleared'));
    const providers = storedProviders();
    if (providers.length) {
      try { setModelsCache(await pushProviders(providers)); } catch { /* The saved key remains available for the next refresh. */ }
    }
  };
  const showEngineHint = Boolean(caps?.webSearch && !IN_HARNESS && searchEngine === 'deepseek');
  return <div className="text-control text-ink" data-tools-settings>
    <div className="settings-field-section" data-picker-caps>
      {caps?.webSearch && !IN_HARNESS ? (
        <label className="settings-field-row">
          <span>
            <span className="settings-field-title">{t('caps.webSearch')}</span>
            {showEngineHint && <span id={engineHintId} className="settings-field-hint" data-deepseek-search-hint>
              {t(caps.deepseekSearch ? 'caps.deepseekHintBilled' : 'caps.deepseekHintNoKey')}
            </span>}
          </span>
          <select value={searchEngine} aria-label={t('caps.webSearch')} aria-describedby={showEngineHint ? engineHintId : undefined}
            onChange={event => useUiStore.getState().setSearchEnginePref(event.target.value)} className={fieldStyle}>
            <option value="server">{caps.searchEngine && caps.searchEngine !== 'default'
              ? fmt(t('caps.engineServer'), { engine: caps.searchEngine }) : t('caps.engineDefault')}</option>
            <option value="search_std">{t('caps.engineStd')}</option>
            <option value="search_pro">{t('caps.enginePro')}</option>
            {(caps.anysearch || anysearchKey || searchEngine === 'anysearch') && <option value="anysearch">{t('caps.engineAnysearch')}</option>}
            {(caps.deepseekSearch || searchEngine === 'deepseek') && <option value="deepseek">{t('caps.engineDeepseek')}</option>}
          </select>
        </label>
      ) : <div className="settings-field-row">
        <span className="settings-field-title">{t('caps.webSearch')}</span>
        <span className="settings-field-status">{t(!caps ? 'settingsAI.capabilitiesUnknown' : caps.webSearch ? 'model.settingsHostSearch' : 'model.settingsSearchUnavailable')}</span>
      </div>}
      {caps && !IN_HARNESS && (!caps.webSearch || searchEngine === 'anysearch') && <div className="settings-field-row">
        <div>
          <label htmlFor={searchKeyId} className="settings-field-title">{t('settingsAI.searchKey')}</label>
          <a href="https://www.anysearch.com" target="_blank" rel="noreferrer" className="mt-1 block w-fit text-accent hover:underline">
            {t('model.settingsGetSearchKey')}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <input id={searchKeyId} type="password" value={anysearchDraft} onChange={event => setAnysearchDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); void saveSearchKey(); } }}
            placeholder={t('caps.anysearchKeyPlaceholder')} data-anysearch-key className={fieldStyle} />
          <button type="button" disabled={anysearchDraft.trim() === anysearchKey} onClick={() => void saveSearchKey()}
            className="min-h-8 shrink-0 rounded-control px-2 py-1 text-accent hover:bg-wash disabled:opacity-40" data-anysearch-save>{t('common.save')}</button>
        </div>
      </div>}
      {visionModels.length ? <label className="settings-field-row">
        <span className="settings-field-title">{t('model.settingsImageModel')}</span>
        <select className={fieldStyle} value={visionModels.some(model => model.id === visionPref) ? visionPref : 'auto'}
          onChange={event => useUiStore.getState().setVisionModelPref(event.target.value)}>
          <option value="auto">{t('caps.visionAuto')}</option>
          {visionModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label> : <div className="settings-field-row">
        <span className="settings-field-title">{t('model.settingsImageModel')}</span>
        <span className="settings-field-status">{t(data ? 'model.settingsNoVision' : 'settingsAI.capabilitiesUnknown')}</span>
      </div>}
    </div>
    <div className="settings-field-section">
      <CanvasSettingSwitch label={t('caps.memory')} checked={memoryEnabled}
        onChange={() => useUiStore.getState().setMemoryEnabled(!memoryEnabled)} />
      <button type="button" className="flex min-h-8 w-fit items-center gap-1 rounded-control text-left text-control text-accent hover:underline focus-visible:outline-accent"
        onClick={() => {
          useUiStore.getState().setApiKeyModalOpen(false);
          useUiStore.getState().setMemoryManagerOpen(true);
        }} data-picker-memory>
        {fmt(t('settingsAI.manageMemory'), { n: memoryCount })}
        <ChevronRight size={14} aria-hidden="true" className="shrink-0" />
      </button>
    </div>
  </div>;
}
