import { defineConfig, loadEnv, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { designRegistryGate } from './scripts/design-registry-vite'

export default defineConfig(({ mode }) => {
  // Disk storage is enabled only for an explicitly configured local instance.
  const env = loadEnv(mode, process.cwd(), '')
  const enabled = (process.env.THOUGHTDAG_DISK_STORAGE ?? env.THOUGHTDAG_DISK_STORAGE) === '1'
  const dataRoot = process.env.THOUGHTDAG_HOME ?? env.THOUGHTDAG_HOME
  if (enabled && !dataRoot) throw new Error('THOUGHTDAG_HOME is required for local disk storage')
  const localRequire = createRequire(import.meta.url)
  const storageFile = resolve(process.cwd(), 'runtime/browser-storage.cjs')
  if (enabled) delete localRequire.cache[localRequire.resolve(storageFile)]
  const storage = enabled ? localRequire(storageFile) as {
    createBrowserStorage: (options: { dataRoot: string }) => (req: IncomingMessage, res: ServerResponse, next: () => void) => void
  } : null
  return {
    define: { __THOUGHTDAG_DISK_STORAGE_REQUIRED__: JSON.stringify(enabled) },
    plugins: [designRegistryGate(), react(), tailwindcss(), ...(storage ? [{
      name: 'thoughtdag-local-storage',
      configureServer(server: import('vite').ViteDevServer) {
        server.middlewares.use(storage.createBrowserStorage({ dataRoot: dataRoot! }))
      },
      configurePreviewServer(server: import('vite').PreviewServer) {
        server.middlewares.use(storage.createBrowserStorage({ dataRoot: dataRoot! }))
      },
    }] : [])],
    // Keep the document package next to its emitted ZIP worker during dev.
    // Prebundling relocates the module to .vite/deps without its assets folder.
    optimizeDeps: { exclude: ['superdoc', '@superdoc/docx-engine'] },
    server: {
      watch: {
        ignored: [normalizePath(resolve('local-tests')) + '/**', normalizePath(resolve('tmp')) + '/**', '**/local-data/**'],
      },
    },
  }
})
