import './index.css'
import { BrowserImportChoiceRequired, initializeDiskStorage, StorageHostUpdateRequired } from './lib/disk-storage'

// Settings are read at module initialization, so restore/migrate the selected
// storage before importing the application and its stores.
const root = document.getElementById('root')!
let language = navigator.language
try { language = localStorage.getItem('thoughtdag.lang') ?? language } catch { /* Storage may be unavailable. */ }
const zh = language.toLowerCase().startsWith('zh')
const screen = document.createElement('main')
screen.className = 'min-h-screen bg-surface text-ink flex items-center justify-center px-6'
const card = document.createElement('section')
card.className = 'w-full max-w-md rounded-panel border border-line bg-card p-6 shadow-sm'
const heading = document.createElement('h1')
heading.className = 'text-title font-semibold'
heading.textContent = zh ? '正在打开本地数据' : 'Opening local data'
const message = document.createElement('p')
message.className = 'mt-3 text-control text-ink-muted'
message.setAttribute('role', 'status')
message.setAttribute('aria-live', 'polite')
message.textContent = zh ? '正在检查画布和附件。' : 'Checking canvases and attachments.'
card.append(heading, message)
screen.append(card)
root.replaceChildren(screen)

function start(choice?: 'project' | 'import') {
  card.replaceChildren(heading, message)
  heading.textContent = zh ? '正在打开本地数据' : 'Opening local data'
  message.textContent = zh ? '正在检查画布和附件。' : 'Checking canvases and attachments.'
  message.setAttribute('role', 'status')
  void initializeDiskStorage((progress) => {
    message.textContent = zh ? `正在核对本地数据 ${progress}` : `Verifying local data ${progress}`
  }, choice).then(() => import('./app-entry')).catch((error: unknown) => {
    if (error instanceof BrowserImportChoiceRequired) {
      heading.textContent = zh ? '浏览器中还有旧画布' : 'Older canvases in this browser'
      message.textContent = zh
        ? '这个地址以前迁移过数据。可以直接打开项目，也可以将浏览器保留的旧画布一起导入。两种选择都会保留浏览器中的原件。'
        : 'This address was migrated before. Open the project, or import the older browser canvases into it. The originals stay in this browser.'
      const actions = document.createElement('div')
      actions.className = 'mt-4 flex flex-wrap gap-2'
      for (const action of ['project', 'import'] as const) {
        const primary = action === 'project'
        const button = document.createElement('button')
        button.type = 'button'
        button.className = primary
          ? 'rounded-control bg-action px-4 py-2 text-control text-white hover:bg-action-strong'
          : 'rounded-control border border-line px-4 py-2 text-control hover:bg-wash'
        button.textContent = primary ? (zh ? '打开项目画布' : 'Open project canvases')
          : (zh ? '导入旧画布并打开' : 'Import older canvases and open')
        button.addEventListener('click', () => start(action))
        actions.append(button)
      }
      card.append(actions)
      return
    }
    console.error('[thoughtdag] local storage could not be opened:', error)
    heading.textContent = zh ? '无法打开本地数据' : 'Unable to open local data'
    if (error instanceof StorageHostUpdateRequired) {
      message.textContent = zh
        ? '请用当前项目版本重启本地数据服务，然后重试。'
        : 'Restart the local data service with the current project version, then retry.'
    } else {
      message.textContent = zh
        ? '请检查项目数据目录和本地服务，然后重试。'
        : 'Check the project data directory and local service, then retry.'
    }
    message.setAttribute('role', 'alert')
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'mt-4 rounded-control bg-action px-4 py-2 text-control text-white hover:bg-action-strong'
    retry.textContent = zh ? '重试' : 'Retry'
    retry.addEventListener('click', () => start())
    card.append(retry)
  })
}
start()
