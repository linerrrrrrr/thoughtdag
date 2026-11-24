import { toast, useUiStore } from './ui-store';
import { t } from '../i18n';
import { ensureCanvasWorkspace } from './canvas-workspace';
import { codexThreadId } from './codex-thread-link';

type SourceSession = { runner?: string; session?: string; cwd?: string | null };

/** Let the OS resolve the documented desktop deep link on the user's device. */
export async function openOriginalCodexThread(id: string): Promise<void> {
  const threadId = codexThreadId(id);
  if (!threadId) return;
  try {
    const url = `codex://threads/${threadId}`;
    if (window.desktopSessions?.openCodexThread) {
      if (await window.desktopSessions.openCodexThread(threadId)) return;
    } else {
      if (window.desktop) window.open(url, '_blank', 'noopener,noreferrer');
      else window.location.assign(url);
      return;
    }
  } catch { /* The app may not be installed on this device. */ }
  toast('error', t('ctx.openCodexFailed'));
}

/** Open the recorded session while keeping Codex in the active canvas folder. */
export async function openCanvasSession(runner: string, historicalCwd: string | null, sessionId: string): Promise<boolean> {
  if (!window.desktopSessions) return false;
  let cwd = historicalCwd;
  if (runner === 'codex') {
    const { bootProjects, useProjects } = await import('../store/projects');
    if (!useProjects.getState().activeId) await bootProjects();
    const { activeId } = useProjects.getState();
    cwd = activeId ? await ensureCanvasWorkspace(activeId).catch(() => null) : null;
    if (!cwd || useProjects.getState().activeId !== activeId) return false;
  }
  const result = await window.desktopSessions.openInCli(runner, cwd, sessionId, 'terminal').catch(() => null);
  return !!result?.opened;
}

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
  if (sessionId && runner && await openCanvasSession(runner, cwd, sessionId)) return true;
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
