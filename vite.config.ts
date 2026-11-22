import { defineConfig, loadEnv, normalizePath } from 'vite'
import type { Connect, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { designRegistryGate } from './scripts/design-registry-vite'

type StorageOptions = { dataRoot: string; database: boolean }

function realPath(file: string) {
  try { return realpathSync.native(file) } catch { return file }
}

function inside(dir: string, file: string) {
  const suffix = relative(dir, file)
  return !suffix || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep))
}

function protectLocalData(privateDirs: string[]): Plugin {
  // Vite's public directory is served separately from its fs.deny checks.
  // Check real paths too, so a linked file or directory retains its privacy.
  const realDirs = privateDirs.map(realPath)
  const guard = (servedDirs: string[]): Connect.NextHandleFunction => (req, res, next) => {
    let pathname: string
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname) }
    catch { res.writeHead(400).end(); return }
    const fsPath = pathname.slice('/@fs/'.length)
    const candidates = pathname.startsWith('/@fs/')
      ? [resolve(isAbsolute(fsPath) ? fsPath : '/' + fsPath)]
      : servedDirs.filter(Boolean).map(dir => resolve(dir, '.' + pathname))
    const privateFile = candidates.some(candidate => {
      const file = realPath(candidate)
      return realDirs.some(dir => inside(dir, file))
    })
    if (privateFile) { res.writeHead(403).end(); return }
    next()
  }
  return {
    name: 'thoughtdag-private-data',
    configureServer(server) {
      server.middlewares.use(guard([server.config.root, server.config.publicDir]))
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard([resolve(server.config.root, server.config.build.outDir)]))
    },
  }
}

export default defineConfig(({ command, mode, isPreview }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url))
  const env = { ...loadEnv(mode, projectRoot, ''), ...process.env }
  const localRequire = createRequire(import.meta.url)
  const { projectStorage } = localRequire(resolve(projectRoot, 'runtime/project-storage.cjs')) as {
    projectStorage: (root: string, env: NodeJS.ProcessEnv, defaultEnabled: boolean) => StorageOptions | null
  }
  const options = projectStorage(projectRoot, env, command === 'serve' && !isPreview && mode !== 'test')
  const storageFile = resolve(projectRoot, 'runtime/browser-storage.cjs')
  if (options) delete localRequire.cache[localRequire.resolve(storageFile)]
  const storage = options ? localRequire(storageFile) as {
    createBrowserStorage: (options: StorageOptions) => (req: IncomingMessage, res: ServerResponse, next: () => void) => void
  } : null
  const privateDirs = [resolve(projectRoot, 'local-data')]
  if (options && !options.database) {
    // Some existing installations put browser-storage/ in the checkout itself.
    if (inside(options.dataRoot, projectRoot)) {
      for (const dir of ['browser-storage', 'desktop-profile', 'workspaces', 'canvases', 'tmp']) {
        privateDirs.push(resolve(options.dataRoot, dir))
      }
    } else privateDirs.push(options.dataRoot)
  }
  return {
    define: { __THOUGHTDAG_DISK_STORAGE_REQUIRED__: JSON.stringify(Boolean(options)) },
    plugins: [protectLocalData(privateDirs), designRegistryGate(), react(), tailwindcss(), ...(storage && options ? [{
      name: 'thoughtdag-local-storage',
      configureServer(server: import('vite').ViteDevServer) {
        server.middlewares.use(storage.createBrowserStorage(options))
      },
      configurePreviewServer(server: import('vite').PreviewServer) {
        server.middlewares.use(storage.createBrowserStorage(options))
      },
    }] : [])],
    // Keep the document package next to its emitted ZIP worker during dev.
    // Prebundling relocates the module to .vite/deps without its assets folder.
    optimizeDeps: { exclude: ['superdoc', '@superdoc/docx-engine'] },
    server: {
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/local-data/**'],
      },
      watch: {
        ignored: [normalizePath(resolve('local-tests')) + '/**', normalizePath(resolve('tmp')) + '/**', '**/local-data/**'],
      },
    },
  }
})
