// Host integration shared by native agent execution and the embedded harness.
import type { StoreApi } from 'zustand';
import type { StoreState } from '../../store/types';
import { useUiStore } from '../ui-store';

let currentSession: { id: string; title: string | null; cwd: string | null } | null = null;
export const currentDshSession = (): typeof currentSession => currentSession;

export function installDshSessionsBridge(apiBase: string): void {
  if (window.desktopSessions) return;
  const api = apiBase.replace(/\/+$/, '');
  const json = async <T,>(path: string): Promise<T> => {
    const result = await fetch(api + path, { credentials: 'same-origin' });
    if (!result.ok) throw new Error(`${path}: ${result.status}`);
    return result.json() as Promise<T>;
  };
  window.desktopSessions = {
    roots: async () => (await json<{ roots: SessionRoot[] }>('/roots')).roots,
    list: async (rootKey) => (await json<{ files: { rel: string; size: number; mtime: number }[] }>(`/roots/${encodeURIComponent(rootKey)}/list`)).files,
    read: async (rootKey, rel) => {
      const result = await fetch(`${api}/roots/${encodeURIComponent(rootKey)}/read?rel=${encodeURIComponent(rel)}`, { credentials: 'same-origin' });
      if (!result.ok) throw new Error(`session read: ${result.status}`);
      return result.text();
    },
    openInCli: async (runner, cwd, sessionId) => {
      if (runner === 'dsh') {
        window.parent.postMessage({ source: 'dsh-thoughtdag', type: 'td:select-session', session: sessionId }, window.location.origin);
        return { opened: true, via: 'app', command: '' };
      }
      try {
        const result = await fetch(api + '/agents/open-in-cli', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ runner, cwd, sessionId }) });
        if (result.ok) {
          const data = await result.json() as { opened: boolean; command: string };
          return { opened: !!data.opened, via: 'terminal', command: data.command ?? '' };
        }
      } catch { /* no host for it */ }
      return { opened: false, via: '', command: '' };
    },
  };
  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as { source?: string; type?: string; session?: typeof currentSession; bar?: boolean; desktop?: boolean; panel?: boolean } | null;
    if (ev.origin !== window.location.origin || data?.source !== 'dsh-thoughtdag') return;
    if (data.type === 'td:current-session') {
      currentSession = data.session ?? null;
      window.dispatchEvent(new CustomEvent('td:dsh-current', { detail: currentSession }));
    }
    if (data.type === 'td:view' && (data.bar !== undefined || data.desktop !== undefined)) {
      useUiStore.getState().setHarnessHost({ bar: !!data.bar, desktop: !!data.desktop, panel: !!data.panel });
    }
  });
  window.parent.postMessage({ source: 'dsh-thoughtdag', type: 'td:request-current' }, window.location.origin);
  void import('../../store/projects').then(({ useProjects }) => {
    let last: string | null = null;
    const tell = () => {
      const state = useProjects.getState();
      const name = state.projects.find((project) => project.id === state.activeId)?.name ?? '';
      if (name === last) return;
      last = name;
      window.parent.postMessage({ source: 'dsh-thoughtdag', type: 'td:title', name }, window.location.origin);
    };
    tell(); useProjects.subscribe(tell);
  });
}

// ── outbound context for a question asked inside the harness ────────────
// The one place the canvas tells the harness bridge WHERE and INTO WHICH
// session a `harness/agent` question runs. Absent (returns undefined)
// everywhere but inside the embedded harness, so the send path stays
// byte-identical elsewhere.

export const HARNESS_AGENT_MODEL = 'harness/agent';
/** The bare entry or one of its per-model forms ('harness/agent/<provider>/<model>'). */
export const isHarnessAgentModel = (id: string | undefined | null): boolean => !!id && (id === HARNESS_AGENT_MODEL || id.startsWith(HARNESS_AGENT_MODEL + '/'));

/** The working directory a fresh agent turn should run in: the project the
 *  active canvas came from, else the session the harness chat currently shows. */
async function activeCanvasCwd(): Promise<string | null> {
  try {
    const { useStore } = await import('../../store');
    const counts = new Map<string, number>();
    for (const n of useStore.getState().nodes) {
      const c = n.data.importSource?.cwd;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best: string | null = null; let bestN = 0;
    for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
    return best;
  } catch { return null; }
}

/** `permission`: the canvas's mode for this turn (absent = ask, the session as set). */
type HarnessRoute = { cwd?: string; session?: string; forkSession?: string; forkAnchor?: string; permission?: 'auto' | 'allow' };

/** Route an unchanged tail to its own session; fork older turns by their anchor. */
export async function harnessOutbound(nodeId: string, model: string | undefined): Promise<HarnessRoute | undefined> {
  if (!window.desktopSessions || !isHarnessAgentModel(model)) return undefined;
  const { useProjects } = await import('../../store/projects');
  const { projects, activeId } = useProjects.getState();
  // the folder the person chose for this canvas first, then the project the
  // canvas came from, then the session the chat shows, then the canvas's own
  // folder: the one the toolbar's folder chip names (a session created
  // without a folder ran in the harness's profile directory, #85)
  const chosen = projects.find((p) => p.id === activeId)?.agentCwd;
  const own = async () => (window.desktopAgents ? await window.desktopAgents.workspace(activeId ?? 'default').catch(() => undefined) : undefined);
  const cwd = chosen ?? (await activeCanvasCwd()) ?? currentSession?.cwd ?? (await own()) ?? undefined;
  // the canvas's permission mode rides along; the plugin applies it to this turn only
  const mode = projects.find((p) => p.id === activeId)?.agentGuard?.mode;
  const base = { ...(cwd ? { cwd } : {}), ...(mode === 'auto' || mode === 'allow' ? { permission: mode } : {}) };
  try {
    const { useStore } = await import('../../store');
    const { nodes, edges } = useStore.getState();
    const incoming = edges.filter((e) => e.target === nodeId);
    if (incoming.length === 1) {
      const parentId = incoming[0].source;
      const parent = nodes.find((n) => n.id === parentId);
      const source = parent?.data.importSource;
      if (source?.runner === 'dsh' && source.sessionId && source.itemIds?.[0]) {
        const hasLaterTurn = edges.some((edge) => edge.source === parentId && nodes.some((n) => n.id === edge.target && n.data.importSource?.sessionId === source.sessionId));
        const unchanged = !parent?.data.source || (parent.data.source.question === parent.data.question && parent.data.source.response === parent.data.response);
        const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        if (!unchanged || (source.cwd && cwd && normalize(source.cwd) !== normalize(cwd))) return base;
        if (!hasLaterTurn) return { ...base, session: source.sessionId };
        return {
          ...base,
          forkSession: source.sessionId,
          forkAnchor: source.itemIds[0],
        };
      }
    }
  } catch { /* store not ready — fall through to a fresh session */ }
  return base;
}

type HarnessTurnRef = { session: string; turn: number | null; userMessageId: string | null; seq: number | null };

/** Provenance for a node that IS a dsh turn: runner, session, the person's
 *  message id (the deep-link and dedup key), the project it ran in. */
const stampProvenance = (
  set: StoreApi<StoreState>['setState'], nodeId: string, sessionId: string, route: HarnessRoute,
  userMessageId: string | null, source?: { question: string; response: string },
): void => {
  const itemIds = userMessageId ? [userMessageId] : [];
  set((s) => ({
    nodes: s.nodes.map((n) => (n.id === nodeId
      ? { ...n, data: { ...n.data,
          importSource: { runner: 'dsh', sessionId, itemIds, ...(route.cwd ? { cwd: route.cwd } : {}) },
          ...(source ? { source } : {}) } }
      : n)),
  }));
};

/** Record the session identity as soon as the harness names the turn. */
export function markHarnessTurn(
  set: StoreApi<StoreState>['setState'],
  nodeId: string,
  route: HarnessRoute,
  turn: HarnessTurnRef,
): void {
  if (!window.desktopSessions) return;
  stampProvenance(set, nodeId, route.session ?? turn.session, route, turn.userMessageId);
}

/** Record the final question and response on the node. */
export function stampHarnessTurn(
  set: StoreApi<StoreState>['setState'],
  nodeId: string,
  turn: { question: string; response: string },
  route: HarnessRoute,
  harnessSession: string | undefined,
  harnessTurn: HarnessTurnRef | null,
): void {
  if (!window.desktopSessions) return;
  const sessionId = route.session ?? harnessTurn?.session ?? harnessSession;
  if (!sessionId) return;
  stampProvenance(set, nodeId, sessionId, route, harnessTurn?.userMessageId ?? null, { question: turn.question, response: turn.response });
}
