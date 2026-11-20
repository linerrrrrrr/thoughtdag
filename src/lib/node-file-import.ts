import { create } from 'zustand';
import type { Attachment } from '../types';
import { generateId } from '../utils';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { processFile, type ProcessFileCallbacks } from './attachments';
import { toast } from './ui-store';
import { t } from '../i18n';

export type PendingAttachmentFile = Pick<Attachment, 'id' | 'name' | 'type'>;
const empty: PendingAttachmentFile[] = [];
const useImports = create<{ pending: Record<string, PendingAttachmentFile[]> }>(() => ({ pending: {} }));
const queues = new Map<string, Promise<void>>();
const activeReads = new Map<string, () => void>();

export function usePendingAttachmentFiles(scope: string) {
  return useImports(state => state.pending[scope] ?? empty);
}

export function hasPendingAttachmentFiles(scope: string): boolean {
  return !!useImports.getState().pending[scope]?.length;
}

export function removePendingAttachmentFile(scope: string, id: string): boolean {
  const { pending } = useImports.getState();
  const files = pending[scope];
  if (!files?.some(file => file.id === id)) return false;
  const remaining = files.filter(file => file.id !== id);
  const next = { ...pending };
  if (remaining.length) next[scope] = remaining;
  else delete next[scope];
  useImports.setState({ pending: next });
  activeReads.get(id)?.();
  activeReads.delete(id);
  return true;
}

/** One read queue per composer keeps attachment order across successive pastes. */
export async function importQuestionFiles(scope: string, files: File[], callbacks: ProcessFileCallbacks): Promise<void> {
  if (!files.length) return;
  const placeholders = files.map(file => ({ id: generateId(), name: file.name, type: file.type }));
  useImports.setState(({ pending }) => ({
    pending: { ...pending, [scope]: [...(pending[scope] ?? empty), ...placeholders] },
  }));
  let slot = queues.get(scope) ?? Promise.resolve();
  const jobs = files.map((file, index) => {
    const previous = slot;
    let release!: () => void;
    slot = new Promise<void>(resolve => { release = resolve; });
    return previous.then(async () => {
      const { id } = placeholders[index];
      const stillPending = () => useImports.getState().pending[scope]?.some(item => item.id === id);
      try {
        if (!stillPending()) return;
        activeReads.set(id, release);
        await processFile(file, {
          add: attachment => {
            if (!stillPending()) return false;
            const accepted = callbacks.add(attachment);
            // Advancing here lets the next file read while extraction continues.
            removePendingAttachmentFile(scope, id);
            return accepted;
          },
          update: callbacks.update,
        }, id);
      } catch {
        toast('error', `${file.name}: ${t('attach.readFailed')}`);
      } finally {
        removePendingAttachmentFile(scope, id);
        release();
      }
    });
  });
  queues.set(scope, slot);
  try { await Promise.all(jobs); } finally { if (queues.get(scope) === slot) queues.delete(scope); }
}

export function nodeImportScope(nodeId: string) {
  return JSON.stringify([useStore.persist.getOptions().name, nodeId]);
}

export function useNodeFilesPending(nodeId: string): boolean {
  const importing = usePendingAttachmentFiles(nodeImportScope(nodeId));
  const extracting = useStore(state => !!state.nodes.find(node => node.id === nodeId)
    ?.data.attachments?.some(attachment => attachment.isExtracting));
  return !!importing.length || extracting;
}

export function nodeFilesPending(nodeId: string): boolean {
  return hasPendingAttachmentFiles(nodeImportScope(nodeId)) || !!useStore.getState().nodes.find(node => node.id === nodeId)
    ?.data.attachments?.some(attachment => attachment.isExtracting);
}

export function importNodeFiles(nodeId: string, files: File[]): Promise<void> {
  const project = useStore.persist.getOptions().name;
  if (useProjects.getState().switching) return Promise.resolve();
  const currentProject = () => useStore.persist.getOptions().name === project && !useProjects.getState().switching;
  return importQuestionFiles(nodeImportScope(nodeId), files, {
    add: attachment => {
      if (!currentProject()) return false;
      useStore.getState().addAttachment(nodeId, attachment);
      const node = useStore.getState().nodes.find(item => item.id === nodeId);
      if (!node?.data.attachments?.some(item => item.id === attachment.id)) return false;
    },
    update: (id, patch) => {
      if (currentProject()) useStore.getState().setAttachmentData(nodeId, id, patch);
    },
  });
}
