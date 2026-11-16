import './index.css'
import { initializeDiskStorage, StorageRecoveryRequired } from './lib/disk-storage'

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

function start(choice?: string) {
  card.replaceChildren(heading, message)
  heading.textContent = zh ? '正在打开本地数据' : 'Opening local data'
  message.textContent = zh ? '正在检查画布和附件。' : 'Checking canvases and attachments.'
  message.setAttribute('role', 'status')
  void initializeDiskStorage((progress) => {
    message.textContent = zh ? `正在核对本地数据 ${progress}` : `Verifying local data ${progress}`
  }, choice).then(() => import('./app-entry')).catch((error: unknown) => {
    if (error instanceof StorageRecoveryRequired) {
      heading.textContent = zh ? '发现已有本地数据' : 'Existing local data found'
      message.textContent = zh
        ? '当前浏览器尚未连接。请选择已有数据，或把当前浏览器数据迁入新副本。'
        : 'This browser is not connected. Choose existing data or migrate this browser into a new copy.'
      const choices = document.createElement('div')
      choices.className = 'mt-4 flex max-h-60 flex-col gap-2 overflow-y-auto'
      choices.dataset.storageRecovery = 'true'
      for (const candidate of [...error.candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.storageRecoveryNamespace = candidate.namespace
        button.className = 'rounded-control border border-line px-3 py-2 text-left text-control hover:bg-wash'
        const date = new Date(candidate.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')
        button.textContent = `${date} · ${candidate.namespace.slice(0, 8)}`
        button.addEventListener('click', () => start(candidate.namespace))
        choices.append(button)
      }
      const fresh = document.createElement('button')
      fresh.type = 'button'
      fresh.className = 'rounded-control border border-line px-3 py-2 text-left text-control hover:bg-wash'
      fresh.textContent = zh ? '将本浏览器数据迁入新副本' : 'Migrate this browser into a new copy'
      fresh.addEventListener('click', () => start('new'))
      choices.append(fresh)
      card.append(choices)
      return
    }
    console.error('[thoughtdag] local storage could not be opened:', error)
    heading.textContent = zh ? '无法打开本地数据' : 'Unable to open local data'
    message.textContent = zh
      ? '请检查数据目录和本地服务后重试。本次操作没有删除原有浏览器数据。'
      : 'Check the data directory and local service, then try again. Existing browser data was not deleted.'
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
