import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { checkTypography } from './check-typography.mjs';
import { checkCursors } from './check-cursors.mjs';
import { checkSettingsSpacing } from './check-settings-spacing.mjs';

export function designRegistryGate(): Plugin {
  let root = '';
  let error = '';
  let checkedAt = 0;
  let pending: Promise<void> | undefined;
  const verify = () => {
    try {
      const typography = checkTypography(root);
      const cursors = checkCursors(root);
      const spacing = checkSettingsSpacing(root);
      error = [
        typography.length && 'Typography registration failed\n' + typography.join('\n'),
        cursors.length && 'Cursor registration failed\n' + cursors.join('\n'),
        spacing.length && 'Settings spacing registration failed\n' + spacing.join('\n'),
      ].filter(Boolean).join('\n');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    checkedAt = Date.now();
    if (error) throw new Error(error);
  };
  const relevant = (file: string) =>
    /^(?:vendor\/design-references\/.*|(?:src|runtime|desktop|public)\/.*\.(?:[cm]?[jt]sx?|css|json|html?)|[^/]+\.html?|server\.mjs)$/
      .test(path.relative(root, file).split(path.sep).join('/'));

  // A single save can update a registry and several views together. All hot
  // updates in that batch must wait for the same verification result.
  const verifyEdits = (server: ViteDevServer) => {
    pending ??= new Promise<void>((resolve, reject) => setTimeout(() => {
      const recovering = Boolean(error);
      try {
        verify();
        if (recovering) server.ws.send({ type: 'full-reload' });
        resolve();
      } catch (cause) { reject(cause); }
      finally { pending = undefined; }
    }, 40));
    return pending;
  };
  return {
    name: 'thoughtdag-design-registries',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
      verify();
    },
    configureServer(server) {
      // Block a fresh page or module load while an invalid hot edit is on disk.
      if (server.config.server.hmr === false) {
        server.watcher.on('all', (event, file) => {
          if (['change', 'add', 'unlink'].includes(event) && relevant(file)) {
            void verifyEdits(server).catch(() => { /* The middleware serves the diagnostics. */ });
          }
        });
      }
      server.middlewares.use(async (_req, res, next) => {
        // Editors can replace several files atomically. Recover on the next
        // request even if the watcher coalesced the repair with the failed edit.
        if (pending || (error && Date.now() - checkedAt > 500)) {
          try { await verifyEdits(server); } catch { /* Keep the current diagnostics. */ }
        }
        if (!error) return next();
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(error);
      });
    },
    hotUpdate({ file, server }) {
      if (this.environment.name === 'client' && relevant(file)) return verifyEdits(server);
    },
  };
}
