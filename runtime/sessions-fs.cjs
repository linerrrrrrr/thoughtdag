// Read-only access to runtime records used by agent nodes over HTTP.
// `rel` never escapes its configured root.
'use strict';
const os = require('node:os');
const { join, resolve, sep } = require('node:path');
const { readdir, stat, readFile } = require('node:fs/promises');

const FILE_ROOTS = {
  'claude-projects': join(os.homedir(), '.claude', 'projects'),
  'codex-sessions': join(os.homedir(), '.codex', 'sessions'),
  'pi-sessions': join(os.homedir(), '.pi', 'agent', 'sessions'),
};
const FILE_READ_MAX = 256 * 1024 * 1024;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function fileInRoot(rootKey, rel) {
  const root = FILE_ROOTS[rootKey];
  if (!root) throw new HttpError(404, 'no such root');
  if (typeof rel !== 'string' || !rel) throw new HttpError(400, 'rel required');
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) throw new HttpError(400, 'rel escapes its root');
  return abs;
}

async function listRoot(rootKey) {
  const root = FILE_ROOTS[rootKey];
  if (!root) throw new HttpError(404, 'no such root');
  const out = [];
  const walk = async (dir, depth) => {
    if (depth > 5) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) await walk(p, depth + 1);
      else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
        try { const st = await stat(p); out.push({ rel: p.slice(root.length + 1), size: st.size, mtime: st.mtimeMs }); } catch { /* raced */ }
      }
    }
  };
  await walk(root, 0);
  return out;
}

/** Handle `/roots` and `/roots/<key>/<op>`; returns false when not ours. */
async function handleSessions(req, res, sub) {
  const url = new URL(req.url ?? '/', 'http://local');
  const p = sub.replace(/\/+$/, '');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); return true; };
  const text = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); return true; };
  try {
    if (p === '/roots' && req.method === 'GET') {
      const roots = [];
      for (const [key, dir] of Object.entries(FILE_ROOTS)) roots.push({ key, path: dir, builtin: true, exists: await stat(dir).then((st) => st.isDirectory()).catch(() => false) });
      return json(200, { roots });
    }
    const m = /^\/roots\/([a-z-]+)\/(list|read)$/.exec(p);
    if (!m || req.method !== 'GET') return false;
    const key = m[1];
    if (m[2] === 'list') return json(200, { files: await listRoot(key) });
    const abs = fileInRoot(key, url.searchParams.get('rel') ?? '');
    if (m[2] === 'read') {
      const st = await stat(abs).catch(() => null);
      if (!st) return json(404, { error: 'no such file' });
      if (st.size > FILE_READ_MAX) return json(413, { error: 'file too large to read whole' });
      return text('application/x-ndjson; charset=utf-8', await readFile(abs));
    }
    return false;
  } catch (e) {
    return json(e instanceof HttpError ? e.status : 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

module.exports = { FILE_ROOTS, fileInRoot, listRoot, handleSessions };
