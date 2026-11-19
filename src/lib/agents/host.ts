import { API_BASE } from '../constants';
import { installDshSessionsBridge } from './harness-bridge';

const harnessApi = import.meta.env.VITE_DSH_BRIDGE as string | undefined;
let probe: Promise<boolean> | null = null;
let checked = false;

export function canRetryAgentHost(): boolean {
  return !!window.desktopAgents || !!harnessApi || !!API_BASE
    || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

/** Startup and any open picker await the same bridge installation. */
export function ensureAgentHost(retry = false): Promise<boolean> {
  if (window.desktopAgents) return Promise.resolve(true);
  if (probe) return probe;
  if (checked && !retry) return Promise.resolve(false);
  const api = harnessApi ?? `${API_BASE}/api`;
  probe = import('./http-bridge').then(async ({ installAgentsHttpBridge }) => {
    const ready = await installAgentsHttpBridge(api);
    if (ready && !harnessApi && !window.desktopSessions) installDshSessionsBridge(api);
    return ready;
  }).catch(() => false).finally(() => {
    checked = true;
    probe = null;
  });
  return probe;
}
