import { appSettings } from './disk-storage';
import { set as idbSet, del as idbDel } from './disk-storage';
import { useStore, stripTransient } from '../store';
import { getModelsOnce, reconcileModelId } from './use-models';
import { useProjects, projectStorageKey, adoptImportedProject, switchProject } from '../store/projects';
import { detectFormat, listConversations, type ImportableConversation } from './import-chat';
import { getContextPath } from './graph';
import { savedDocxRulerEdges } from './docx-ruler-data';
import { normalizeConversationEdge } from './normalize-graph';
import { countTokens } from '../utils';
import { confirmDialog, toast, useUiStore } from './ui-store';
import { inlineVaultedContent, internNodes } from './attachment-vault';
import { captureImportedCodexVisuals } from './codex-visual-host';
import { ensureAgentHost } from './agents/host';
import { t, fmt } from '../i18n';
import type { ThoughtNode } from '../types';
import type { ProjectMeta, ProjectPlacement } from '../store/projects';
import type { PersistedState } from '../store/types';

export const EXPORT_FORMAT_VERSION = 1;
// Must match the main store's persist `version` — a mismatched envelope
// silently hydrates to an empty canvas.
const PERSIST_VERSION = 1;

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'canvas';
}

export function downloadFile(filename: string, content: string | Blob, mime: string): void {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string, { notify = true } = {}): Promise<void> {
  await navigator.clipboard.writeText(text);
  if (notify) toast('success', t('toast.copied'));
}

function activeProject() {
  const { projects, activeId } = useProjects.getState();
  return projects.find((p) => p.id === activeId);
}

export function activeProjectName(): string {
  return activeProject()?.name ?? 'canvas';
}

export async function exportActiveProjectHtml(): Promise<void> {
  const { nodes, edges } = useStore.getState();
  const project = activeProject();
  const projectId = useProjects.getState().activeId;
  // Mounted controls and panels belong to the active canvas. A file must
  // never combine one project's graph with another project's window.
  let switched = false;
  const unsubscribe = useProjects.subscribe(state => { if (state.activeId !== projectId) switched = true; });
  const checkProject = () => { if (switched) throw new Error('The active canvas changed during HTML export'); };
  const name = project?.name ?? 'canvas';
  let progress: string | undefined;
  try {
    const { confirmIfSensitive } = await import('./sensitive-scan');
    if (!await confirmIfSensitive(nodes)) return;
    progress = toast('info', t('richDocument.exporting'), 0);
    const { buildCanvasHtml } = await import('./canvas-html');
    checkProject();
    const html = await buildCanvasHtml(name, nodes, savedDocxRulerEdges(nodes, edges), project?.kind);
    checkProject();
    downloadFile(`${sanitizeFilename(name)}.html`, html, 'text/html;charset=utf-8');
    toast('success', fmt(t('toast.exported'), { name }));
  } catch (error) {
    console.error('[thoughtdag] HTML export failed', error);
    toast('error', t('richDocument.exportFailed'));
  } finally {
    unsubscribe();
    if (progress) useUiStore.getState().dismissToast(progress);
  }
}

// ─── Whole-canvas JSON backup ───────────────────────────────────
export async function buildCanvasBackup(project: Pick<ProjectMeta, 'name' | 'instantiatedFrom'> & { id: string | null }, graph: PersistedState,
  opts?: { sharedReadonly?: boolean; paradigm?: boolean }) {
  const { nodes: rawNodes, edges, events, lastNodeNumber } = graph;
  const nodes = await inlineVaultedContent(rawNodes);
  return {
    version: EXPORT_FORMAT_VERSION,
    ...(opts?.paradigm && { kind: 'thoughtdag-paradigm' }),
    name: project.name,
    projectId: project.id,
    exportedAt: new Date().toISOString(),
    // paradigm provenance lives in project meta, not the graph — without
    // this line a backup round-trip would silently drop it
    instantiatedFrom: project.instantiatedFrom,
    // a courtesy flag, not a lock: the importing side asks before turning
    // this into an editable copy (a file in someone's hands is theirs)
    ...(opts?.sharedReadonly ? { sharedReadonly: true } : {}),
    nodes: stripTransient(nodes),
    lastNodeNumber,
    edges: savedDocxRulerEdges(rawNodes, edges).map(normalizeConversationEdge),
    events,
  };
}

export async function exportActiveProjectJson(opts?: { sharedReadonly?: boolean }): Promise<void> {
  // The read-only viewer has a graph but no local catalog entry.
  const project = activeProject() ?? { id: null, name: 'canvas' };
  const payload = await buildCanvasBackup(project, useStore.getState(), opts);
  const { confirmIfSensitive } = await import('./sensitive-scan');
  if (!await confirmIfSensitive(payload.nodes)) return;
  appSettings.setItem('thoughtdag.lastBackupAt', String(Date.now()));
  downloadFile(`${sanitizeFilename(project.name)}.thoughtdag.json`, JSON.stringify(payload), 'application/json');
  toast('success', fmt(t('toast.exported'), { name: project.name }));
}

/**
 * Parse any supported file. Returns 'own' after importing a ThoughtDAG
 * backup directly, or the conversation list of a ChatGPT/Claude export so
 * the caller can show a picker.
 */
export async function exportActiveParadigm(): Promise<void> {
  const project = activeProject() ?? { id: null, name: 'canvas' };
  const payload = await buildCanvasBackup(project, useStore.getState(), { paradigm: true });
  const { confirmIfSensitive } = await import('./sensitive-scan');
  if (!await confirmIfSensitive(payload.nodes)) return;
  downloadFile(`${sanitizeFilename(project.name)}.paradigm.json`, JSON.stringify(payload), 'application/json');
  toast('success', fmt(t('toast.exported'), { name: project.name }));
}

export async function parseImportFile(file: File): Promise<
  { kind: 'own'; ok: boolean } | { kind: 'chat'; conversations: ImportableConversation[] } | { kind: 'error' }
> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not one JSON document — maybe a runner session (JSONL, one event per
    // line). Runner sessions import read-only through the same modal.
    const { anyRunnerSessionConversation } = await import('./adapters');
    const session = await anyRunnerSessionConversation(text);
    if (session) return { kind: 'chat', conversations: [session] };
    toast('error', t('toast.importFailedJson'));
    return { kind: 'error' };
  }
  // The manifest also carries nodes/edges arrays, but they are audit
  // records, not canvas nodes — importing them would build a broken canvas.
  if ((parsed as { format?: string } | null)?.format === 'thoughtdag-manifest') {
    toast('error', t('toast.importManifest'), 9000);
    return { kind: 'error' };
  }
  const format = detectFormat(parsed);
  if (format === 'chatgpt' || format === 'claude') {
    const conversations = listConversations(parsed);
    if (conversations.length === 0) {
      toast('error', t('toast.importNoConversations'));
      return { kind: 'error' };
    }
    return { kind: 'chat', conversations };
  }
  return { kind: 'own', ok: await importProjectFromFile(file, parsed) };
}

// A canvas node must at least place and describe itself; anything else
// (manifests, foreign JSON with nodes/edges arrays) is rejected up front
// instead of crashing later inside stripTransient/React Flow.
function looksLikeCanvasNodes(nodes: unknown[]): boolean {
  return nodes.every((n) => {
    const node = n as Partial<ThoughtNode>;
    return !!node && typeof node.id === 'string'
      && !!node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
      && !!node.data && typeof node.data === 'object' && !Array.isArray(node.data);
  });
}

/** Convert selected chat conversations, one new project each. */
export async function importChatConversations(convs: ImportableConversation[]): Promise<void> {
  let firstId: string | null = null;
  let total = 0;
  for (const conv of convs) {
    const graph = conv.build();
    const { edges } = graph;
    const nodes = conv.source === 'codex' ? await captureImportedCodexVisuals(graph.nodes, ensureAgentHost) : graph.nodes;
    if (nodes.length === 0) continue;
    // Arrive at the working tail, not a bird's-eye column of 200 turns —
    // the canvas consumes this once on its next mount.
    if (firstId === null) {
      const { useUiStore } = await import('./ui-store');
      useUiStore.getState().setArrivalFocusNodeId(nodes[nodes.length - 1].id);
    }
    const id = crypto.randomUUID();
    await idbSet(projectStorageKey(id), JSON.stringify({
      state: { nodes: stripTransient(nodes), edges: edges.map(normalizeConversationEdge) },
      version: PERSIST_VERSION,
    }));
    await adoptImportedProject(id, conv.title.slice(0, 60));
    firstId ??= id;
    total += nodes.length;
  }
  if (firstId) {
    toast('success', fmt(t('toast.importedChats'), { n: convs.length, m: total }));
  }
}

/** Imported canvases carry the AUTHOR's model pins (e.g. gateway slugs);
    the importer may reach the same families through different providers.
    Same family here → remap to the local id; unreachable → keep the pin
    (the author's intent survives a round-trip) and warn — generation
    falls back honestly at run time. */
async function reconcileImportedModels(nodes: ThoughtNode[], notify = true): Promise<ThoughtNode[]> {
  const data = await getModelsOnce();
  if (!data || data.models.length === 0) return nodes;
  const remapped = new Set<string>();
  const missing = new Set<string>();
  const out = nodes.map((n) => {
    const pin = n.data?.model;
    if (!pin) return n;
    const r = reconcileModelId(pin, data.models);
    if (r === pin) return n;
    if (r) { remapped.add(`${pin} → ${r}`); return { ...n, data: { ...n.data, model: r } }; }
    missing.add(pin);
    return n;
  });
  if (notify && remapped.size) toast('info', fmt(t('import.modelsRemapped'), { list: [...remapped].join('，') }), 9000);
  if (notify && missing.size) toast('info', fmt(t('import.modelsMissing'), { list: [...missing].join('，') }), 10000);
  return out;
}

export type CanvasImportResult = 'imported' | 'cancelled' | { error: string };

export async function importNativeCanvas(file: File, options?: ProjectPlacement & { quiet?: boolean }, pre?: unknown): Promise<CanvasImportResult> {
  type Backup = PersistedState & { name?: string; kind?: string; format?: string; version?: number; sharedReadonly?: boolean; instantiatedFrom?: ProjectMeta['instantiatedFrom'] };
  const invalid = (message: string) => {
    if (!options?.quiet) toast('error', message, 9000);
    return { error: message };
  };
  let parsed: Backup;
  try {
    parsed = (pre ?? JSON.parse((await file.text()).replace(/^\uFEFF/, ''))) as Backup;
  } catch {
    return invalid(t('toast.importFailedJson'));
  }
  if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    return invalid(t('toast.importFailedMissing'));
  }
  if (parsed.version !== undefined && parsed.version !== EXPORT_FORMAT_VERSION) {
    return invalid(t('library.invalidCanvasVersion'));
  }
  const paradigm = parsed.kind === 'thoughtdag-paradigm';
  if (parsed.format !== undefined || (parsed.kind !== undefined && !paradigm) ||
      parsed.edges.some(edge => !edge || typeof edge.source !== 'string' || typeof edge.target !== 'string')) {
    return invalid(t('library.invalidCanvasFile'));
  }
  if (!looksLikeCanvasNodes(parsed.nodes)) {
    return invalid(t('toast.importFailedShape'));
  }
  if (parsed.sharedReadonly) {
    const ok = await confirmDialog({
      title: t('import.readonlyTitle'),
      message: t('import.readonlyConfirm'),
      confirmLabel: t('common.confirm'),
    });
    if (!ok) return 'cancelled';
  }
  const id = crypto.randomUUID();
  const reconciled = await internNodes(await reconcileImportedModels(parsed.nodes, !options?.quiet));
  // Write in the zustand-persist envelope format so rehydration accepts it.
  await idbSet(projectStorageKey(id), JSON.stringify({
    state: { nodes: stripTransient(reconciled), lastNodeNumber: parsed.lastNodeNumber, edges: parsed.edges.map(normalizeConversationEdge), ...(Array.isArray(parsed.events) ? { events: parsed.events } : {}) },
    version: PERSIST_VERSION,
  }));
  const name = (typeof parsed.name === 'string' && parsed.name.trim()) || file.name.replace(/(?:\.(?:thoughtdag|paradigm))?\.json$/i, '') || 'Imported canvas';
  try {
    await adoptImportedProject(id, name, paradigm ? 'paradigm' : 'chat', { instantiatedFrom: parsed.instantiatedFrom }, { ...options, activate: false });
  } catch (error) {
    await idbDel(projectStorageKey(id));
    throw error;
  }
  if (options?.activate !== false) await switchProject(id);
  if (!options?.quiet) toast('success', fmt(t('toast.imported'), { name, n: parsed.nodes.length }));
  return 'imported';
}

export async function importProjectFromFile(file: File, pre?: unknown): Promise<boolean> {
  return (await importNativeCanvas(file, undefined, pre)) === 'imported';
}

// ─── Event-log CSV export (research measurement layer) ──────────
export function exportEventLogCsv(): void {
  const { events } = useStore.getState();
  if (events.length === 0) return;
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = events.map((e) => [e.t, e.op, e.id ?? '', e.d ? esc(JSON.stringify(e.d)) : ''].join(','));
  const csv = ['t,op,id,detail', ...rows].join('\n');
  downloadFile(`${sanitizeFilename(activeProjectName())}.events.csv`, csv, 'text/csv');
  toast('success', fmt(t('toast.exported'), { name: activeProjectName() }));
}

// ─── Markdown export ────────────────────────────────────────────
function nodeToMd(n: ThoughtNode): string {
  const parts = [`## Q: ${n.data.question}`, ''];
  const atts = n.data.attachments || [];
  if (atts.length > 0) parts.push(`> ${t('export.attachmentsLabel')} ${atts.map((a) => a.name).join(', ')}`, '');
  parts.push(n.data.response || '_(no response)_', '');
  return parts.join('\n');
}

export function nodesToMarkdown(ordered: ThoughtNode[], subtitle: string): string {
  const totalTok = ordered.reduce((s, n) => s + countTokens(n.data.question + n.data.response), 0);
  return [
    `# ${activeProjectName()}`,
    '',
    `> ${subtitle} · exported ${new Date().toISOString().slice(0, 10)} · ${ordered.length} nodes · ~${totalTok} tokens`,
    '',
    ordered.map(nodeToMd).join('\n---\n\n'),
  ].join('\n');
}

// Entry ①: the full context chain of one node (topological, roots first)
export function contextChainMarkdown(nodeId: string): string {
  const { nodes, edges } = useStore.getState();
  const ordered = getContextPath(nodeId, nodes, edges);
  return nodesToMarkdown(ordered, t('export.contextChain'));
}

// Entry ②: a multi-selection, in reading order (top-to-bottom, then left-to-right)
export function selectionMarkdown(selectedIds: string[]): string {
  const { nodes } = useStore.getState();
  const selected = new Set(selectedIds);
  const ordered = nodes
    .filter(node => selected.has(node.id) && node.data.stepKind !== 'frame')
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  return nodesToMarkdown(ordered, t('export.selectedNodes'));
}

export function downloadMarkdown(md: string): void {
  downloadFile(`${sanitizeFilename(activeProjectName())}.md`, md, 'text/markdown');
}
