'use strict';

const fs = require('node:fs/promises');
const { createInterface } = require('node:readline');
const os = require('node:os');
const path = require('node:path');

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const MAX_FRAGMENT = 1_000_000;
const SLOT = '<!--__INLINE_VISUALIZATION_FRAGMENT__-->';
const cachedFiles = new Map();
const cachedRecords = new Map();
const cachedKits = new Map();

function remember(cache, key, value) {
  if (cache.size >= 64) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function localPath(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 4096 || /[\x00-\x1f]/.test(raw)) return null;
  let value = raw.replace(/\\/g, '/');
  if (value.startsWith('//')) return null;
  if (process.platform === 'win32') {
    if (/^\/[a-z]:\//i.test(value)) value = value.slice(1);
    if (!/^[a-z]:\//i.test(value) || value.slice(2).includes(':')) return null;
  }
  return path.isAbsolute(value) ? path.normalize(value) : null;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Reject redirected path components and check the opened file's identity.
// The root may itself be a user-configured symlink (e.g. CODEX_HOME).
async function openInside(root, file, maxSize) {
  if (!inside(root, file)) throw new Error('Outside the source root');
  const canonical = path.join(await fs.realpath(root), path.relative(root, file));
  const check = async () => {
    if (path.relative(canonical, await fs.realpath(file))) throw new Error('Redirected source path');
  };
  await check();
  const stat = await fs.lstat(canonical, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || (maxSize && stat.size > maxSize)) throw new Error('Invalid source file');
  const handle = await fs.open(canonical, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw new Error('Source changed');
    await check();
    return { handle, stat: opened };
  } catch (e) { await handle.close(); throw e; }
}

async function entries(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

async function findRollout(home, id) {
  const key = path.join(home, id);
  const cached = cachedFiles.get(key);
  if (cached && await fs.stat(cached).then(s => s.isFile()).catch(() => false)) return cached;
  const sessions = path.join(home, 'sessions');
  const matches = new RegExp('^rollout-.*-' + id + '\\.jsonl$', 'i');
  const visited = new Set();
  async function check(dir) {
    if (visited.has(dir)) return null;
    visited.add(dir);
    const file = (await entries(dir)).find(e => e.isFile() && matches.test(e.name));
    return file ? remember(cachedFiles, key, path.join(dir, file.name)) : null;
  }
  // Most threads use UUIDv7. Account for local date boundaries in the rollout path.
  if (id[14] === '7') {
    const timestamp = parseInt(id.replaceAll('-', '').slice(0, 12), 16);
    for (const day of [0, -1, 1]) {
      const date = new Date(timestamp + day * 86_400_000).toISOString().slice(0, 10);
      const file = await check(path.join(sessions, ...date.split('-')));
      if (file) return file;
    }
  }
  const archived = await check(path.join(home, 'archived_sessions'));
  if (archived) return archived;
  async function walk(dir, level) {
    if (level === 3) return check(dir);
    const pattern = level === 0 ? /^\d{4}$/ : /^\d{2}$/;
    for (const entry of await entries(dir)) {
      if (!entry.isDirectory() || !pattern.test(entry.name)) continue;
      const found = await walk(path.join(dir, entry.name), level + 1);
      if (found) return found;
    }
    return null;
  }
  return walk(sessions, 0);
}

async function recordedRefs(home, file, id) {
  const { handle, stat } = await openInside(home, file);
  try {
    const stamp = [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':');
    const cached = cachedRecords.get(file);
    if (cached?.stamp === stamp && cached.id === id) return cached.refs;
    const { parseCodexVisuals } = await import('./agents/codex-visual-refs.mjs');
    const refs = new Map();
    let identified = false;
    let cwd = null;
    const stream = handle.createReadStream({ autoClose: false, encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.includes('session_meta') && !line.includes('turn_context') && !line.includes('visualize')) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        const p = record.payload;
        if (!p) continue;
        if (record.type === 'session_meta') {
          if (p.id?.toLowerCase() !== id) return new Map();
          identified = true;
          cwd = localPath(p.cwd);
        }
        if (!identified) continue;
        if (record.type === 'turn_context' && p.cwd) cwd = localPath(p.cwd);
        if (record.type !== 'response_item' || p.type !== 'message' || p.role !== 'assistant'
          || ![undefined, null, 'final', 'final_answer', 'partial_answer'].includes(p.phase ?? p.channel) || !Array.isArray(p.content)) continue;
        const text = p.content.filter(c => c?.type === 'output_text' || c?.type === 'text').map(c => c.text).join('\n');
        for (const ref of parseCodexVisuals(text)) {
          const source = localPath(ref.path);
          if (source) refs.set(source, cwd);
        }
      }
    } finally { lines.close(); stream.destroy(); }
    remember(cachedRecords, file, { stamp, id, refs });
    return refs;
  } finally { await handle.close(); }
}

async function loadKit(home) {
  // Only read static assets from the installed first-party plugin. No plugin
  // executable, Python runtime or network connection is required to capture.
  const plugins = path.join(home, 'plugins', 'cache', 'openai-curated-remote', 'visualize');
  const versions = (await entries(plugins)).filter(e => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
    .map(e => e.name).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const version of versions) {
    const dir = path.join(plugins, version, 'skills', 'visualize', 'assets');
    if (cachedKits.has(dir)) return cachedKits.get(dir);
    try {
      async function asset(name) {
        const { handle } = await openInside(home, path.join(dir, name), 256 * 1024);
        try { return await handle.readFile('utf8'); } finally { await handle.close(); }
      }
      const [css, template, bridge, calendar, sources] = await Promise.all([
        asset('visualize.css'), asset('visualize.html'), asset('standalone-host-bridge.js').catch(() => ''),
        asset('calendar.js').catch(() => ''), asset('dashboard-sources.js').catch(() => ''),
      ]);
      if (template.includes(SLOT)) return remember(cachedKits, dir, { css, template, bridge, calendar, sources });
    } catch { /* another installed version may still be available */ }
  }
  return { css: '', template: SLOT, bridge: '' };
}

function inlineScript(code) {
  return code ? '<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script>' : '';
}

async function readCodexVisual(request, home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  const id = request?.threadId;
  const source = localPath(request?.path);
  if (typeof id !== 'string' || !UUID.test(id) || !source || path.extname(source).toLowerCase() !== '.html') return null;
  try {
    const thread = id.toLowerCase();
    const file = await findRollout(home, thread);
    if (!file) return null;
    const refs = await recordedRefs(home, file, thread);
    if (!refs.has(source)) return null;
    const visuals = path.join(home, 'visualizations');
    const relative = path.relative(visuals, source).split(path.sep);
    let root = refs.get(source);
    if (inside(visuals, source)) {
      const folder = relative.length >= 5 && /^\d{4}$/.test(relative[0]) && relative.slice(1, 3).every(n => /^\d{2}$/.test(n)) ? 3 : 0;
      if (relative[folder]?.toLowerCase() !== thread) return null;
      root = home;
    } else if (!root || (inside(home, source) && !inside(home, root))) return null;
    const { handle, stat } = await openInside(root, source, MAX_FRAGMENT);
    let fragment;
    try {
      const bytes = Buffer.alloc(Number(stat.size));
      let used = 0;
      while (used < bytes.length) {
        const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
        if (bytesRead === 0) return null;
        used += bytesRead;
      }
      const end = await handle.stat({ bigint: true });
      if (end.size !== stat.size || end.mtimeNs !== stat.mtimeNs || bytes.includes(0)) return null;
      fragment = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } finally { await handle.close(); }
    if (!fragment.trim()) return null;
    if (/^\s*(?:<!doctype\s+html\b|<html\b)/i.test(fragment)) return fragment;
    const kit = await loadKit(home);
    // Preserve pinned implementations supplied by the fragment itself.
    const pinned = /\/plugins\/visualize\/widgets\/[^/]+\/(?:calendar|element)\.js/i.test(fragment);
    const calendar = /\bviz-calendar\b/i.test(fragment) && !pinned ? inlineScript(kit.calendar) : '';
    const sources = /<dash-sources\b/i.test(fragment) && kit.sources
      ? inlineScript("document.addEventListener('DOMContentLoaded', () => {" + kit.sources + "\n}, {once:true});") : '';
    return '<!doctype html><html data-visualize-standalone><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<style>' + kit.css + '</style></head><body>'
      + (kit.bridge ? '<script type="application/json" id="codex-visualization-widget-state">{}</script>' + inlineScript(kit.bridge) : '')
      + kit.template.replace(SLOT, () => calendar + sources + fragment) + '</body></html>';
  } catch { return null; }
}

module.exports = { readCodexVisual };
