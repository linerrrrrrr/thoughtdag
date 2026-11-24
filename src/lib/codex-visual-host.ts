import { parseCodexVisuals, type CodexVisualSnapshot } from './codex-visuals';
import { codexThreadIdForVersion } from './codex-thread-link';
import type { ThoughtNode } from '../types';

/** Capture from the host which owns the native Codex record. */
export async function readCodexVisual(path: string, threadId: string): Promise<string | null> {
  try {
    const html = await window.desktopLocal?.codexVisual?.({ path, threadId });
    return typeof html === 'string' && html.length > 0 ? html : null;
  } catch { return null; }
}

export async function captureCodexVisuals(text: string, threadId: string, saved: readonly CodexVisualSnapshot[] = [], signal?: AbortSignal): Promise<CodexVisualSnapshot[] | undefined> {
  const refs = parseCodexVisuals(text);
  const paths = new Set(refs.map(ref => ref.path));
  for (const entry of saved) if (entry && typeof entry.html === 'string' && entry.html) paths.delete(entry.path);
  if (!paths.size || signal?.aborted) return;
  const captured: CodexVisualSnapshot[] = [];
  // A canvas switch drains active runs. Preserve the completed answer even
  // when its local host is still looking for an optional original.
  let onAbort: (() => void) | undefined;
  const stopped = signal && new Promise<null>(resolve => {
    onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    for (const path of paths) {
      const pending = readCodexVisual(path, threadId);
      const html = stopped ? await Promise.race([pending, stopped]) : await pending;
      if (html) captured.push({ path, html });
      if (signal?.aborted) break;
    }
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
  if (captured.length) return [...saved, ...captured];
}

/** Resolve available originals during native import and when reopening older canvases. */
export async function captureImportedCodexVisuals(nodes: ThoughtNode[], connect?: () => Promise<unknown>): Promise<ThoughtNode[]> {
  const updates = new Map<ThoughtNode, ThoughtNode>();
  for (const node of nodes) {
    const data = node.data;
    if (data.isLoading) continue;
    let snapshots = data.codexVisuals;
    for (const [i, text] of (data.responses ?? []).entries()) {
      if (typeof text !== 'string' || !text.includes('\uE200visualize\uE202')) continue;
      const threadId = codexThreadIdForVersion(data, i);
      if (!threadId) continue;
      const existing = snapshots?.[i];
      const saved = Array.isArray(existing) ? existing : [];
      if (connect && !window.desktopLocal?.codexVisual
          && parseCodexVisuals(text).some(ref => !saved.some(entry => entry?.path === ref.path && entry.html))) {
        await connect();
        connect = undefined;
      }
      const captured = await captureCodexVisuals(text, threadId, saved);
      if (!captured) continue;
      if (!snapshots || snapshots === data.codexVisuals) snapshots = [...(snapshots ?? [])];
      snapshots[i] = captured;
    }
    if (snapshots !== data.codexVisuals) updates.set(node, { ...node, data: { ...data, codexVisuals: snapshots } });
  }
  return updates.size ? nodes.map(node => updates.get(node) ?? node) : nodes;
}
