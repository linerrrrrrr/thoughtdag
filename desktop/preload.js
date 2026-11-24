// The one bridge between the web layer and the desktop shell. The page
// stays a normal web app (no node integration); anything the shell can do
// for it is declared here, explicitly, one method at a time.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  // Only File objects selected or dropped by the user can provide a path.
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  // Update flow: the shell checks/downloads/installs, the PAGE renders every
  // prompt as in-app toasts (same look and language as the rest of the UI).
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (cb) => { ipcRenderer.on('update:event', (_e, data) => cb(data)); },
  // Windows and Linux: keep running in the tray when the window closes
  // (#77). macOS hides on close by itself, so the page offers no switch there.
  ...(process.platform === 'darwin' ? {} : { tray: (req) => ipcRenderer.invoke('shell:tray', req) }),
});

// Read-only runtime records used to complete agent nodes.
contextBridge.exposeInMainWorld('desktopSessions', {
  roots: () => ipcRenderer.invoke('sessions:roots'),
  list: (rootKey) => ipcRenderer.invoke('sessions:list', rootKey),
  read: (rootKey, rel) => ipcRenderer.invoke('sessions:read', rootKey, rel),
  openInCli: (runner, cwd, sessionId, mode) => ipcRenderer.invoke('sessions:open-in-cli', runner, cwd, sessionId, mode),
  codexThreadRead: (threadId) => ipcRenderer.invoke('codex:thread-read', threadId),
  openCodexThread: (threadId) => ipcRenderer.invoke('codex:thread-open', threadId),
});

contextBridge.exposeInMainWorld('desktopNavigation', {
  onOpen: (cb) => { ipcRenderer.on('navigation:open', (_e, url) => cb(url)); },
  pending: () => ipcRenderer.invoke('navigation:pending'),
});

// Local paths mentioned in responses: open here, on this machine (folder
// or file in Finder, image/PDF in its viewer), and images inline as data
// URLs. Nothing executable is ever launched.
// Agent runtimes the shell can hand a turn to (Pi today). `run` resolves
// with a run id at once; the run's events arrive through onEvent tagged
// with that id, ending with `run_end`.
contextBridge.exposeInMainWorld('desktopAgents', {
  capabilities: { nativePicker: true },
  available: () => ipcRenderer.invoke('agents:available'),
  models: (runtime) => ipcRenderer.invoke('agents:models', runtime),
  run: (request) => ipcRenderer.invoke('agents:run', request),
  abort: (runId) => ipcRenderer.invoke('agents:abort', runId),
  steer: (runId, prompt) => ipcRenderer.invoke('agents:steer', runId, prompt),
  workspace: (canvasId) => ipcRenderer.invoke('agents:workspace', canvasId),
  canvasWorkspace: (canvasId, namespace) => ipcRenderer.invoke('agents:canvas-workspace', canvasId, namespace),
  answer: (runId, requestId, response) => ipcRenderer.invoke('agents:answer', runId, requestId, response),
  guardWrite: (cwd, config) => ipcRenderer.invoke('agents:guard-write', cwd, config),
  pickCwd: () => ipcRenderer.invoke('agents:pick-cwd'),
  writeMaterials: (cwd, files) => ipcRenderer.invoke('agents:write-materials', cwd, files),
  managedDocument: (request) => ipcRenderer.invoke('agents:document', request),
  onEvent: (cb) => { ipcRenderer.on('agents:event', (_e, payload) => cb(payload)); },
});

// The why layer: search across every local agent's sessions and the
// memories Claude Code and Codex keep, recall one turn or entry in full.
contextBridge.exposeInMainWorld('desktopWhy', {
  status: () => ipcRenderer.invoke('why:status'),
  find: (phrase, opts) => ipcRenderer.invoke('why:find', phrase, opts),
  turns: (opts) => ipcRenderer.invoke('why:turns', opts),
  recall: (session, turn) => ipcRenderer.invoke('why:recall', session, turn),
  memories: () => ipcRenderer.invoke('why:memories'),
  suggest: (term, k) => ipcRenderer.invoke('why:suggest', term, k),
  topics: () => ipcRenderer.invoke('why:topics'),
  setTopics: (topics) => ipcRenderer.invoke('why:set-topics', topics),
  labelStart: (call, opts) => ipcRenderer.invoke('why:label-start', call, opts),
  labelStop: () => ipcRenderer.invoke('why:label-stop'),
  byTopic: (ids, opts) => ipcRenderer.invoke('why:by-topic', ids, opts),
  sample: (n) => ipcRenderer.invoke('why:sample', n),
  dossiers: () => ipcRenderer.invoke('why:dossiers'),
  dossier: (id) => ipcRenderer.invoke('why:dossier', id),
  setDossier: (id, d) => ipcRenderer.invoke('why:set-dossier', id, d),
  deleteDossier: (id) => ipcRenderer.invoke('why:delete-dossier', id),
  dossierPending: (id, item) => ipcRenderer.invoke('why:dossier-pending', id, item),
  dossierNewTurns: (id, opts) => ipcRenderer.invoke('why:dossier-new', id, opts),
});

contextBridge.exposeInMainWorld('desktopLocal', {
  codexVisual: (request) => ipcRenderer.invoke('local:codex-visual', request),
  open: (p) => ipcRenderer.invoke('local:open', p),
  reveal: (p) => ipcRenderer.invoke('local:reveal', p),
  read: (p) => ipcRenderer.invoke('local:read', p),
  image: (p) => ipcRenderer.invoke('local:image', p),
});

// The canvas's own source record for the why layer (see main.js): the page
// hands over a project id and its slim JSON; the shell decides where it lives.
contextBridge.exposeInMainWorld('desktopCanvas', {
  write: (projectId, json) => ipcRenderer.invoke('canvas:record-write', projectId, json),
  remove: (projectId) => ipcRenderer.invoke('canvas:record-remove', projectId),
});
