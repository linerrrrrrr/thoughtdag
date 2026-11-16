import { toast, useUiStore } from './ui-store';
import { t } from '../i18n';

type SourceSession = { runner?: string; session?: string; cwd?: string | null };

/** Open a canvas source directly, or hand an agent source back to its runtime. */
export async function openWhyLink(url: string, source?: SourceSession): Promise<boolean> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'thoughtdag:') return false;
  const canvas = parsed.searchParams.get('canvas');
  if (canvas) {
    const { bootProjects, useProjects, switchProject } = await import('../store/projects');
    await bootProjects();
    const projects = useProjects.getState().projects;
    const matches = projects.filter((p) => p.name === canvas);
    const project = projects.find((p) => p.id === canvas) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!project) { toast('error', t('memory.sourceUnavailable')); return false; }
    await switchProject(project.id);
    const nodeId = parsed.searchParams.get('node');
    if (nodeId) {
      const { useStore } = await import('../store');
      if (useStore.getState().nodes.some((n) => n.id === nodeId)) useUiStore.getState().setArrivalFocusNodeId(nodeId);
    }
    return true;
  }
  const sessionId = source?.session ?? parsed.searchParams.get('session');
  const runner = source?.runner ?? parsed.searchParams.get('runner');
  const cwd = source?.cwd ?? parsed.searchParams.get('cwd');
  if (sessionId && runner && window.desktopSessions) {
    const result = await window.desktopSessions.openInCli(runner, cwd, sessionId, 'terminal').catch(() => null);
    if (result?.opened) return true;
  }
  toast('error', t('memory.sourceUnavailable'));
  return false;
}

/** The desktop shell may deliver a canvas link before or after the page starts. */
let navigationStarted = false;
export function startSourceNavigation(): void {
  const bridge = window.desktopNavigation;
  if (!bridge || navigationStarted) return;
  navigationStarted = true;
  bridge.onOpen((url) => { void openWhyLink(url); });
  void bridge.pending().then((url) => { if (url) void openWhyLink(url); }).catch(() => undefined);
}
