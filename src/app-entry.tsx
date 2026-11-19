import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import App from './App'
import { bootProjects } from './store/projects'
import { isViewerMode, bootViewer } from './lib/viewer'
import { initAppearance } from './lib/appearance'
import { installDshSessionsBridge } from './lib/agents/harness-bridge'
import { ensureAgentHost } from './lib/agents/host'
import { onDiskStorageError } from './lib/disk-storage'
import { toast } from './lib/ui-store'
import { t } from './i18n'

initAppearance()
onDiskStorageError(() => toast('error', t('storage.writeFailed'), 0))

// Embedded hosts expose their own session bridge and update check.
const dshApi = import.meta.env.VITE_DSH_BRIDGE as string | undefined
if (dshApi && !window.desktopSessions) installDshSessionsBridge(dshApi)
if (dshApi) void import('./lib/plugin-update').then((mod) => mod.bootPluginUpdateCheck(dshApi))
void ensureAgentHost()

if (isViewerMode) void bootViewer()
else {
  void bootProjects()
  if (navigator.storage?.persist) void navigator.storage.persist()
  void import('./lib/local-backup').then((m) => m.bootAutoBackup())
}
void import('./lib/update-check').then((m) => m.bootUpdateCheck())

window.addEventListener('hashchange', () => {
  if (window.location.hash.startsWith('#view=') !== isViewerMode) window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
