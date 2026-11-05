import { toast } from './ui-store';
import { t, fmt } from '../i18n';
import { localTargetOf } from './local-target';
export { localTargetOf, basenameOf } from './local-target';

// A response from a coding agent names files and folders on THIS machine
// ("wrote docs/x.md", "the poster is at /Users/…/poster.png"). Markdown
// turns those into root-relative links, and a browser would resolve them
// against the app's own origin — a web address for a file that lives on
// disk. Here they are recognized and kept local.

/** The local path an href/src denotes, or null for a real web resource.
 *  A RELATIVE path ("./fig1.png", "assets/1.png") is local only when the
 *  writer's working directory is known — the source session's cwd —
 *  and resolves against it. */
export function localPathOf(href: string | undefined | null, base?: string | null): string | null {
  return localTargetOf(href, base)?.path ?? null;
}

/** Open a local path on this machine through the desktop shell (folder or
 *  file in Finder, image/PDF in its viewer). In the browser there is no
 *  disk to reach: say so instead of navigating anywhere. */
export async function openLocalPath(path: string): Promise<void> {
  const bridge = window.desktopLocal;
  if (!bridge) { toast('info', fmt(t('local.unavailable'), { path }), 7000); return; }
  const r = await bridge.open(path).catch(() => ({ ok: false, reason: 'error' }));
  if (!r.ok) toast('error', fmt(t(r.reason === 'missing' ? 'local.missing' : 'local.failed'), { path }), 7000);
}
