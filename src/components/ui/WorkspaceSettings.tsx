import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { useCanvasToolCard } from '../../lib/use-canvas-tool-card';
import { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Loader2, Plus, Trash2, X, Pencil } from 'lucide-react';
import { ImageInputIcon, JudgeIcon, SettingsIcon } from '../../lib/ui-icons';
import { startOpenRouterOAuth } from '../../lib/openrouter-oauth';
import { useUiStore, toast } from '../../lib/ui-store';
import { canvasTypographyDraftKey } from '../../lib/canvas-typography-preferences';
import { useModels, setModelsCache } from '../../lib/use-models';
import {
  PROVIDER_PRESETS, type ProviderPreset, type RuntimeModel, type RuntimeProvider,
  createRuntimeProviderId, guessVision, probeModels, pushProviders, saveProviders, storedProviders,
} from '../../lib/runtime-providers';
import { useT, fmt, useI18n } from '../../i18n';
import JudgeSettings from './JudgeSettings';
import { judgeConfigured } from '../../lib/judge';
import { apiVisionModels } from '../../lib/background-model';
import { modelExecutionKind } from '../../lib/node-execution';
import AgentConnectionSection from './AgentConnectionSection';
import { restoreCanvasToolbarFocus } from '../../lib/use-responsive-canvas-header';

import { NodePreferences, InterfacePreferences } from '../CanvasPreferences';
import EdgeRoutingControls from '../EdgeRoutingControls';
import { AgentEffortSettings, DefaultModelSettings, JudgeToggle, ToolsSettings } from './CanvasModelSettings';
import SettingsNavigation from './SettingsNavigation';
import '../../design-system/settings-spacing.css';
import './WorkspaceSettings.css';

export default function WorkspaceSettings() {
  const t = useT();
  const requestedOpen = useUiStore((s) => s.apiKeyModalOpen);
  const setOpen = useUiStore((s) => s.setApiKeyModalOpen);
  const open = useCanvasToolCard('settings', requestedOpen, () => setOpen(false));
  const data = useModels();
  const [providers, setProviders] = useState<RuntimeProvider[]>(() => storedProviders());
  useEffect(() => { if (open) setProviders(storedProviders()); }, [open]);
  const section = useUiStore(s => s.apiKeyModalSection);
  const apiPage = section === 'providers';
  const judgeCfg = useUiStore(s => s.judge);
  const [justAdded, setJustAdded] = useState(false);
  useEffect(() => { if (open) setJustAdded(false); }, [open]);
  // A credential draft stays in this mounted component and never enters persistent storage.
  const [anysearchDraft, setAnysearchDraft] = useState(() => useUiStore.getState().anysearchKey);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  // Landing quick-connect: open straight onto the recommended preset
  const presetHint = useUiStore((s) => s.apiKeyPresetHint);
  useEffect(() => {
    if (!open || !presetHint) return;
    const p = PROVIDER_PRESETS.find((x) => x.id === presetHint);
    if (p) { setAdding(true); setEditingId(undefined); setKey(''); setCustomName(''); setPreset(p); setProbed(null); setPicked(new Map()); }
    useUiStore.getState().setApiKeyPresetHint(null);
  }, [open, presetHint]);
  // OAuth pickup: a freshly minted key opens the model-picking view — key
  // filled, catalog probed, recommended set pre-checked. The USER saves;
  // nothing is registered on their behalf.
  const mintedKey = useUiStore((s) => s.oauthMintedKey);
  useEffect(() => {
    if (!open || !mintedKey) return;
    useUiStore.getState().setOauthMintedKey(null);
    const p = PROVIDER_PRESETS.find((x) => x.id === 'openrouter')!;
    setAdding(true);
    setEditingId(undefined);
    setCustomName('');
    setPreset(p);
    setKey(mintedKey);
    void doProbe(p.baseURL, mintedKey, undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mintedKey]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // ── add-flow state ──
  const lang = useI18n((st) => st.lang);
  // Region twins (智谱/Z.ai, Kimi cn/intl) collapse to the one matching the
  // UI language — the same provider never appears twice in the row.
  const visiblePresets = PROVIDER_PRESETS.filter((p) => !p.region || p.region === lang);
  const [preset, setPreset] = useState<ProviderPreset>(visiblePresets[0]);
  const [key, setKey] = useState('');
  const [customURL, setCustomURL] = useState('');
  const [customName, setCustomName] = useState('');
  const [probed, setProbed] = useState<RuntimeModel[] | null>(null);
  const [picked, setPicked] = useState<Map<string, boolean>>(new Map()); // id → vision
  const [filter, setFilter] = useState('');
  const [sortMode, setSortMode] = useState<'time' | 'name'>('time');
  const [initialPicked, setInitialPicked] = useState<Set<string>>(new Set());

  const apiModels = useMemo(() => (data?.models ?? []).filter(model => model.provider !== '__agent__' && modelExecutionKind(model.id) === 'api'), [data]);
  const serverModels = useMemo(
    () => apiModels.filter(m => !providers.some(p => m.sourceId ? p.id === m.sourceId : p.models.some(x => x.id === m.id))),
    [apiModels, providers],
  );
  const visionCount = apiVisionModels(apiModels).length;

  const resetAdd = () => {
    setAdding(false); setEditingId(undefined); setProbed(null); setPicked(new Map()); setKey(''); setCustomURL(''); setCustomName(''); setFilter(''); setError('');
  };
  const layerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const backdropPress = useRef(false);
  useLayoutEffect(() => {
    if (!requestedOpen) return;
    const focused = document.activeElement;
    openerRef.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
  }, [requestedOpen]);
  const closeSettings = () => {
    setOpen(false);
    const opener = openerRef.current;
    restoreCanvasToolbarFocus(opener?.isConnected && opener.getClientRects().length
      ? opener : document.querySelector('[data-settings-entry]'));
  };
  useDismissableLayer({
    open, refs: [layerRef], modal: true, restoreFocus: false, dismissOnOutside: false,
    onDismiss: reason => {
      if (reason === 'escape' && section === 'nodes') useUiStore.getState().setDraft(canvasTypographyDraftKey, '');
      if (apiPage) resetAdd();
      if (section === 'tools') setAnysearchDraft(useUiStore.getState().anysearchKey);
      closeSettings();
    },
  });

  if (!open) return null;

  const commit = async (next: RuntimeProvider[]) => {
    setBusy(true);
    setError('');
    try {
      const fresh = await pushProviders(next);
      saveProviders(next);
      setProviders(next);
      setModelsCache(fresh);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // One-click re-probe: keeps your picked models, updates vision metadata,
  // drops delisted ids, and — for providers with small catalogs — adopts
  // newly listed models automatically. Huge catalogs (gateways) stay on the
  // picked+recommended whitelist; use Add to browse their new arrivals.
  const refresh = async (p: RuntimeProvider) => {
    // Same-URL region twins exist (Kimi Code): prefer the
    // twin matching the UI language so the visible chip row highlights.
    const match = PROVIDER_PRESETS.find((x) => x.baseURL === p.baseURL && (!x.region || x.region === lang))
      ?? PROVIDER_PRESETS.find((x) => x.baseURL === p.baseURL);
    setPreset(match ?? PROVIDER_PRESETS.find((x) => x.id === 'custom')!);
    setEditingId(p.id);
    setCustomName(match ? p.connectionName ?? '' : p.name);
    if (!match) setCustomURL(p.baseURL);
    setKey(p.apiKey);
    setAdding(true);
    await doProbe(p.baseURL, p.apiKey, p.models);
  };


  const doProbe = async (baseURLArg?: string, keyArg?: string, keepPicked?: RuntimeModel[], preferRecommend?: boolean) => {
    setBusy(true);
    setError('');
    setProbed(null);
    try {
      const baseURL = baseURLArg ?? (preset.id === 'custom' ? customURL.trim() : preset.baseURL);
      // derived from the URL, not the preset state — the refresh flow calls
      // in before its setPreset() has landed
      const presetMeta = PROVIDER_PRESETS.find((x) => x.baseURL === baseURL);
      // fixed-catalog endpoints (no /models route) list from the preset
      const fixed = presetMeta?.fixedModels;
      const models: RuntimeModel[] = fixed ? fixed.map((id) => ({ id })) : await probeModels(baseURL, (keyArg ?? key).trim());
      if (models.length === 0) throw new Error(t('provider.probeEmpty'));
      // A /models route is not always the whole catalog (bigmodel omits
      // glm-4v-flash, its own vision flash). Recommended ids join the
      // browsable list, and already-picked models missing from it survive a
      // refresh instead of silently vanishing.
      if (!fixed) {
        for (const id of presetMeta?.recommend ?? []) {
          if (!models.some((m) => m.id === id)) models.push({ id, ...(guessVision(id) ? { vision: true } : {}) });
        }
      }
      for (const m of keepPicked ?? []) {
        if (!models.some((x) => x.id === m.id)) models.push({ ...m });
      }
      const preselect = new Map<string, boolean>();
      const recHits = preferRecommend
        ? models.filter((m) => new Set(preset.recommend ?? []).has(m.id))
        : [];
      if (keepPicked) {
        // refresh flow: your current picks stay checked; everything the
        // provider newly lists is visible right here, unchecked
        const listed = new Set(models.map((m) => m.id));
        for (const m of keepPicked) if (listed.has(m.id)) {
          preselect.set(m.id, models.find((x) => x.id === m.id)?.vision ?? !!m.vision);
        }
      } else if (recHits.length > 0) {
        // OAuth pickup: the preset's recommended set leads, not raw recency
        recHits.forEach((m) => preselect.set(m.id, !!m.vision));
      } else if (models.some((m) => m.created)) {
        // release times available: preselect the newest 8
        [...models].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).slice(0, 8)
          .forEach((m) => preselect.set(m.id, !!m.vision));
      } else {
        const rec = new Set(preset.recommend ?? []);
        for (const m of models) {
          if (rec.size > 0 ? rec.has(m.id) : models.length <= 12) preselect.set(m.id, !!m.vision);
        }
      }
      setPicked(preselect);
      setInitialPicked(new Set(preselect.keys()));
      setProbed(models);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doAdd = async () => {
    // A keyless save on a keyed endpoint would look like success and then
    // 401 on every call ("Missing Authentication header") — refuse it here.
    // Custom endpoints stay free-form: local runtimes often have no key.
    if (preset.id !== 'custom' && !preset.noKey && !key.trim()) {
      setError(t('provider.keyMissing'));
      return;
    }
    const baseURL = preset.id === 'custom' ? customURL.trim() : preset.baseURL;
    const name = preset.id === 'custom' ? (customName.trim() || t('provider.customName')) : preset.name;
    const probedMeta = new Map((probed ?? []).map((m) => [m.id, m]));
    const models: RuntimeModel[] = [...picked.entries()].map(([id, vision]) => {
      const cl = probedMeta.get(id)?.contextLength;
      return { id, ...(vision ? { vision } : {}), ...(cl ? { contextLength: cl } : {}) };
    });
    if (!baseURL || models.length === 0) return;
    const connection: RuntimeProvider = {
      id: editingId ?? createRuntimeProviderId(), preset: preset.id, name, baseURL, apiKey: key.trim(), models,
      ...(preset.id !== 'custom' && customName.trim() ? { connectionName: customName.trim() } : {}),
    };
    const next = editingId ? providers.map(p => p.id === editingId ? connection : p) : [...providers, connection];
    if (await commit(next)) {
      toast('success', fmt(t('provider.added'), { n: models.length, name }));
      resetAdd();
      setJustAdded(true);
    }
  };

  const remove = async (id: string) => {
    await commit(providers.filter(p => p.id !== id));
  };

  const shown = (probed?.filter((m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase())) ?? [])
    .sort((a, b) =>
      (Number(initialPicked.has(b.id)) - Number(initialPicked.has(a.id))) ||
      (sortMode === 'time' ? (b.created ?? 0) - (a.created ?? 0) : a.id.localeCompare(b.id)));

  return createPortal((
    <div className="workspace-settings-backdrop" data-type-surface="portal" data-cursor="native" data-settings-backdrop
      onPointerDownCapture={event => { backdropPress.current = event.button === 0 && event.target === event.currentTarget; }}
      onPointerCancel={() => { backdropPress.current = false; }}
      onClick={event => {
        if (backdropPress.current && event.target === event.currentTarget) closeSettings();
        backdropPress.current = false;
      }}>
      <div ref={layerRef} id="workspace-settings" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title"
        tabIndex={-1} className="workspace-settings" data-settings-panel
        data-model-connection-panel={apiPage || section === 'agents' ? '' : undefined}
        data-connection-page={apiPage ? 'api' : section === 'agents' ? 'agents' : undefined}>
        <div className="workspace-settings-layout">
          <h2 id="workspace-settings-title" className="settings-identity text-heading font-semibold">
            <SettingsIcon size={20} strokeWidth={1.75} aria-hidden="true" />
            {t('settings.title')}
          </h2>
          <button type="button" onClick={closeSettings} aria-label={t('common.close')}
            className="settings-close flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-wash focus-visible:outline-accent">
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <SettingsNavigation section={section} onChange={next => setOpen(true, next)} />
          <section className="settings-page" aria-label={t(`settings.${section}`)}>
            <header className="settings-page-heading">
              <h3 className="text-section font-semibold">{t(`settings.${section}`)}</h3>
            </header>
            <div key={section} className="settings-page-scroll">
              {(section === 'agents' || section === 'judge') &&
                <p className="settings-page-intro text-control text-ink-muted">
                  {section === 'judge' ? t('judge.oneLine') : t('settings.agentsHint')}
                </p>}
              {section === 'general' && <InterfacePreferences />}
              {section === 'nodes' && <NodePreferences />}
              {section === 'edges' && <EdgeRoutingControls />}
              {section === 'agents' && <>
                <AgentConnectionSection />
                <div className="settings-section-divider"><AgentEffortSettings /></div>
              </>}
              {section === 'tools' && <ToolsSettings anysearchDraft={anysearchDraft} setAnysearchDraft={setAnysearchDraft} />}
              {section === 'judge' && <><JudgeToggle /><JudgeSettings /></>}
              {apiPage && !adding && <DefaultModelSettings />}
              {apiPage && <div className={`settings-field-section settings-api${adding ? '' : ' settings-section-divider'}`}>
                <div className="settings-api-heading">
                  <div>
                    <h4 className="text-title font-semibold">{t('connection.api')}</h4>
                    {!adding && !providers.length && !serverModels.length &&
                      <p className="settings-field-hint">{t('provider.emptyConnections')}</p>}
                  </div>
                  {!adding && <button onClick={() => setAdding(true)} className="settings-add-button text-control" data-provider-add>
                    <Plus size={15} strokeWidth={1.75} aria-hidden="true" />{t('provider.add')}
                  </button>}
                </div>
                {!adding && (<>
                  {serverModels.length > 0 && (
                    <p className="text-control text-ink-muted">
                      {fmt(t('provider.serverRow'), { n: serverModels.length })}
                    </p>
                  )}

                  {providers.map((p) => (
                    <div key={p.id} className="border border-line rounded-content px-3 py-2.5 bg-surface flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-control text-ink font-medium">{p.connectionName ? `${p.name} · ${p.connectionName}` : apiModels.find(m => m.sourceId === p.id)?.sourceLabel ?? p.name}</div>
                        <div className="text-control text-ink-faint mt-0.5 font-mono truncate">{p.baseURL}</div>
                        <div className="text-control text-ink-muted mt-1">
                          {fmt(t('provider.modelCount'), { n: p.models.length })}
                          {p.models.some((m) => m.vision) && <> · <span className="inline-flex items-center gap-1" data-tooltip={t('provider.visionYes')}>
                            <ImageInputIcon size={13} strokeWidth={1.75} aria-hidden />
                            <span className="sr-only">{t('provider.visionYes')} </span>{p.models.filter((m) => m.vision).length}
                          </span></>}
                        </div>
                      </div>
                      <button onClick={() => void refresh(p)} disabled={busy}  aria-label={t('provider.refreshTitle')} className="text-ink-faint hover:text-accent w-6 h-6 rounded-control flex items-center justify-center transition-colors shrink-0" data-provider-refresh>
                        <Pencil size={13} strokeWidth={1.75} />
                      </button>
                      <button onClick={() => void remove(p.id)} disabled={busy} aria-label={t('actions.deleteProvider')} className="w-6 h-6 rounded-control flex items-center justify-center transition-colors shrink-0 object-action-danger" data-icon-only>
                        <Trash2 size={13} strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}

                  {apiModels.length > 0 && (
                    <p className="text-control text-ink-faint">
                      {fmt(t('provider.capabilityLine'), { n: apiModels.length, v: visionCount })}
                      {!data?.capabilities?.webSearch && ` ${t('provider.noSearchNote')}`}
                    </p>
                  )}

                  {justAdded && !judgeConfigured(judgeCfg) && (
                    <p className="text-control text-ink-muted flex items-center gap-2" data-judge-next>
                      <JudgeIcon size={12} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
                      <span>{t('provider.nextJudge')}</span>
                      <button onClick={() => setOpen(true, 'judge')} className="text-accent hover:underline" data-judge-open>{t('judge.goConfigure')}</button>
                    </p>
                  )}
                </>)}

                {adding && (<>
                  <div>
                    <span id="settings-api-source" className="settings-field-caption text-control font-medium text-ink block">{t('provider.pickSource')}</span>
                    <div className="settings-source-grid" role="group" aria-labelledby="settings-api-source">
                      {visiblePresets.map((p) => (
                        <button
                          key={p.id}
                          autoFocus={preset.id === p.id}
                          onClick={() => {
                            if (preset.id === p.id) return;
                            setEditingId(undefined);
                            setKey(''); setCustomName(''); setCustomURL('');
                            setPreset(p); setProbed(null); setPicked(new Map()); setError('');
                          }}
                          aria-pressed={preset.id === p.id}
                          className={`text-control px-2 py-1.5 rounded-control border transition-colors ${preset.id === p.id ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-line text-ink-muted hover:bg-wash'}`}
                          data-preset={p.id}
                        >
                          {p.id === 'custom' ? t('provider.customName') : p.noKey ? `${p.name} · ${t('provider.local')}` : p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {preset.id === 'custom' && (
                    <div>
                      <label htmlFor="settings-api-url" className="settings-field-caption settings-field-title">{t('provider.baseURL')}</label>
                      <input id="settings-api-url" value={customURL} onChange={(e) => setCustomURL(e.target.value)} placeholder="https://…/v1"
                        aria-describedby="settings-api-url-hint"
                        className="w-full bg-wash text-control text-ink font-mono rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder-ink-faint" data-provider-url />
                      <p id="settings-api-url-hint" className="settings-field-hint">{t('provider.baseURLHint')}</p>
                    </div>
                  )}
                  <div>
                    <label htmlFor="settings-api-name" className="settings-field-caption settings-field-title">{t('provider.displayName')}</label>
                    <input id="settings-api-name" value={customName} onChange={e => setCustomName(e.target.value)}
                      placeholder={preset.id === 'custom' ? t('provider.customName') : preset.name}
                      className="w-full bg-wash text-control text-ink rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder-ink-faint" />
                  </div>

                  {preset.id === 'openrouter' && !probed && (
                    <div className="border border-accent/30 bg-accent/5 rounded-content px-3 py-2.5 flex flex-col items-stretch gap-2.5" data-provider-oauth-row>
                      <p className="text-control text-ink-muted flex-1 min-w-0">{t('provider.oauthHint')}</p>
                      <button onClick={() => void startOpenRouterOAuth()} data-provider-oauth
                        className="text-control bg-action text-white px-3 py-1.5 rounded-control shrink-0 flex items-center justify-center gap-1.5">
                        <ExternalLink size={12} strokeWidth={1.75} /> {t('provider.oauthButton')}
                      </button>
                    </div>
                  )}
                  {!preset.noKey && (
                    <div>
                      <label htmlFor="settings-api-key" className="settings-field-caption settings-field-title">API key</label>
                      <input id="settings-api-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…"
                        className="w-full bg-wash text-control text-ink font-mono rounded-control px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder-ink-faint" data-provider-key />
                      {preset.keyUrl && (
                        <p className="settings-field-hint">
                          {t('provider.keyHint')}{' '}
                          <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{preset.keyUrl.replace('https://', '')}</a>
                        </p>
                      )}
                    </div>
                  )}
                  {preset.noKey && <p className="text-control text-ink-faint">{t('provider.localHint')}</p>}

                  {!probed && (
                    <button onClick={() => void doProbe()} disabled={busy || (preset.id === 'custom' ? !customURL.trim() : !preset.noKey && !key.trim())}
                      className="text-control bg-action text-white px-4 py-1.5 rounded-control disabled:opacity-40 flex items-center gap-1.5" data-provider-probe>
                      {busy && <Loader2 size={12} className="animate-spin" />}
                      {busy ? t('provider.probing') : t('provider.probe')}
                    </button>
                  )}

                  {probed && (<>
                    <div>
                      <div className="settings-field-caption flex flex-wrap items-center gap-2">
                        <span className="text-control font-medium text-ink flex-1">{fmt(t('provider.pickModels'), { n: probed.length })}</span>
                        {probed.length > 15 && (
                          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('provider.filter')} aria-label={t('provider.filter')}
                            className="bg-wash text-control text-ink rounded-control px-2 py-1 w-36 focus:outline-none focus:ring-1 focus:ring-accent/40 placeholder-ink-faint" />
                        )}
                        {probed.some((m) => m.created) && (
                          <button
                            onClick={() => setSortMode((v) => (v === 'time' ? 'name' : 'time'))}
                            className="text-control px-2.5 py-1.5 rounded-tag border border-line text-ink-muted hover:bg-wash transition-colors shrink-0"
                            data-sort-toggle
                          >
                            {sortMode === 'time' ? t('provider.sortTime') : t('provider.sortName')}
                          </button>
                        )}
                      </div>
                      <div className="border border-line rounded-content max-h-[220px] overflow-y-auto divide-y divide-line/60" data-provider-models>
                        {shown.slice(0, 200).map((m) => (
                          <label key={m.id} data-cursor="action" className="flex items-center gap-2 px-3 py-1.5 text-control text-ink hover:bg-wash">
                            <input type="checkbox" checked={picked.has(m.id)}
                              onChange={(e) => {
                                const next = new Map(picked);
                                if (e.target.checked) next.set(m.id, !!m.vision); else next.delete(m.id);
                                setPicked(next);
                              }} />
                            <span className="font-mono flex-1 truncate">{m.id}</span>
                            {m.contextLength ? (
                              <span className="text-meta text-ink-faint font-mono shrink-0" data-tooltip={m.contextLength.toLocaleString()} data-model-window>
                                {m.contextLength >= 1024 * 1024 ? `${Math.round(m.contextLength / (1024 * 1024))}M` : `${Math.round(m.contextLength / 1024)}k`}
                              </span>
                            ) : null}
                            {m.vision != null ? (
                              m.vision && <span data-tooltip={t('provider.visionYes')}>
                                <ImageInputIcon size={13} strokeWidth={1.75} aria-hidden />
                                <span className="sr-only">{t('provider.visionYes')}</span>
                              </span>
                            ) : picked.has(m.id) && (
                              <button
                                onClick={(e) => { e.preventDefault(); const next = new Map(picked); next.set(m.id, !next.get(m.id)); setPicked(next); }}
                                data-tooltip={t('provider.visionToggle')} aria-label={t('provider.visionToggle')}
                                aria-pressed={!!picked.get(m.id)}
                                className={`flex items-center gap-0.5 text-control px-1.5 py-0.5 rounded-tag transition-colors ${picked.get(m.id) ? 'bg-accent/10 text-accent' : 'bg-wash text-ink-faint'}`}
                              >
                                <ImageInputIcon size={13} strokeWidth={1.75} aria-hidden />
                              </button>
                            )}
                          </label>
                        ))}
                      </div>
                      <p className="text-meta text-ink-faint mt-1">{fmt(t('provider.pickedCount'), { n: picked.size })}</p>
                    </div>
                  </>)}

                  <p className="text-control text-ink-faint bg-wash rounded-content px-3 py-2">{t('provider.privacy')}</p>
                  {error && <p className="text-control text-red-600">{error}</p>}
                </>)}
                {!adding && error && <p className="text-control text-red-600">{error}</p>}
              </div>}
            </div>
            {apiPage && adding && <div className="settings-page-footer flex items-center justify-end gap-2 border-t border-line shrink-0">
              <button onClick={resetAdd} className="text-control text-ink-muted hover:text-ink px-3 py-1.5 rounded-control hover:bg-wash transition-colors">{t('common.cancel')}</button>
              <button onClick={() => void doAdd()} disabled={busy || picked.size === 0}
                className="text-control bg-action text-white px-4 py-1.5 rounded-control disabled:opacity-40 flex items-center gap-1.5" data-provider-save>
                {busy && <Loader2 size={12} className="animate-spin" />}
                {t('provider.save')}
              </button>
            </div>}
          </section>
        </div>
      </div>
    </div>
  ), document.body);
}
