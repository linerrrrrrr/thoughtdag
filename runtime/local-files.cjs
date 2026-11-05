'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const MAX_TEXT = 1024 * 1024;
const VIEWABLE = /\.(png|jpe?g|gif|webp|pdf|zip|docx|xlsx|pptx|odt|ods|odp)$/i;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

function nativePath(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 4096 || /[\x00-\x1f]/.test(raw)) return null;
  let value = raw.replace(/\\/g, '/');
  if (value.startsWith('//')) return null;
  if (process.platform === 'win32' && /^\/[a-z]:\//i.test(value)) value = value.slice(1);
  if (value.startsWith('~/')) value = path.join(os.homedir(), value.slice(2));
  return path.isAbsolute(value) ? path.normalize(value) : null;
}

function launch(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: 'ignore', shell: false });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

// Explorer can exit with code 1 after handing off to an existing window, and
// can stay alive for the window's lifetime. Wait only for ShellExecute's result,
// not the viewer process. Pass paths as data so names cannot become PS commands.
function launchWindows(p, select = false) {
  const script = `
    $ErrorActionPreference = 'Stop'
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.UseShellExecute = $true
    if ($env:THOUGHTDAG_LOCAL_SELECT -eq '1') {
      $info.FileName = 'explorer.exe'
      $info.Arguments = '/select,"' + $env:THOUGHTDAG_LOCAL_PATH + '"'
    } else {
      $info.FileName = $env:THOUGHTDAG_LOCAL_PATH
    }
    [System.Diagnostics.Process]::Start($info) | Out-Null
  `;
  return launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
    ...process.env, THOUGHTDAG_LOCAL_PATH: p, THOUGHTDAG_LOCAL_SELECT: select ? '1' : '0',
  });
}

function createLocalFiles({ shell, allowRemoteOrigin = false } = {}) {
  async function inspect(raw) {
    const p = nativePath(raw);
    if (!p) return { ok: false, reason: 'invalid' };
    try { return { ok: true, path: p, stat: await fs.stat(p) }; }
    catch { return { ok: false, reason: 'missing' }; }
  }
  async function reveal(raw) {
    const file = await inspect(raw);
    if (!file.ok) return file;
    const { path: p, stat } = file;
    if (shell) {
      if (stat.isDirectory()) { const error = await shell.openPath(p); return { ok: !error, kind: 'dir' }; }
      shell.showItemInFolder(p);
      return { ok: true, kind: 'file', opened: 'finder' };
    }
    const ok = process.platform === 'win32'
      ? await launchWindows(p, !stat.isDirectory())
      : process.platform === 'darwin'
        ? await launch('/usr/bin/open', stat.isDirectory() ? [p] : ['-R', p])
        : await launch('xdg-open', [stat.isDirectory() ? p : path.dirname(p)]);
    return { ok, kind: stat.isDirectory() ? 'dir' : 'file', opened: 'finder', ...(!ok ? { reason: 'error' } : {}) };
  }
  async function open(raw) {
    const file = await inspect(raw);
    if (!file.ok) return file;
    const { path: p, stat } = file;
    // Source, scripts, shortcuts and unknown file types are never executed.
    if (!stat.isDirectory() && !VIEWABLE.test(p)) return reveal(p);
    if (shell) { const error = await shell.openPath(p); return { ok: !error, kind: stat.isDirectory() ? 'dir' : 'file', opened: 'viewer' }; }
    const ok = process.platform === 'win32'
      ? await launchWindows(p)
      : await launch(process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', [p]);
    return { ok, kind: stat.isDirectory() ? 'dir' : 'file', opened: 'viewer', ...(!ok ? { reason: 'error' } : {}) };
  }
  async function read(raw) {
    const file = await inspect(raw);
    if (!file.ok) return file;
    // Even an ASCII-only PDF must use its viewer, not the source-code preview.
    if (!file.stat.isFile() || VIEWABLE.test(file.path)) return { ok: false, reason: 'not-text' };
    const handle = await fs.open(file.path, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(file.stat.size, MAX_TEXT));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.includes(0)) return { ok: false, reason: 'not-text' };
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: file.stat.size > bytesRead });
      return { ok: true, text, truncated: file.stat.size > bytesRead };
    } catch (e) { return { ok: false, reason: e instanceof TypeError ? 'not-text' : 'error' }; }
    finally { await handle.close(); }
  }
  async function image(raw) {
    const file = await inspect(raw);
    if (!file.ok || !file.stat.isFile() || file.stat.size > 20 * 1024 * 1024) return null;
    const mime = IMAGE_MIME[path.extname(file.path).slice(1).toLowerCase()];
    if (!mime) return null;
    return `data:${mime};base64,${(await fs.readFile(file.path)).toString('base64')}`;
  }
  async function handle(req, res, sub, body) {
    if (!/^\/local\/(open|reveal|read|image)$/.test(sub)) return false;
    const send = (code, payload) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)); return true; };
    // JSON POST plus an origin check blocks cross-site reads and launch requests.
    if (req.method !== 'POST' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(405, { ok: false, reason: 'invalid' });
    const origin = req.headers.origin;
    if (origin) {
      let allowed = false;
      try {
        const url = new URL(origin), host = new URL(`http://${req.headers.host}`).hostname;
        const local = (name) => ['localhost', '127.0.0.1', '[::1]'].includes(name);
        allowed = /^https?:$/.test(url.protocol) && ((allowRemoteOrigin && url.host === req.headers.host) || (local(url.hostname) && local(host)));
      } catch { /* invalid origin */ }
      if (!allowed) return send(403, { ok: false, reason: 'forbidden' });
    }
    try { return send(200, await ({ open, reveal, read, image })[sub.slice(7)](body?.path)); }
    catch { return send(500, { ok: false, reason: 'error' }); }
  }
  return { open, reveal, read, image, handle };
}
module.exports = { createLocalFiles, nativePath };
