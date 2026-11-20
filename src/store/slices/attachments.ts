import type { StateCreator } from 'zustand';
import type { Attachment } from '../../types';
import { inheritedAttachments } from '../../lib/graph';
import { attachmentFingerprint } from '../../lib/attachments';
import { toolStepIds } from '../../lib/turn-insight';
import { toast } from '../../lib/ui-store';
import { t } from '../../i18n';
import type { StoreState, AttachmentSlice } from '../types';

export const createAttachmentSlice: StateCreator<StoreState, [], [], AttachmentSlice> = (set, get) => ({
  addAttachment: (nodeId: string, attachment: Attachment) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // Dedup: skip if same file already on this node (name + size + content prefix)
    const existing = node.data.attachments || [];
    const fingerprint = attachmentFingerprint(attachment);
    if (existing.some((a) => attachmentFingerprint(a) === fingerprint)) {
      return;
    }
    if (node.data.stepKind === 'file' && existing.length > 0) {
      toast('info', t('content.oneFilePerNode'));
      return;
    }
    get().logEvent('material-add', nodeId, { type: attachment.type });
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, attachments: [...(n.data.attachments || []), attachment] } }
          : n
      ),
    }));
    get().pushHistory();
  },

  removeAttachment: (nodeId: string, attachmentId: string) => {
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, attachments: (n.data.attachments || []).filter((a) => a.id !== attachmentId) } }
          : n
      ),
    }));
    get().pushHistory();
  },

  toggleExcludeAttachment: (nodeId: string, attachmentId: string, ancestorExcluded?: boolean) => {
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const excluded = n.data.excludedAttachmentIds || [];
        const included = n.data.includedAttachmentIds || [];
        const isExcludedSelf = excluded.includes(attachmentId);
        const isIncludedOverride = included.includes(attachmentId);

        if (ancestorExcluded && !isIncludedOverride) {
          // Ancestor excluded this → add to includedAttachmentIds to override
          return { ...n, data: { ...n.data, includedAttachmentIds: [...included, attachmentId] } };
        } else if (ancestorExcluded && isIncludedOverride) {
          // Was overriding ancestor exclusion → remove override (respect ancestor exclusion)
          return { ...n, data: { ...n.data, includedAttachmentIds: included.filter((id) => id !== attachmentId) } };
        } else if (isExcludedSelf) {
          // Self-excluded → un-exclude
          return { ...n, data: { ...n.data, excludedAttachmentIds: excluded.filter((id) => id !== attachmentId) } };
        } else {
          // Not excluded → exclude
          return { ...n, data: { ...n.data, excludedAttachmentIds: [...excluded, attachmentId] } };
        }
      }),
    }));
    get().pushHistory();
  },

  setToolRecordForwarded: (nodeId: string, forward: boolean) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    const ids = node ? toolStepIds(node.data) : [];
    if (ids.length === 0) return;
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const rest = (n.data.excludedAttachmentIds || []).filter((id) => !ids.includes(id));
        return { ...n, data: { ...n.data, excludedAttachmentIds: forward ? rest : [...rest, ...ids] } };
      }),
    }));
    get().pushHistory();
  },

  setAttachmentData: (nodeId: string, attachmentId: string, data: Partial<Attachment>) => {
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return { ...n, data: { ...n.data, attachments: (n.data.attachments || []).map((a) =>
          a.id === attachmentId ? { ...a, ...data } : a
        ) } };
      }),
    }));
  },

  setAttachmentRenderMode: (nodeId: string, attachmentId: string, mode: 'full' | 'text-only') => {
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return { ...n, data: { ...n.data, attachments: (n.data.attachments || []).map((a) =>
          a.id === attachmentId ? { ...a, renderMode: mode } : a
        ) } };
      }),
    }));
  },

  getInheritedAttachments: nodeId => inheritedAttachments(nodeId, get().nodes, get().edges),
});
