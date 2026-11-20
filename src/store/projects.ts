import { create } from 'zustand';
import { get as idbGet, set as idbSet, del as idbDel, diskStorageNamespace, updateStoredValue } from '../lib/disk-storage';
import { useStore } from './index';
import type { StoreState } from './types';
import { activeAbortControllers } from './streaming';
import { flushPendingWrites } from '../lib/persistence';
import { resetMemoryWriteCaps } from '../lib/memory';
import { buildRuleOutRuleIn } from '../lib/paradigms/rule-out-rule-in';
import { toast } from '../lib/ui-store';
import { t } from '../i18n';
import type { AgentPermissionMode } from '../types';
import { normalizeConversationGraph } from '../lib/normalize-graph';
import { ensureCanvasWorkspace } from '../lib/canvas-workspace';

// Project layer: each canvas persists under its own storage key; this
// module owns the metadata list and the switching choreography.
// Each metadata edit applies to the latest stored catalog across local windows.

const META_KEY = 'thoughtdag:projects';
const LEGACY_KEY = 'thoughtdag';

export const projectStorageKey = (id: string) => `thoughtdag:project:${id}`;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 'chat' (default) = conversation canvas; 'paradigm' = orchestration view, no LLM. */
  kind?: 'chat' | 'paradigm';
  /** Provenance: which paradigm this run canvas was instantiated from. */
  instantiatedFrom?: { name: string; at: string };
  /** Optional working directory for runtimes with a selectable directory. */
  agentCwd?: string;
  /** How the agent's boundary guard behaves for this canvas: ask on every
      step outside the working directory (default), or let everything
      through; `allow` lists directories that never ask. */
  agentGuard?: { mode: AgentPermissionMode; allow: string[] };
  /** Archived = hidden from the dropdown and Recent work, data untouched.
      Tidying and destroying are different verbs. */
  archived?: boolean;

}

/** Archive/restore a canvas. Archiving the ACTIVE canvas switches away
 *  first — to the newest unarchived one, or a fresh canvas. */
export async function setProjectArchived(id: string, archived: boolean): Promise<void> {
  const { projects, activeId } = useProjects.getState();
  if (archived && id === activeId) {
    const rest = projects.filter((p) => p.id !== id && !p.archived).sort((a, b) => b.updatedAt - a.updatedAt);
    if (rest.length > 0) await switchProject(rest[0].id);
    else await createProject('My Canvas');
  }
  await patchProject(id, { archived });
}

/** Stamp paradigm provenance on a project (persisted with the meta list). */
export async function markInstantiatedFrom(projectId: string, paradigmName: string): Promise<void> {
  await patchProject(projectId, { instantiatedFrom: { name: paradigmName, at: new Date().toISOString() } });
}

interface ProjectsState {
  projects: ProjectMeta[];
  activeId: string | null;
  switching: boolean;
}

export const useProjects = create<ProjectsState>(() => ({
  projects: [],
  activeId: null,
  switching: false,
}));

type ProjectIndex = { projects: ProjectMeta[]; activeId: string };

async function editIndex(change: (index: ProjectIndex) => ProjectIndex): Promise<ProjectIndex> {
  const saved = await updateStoredValue<ProjectIndex>(META_KEY, current => {
    if (!current) throw new Error('Canvas catalog is unavailable');
    return change(current);
  });
  useProjects.setState({ projects: saved.projects });
  return saved;
}

function patchProject(id: string, patch: Partial<ProjectMeta>) {
  return editIndex(index => ({
    ...index, projects: index.projects.map(p => p.id === id ? { ...p, ...patch } : p),
  }));
}

export async function refreshProjectIndex(): Promise<void> {
  if (diskStorageNamespace() === 'browser' || !useProjects.getState().activeId) return;
  const before = useProjects.getState().projects;
  const index = await idbGet<ProjectIndex>(META_KEY);
  // A local edit may have finished while the read was in flight.
  if (index && before === useProjects.getState().projects) useProjects.setState({ projects: index.projects });
}

export async function prepareCanvasFolders(projects: ReadonlyArray<Pick<ProjectMeta, 'id'>> = useProjects.getState().projects): Promise<void> {
  const results = await Promise.allSettled(projects.map(({ id }) => ensureCanvasWorkspace(id)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    console.error('[thoughtdag] could not prepare canvas workspace:', failure.reason);
    toast('error', t('toast.canvasWorkspaceFailed'));
  }
}

// ─── Boot & migration ───────────────────────────────────────────
// Idempotent write order: ① copy graph data → ② write metadata → ③ delete
// legacy key. A crash between steps re-runs the migration harmlessly.
let bootPromise: Promise<void> | null = null;

export function bootProjects(): Promise<void> {
  bootPromise ??= (async () => {
    // The graph store also imports project helpers. Subscribe once both modules are initialized.
    useStore.subscribe(touchProjectOnGraphChange);
    let meta = await idbGet<ProjectIndex>(META_KEY);
    if (!meta || meta.projects.length === 0) {
      const legacy = await idbGet<string>(LEGACY_KEY); // raw persist envelope string
      const id = crypto.randomUUID();
      const now = Date.now();
      if (legacy) await idbSet(projectStorageKey(id), legacy);
      meta = await updateStoredValue<ProjectIndex>(META_KEY, current => current?.projects.length ? current : {
        projects: [{ id, name: 'My Canvas', createdAt: now, updatedAt: now }], activeId: id,
      });
      if (legacy) await idbDel(meta.activeId === id ? LEGACY_KEY : projectStorageKey(id));
    }
    if (!meta.projects.some((p) => p.id === meta.activeId)) {
      meta.activeId = meta.projects[0].id;
    }
    useProjects.setState({ projects: meta.projects, activeId: meta.activeId });
    useStore.persist.setOptions({ name: projectStorageKey(meta.activeId) });
    await useStore.persist.rehydrate(); // fires onFinishHydration → App gate opens
    await prepareCanvasFolders(meta.projects);
    window.addEventListener('focus', () => { void refreshProjectIndex().catch(() => undefined); });
  })().catch(async (e) => {
    console.error('[thoughtdag] project boot failed:', e);
    toast('error', t('toast.projectsLoadFailed'));
    useStore.persist.setOptions({ name: projectStorageKey('recovery') });
    await useStore.persist.rehydrate();
  });
  return bootPromise;
}

// ─── Switching ──────────────────────────────────────────────────
// Danger window: between setOptions and rehydrate completion, any setState
// would write the OLD graph under the NEW key. Defenses: abort all streams
// first (drain), and the `switching` flag disables the switcher UI.
let suppressTouch = false;

async function drainGenerations(): Promise<void> {
  for (const controller of activeAbortControllers.values()) controller.abort();
  const deadline = Date.now() + 1000;
  while (activeAbortControllers.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30));
  }
  await new Promise((r) => setTimeout(r, 0)); // let the final abort writes reach the debounce queue
}

/** Run before the active canvas is swapped out — the canvas record
 *  flushes here so a switch never loses a minute of changes. */
export const beforeSwitchHooks: Array<() => Promise<void>> = [];

export async function switchProject(id: string): Promise<void> {
  for (const hook of beforeSwitchHooks) await hook().catch(() => undefined);
  const { activeId, switching, projects } = useProjects.getState();
  if (switching || id === activeId || !projects.some((p) => p.id === id)) return;
  useProjects.setState({ switching: true });
  try {
    await drainGenerations();
    await flushPendingWrites();
    const saved = await editIndex(index => index.projects.some(p => p.id === id) ? {
      activeId: id, projects: index.projects.map(p => p.id === id && p.archived ? { ...p, archived: false } : p),
    } : index);
    if (!saved.projects.some(p => p.id === id)) return;
    resetMemoryWriteCaps(); // a canvas visit is one memory session (#47)
    suppressTouch = true;
    useStore.persist.setOptions({ name: projectStorageKey(id) });
    await useStore.persist.rehydrate();
    useStore.setState({ selectedNodeId: null, selectedNodeIds: [] });
    // opening IS unarchiving: archived means "hidden from the lists", and
    // a canvas the user just switched to is back in the working set —
    // whether opened from the canvas menu or a source link.
    useProjects.setState({ activeId: id });
  } finally {
    suppressTouch = false;
    useProjects.setState({ switching: false });
  }
}

// ─── CRUD ───────────────────────────────────────────────────────
export async function createProject(name = 'Untitled', kind: 'chat' | 'paradigm' = 'chat'): Promise<string> {
  const id = crypto.randomUUID();
  await registerProject(id, name, kind);
  return id;
}

export async function setProjectAgentCwd(id: string, cwd: string | undefined): Promise<void> {
  await patchProject(id, { agentCwd: cwd });
}

export async function setProjectAgentGuard(id: string, guard: { mode: AgentPermissionMode; allow: string[] } | undefined): Promise<void> {
  await patchProject(id, { agentGuard: guard });
}

export async function renameProject(id: string, name: string): Promise<void> {
  await patchProject(id, { name });
}

export async function deleteProject(id: string): Promise<void> {
  const { projects, activeId } = useProjects.getState();
  if (id === activeId) {
    const rest = projects.filter((p) => p.id !== id);
    if (rest.length > 0) await switchProject(rest[0].id);
    else await createProject('My Canvas');
  }
  const { removeCanvasDocuments } = await import('../lib/managed-document-file');
  await removeCanvasDocuments(id);
  await idbDel(projectStorageKey(id));
  await editIndex(index => {
    const remaining = index.projects.filter(p => p.id !== id);
    return { projects: remaining, activeId: index.activeId === id ? remaining[0]?.id ?? '' : index.activeId };
  });
  // the why layer's copy goes with it (desktop only; a no-op elsewhere)
  void import('../lib/canvas-record').then((m) => m.removeCanvasRecord(id)).catch(() => undefined);
}

// New canvases hydrate an empty key. Imports have already written their graph.
async function registerProject(
  id: string,
  name: string,
  kind: 'chat' | 'paradigm' = 'chat',
  extras?: Partial<Pick<ProjectMeta, 'instantiatedFrom'>>,
): Promise<void> {
  const now = Date.now();
  await editIndex(index => ({
    ...index, projects: [...index.projects, { id, name, createdAt: now, updatedAt: now, kind, ...extras }],
  }));
  await prepareCanvasFolders([{ id }]);
  await switchProject(id);
}

export const adoptImportedProject = registerProject;

// Seed a new paradigm project with the built-in rule-out/rule-in score and
// switch to it (shared by the landing page and the project switcher).
export async function createBuiltinParadigm(lang: 'en' | 'zh'): Promise<void> {
  const { name, nodes, edges } = normalizeConversationGraph(buildRuleOutRuleIn(lang));
  const id = crypto.randomUUID();
  await idbSet(projectStorageKey(id), JSON.stringify({ state: { nodes, edges }, version: 1 }));
  await adoptImportedProject(id, name, 'paradigm');
}

if (import.meta.env.DEV) {
  Object.assign(window, { __projects: useProjects });
}

// ─── updatedAt bookkeeping ──────────────────────────────────────
let touchTimer: ReturnType<typeof setTimeout> | null = null;
function touchProjectOnGraphChange(state: StoreState, prev: StoreState) {
  if (suppressTouch) return;
  if (state.nodes === prev.nodes && state.edges === prev.edges) return;
  const { activeId } = useProjects.getState();
  if (!activeId) return;
  if (touchTimer) clearTimeout(touchTimer);
  touchTimer = setTimeout(() => {
    void patchProject(activeId, { updatedAt: Date.now() }).catch(error => console.warn('[thoughtdag] canvas timestamp:', error));
  }, 1000);
}
