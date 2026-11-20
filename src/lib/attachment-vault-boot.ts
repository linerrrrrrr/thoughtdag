import { diskStorageNamespace, get as idbGet } from './disk-storage';
import { useStore } from '../store';
import { useProjects, projectStorageKey } from '../store/projects';
import { internNodes, gcVault } from './attachment-vault';
import type { ThoughtNode } from '../types';
import { DOCX_MIME_TYPE } from './document-copy';

// Store-aware vault plumbing lives in its own module: attachment-vault.ts
// is imported from inside the store's module graph (lib/attachments), so
// importing the store THERE would be circular. Only App boots these.

/** Older canvases carry PDF bytes inline — lighten the ACTIVE canvas once
    after it hydrates. Idempotent; the lightened graph re-persists via the
    normal middleware. */
export async function migrateActiveCanvasToVault(): Promise<void> {
  const { nodes } = useStore.getState();
  if (!nodes.some((n) => n.data.attachments?.some((a) => (a.type === 'application/pdf' || a.type === DOCX_MIME_TYPE) && a.content && !a.contentInVault))) return;
  const interned = await internNodes(nodes);
  // Guard against a project switch racing the async intern
  if (useStore.getState().nodes !== nodes) return;
  useStore.setState({ nodes: interned });
}

/** Boot sweep: collect every attachment id across ALL projects (persisted
    payloads + the live one), then drop unreferenced vault entries. */
export async function gcVaultAtBoot(): Promise<void> {
  try {
    // This retired database contains only capabilities for writing imported
    // OS files. Removing it detaches old imports without touching any file.
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('thoughtdag-document-sources');
    // Another local window may have vaulted a file ahead of its debounced
    // graph save. A sweep based on one window cannot establish ownership.
    if (diskStorageNamespace() !== 'browser') return;
    const ids = new Set<string>();
    for (const n of useStore.getState().nodes) for (const a of n.data.attachments ?? []) ids.add(a.contentVaultId ?? a.id);
    for (const p of useProjects.getState().projects) {
      const raw = await idbGet(projectStorageKey(p.id));
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const nodes = (parsed?.state?.nodes ?? []) as ThoughtNode[];
      for (const n of nodes) for (const a of n.data.attachments ?? []) ids.add(a.contentVaultId ?? a.id);
    }
    const swept = await gcVault(ids);
    if (swept > 0) console.info(`[thoughtdag] vault GC: swept ${swept} orphaned payload(s)`);
  } catch (err) {
    console.warn('[thoughtdag] vault GC failed:', err);
  }
}
