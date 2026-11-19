import { ChevronRight, KeyRound, SquareTerminal } from 'lucide-react';
import { fmt, useT } from '../../i18n';
import { apiVisionModels } from '../../lib/background-model';
import { IN_HARNESS } from '../../lib/embedded';
import { effectiveProvider, JUDGE_LABELS, judgeConfigured, judgeTripped } from '../../lib/judge';
import { profileLines } from '../../lib/profile';
import { pushProviders, storedProviders } from '../../lib/runtime-providers';
import { toast, useUiStore } from '../../lib/ui-store';
import { setModelsCache, useModels } from '../../lib/use-models';
import { isImeComposing } from '../../utils';
import CanvasTypographySettings from './CanvasTypographySettings';
import ConnectionLayoutControls from '../ConnectionLayoutControls';
import '../CanvasLayoutPanel.css';

type SettingsProps = {
  anysearchDraft: string;
  setAnysearchDraft: (value: string) => void;
  onConnection: (section: 'providers' | 'agents' | 'judge') => void;
};

const linkStyle = 'flex min-h-8 min-w-0 items-center gap-2 rounded-control px-2 py-1 text-left text-control text-ink hover:bg-wash focus-visible:outline-accent';
const fieldStyle = 'min-w-0 w-full min-h-8 rounded-control border border-line bg-wash px-2 py-1 text-control text-ink focus-visible:outline-accent';

function JudgeRow({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const judge = useUiStore(s => s.judge);
  const setJudge = useUiStore(s => s.setJudge);
  const enabled = judge.provider !== 'off';
  const state = !enabled ? 'off' : !judgeConfigured(judge) ? 'no-api' : judgeTripped() ? 'tripped' : 'on';
  const status = state === 'on' ? JUDGE_LABELS[effectiveProvider(judge)]
    : state === 'no-api' ? t('model.settingsJudgeUnconfigured')
    : state === 'tripped' ? t('model.settingsJudgeUnavailable') : null;
  return <div className="flex items-center gap-2" data-picker-judge-row data-judge-state={state}>
    <button type="button" onClick={onOpen} className={linkStyle + ' flex-1 justify-between'} data-picker-judge>
      <span className="min-w-0">
        <span className="block">{t('judge.pickerEntry')}</span>
        {status && <span className="block text-control text-ink-muted">{status}</span>}
      </span>
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-faint" />
    </button>
    <button type="button" role="switch" aria-checked={enabled} aria-label={t('judge.pickerEntry')}
      onClick={() => setJudge(enabled ? { provider: 'off', prevProvider: judge.provider } : { provider: judge.prevProvider ?? 'none' })}
      className="canvas-routing-switch" data-picker-judge-toggle>
      <span className="canvas-routing-switch-track"><span /></span>
    </button>
  </div>;
}

export default function CanvasModelSettings({ anysearchDraft, setAnysearchDraft, onConnection }: SettingsProps) {
  const t = useT();
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
    toast('success', t(key ? 'caps.anysearchSaved' : 'caps.anysearchCleared'));
    const providers = storedProviders();
    if (providers.length) {
      try { setModelsCache(await pushProviders(providers)); } catch { /* The saved key remains available for the next refresh. */ }
    }
  };
  return <div className="text-control text-ink" data-model-settings>
    <div className="grid grid-cols-2 gap-1 px-2 py-2">
      <button type="button" className={linkStyle} onClick={() => onConnection('providers')} data-picker-apikey>
        <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-muted" />
        {t('connection.api')}
      </button>
      <button type="button" className={linkStyle} onClick={() => onConnection('agents')} data-picker-agent>
        <SquareTerminal size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-muted" />
        {t('connection.agent')}
      </button>
    </div>
    <CanvasTypographySettings />
    <div className="border-t border-line px-4 py-3"><ConnectionLayoutControls /></div>
    <div className="grid gap-1 border-t border-line px-2 py-2">
      <JudgeRow onOpen={() => onConnection('judge')} />
      <div className="flex items-center gap-2">
        <button type="button" className={linkStyle + ' flex-1'} onClick={() => useUiStore.getState().setMemoryManagerOpen(true)} data-picker-memory>
          <span className="flex-1">{t('caps.memory')}</span>
          <span className="text-ink-muted">{fmt(t('model.settingsMemoryCount'), { n: memoryCount })}</span>
          <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-faint" />
        </button>
        <button type="button" role="switch" aria-checked={memoryEnabled} aria-label={t('caps.memory')}
          onClick={() => useUiStore.getState().setMemoryEnabled(!memoryEnabled)} className="canvas-routing-switch">
          <span className="canvas-routing-switch-track"><span /></span>
        </button>
      </div>
    </div>
    {data && <div className="grid gap-3 border-t border-line px-4 py-3" data-picker-caps>
      {caps && <div className="grid gap-1">
        {caps.webSearch && !IN_HARNESS ? (
          <label className="grid gap-1">
            {t('caps.webSearch')}
            <select value={searchEngine} onChange={event => useUiStore.getState().setSearchEnginePref(event.target.value)} className={fieldStyle}>
              <option value="server">{caps.searchEngine && caps.searchEngine !== 'default'
                ? fmt(t('caps.engineServer'), { engine: caps.searchEngine }) : t('caps.engineDefault')}</option>
              <option value="search_std">{t('caps.engineStd')}</option>
              <option value="search_pro">{t('caps.enginePro')}</option>
              {(caps.anysearch || anysearchKey || searchEngine === 'anysearch') && <option value="anysearch">{t('caps.engineAnysearch')}</option>}
              {(caps.deepseekSearch || searchEngine === 'deepseek') && <option value="deepseek">{t('caps.engineDeepseek')}</option>}
            </select>
          </label>
        ) : <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span>{t('caps.webSearch')}</span>
          <span className="text-ink-muted">{t(caps.webSearch ? 'model.settingsHostSearch' : 'model.settingsSearchUnavailable')}</span>
        </div>}
        {!IN_HARNESS && (!caps.webSearch || searchEngine === 'anysearch') && <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <input type="password" value={anysearchDraft} onChange={event => setAnysearchDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); void saveSearchKey(); } }}
              aria-label={t('caps.anysearchKeyPlaceholder')} placeholder={t('caps.anysearchKeyPlaceholder')}
              data-anysearch-key className={fieldStyle} />
            <button type="button" disabled={anysearchDraft.trim() === anysearchKey} onClick={() => void saveSearchKey()}
              className="shrink-0 rounded-control px-2 py-1 text-accent hover:bg-wash disabled:opacity-40" data-anysearch-save>{t('common.save')}</button>
          </div>
          <a href="https://www.anysearch.com" target="_blank" rel="noreferrer" className="w-fit text-ink-muted underline hover:text-accent">
            {t('model.settingsGetSearchKey')}
          </a>
        </div>}
        {!IN_HARNESS && caps.webSearch && searchEngine === 'deepseek' &&
          <p className="text-ink-muted" data-deepseek-search-hint>{t(caps.deepseekSearch ? 'caps.deepseekHintBilled' : 'caps.deepseekHintNoKey')}</p>}
      </div>}
      {visionModels.length ? <label className="grid gap-1">
        {t('model.settingsImageModel')}
        <select className={fieldStyle} value={visionModels.some(model => model.id === visionPref) ? visionPref : 'auto'}
          onChange={event => useUiStore.getState().setVisionModelPref(event.target.value)}>
          <option value="auto">{t('caps.visionAuto')}</option>
          {visionModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label> : <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span>{t('model.settingsImageModel')}</span>
        <span className="text-ink-muted">{t('model.settingsNoVision')}</span>
      </div>}
    </div>}
  </div>;
}
