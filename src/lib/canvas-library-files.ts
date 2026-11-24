import { useStore } from '../store';
import { projectStorageKey, refreshProjectIndex, useProjects, type ProjectMeta } from '../store/projects';
import type { PersistedState } from '../store/types';
import { t, fmt } from '../i18n';
import { get } from './disk-storage';
import { buildCanvasBackup, downloadFile, importNativeCanvas, type CanvasImportResult } from './export';
import { confirmSensitiveHits, scanNodes, type SensitiveHit } from './sensitive-scan';
import { toast } from './ui-store';

export async function importLibraryCanvas(file: File, folderId: string | null): Promise<CanvasImportResult> {
  if (!/\.json$/i.test(file.name)) {
    return { error: t('library.invalidCanvasFile') };
  }
  try {
    return await importNativeCanvas(file, { folderId, activate: false, quiet: true });
  } catch (error) {
    console.error('[thoughtdag] library import failed:', error);
    return { error: t('library.actionFailed') };
  }
}

/** Read-only access must not advance the revision used by the live editor. */
export async function readStoredCanvas(projectId: string): Promise<PersistedState> {
  const stored = await get(projectStorageKey(projectId));
  // A new, untouched canvas has a catalog entry before its first graph write.
  if (stored === undefined) return { nodes: [], edges: [], events: [] };
  const decoded = typeof stored === 'string' ? JSON.parse(stored) : stored;
  const graph = decoded?.state ?? decoded;
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid saved canvas');
  return graph as PersistedState;
}

const utf8 = new TextEncoder();
function archiveName(value: string, fallback: string): string {
  const safe = value.normalize('NFC').replace(/[\p{Cc}\\/:*?"<>|\u202a-\u202e\u2066-\u2069]/gu, '_').trim().replace(/^\.+/, '');
  let name = '', bytes = 0;
  // Leave room for the extension and a duplicate counter on common filesystems.
  for (const letter of safe) {
    bytes += utf8.encode(letter).length;
    if (bytes > 160) break;
    name += letter;
  }
  name = name.replace(/[ .]+$/g, '') || fallback;
  if (/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\s*\.|$)/i.test(name)) return '_' + name;
  return name;
}

export function folderArchiveEntries(projects: readonly ProjectMeta[]): { project: ProjectMeta; filename: string }[] {
  const used = new Set<string>();
  const ordered = [...projects].sort((a, b) => Number(!!a.archived) - Number(!!b.archived)
    || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return ordered.map(project => {
    const base = archiveName(project.name, 'canvas');
    const extension = project.kind === 'paradigm' ? '.paradigm.json' : '.thoughtdag.json';
    let filename = base + extension, number = 1;
    while (used.has(filename.toLowerCase())) filename = `${base} (${++number})${extension}`;
    used.add(filename.toLowerCase());
    return { project, filename };
  });
}

export async function exportProjectFolder(folderId: string): Promise<boolean> {
  await refreshProjectIndex();
  if (useProjects.getState().switching) {
    await new Promise<void>(resolve => {
      const stop = useProjects.subscribe(state => {
        if (!state.switching) { stop(); resolve(); }
      });
    });
  }
  const { projects, folders, activeId } = useProjects.getState();
  const folder = folders.find(item => item.id === folderId);
  if (!folder) throw new Error(t('library.actionFailed'));
  // Capture the live graph and its identity together. Switching or typing during
  // compression cannot mix two canvases or omit the last debounced edit.
  const { nodes, edges, events, lastNodeNumber } = useStore.getState();
  const live = { nodes, edges, events, lastNodeNumber };
  const entries = folderArchiveEntries(projects.filter(project => project.folderId === folderId));
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const name = archiveName(folder.name, 'folder');
  const root = zip.folder(name)!;
  const hits: SensitiveHit[] = [];
  for (const { project, filename } of entries) {
    const graph = project.id === activeId ? live : await readStoredCanvas(project.id);
    const payload = await buildCanvasBackup(project, graph, { paradigm: project.kind === 'paradigm' });
    if (hits.length < 20) hits.push(...scanNodes(payload.nodes).slice(0, 20 - hits.length));
    root.file(filename, JSON.stringify(payload));
  }
  if (!await confirmSensitiveHits(hits)) return false;
  const file = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadFile(name + '.zip', file, 'application/zip');
  toast('success', fmt(t('toast.exported'), { name: folder.name }));
  return true;
}
