// ThoughtDAG desktop shell — a thin window around the SAME app:
// the bundled server.mjs runs as a child, serves the built dist on a
// local port, and this window points at it. No second stack: everything
// the web app is, the desktop app is.
const { app, BrowserWindow, shell, utilityProcess, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const net = require('net');
const os = require('os');
const fsp = require('fs/promises');

// Development: the repo root (live dist + server.mjs + root node_modules).
// Packaged: a self-contained payload under Resources — same three files,
// prepared by scripts/prepare-payload.mjs with production deps only.
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'payload')
  : path.join(__dirname, '..');
// Read only the local data-location switches; credentials stay with the
// existing server configuration rather than entering the shell's settings.
try {
  for (const line of require('fs').readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const match = line.match(/^\s*(THOUGHTDAG_HOME|THOUGHTDAG_DISK_STORAGE)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
} catch { /* Optional local deployment configuration. */ }

// An explicit test/demo profile always wins. A configured data root also owns
// the desktop profile, but an existing profile must first be migrated rather
// than silently opening an empty one under the new location.
const dataDirArg = process.argv.find((a) => a.startsWith('--user-data-dir='));
let dataDir = dataDirArg ? path.resolve(dataDirArg.slice('--user-data-dir='.length)) : null;
if (!dataDir && process.env.THOUGHTDAG_DISK_STORAGE === '1' && process.env.THOUGHTDAG_HOME) {
  if (!path.isAbsolute(process.env.THOUGHTDAG_HOME)) throw new Error('THOUGHTDAG_HOME must be absolute');
  const previous = app.getPath('userData');
  const next = path.join(process.env.THOUGHTDAG_HOME, 'desktop-profile');
  const fs = require('fs');
  if (!fs.existsSync(next) && fs.existsSync(previous) && fs.readdirSync(previous).length) {
    throw new Error('The existing desktop profile must be migrated before changing its data directory');
  }
  fs.mkdirSync(next, { recursive: true, mode: 0o700 });
  dataDir = next;
}
if (dataDir) {
  app.setPath('userData', dataDir);
  app.setPath('sessionData', dataDir);
}
// The why layer as a library (cli/src/lib.ts bundled by `npm run desktop:why`;
// the payload carries a copy): the index under ~/.thoughtdag, find, recall,
// and the memory files. Loaded on first use — a query refreshes the index
// when a source moved on, so the first call after a while can take a moment.
const WHY_FILE = app.isPackaged ? path.join(ROOT, 'why.mjs') : path.join(__dirname, 'why.mjs');
let whyModule = null;
function whyLib() {
  if (!whyModule) {
    whyModule = import(require('url').pathToFileURL(WHY_FILE).href).then((m) => { m.setQuiet?.(true); return m; });
    whyModule.catch(() => { whyModule = null; });
  }
  return whyModule;
}
let serverProc = null;
let win = null;

// Closing the window hides it: the page is where answers stream and unsent
// drafts live, so it keeps running. On macOS always (the Dock brings it
// back, Cmd+Q quits); on Windows and Linux when the person keeps the app in
// the tray (#77). Quitting from a menu, the tray or an update install
// closes for real.
let quitting = false;
let tray = null;
let shellPrefs = null;
const shellPrefsFile = () => path.join(app.getPath('userData'), 'shell-prefs.json');
function prefs() {
  if (!shellPrefs) {
    try { shellPrefs = JSON.parse(require('fs').readFileSync(shellPrefsFile(), 'utf8')); } catch { shellPrefs = {}; }
  }
  return shellPrefs;
}
const hidesOnClose = () => process.platform === 'darwin' || !!prefs().closeToTray;

function showWindow() {
  if (!win || win.isDestroyed()) { void boot(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function syncTray() {
  if (process.platform === 'darwin') return;
  if (!prefs().closeToTray) { tray?.destroy(); tray = null; return; }
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
    tray.setToolTip('ThoughtDAG');
    tray.on('click', showWindow);
  }
  // the page sends its own words for the menu, in the language it shows
  const labels = prefs().trayLabels ?? {};
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: labels.open || 'Open ThoughtDAG', click: showWindow },
    { type: 'separator' },
    { label: labels.quit || 'Quit', click: () => app.quit() },
  ]));
}

function setupShell() {
  ipcMain.handle('shell:tray', async (_e, req) => {
    if (process.platform === 'darwin') return { closeToTray: false };
    const next = {};
    if (typeof req?.on === 'boolean') next.closeToTray = req.on;
    if (typeof req?.labels?.open === 'string' && typeof req?.labels?.quit === 'string') {
      next.trayLabels = { open: req.labels.open.slice(0, 60), quit: req.labels.quit.slice(0, 60) };
    }
    if (Object.keys(next).length) {
      shellPrefs = { ...prefs(), ...next };
      await fsp.writeFile(shellPrefsFile(), JSON.stringify(shellPrefs));
    }
    syncTray();
    return { closeToTray: !!prefs().closeToTray };
  });
  syncTray();
}

// first free port from a quiet base — never collide with dev servers
function freePort(start = 31173) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(freePort(start + 1)));
    probe.once('listening', () => probe.close(() => resolve(start)));
    probe.listen(start, '127.0.0.1');
  });
}

async function waitReady(port, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/models`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function boot() {
  const port = await freePort();
  serverProc = utilityProcess.fork(path.join(ROOT, 'server.mjs'), [], {
    cwd: ROOT, // .env resolves from the project root, same as `npm run server`
    // HOST is forced to loopback AFTER the spread: the desktop shell only ever
    // connects to 127.0.0.1, so the bundled server must never bind anything
    // else — not even if the user's ambient environment carries HOST=0.0.0.0.
    // The HOST opt-in escape hatch is for `npm run server` power users only.
    env: { ...process.env, PORT: String(port), SERVE_DIST: path.join(ROOT, 'dist'), HOST: '127.0.0.1' },
    stdio: 'pipe',
    serviceName: 'thoughtdag-server',
  });
  serverProc.stdout?.on('data', (d) => console.log('[server]', String(d).trimEnd()));
  serverProc.stderr?.on('data', (d) => console.error('[server]', String(d).trimEnd()));

  win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'ThoughtDAG',
    backgroundColor: '#FAF9F7',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  // splash first: the window exists from the first moment, breathing,
  // while the bundled server warms up behind it
  const w = win;
  w.on('close', (e) => {
    if (quitting || !hidesOnClose()) return;
    e.preventDefault();
    w.hide();
  });
  w.on('closed', () => { if (win === w) win = null; });
  win.loadFile(path.join(__dirname, 'splash.html'));
  // external links belong to the system browser, not this window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // In-page navigation to the outside (a plain link inside a response)
  // would replace the app with the target site, with no way back. The
  // app's own origins navigate; everything else goes to the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (/^(http:\/\/(127\.0\.0\.1|localhost)[:/]|file:|data:)/.test(url)) return;
    e.preventDefault();
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
  });

  const ready = await waitReady(port);
  if (!ready) {
    win.loadURL(`data:text/html,<pre>ThoughtDAG server failed to start on port ${port}.\nCheck the terminal output.</pre>`);
    return;
  }
  // ?dv= identifies the desktop build to the web layer; &su=1 tells it the
  // shell self-updates, so the in-page download nudge stays quiet.
  // --lang=en|zh seeds the UI language (a demo profile boots in the
  // requested language instead of the system's); absent, the web layer
  // detects as always.
  const langArg = process.argv.find((a) => a === '--lang=en' || a === '--lang=zh');
  const langQ = langArg ? `&lang=${langArg.slice('--lang='.length)}` : '';
  // TD_WHATS_NEW=1 forces the what's-new dialog for this version (development).
  const wnQ = process.env.TD_WHATS_NEW === '1' ? '&wn=1' : '';
  win.loadURL(`http://127.0.0.1:${port}/?dv=${encodeURIComponent(app.getVersion())}&su=1${langQ}${wnQ}`);
}

// ─── Read-only access to agent runtime records ──────────────────────────
// The shell exposes four fenced primitives; ALL runner knowledge (formats,
// meta parsing, grouping) lives in the web layer's adapter code. The
// renderer never passes absolute paths — only a whitelisted root key plus
// a relative path that must resolve inside that root. Read-only by
// contract: no primitive here can write, move, or delete a session file.
const BUILTIN_ROOTS = process.env.TD_SESSION_ROOTS
  ? JSON.parse(process.env.TD_SESSION_ROOTS) // test harness only: point the runtime bridge at fixture stores
  : {
    'claude-projects': path.join(os.homedir(), '.claude', 'projects'),
    'codex-sessions': path.join(os.homedir(), '.codex', 'sessions'),
    // Pi: one JSONL per session under ~/.pi/agent/sessions/<encoded cwd>/
    'pi-sessions': path.join(os.homedir(), '.pi', 'agent', 'sessions'),
  };
const allRoots = () => BUILTIN_ROOTS;

function resolveInRoot(rootKey, rel) {
  const root = allRoots()[rootKey];
  if (!root) throw new Error('unknown session root');
  const abs = path.resolve(root, String(rel));
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('path escapes session root');
  return abs;
}

// ─── Terminal registry ─────────────────────────────────────────────────
// One entry per terminal the shell knows how to drive:
//   { id, name, probe(): Promise<bool>, launch(cwd, program): Promise<bool> }
// program is the bare runner command ('claude --resume <id>'); every
// launcher owns its platform's way of "open a terminal at cwd, run this,
// keep the window". Probed, never assumed — the picker lists only what
// this machine actually has. macOS entries are live-verified; Windows and
// Linux entries follow each terminal's documented CLI and await a real
// machine. Any terminal the registry can't drive (or a launch that fails)
// falls back to the clipboard road — never a broken window.
const { spawn } = require('child_process');
const dirExists = (p) => fsp.stat(p).then((s) => s.isDirectory()).catch(() => false);
const fileExists = (p) => fsp.access(p).then(() => true, () => false);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const run = (bin, args) => new Promise((resolve) => {
  const c = spawn(bin, args, { stdio: 'ignore', detached: process.platform === 'linux' });
  c.on('error', () => resolve(false));
  c.on('exit', (code) => resolve(code === 0));
  if (process.platform === 'linux') c.unref();
});

async function binOnPath(name) {
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (d && await fileExists(path.join(d, name))) return true;
  }
  return false;
}

// macOS: a .command file runs in the user's default shell (right PATH,
// zero automation permissions) inside any terminal app that accepts it.
async function launchCommandFile(appPath, cwd, program) {
  const file = path.join(require(path.join(RUNTIME_DIR, 'local-temp.cjs')).thoughtdagTempRoot(), `thoughtdag-resume-${Date.now()}.command`);
  try {
    await fsp.writeFile(file, `#!/bin/zsh\nrm -- ${shq(file)}\ncd ${shq(cwd)}\n${program}\n`, { mode: 0o755 });
  } catch { return false; }
  return run('open', ['-a', appPath, file]);
}
const launchOpenArgs = (appPath, argv) => run('open', ['-na', appPath, '--args', ...argv]);
const posix = (cwd, program) => ['-lc', `cd ${shq(cwd)} && ${program}`];

function buildTerminalRegistry() {
  if (process.platform === 'darwin') {
    const appEntry = (id, name, appPath, launch) => ({ id, name, probe: () => dirExists(appPath), launch });
    return [
      appEntry('terminal', 'Terminal', '/System/Applications/Utilities/Terminal.app', (cwd, p) => launchCommandFile('/System/Applications/Utilities/Terminal.app', cwd, p)),
      appEntry('iterm', 'iTerm2', '/Applications/iTerm.app', (cwd, p) => launchCommandFile('/Applications/iTerm.app', cwd, p)),
      appEntry('ghostty', 'Ghostty', '/Applications/Ghostty.app', (cwd, p) => launchOpenArgs('/Applications/Ghostty.app', ['-e', 'zsh', ...posix(cwd, p)])),
      appEntry('warp', 'Warp', '/Applications/Warp.app', (cwd, p) => launchCommandFile('/Applications/Warp.app', cwd, p)),
      appEntry('alacritty', 'Alacritty', '/Applications/Alacritty.app', (cwd, p) => launchOpenArgs('/Applications/Alacritty.app', ['-e', 'zsh', ...posix(cwd, p)])),
      appEntry('kitty', 'kitty', '/Applications/kitty.app', (cwd, p) => launchOpenArgs('/Applications/kitty.app', ['zsh', ...posix(cwd, p)])),
      appEntry('wezterm', 'WezTerm', '/Applications/WezTerm.app', (cwd, p) => launchOpenArgs('/Applications/WezTerm.app', ['start', '--', 'zsh', ...posix(cwd, p)])),
    ];
  }
  if (process.platform === 'win32') {
    const wtPath = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe');
    return [
      { id: 'wt', name: 'Windows Terminal', probe: async () => (await fileExists(wtPath)) || binOnPath('wt.exe'),
        launch: (cwd, p) => run('wt.exe', ['-d', cwd, 'cmd', '/k', p]) },
      { id: 'powershell', name: 'PowerShell', probe: async () => true,
        launch: (cwd, p) => run('cmd', ['/c', 'start', '', 'powershell', '-NoExit', '-Command', `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; ${p}`]) },
      { id: 'cmd', name: 'Command Prompt', probe: async () => true,
        launch: (cwd, p) => run('cmd', ['/c', 'start', '', 'cmd', '/k', `cd /d "${cwd}" && ${p}`]) },
    ];
  }
  // linux: binaries on PATH, each with its documented cwd/exec flags
  const bin = (id, name, argv) => ({ id, name, probe: () => binOnPath(id), launch: (cwd, p) => run(id, argv(cwd, p)) });
  return [
    bin('gnome-terminal', 'GNOME Terminal', (cwd, p) => ['--working-directory', cwd, '--', 'bash', ...posix(cwd, p)]),
    bin('konsole', 'Konsole', (cwd, p) => ['--workdir', cwd, '-e', 'bash', ...posix(cwd, p)]),
    bin('xfce4-terminal', 'Xfce Terminal', (cwd, p) => [`--working-directory=${cwd}`, '-x', 'bash', ...posix(cwd, p)]),
    bin('ghostty', 'Ghostty', (cwd, p) => ['-e', 'bash', ...posix(cwd, p)]),
    bin('alacritty', 'Alacritty', (cwd, p) => ['--working-directory', cwd, '-e', 'bash', ...posix(cwd, p)]),
    bin('kitty', 'kitty', (cwd, p) => ['--directory', cwd, 'bash', ...posix(cwd, p)]),
    bin('wezterm', 'WezTerm', (cwd, p) => ['start', '--cwd', cwd, '--', 'bash', ...posix(cwd, p)]),
    bin('x-terminal-emulator', 'System terminal', (cwd, p) => ['-e', `bash -lc ${shq(`cd ${shq(cwd)} && ${p}`)}`]),
  ];
}

function setupAgentSessions() {
  const probedTerminals = async () => {
    const reg = buildTerminalRegistry();
    const alive = await Promise.all(reg.map(async (term) => (await term.probe()) ? term : null));
    return alive.filter(Boolean);
  };

  ipcMain.handle('sessions:roots', async () => {
    const out = [];
    for (const [key, p] of Object.entries(allRoots())) {
      const exists = await fsp.stat(p).then((s) => s.isDirectory()).catch(() => false);
      out.push({ key, path: p, builtin: key in BUILTIN_ROOTS, exists });
    }
    return out;
  });

  ipcMain.handle('sessions:list', async (_e, rootKey) => {
    const root = allRoots()[rootKey];
    if (!root) return [];
    const out = [];
    async function walk(dir, depth) {
      if (depth > 4) return; // codex nests YYYY/MM/DD; nothing legit goes deeper
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(p, depth + 1);
        else if (ent.isFile() && (ent.name.endsWith('.jsonl'))) {
          try {
            const st = await fsp.stat(p);
            out.push({ rel: path.relative(root, p), size: st.size, mtime: st.mtimeMs });
          } catch { /* raced deletion — a live store is allowed to move under us */ }
        }
      }
    }
    await walk(root, 0);
    return out;
  });

  // Local paths a response mentions (a file the agent wrote, a folder it
  // built) open on THIS machine, never as a URL: a folder or a plain file
  // shows in Finder, an image or PDF opens in its viewer. Nothing that
  // could execute is ever handed to the OS — a script link reveals, it
  // does not run.
  const localFiles = require(path.join(ROOT, 'runtime', 'local-files.cjs')).createLocalFiles({ shell });
  for (const action of ['open', 'reveal', 'read', 'image']) {
    ipcMain.handle(`local:${action}`, (_e, raw) => localFiles[action](raw));
  }

  // The canvas's own source record for the why layer: one slim JSON per
  // project under <thoughtdag home>/canvases/, private (0700/0600), written
  // whole via a temp file. The renderer names the project; the shell owns
  // the path — no path ever crosses the bridge.
  const THOUGHTDAG_HOME = process.env.THOUGHTDAG_HOME || path.join(os.homedir(), '.thoughtdag');
  const CANVAS_DIR = path.join(THOUGHTDAG_HOME, 'canvases');
  const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;
  ipcMain.handle('canvas:record-write', async (_e, projectId, json) => {
    if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId) || typeof json !== 'string' || json.length > 64 * 1024 * 1024) return { ok: false, reason: 'invalid' };
    await fsp.mkdir(CANVAS_DIR, { recursive: true, mode: 0o700 });
    await fsp.chmod(THOUGHTDAG_HOME, 0o700).catch(() => undefined);
    await fsp.chmod(CANVAS_DIR, 0o700).catch(() => undefined);
    const file = path.join(CANVAS_DIR, `${projectId}.thoughtdag.json`);
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, json, { mode: 0o600 });
    await fsp.chmod(tmp, 0o600).catch(() => undefined);
    await fsp.rename(tmp, file);
    return { ok: true, file };
  });
  ipcMain.handle('canvas:record-remove', async (_e, projectId) => {
    if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return { ok: false };
    await fsp.rm(path.join(CANVAS_DIR, `${projectId}.thoughtdag.json`), { force: true }).catch(() => undefined);
    return { ok: true };
  });

  ipcMain.handle('sessions:read', (_e, rootKey, rel) => fsp.readFile(resolveInRoot(rootKey, rel), 'utf8'));

  // "Open in CLI": navigation, not orchestration — this walks the user to
  // the session's door; the runner and every keystroke after are theirs.
  // Structured args only (never a raw command string from the renderer);
  // the command is assembled HERE against a runner whitelist.
  const PROGRAMS = {
    'claude-code': (id) => `claude --resume ${id}`,
    codex: (id) => `codex resume ${id}`,
    pi: (id) => `pi --session ${id}`,
  };
  ipcMain.handle('sessions:open-in-cli', async (_e, runner, cwd, sessionId) => {
    const buildProgram = PROGRAMS[runner];
    if (!buildProgram || !/^[\w.-]{4,}$/.test(String(sessionId))) return { opened: false, via: '', command: '' };
    const cwdOk = typeof cwd === 'string' && path.isAbsolute(cwd) && await dirExists(cwd);
    const dir = cwdOk ? cwd : os.homedir();
    const program = buildProgram(sessionId);
    const command = `cd ${shq(dir)} && ${program}`; // the clipboard form

    // the chosen terminal first, then any other live one — a launch that
    // fails hands the command to the clipboard road, never a broken window
    const alive = await probedTerminals();
    for (const term of alive.slice(0, 2)) {
      if (await term.launch(dir, program)) return { opened: true, via: 'terminal', command };
    }
    return { opened: false, via: '', command };
  });
}

// Signed builds self-update through GitHub releases (latest*.yml), and every
// step past LOOKING belongs to the user: the app only checks quietly. Finding
// a version raises an in-app toast (the PAGE renders all update prompts via
// the preload bridge — same look and language as the rest of the UI); nothing
// downloads until the user clicks download; nothing installs until the user
// clicks restart (or quits after opting in). Checking BY HAND always answers
// out loud: found, already latest, or could not check.
let updater = null;        // electron-updater instance once set up
let announced = null;      // version already toasted this session (auto checks)
let downloading = false;
let downloadedInfo = null; // set once an update finished downloading
let manualCheck = false;   // the current check came from the menu
let lastPercent = 0;       // download progress, for the Dock bar and answers

// every update prompt is one event to the page; the page toasts it
function sendUpdate(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update:event', payload);
}

function setupAutoUpdate() {
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = false; // the user starts the download, never the app
  updater.on('update-available', (info) => {
    const manual = manualCheck; manualCheck = false;
    if (downloading || downloadedInfo) return;
    if (!manual && info.version === announced) return; // once per session, unless asked
    announced = info.version;
    sendUpdate({ kind: 'available', version: info.version });
  });
  updater.on('update-not-available', () => {
    const manual = manualCheck; manualCheck = false;
    if (manual) sendUpdate({ kind: 'latest', version: app.getVersion() });
  });
  // Download progress lives on the Dock icon (system-level, zero UI):
  // a 140MB first-time update on a slow line is minutes of otherwise
  // invisible work — the one moment users concluded "nothing happened".
  updater.on('download-progress', (p) => {
    lastPercent = p.percent;
    if (win && !win.isDestroyed()) win.setProgressBar(p.percent / 100);
  });
  updater.on('update-downloaded', (info) => {
    downloading = false;
    downloadedInfo = info;
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
    sendUpdate({ kind: 'ready', version: info.version });
  });
  const check = (manual) => {
    manualCheck = manual;
    updater.checkForUpdates().catch(() => {
      const m = manualCheck; manualCheck = false;
      if (m) sendUpdate({ kind: 'check-failed' });
    });
  };
  check(false);
  setInterval(() => check(false), 4 * 60 * 60 * 1000);

  // Menu → Check for updates. A downloaded update short-circuits straight
  // to the restart toast; asking during a download answers with progress;
  // asking by hand re-offers a version dismissed earlier.
  ipcMain.handle('update:check', () => {
    if (downloadedInfo) { sendUpdate({ kind: 'ready', version: downloadedInfo.version }); return; }
    if (downloading) { sendUpdate({ kind: 'downloading', percent: Math.round(lastPercent) }); return; }
    check(true);
  });
  ipcMain.handle('update:download', () => {
    if (downloading || downloadedInfo || !announced) return;
    downloading = true;
    sendUpdate({ kind: 'downloading', percent: 0 });
    updater.downloadUpdate().catch(() => {
      downloading = false;
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
      sendUpdate({ kind: 'download-failed' });
    });
  });
  ipcMain.handle('update:install', () => {
    // an update install closes the windows before before-quit fires
    if (downloadedInfo) { quitting = true; updater.quitAndInstall(); }
  });
}

// ─── Codex app-server (Tier 2, READ path) ────────────────────────
// Lazy singleton over `codex app-server` (JSON-RPC over stdio): the
// thread store's front door — real names, fork lineage, paged turns.
// This optional read-only bridge supplies native turn history when available.
let codexRpc = null; // null=not started, 'dead'=CLI absent, else client
// ── agent runtimes ─────────────────────────────────────────────────────
// Pi as an agent the canvas can hand a turn to. The runtime lives in
// agents/pi.js; here it is created on first use, its events are relayed to
// the renderer tagged by run, and the per-canvas workspace directories the
// runs default to are handed out under userData.
// One module per runtime under agents/, created on first use. A run is
// addressed by its id: abort and answer find the runtime that owns it.
const RUNTIME_DIR = app.isPackaged ? path.join(process.resourcesPath, 'payload', 'runtime') : path.join(__dirname, '..', 'runtime');
const agentOps = require(path.join(RUNTIME_DIR, 'agents', 'ops.cjs'));
const RUNTIME_FACTORIES = {
  pi: () => require(path.join(RUNTIME_DIR, 'agents', 'pi.cjs')).createPiRuntime({ log: (line) => console.log(line) }),
  codex: () => require(path.join(RUNTIME_DIR, 'agents', 'codex.cjs')).createCodexRuntime({ log: (line) => console.log(line) }),
  'claude-code': () => require(path.join(RUNTIME_DIR, 'agents', 'claude.cjs')).createClaudeRuntime({ log: (line) => console.log(line) }),
};
const runtimes = new Map();
function agentsRuntime(name = 'pi') {
  const key = RUNTIME_FACTORIES[name] ? name : 'pi';
  if (!runtimes.has(key)) runtimes.set(key, RUNTIME_FACTORIES[key]());
  return runtimes.get(key);
}
const runOwners = new Map(); // runId → runtime name

const workspaceFor = (canvasId) => agentOps.workspaceFor(
  path.join(process.env.THOUGHTDAG_HOME || app.getPath('userData'), 'workspaces'), canvasId,
);

function setupAgents() {
  ipcMain.handle('agents:available', async () => {
    const out = {};
    for (const name of Object.keys(RUNTIME_FACTORIES)) out[name] = await agentsRuntime(name).available().catch(() => null);
    return out;
  });
  ipcMain.handle('agents:models', async (_e, runtime) => {
    try { return await agentsRuntime(runtime).models(); } catch (e) { return { installed: false, models: [], default: null, error: e instanceof Error ? e.message : String(e) }; }
  });
  ipcMain.handle('agents:run', async (_e, req) => {
    const r = req && typeof req === 'object' ? req : {};
    const name = RUNTIME_FACTORIES[r.runtime] ? r.runtime : 'pi';
    const runId = await agentsRuntime(name).run(r, (payload) => { if (win && !win.isDestroyed()) win.webContents.send('agents:event', payload); });
    runOwners.set(runId, name);
    return runId;
  });
  ipcMain.handle('agents:abort', async (_e, runId) => agentsRuntime(runOwners.get(String(runId))).abort(String(runId)));
  ipcMain.handle('agents:steer', async (_e, runId, prompt) => {
    const id = String(runId);
    if (!runOwners.has(id)) throw new Error('This agent run is no longer active.');
    const agent = agentsRuntime(runOwners.get(id));
    if (!agent.steer) throw new Error('This agent does not support additional instructions while running.');
    return agent.steer(id, String(prompt ?? ''));
  });
  ipcMain.handle('agents:workspace', async (_e, canvasId) => workspaceFor(canvasId));
  ipcMain.handle('agents:answer', async (_e, runId, requestId, response) => agentsRuntime(runOwners.get(String(runId))).answer(String(runId), String(requestId), response));
  ipcMain.handle('agents:guard-write', async (_e, cwd, config) => agentOps.writeGuard(cwd, config));
  // a folder the person picks as a canvas's working directory
  ipcMain.handle('agents:pick-cwd', async () => {
    const r = await dialog.showOpenDialog(win ?? undefined, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths?.[0] ? null : r.filePaths[0];
  });
  ipcMain.handle('agents:write-materials', async (_e, cwd, files) => agentOps.writeMaterials(cwd, files));

  // ── the why layer: what was asked, answered and remembered across the local agents ──
  ipcMain.handle('why:status', async () => {
    try { const w = await whyLib(); return { available: true, home: w.HOME }; }
    catch (e) { return { available: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  ipcMain.handle('why:find', async (_e, phrase, opts) => (await whyLib()).findJson(String(phrase ?? ''), opts && typeof opts === 'object' ? opts : {}));
  ipcMain.handle('why:turns', async (_e, opts) => (await whyLib()).turnsJson(opts && typeof opts === 'object' ? opts : {}));
  ipcMain.handle('why:recall', async (_e, session, turn) => (await whyLib()).recallJson(String(session ?? ''), Number(turn)));
  ipcMain.handle('why:memories', async () => (await whyLib()).memoriesJson());
  ipcMain.handle('why:suggest', async (_e, term, k) => (await whyLib()).suggestJson(String(term ?? ''), Number(k) || 8));
  ipcMain.handle('why:topics', async () => (await whyLib()).topicsJson());
  ipcMain.handle('why:set-topics', async (_e, topics) => (await whyLib()).setTopics(Array.isArray(topics) ? topics : []));
  ipcMain.handle('why:label-start', async (_e, call, opts) => (await whyLib()).labelStart(call, opts && typeof opts === 'object' ? opts : {}));
  ipcMain.handle('why:label-stop', async () => (await whyLib()).labelStop());
  ipcMain.handle('why:by-topic', async (_e, ids, opts) => (await whyLib()).byTopicJson(Array.isArray(ids) ? ids.map(String) : [], opts && typeof opts === 'object' ? opts : {}));
  ipcMain.handle('why:sample', async (_e, n) => (await whyLib()).sampleQuestions(Number(n) || 120));
  ipcMain.handle('why:dossiers', async () => (await whyLib()).dossiersJson());
  ipcMain.handle('why:dossier', async (_e, id) => (await whyLib()).dossierJson(String(id)));
  ipcMain.handle('why:set-dossier', async (_e, id, d) => (await whyLib()).setDossier(String(id), d && typeof d === 'object' ? d : {}));
  ipcMain.handle('why:delete-dossier', async (_e, id) => (await whyLib()).deleteDossier(String(id)));
  ipcMain.handle('why:dossier-pending', async (_e, id, item) => (await whyLib()).dossierAddPending(String(id), item && typeof item === 'object' ? item : { text: '' }));
  ipcMain.handle('why:dossier-new', async (_e, id, opts) => (await whyLib()).dossierNewTurns(String(id), opts && typeof opts === 'object' ? opts : {}));
}

function codexAppServer() {
  if (codexRpc === 'dead') return null;
  if (codexRpc) return codexRpc;
  try {
    const proc = require('child_process').spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const pending = new Map();
    let nextId = 1;
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        } catch { /* notification noise */ }
      }
    });
    proc.on('error', () => { codexRpc = 'dead'; });
    proc.on('exit', () => { if (codexRpc !== 'dead') codexRpc = null; });
    const send = (method, params) => new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      try { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); } catch { resolve(null); }
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 10000);
    });
    codexRpc = { send, proc, ready: send('initialize', { clientInfo: { name: 'thoughtdag', title: 'ThoughtDAG', version: app.getVersion() } }) };
    return codexRpc;
  } catch { codexRpc = 'dead'; return null; }
}
ipcMain.handle('codex:thread-read', async (_e, threadId) => {
  if (typeof threadId !== 'string' || !/^[A-Za-z0-9-]{8,}$/.test(threadId)) return null;
  const c = codexAppServer();
  if (!c) return null;
  await c.ready;
  const r = await c.send('thread/read', { threadId, includeTurns: true });
  return r?.result?.thread ?? null;
});

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  // Canvas links from search results can open an existing canvas and node.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('thoughtdag', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('thoughtdag');
  }
  let pendingDeepLink = process.argv.find((a) => typeof a === 'string' && a.startsWith('thoughtdag://')) ?? null;
  const deliverDeepLink = (url) => {
    if (typeof url !== 'string' || !url.startsWith('thoughtdag://')) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('navigation:open', url);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      pendingDeepLink = url; // the renderer pulls it once it is ready
    }
  };
  app.on('open-url', (e, url) => { e.preventDefault(); deliverDeepLink(url); });
  ipcMain.handle('navigation:pending', () => { const l = pendingDeepLink; pendingDeepLink = null; return l; });
  app.on('second-instance', (_e, argv) => {
    if (win && !win.isDestroyed()) showWindow();
    const link = argv.find((a) => typeof a === 'string' && a.startsWith('thoughtdag://'));
    if (link) deliverDeepLink(link);
  });
  app.whenReady().then(() => {
    void boot();
    setupShell();
    setupAgentSessions();
    setupAgents();
    if (app.isPackaged) {
      setupAutoUpdate();
    } else {
      // dev shell: the menu entry exists (preload is loaded), so answer honestly
      ipcMain.handle('update:check', () => { sendUpdate({ kind: 'dev' }); });
    }
  });
  // the Dock click brings back the hidden window rather than booting a second server
  app.on('activate', () => { if (win && !win.isDestroyed()) showWindow(); else if (BrowserWindow.getAllWindows().length === 0) boot(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => { serverProc?.kill(); if (codexRpc && codexRpc !== 'dead') codexRpc.proc.kill(); for (const r of runtimes.values()) r.shutdown(); });
}
