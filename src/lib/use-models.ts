import { appSettings } from './disk-storage';
import { useSyncExternalStore } from 'react';
import { API_BASE } from './constants';
import { storedProviders, pushProviders, refreshStoredProviders } from './runtime-providers';
import { agentCatalog, AGENT_PROVIDER, AGENT_RUNTIMES, agentTarget, isAgentModel, runtimeOf, type RuntimeStatus } from './agents/agent-runtime';
import { displayModelName } from './model-sources';
import { modelMatchesExecution, type NodeExecutionKind } from './node-execution';
import type { AgentRuntime } from '../types';
import { t, fmt } from '../i18n';
import { canRetryAgentHost, ensureAgentHost } from './agents/host';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  vision: boolean;
  /** agent models: the effort levels this runtime accepts for the model, in its own words (read from the CLI) */
  efforts?: string[];
  /** the runtime's own default among them, when it says */
  defaultEffort?: string | null;
  supportsFast?: boolean;
  defaultFast?: boolean;
}

export interface Capabilities {
  webSearch: boolean;
  searchEngine: string;
  /** AnySearch engine reachable (always true locally; hosted = key present). */
  anysearch?: boolean;
  /** DeepSeek's Search API can serve as the engine (a DeepSeek key is configured). */
  deepseekSearch?: boolean;
  scholarSearch: boolean;
  vision: boolean;
}

export type ModelData = { models: ModelInfo[]; default: string | null; capabilities?: Capabilities; /** the agent runtimes are being asked right now */ agentsPending?: boolean; /** what each agent runtime answered the last time it was asked (absent until asked) */ runtimes?: Partial<Record<AgentRuntime, RuntimeStatus>> };

// Model list is fetched once per session and shared by every picker
let cache: ModelData | null = null;
let serverModelsLoaded = false;
let inflight: Promise<ModelData | null> | null = null;
const listeners = new Set<() => void>();

function publishModels(data: ModelData) {
  cache = data;
  for (const notify of listeners) notify();
}

async function fetchServerModels(): Promise<ModelData> {
  const response = await fetch(`${API_BASE}/api/models`);
  if (!response.ok) throw new Error(`Model list: ${response.status}`);
  const data = await response.json();
  return { models: data.models ?? [], default: data.default ?? null, capabilities: data.capabilities };
}

/** Imperative access to the same per-session model cache (e.g. picking an extraction model). */
export function getModelsOnce(): Promise<ModelData | null> {
  if (serverModelsLoaded) return Promise.resolve(cache);
  inflight ??= (async () => {
    // browser-stored providers re-register themselves before the first list
    // fetch (the proxy holds them in memory only, so restarts forget them)
    const stored = storedProviders();
    let base: ModelData | null = null;
    if (stored.length > 0) {
      try { base = await pushProviders(stored); } catch { /* proxy down or bad config: fall through to the plain list */ }
    }
    if (!base) {
      base = await fetchServerModels().catch(() => null);
    }
    if (!serverModelsLoaded && base) setModelsCache(base);
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Family-level id for cross-provider comparison: the gateway slug
    'deepseek/deepseek-v4-pro' and the direct id 'deepseek-v4-pro' are the
    same model reached through different doors. */
function modelBasename(id: string): string {
  return (id.split('/').pop() ?? id).toLowerCase();
}

/** Ids a provider retired and now serves through a successor (DeepSeek's
    V4 Flash names since 2026-09-10): a pin on one follows the successor. */
const RETIRED_MODEL_IDS: Record<string, string> = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
};

/** Reconcile a pinned model id against the locally available list: exact id
    → itself; same family under a different provider → the local id; a
    retired id → its successor; otherwise null (not reachable here). */
export function reconcileModelId(pinned: string, models: ModelInfo[]): string | null {
  if (models.some((m) => m.id === pinned)) return pinned;
  const base = modelBasename(pinned);
  const successor = RETIRED_MODEL_IDS[base];
  const match = models.find((m) => modelBasename(m.id) === base)
    ?? (successor ? models.find((m) => modelBasename(m.id) === successor) : undefined);
  return match ? match.id : null;
}

const AGENT_CACHE_KEY = 'thoughtdag.agentModels';
const AGENT_NAMES_KEY = 'thoughtdag.agentModelNames';
const hasAgentsBridge = () => typeof window !== 'undefined' && !!window.desktopAgents;

/** A remembered model name alone does not establish a connection to its runtime. */
export function availableExecutionModels(data: ModelData | null, kind: NodeExecutionKind): ModelInfo[] {
  return data?.models.filter(model => {
    if (!modelMatchesExecution(model.id, kind)) return false;
    const runtime = runtimeOf(model.id);
    return !runtime || (hasAgentsBridge() && data.runtimes?.[runtime]?.installed === true);
  }) ?? [];
}

/** The agent entries the runtimes bridge owns and may replace: the ones it
 *  reported itself (pi/ codex/ claude/ ids). A server can hand out agent
 *  entries of its own under the same group (the harness runs the agent loop
 *  on its models); those belong with the API list and are never replaced. */
const isRuntimeAgent = (m: ModelInfo) => m.provider === AGENT_PROVIDER && isAgentModel(m.id);

/** Picker id → the model name the runtime actually ran under it (an alias
 *  like `opus` resolves inside the CLI; the first turn tells us to what). */
function resolvedNames(): Record<string, string> {
  try { const v = JSON.parse(appSettings.getItem(AGENT_NAMES_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** An alias entry shows the model it resolved to, once a turn has told us —
 *  marked as the LAST run's, since an alias means "the newest" and the CLI may
 *  have moved on since (the next turn reports the new name and the label follows). */
function withResolvedNames(models: ModelInfo[]): ModelInfo[] {
  const names = resolvedNames();
  return models.map((m) => {
    const resolved = m.provider === AGENT_PROVIDER ? names[m.id] : undefined;
    if (!resolved || m.id.endsWith('/' + resolved)) return m;
    const r = displayModelName(m.id, resolved);
    if (displayModelName(m.id, m.name).includes(r)) return m;
    return { ...m, name: `${m.name} · ${fmt(t('models.resolvedLast'), { r })}` };
  });
}

/** Display the recorded model with its resolved alias and the effort used for that version. */
export function describeModel(id: string | null | undefined, effort?: string | null, opts?: { /** omit the resolved alias on compact cards */ compact?: boolean }): string {
  if (!id) return '';
  const target = agentTarget(id);
  if (!target) return id.split('/').pop() ?? id;
  let remembered: ModelInfo[] = [];
  try { remembered = JSON.parse(appSettings.getItem(AGENT_CACHE_KEY) ?? '[]'); } catch { remembered = []; }
  const entry = remembered.find((m) => m && m.id === id);
  const base = displayModelName(id, entry?.name ?? `${AGENT_RUNTIMES[target.runtime].label} · ${target.id}`);
  const resolved = opts?.compact ? undefined : resolvedNames()[id];
  const alias = resolved && displayModelName(id, resolved);
  const withName = alias && !base.includes(alias) ? `${base} · ${alias}` : base;
  return effort ? `${withName} · ${effort}` : withName;
}

/** Last launch's agent models, so the picker is whole without asking anyone. */
function withRemembered(d: ModelData): ModelData {
  if (!hasAgentsBridge()) return d;
  let remembered: ModelInfo[] = [];
  try { remembered = JSON.parse(appSettings.getItem(AGENT_CACHE_KEY) ?? '[]'); } catch { remembered = []; }
  const own = d.models.filter((m) => !isRuntimeAgent(m));
  return { ...d, models: [...own, ...withResolvedNames(remembered.filter((m) => m && isRuntimeAgent(m)))], agentsPending: false };
}

let agentsRefreshing: Promise<void> | null = null;

/** Discover the bridge and its catalog independently of the API provider list. */
export async function ensureAgentsFresh(force = false): Promise<void> {
  if (agentsRefreshing) return agentsRefreshing;
  if (!force && availableExecutionModels(cache, 'codex').length && !cache?.runtimes?.codex?.error) return;
  agentsRefreshing = (async () => {
    const before = cache ?? { models: [], default: null };
    publishModels({ ...before, agentsPending: true });
    if (!await ensureAgentHost(canRetryAgentHost())) {
      publishModels({ ...(cache ?? before), agentsPending: false });
      return;
    }
    const asked = await agentCatalog().catch(() => ({ models: [] as ModelInfo[], runtimes: {} as Partial<Record<AgentRuntime, RuntimeStatus>> }));
    const extra = asked.models;
    try { appSettings.setItem(AGENT_CACHE_KEY, JSON.stringify(extra)); } catch { /* ignore */ }
    const own = (cache ?? before).models.filter((m) => !isRuntimeAgent(m));
    publishModels({ ...(cache ?? before), models: [...own, ...withResolvedNames(extra)], agentsPending: false, runtimes: asked.runtimes });
  })().finally(() => { agentsRefreshing = null; });
  return agentsRefreshing;
}

export function recheckAgents(): Promise<void> {
  return ensureAgentsFresh(true);
}

let catalogRefresh: Promise<void> | null = null;
export function refreshModelCatalog(): Promise<void> {
  catalogRefresh ??= (async () => {
    const refreshServer = async () => {
      const data = await refreshStoredProviders() ?? await fetchServerModels();
      setModelsCache(data);
    };
    const [server, agent] = await Promise.allSettled([refreshServer(), recheckAgents()]);
    if (server.status === 'rejected') throw server.reason;
    if (agent.status === 'rejected') throw agent.reason;
  })().finally(() => { catalogRefresh = null; });
  return catalogRefresh;
}

/** A turn reported which model an agent alias resolved to: remember it
 *  and rename the entry in place, so the picker reads `Opus · claude-opus-5`. */
export function noteAgentModelName(id: string, resolved: string): void {
  if (!id || !resolved) return;
  const names = resolvedNames();
  if (names[id] === resolved) return;
  names[id] = resolved;
  try { appSettings.setItem(AGENT_NAMES_KEY, JSON.stringify(names)); } catch { /* ignore */ }
  if (!cache) return;
  const own = cache.models.filter((m) => !isRuntimeAgent(m));
  const agents = cache.models.filter(isRuntimeAgent).map((m) => ({ ...m, name: m.name.split(' · ').slice(0, 2).join(' · ') }));
  publishModels({ ...cache, models: [...own, ...withResolvedNames(agents)] });
}
if (typeof window !== 'undefined') {
  window.addEventListener('td:agent-model-resolved', (ev) => {
    const d = (ev as CustomEvent<{ id?: string; resolved?: string }>).detail;
    if (d?.id && d?.resolved) noteAgentModelName(d.id, d.resolved);
  });
}

/** Replace the shared cache (after a runtime-key change) and notify every subscribed picker. */
export function setModelsCache(d: ModelData): void {
  serverModelsLoaded = true;
  if (d.agentsPending !== undefined || d.runtimes) return publishModels(d);
  // Either catalog can arrive first. An API refresh must preserve discovery
  // in progress and the local models already confirmed by the bridge.
  if (cache?.agentsPending || cache?.runtimes) {
    return publishModels({ ...d, agentsPending: cache.agentsPending, runtimes: cache.runtimes,
      models: [...d.models.filter(model => !isRuntimeAgent(model)), ...cache.models.filter(isRuntimeAgent)] });
  }
  publishModels(withRemembered(d));
}

function subscribeModels(notify: () => void) {
  listeners.add(notify);
  if (!serverModelsLoaded) void getModelsOnce();
  return () => { listeners.delete(notify); };
}

const skipSubscription = () => () => {};
export const getCachedModels = () => cache;
const noModels = () => null;

export function useModels(enabled = true): ModelData | null {
  return useSyncExternalStore(enabled ? subscribeModels : skipSubscription, enabled ? getCachedModels : noModels, noModels);
}
