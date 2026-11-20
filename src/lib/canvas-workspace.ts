import { diskCanvasWorkspace } from './disk-storage';
import { browserNamespace } from './managed-document-file';

/** A folder for external tools, owned by the selected local storage profile.
 * Hosted canvases can still open and save when no filesystem host is available. */
export async function ensureCanvasWorkspace(canvasId: string): Promise<string | null> {
  if (!canvasId || typeof window === 'undefined' || window.location?.hash?.startsWith('#view=')) return null;
  const dir = await diskCanvasWorkspace(canvasId);
  if (dir) return dir;
  if (!window.desktopAgents?.canvasWorkspace) return null;
  const path = await window.desktopAgents.canvasWorkspace(canvasId, browserNamespace());
  if (typeof path !== 'string' || !path) throw new Error('Missing canvas workspace path');
  return path;
}
