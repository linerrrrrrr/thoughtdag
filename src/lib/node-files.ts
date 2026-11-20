import type { Attachment } from '../types';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { sameGraph } from '../store/slices/history';
import { t } from '../i18n';
import { loadAttachmentContent, loadDocumentContent, loadNodePdfFile } from './attachment-vault';
import { hasNativeDocxSource, isDocxDocument } from './document-copy';
import { diskStorageNamespace } from './disk-storage';
import { fileEditPreview } from './document-edit-preview';
import { managedDocumentFile, probeManagedDocuments, type ManagedFileKey, type ManagedFileState } from './managed-document-file';
import { toast } from './ui-store';

export const isFileMaterial = (att: Attachment) => !att.op && !/^(tool: |🔧|⌨️)/.test(att.name);
export const hasNodeFileHost = () => diskStorageNamespace() !== 'browser' || !!window.desktopAgents?.managedDocument;
const identity = (key: ManagedFileKey) => JSON.stringify([key.canvasId, key.nodeId, key.attachmentId]);
const tracked = new Map<string, { key: ManagedFileKey; file: ManagedFileState; attachment: Attachment }>();
const pending = new Map<string, Promise<unknown>>();
type Snapshot = ReturnType<typeof useStore.getState>['history'][number];
const editGroups = new Map<string, { token: object; last?: Snapshot }>();
export function groupNodeFileEdits(keys: ManagedFileKey[], token: object) {
  for (const key of keys) if (!ownsNodeFileEdits(key, token)) editGroups.set(identity(key), { token });
}
export function ownsNodeFileEdits(key: ManagedFileKey, token: object) {
  return editGroups.get(identity(key))?.token === token;
}
export function releaseNodeFileEdits(keys: ManagedFileKey[], token: object) {
  for (const key of keys) if (ownsNodeFileEdits(key, token)) editGroups.delete(identity(key));
}
const withFile = <T,>(key: ManagedFileKey, work: () => Promise<T>): Promise<T> => {
  const id = identity(key);
  const task = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
  pending.set(id, task);
  return task.finally(() => { if (pending.get(id) === task) pending.delete(id); });
};

function keyFor(canvasId: string, nodeId: string, att: Attachment): ManagedFileKey {
  const legacy = isDocxDocument(att) && !hasNativeDocxSource(att);
  return { canvasId, nodeId, attachmentId: att.id, name: legacy ? att.name + '.txt' : att.name };
}

function current(key: ManagedFileKey): Attachment | undefined {
  const project = useProjects.getState();
  if (project.switching || (project.activeId ?? 'default') !== key.canvasId) return;
  return useStore.getState().nodes.find(n => n.id === key.nodeId)?.data.attachments?.find(a => a.id === key.attachmentId);
}

const binary = (a: Attachment) => hasNativeDocxSource(a) || a.type === 'application/pdf' || a.type.startsWith('image/');
function encodeText(text: string) {
  const bytes = new TextEncoder().encode(text);
  let chars = '';
  for (let i = 0; i < bytes.length; i += 32768) chars += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(chars);
}
async function bytesOf(att: Attachment) {
  if (hasNativeDocxSource(att)) return loadDocumentContent(att);
  if (att.type === 'application/pdf') return loadNodePdfFile(att);
  const content = await loadAttachmentContent(att);
  return binary(att) ? content : encodeText(content);
}
function sameBytes(a: Attachment, b: Attachment) {
  return a === b || (a.editedDocxRevision === b.editedDocxRevision && a.editedDocxContent === b.editedDocxContent
    && a.pdfFileRevision === b.pdfFileRevision && a.pdfFileContent === b.pdfFileContent
    && a.content === b.content && a.contentInVault === b.contentInVault && a.contentVaultId === b.contentVaultId && a.name === b.name);
}

async function accept(key: ManagedFileKey, att: Attachment, value: string, revision: string) {
  const stillCurrent = () => {
    const live = current(key);
    return !!live && live.nodeFileRevision === att.nodeFileRevision && sameBytes(att, live);
  };
  if (!stillCurrent()) throw new Error(t('document.editChanged'));
  const group = editGroups.get(identity(key));
  if (hasNativeDocxSource(att) || att.type === 'application/pdf') {
    const { applyNodeFile } = await import('./node-file-edits');
    await applyNodeFile(key.canvasId, key.nodeId, att, value, 'base64', stillCurrent, revision);
  } else {
    const { readMaterialChange } = await import('./node-file-material');
    const patch = await readMaterialChange(att, value);
    if (!stillCurrent()) throw new Error(t('document.editChanged'));
    const state = useStore.getState();
    state.pushHistory();
    state.setAttachmentData(key.nodeId, att.id, { ...patch, nodeFileRevision: revision });
    state.pushHistory();
  }
  // Consecutive saves from one editing task are one undo step. An
  // intervening user action always keeps its own position in history.
  if (group && group === editGroups.get(identity(key))) {
    const { history, historyIndex } = useStore.getState();
    if (group.last && historyIndex > 1 && historyIndex === history.length - 1 && sameGraph(group.last, history[historyIndex - 1])) {
      useStore.setState({ history: [...history.slice(0, -2), history[historyIndex]], historyIndex: historyIndex - 1 });
    }
    group.last = history[historyIndex];
  }
  fileEditPreview(key.canvasId, key.nodeId, att.id, null);
}

function remember(key: ManagedFileKey, file: ManagedFileState, att: Attachment) {
  const { path, previewPath, revision } = file;
  // Never keep binary response bodies in the polling index.
  tracked.set(identity(key), { key, file: { path, previewPath, revision }, attachment: att });
}

async function reconcile(key: ManagedFileKey, readChanges: boolean): Promise<ManagedFileState | null> {
  const att = current(key);
  if (!att) throw new Error(t('document.editChanged'));
  const prior = tracked.get(identity(key));
  let file: ManagedFileState | null;
  const ensure = async () => {
    const bytes = await bytesOf(att);
    if (!bytes && (binary(att) || att.contentInVault)) throw new Error(t('document.openFailed'));
    return managedDocumentFile(key, { op: 'ensure', base64: bytes });
  };
  if (!prior || prior.key.name !== key.name) {
    // A renamed attachment has a different managed path. Initialize it the
    // same way as an imported attachment; other paths may still be in use.
    file = att.nodeFileRevision ? await managedDocumentFile(key, { op: 'read', knownRevision: att.nodeFileRevision }) : null;
    if (file && file.base64 === undefined && att.extractedBy === 'manual' && !binary(att) && !att.contentInVault) {
      // A text edit may have been persisted just before reload, while the
      // managed file still has the last synchronized bytes.
      file = await managedDocumentFile(key, { op: 'write', expectedRevision: file.revision, base64: await bytesOf(att) });
      if (file?.conflict) file = await managedDocumentFile(key, { op: 'read' });
    }
    file ??= await ensure();
  } else if (!sameBytes(prior.attachment, att)) {
    // An undo, redo or canvas edit restored different bytes. A concurrent
    // disk save must not be overwritten by this change.
    const bytes = await bytesOf(att);
    const live = current(key);
    if (!live || !sameBytes(live, att)) throw new Error(t('document.editChanged'));
    file = await managedDocumentFile(key, { op: 'write', expectedRevision: prior.file.revision, base64: bytes });
    if (file?.conflict) {
      // Keep the local state as an undo step and import the newer disk
      // version. A dirty DOCX editor retains its draft independently.
      file = await managedDocumentFile(key, { op: 'read' });
      toast('info', t('document.concurrentSave'));
    }
  } else if (readChanges) {
    file = await managedDocumentFile(key, { op: 'read', knownRevision: prior.file.revision });
    file ??= await ensure();
  } else return prior.file;
  if (!file) return null;
  const live = current(key);
  if (!live || !sameBytes(live, att) || att.nodeFileRevision !== live.nodeFileRevision) throw new Error(t('document.editChanged'));
  if (file.base64 !== undefined) await accept(key, live, file.base64, file.revision);
  else if (live.nodeFileRevision !== file.revision) useStore.getState().setAttachmentData(key.nodeId, att.id, { nodeFileRevision: file.revision });
  const updated = current(key);
  if (updated) remember(key, file, updated);
  return file;
}

export function openNodeFile(canvasId: string, nodeId: string, att: Attachment) {
  const key = keyFor(canvasId, nodeId, att);
  return withFile(key, () => reconcile(key, true));
}

/** The editor calls this before publishing its canvas revision. A browser
 * without a local file host continues to save into its attachment vault. */
export async function saveNodeFile(canvasId: string, nodeId: string, att: Attachment, content: string,
  assertCurrent: () => void, publish: (revision?: string) => void): Promise<void> {
  if (!hasNodeFileHost()) { assertCurrent(); publish(); return; }
  const key = keyFor(canvasId, nodeId, att);
  return withFile(key, async () => {
    assertCurrent();
    // A copied/imported attachment may carry a hash from its old canvas
    // before its ordinary file exists in this one.
    const synchronized = await reconcile(key, false);
    assertCurrent();
    const base = att.nodeFileRevision ?? synchronized?.revision;
    if (!base) throw new Error(t('document.openFailed'));
    const file = await managedDocumentFile(key, { op: 'write', expectedRevision: base, base64: content });
    if (!file || file.conflict) throw new Error(t('document.editChanged'));
    // Publish and remember the same revision before releasing the file.
    // If the editor changed during the write, reconcile from disk on retry.
    tracked.delete(identity(key));
    assertCurrent();
    publish(file.revision);
    const saved = current(key);
    if (saved) remember(key, file, saved);
  });
}

export function watchNodeFiles() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const failed = new Set<string>();
  const diskPreviews = new Map<string, string>();
  function report(id: string, name: string, error: unknown) {
    if (!failed.has(id)) toast('error', name + ' · ' + (error instanceof Error ? error.message : String(error)));
    failed.add(id);
  }
  async function poll() {
    try {
      const project = useProjects.getState();
      if (project.switching || !hasNodeFileHost()) return;
      const canvasId = project.activeId ?? 'default';
      const materials = useStore.getState().nodes.flatMap(n => (n.data.attachments ?? []).filter(isFileMaterial).map(att => ({ key: keyFor(canvasId, n.id, att), att })));
      const active = new Set(materials.map(({ key }) => identity(key)));
      for (const [id, entry] of tracked) if (!active.has(id)) {
        fileEditPreview(entry.key.canvasId, entry.key.nodeId, entry.key.attachmentId, null);
        tracked.delete(id);
        diskPreviews.delete(id);
        failed.delete(id);
      }
      const items = materials.flatMap(({ key }) => {
        const entry = tracked.get(identity(key));
        return entry ? [{ ...key, knownRevision: entry.file.revision }] : [];
      });
      const changes = await probeManagedDocuments(items);
      const byNode = new Map(changes.map(x => [JSON.stringify([x.nodeId, x.attachmentId]), x]));
      for (const { key, att } of materials) {
        if (stopped || useProjects.getState().switching || (useProjects.getState().activeId ?? 'default') !== canvasId) break;
        const id = identity(key);
        const change = byNode.get(JSON.stringify([key.nodeId, key.attachmentId]));
        try {
          const prior = tracked.get(id);
          if (!prior || !sameBytes(prior.attachment, att) || change?.changed) await withFile(key, () => reconcile(key, !!change?.changed));
          const preview = change?.preview;
          if (preview && current(key)?.nodeFileRevision === preview.baseRevision) {
            const signature = JSON.stringify(preview);
            if (diskPreviews.get(id) !== signature) fileEditPreview(canvasId, key.nodeId, key.attachmentId, preview);
            diskPreviews.set(id, signature);
          } else if (diskPreviews.delete(id)) fileEditPreview(canvasId, key.nodeId, key.attachmentId, null);
          failed.delete(id);
        } catch (error) { if (current(key)) report(id, key.name, error); }
      }
      failed.delete('probe');
    } catch (error) { report('probe', t('document.openFailed'), error); }
    finally { if (!stopped) timer = setTimeout(() => { void poll(); }, document.hidden ? 3500 : 650); }
  }
  void poll();
  return () => { stopped = true; clearTimeout(timer); };
}
