'use strict';

// A same-origin, loopback-only persistence endpoint for a locally hosted canvas.
// The browser owns the logical keys and migration; this module only commits
// opaque UTF-8 records beneath the explicitly configured data directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PREFIX = '/__thoughtdag_storage';
const MAX_REQUEST_BYTES = 256 * 1024 * 1024;
const NAMESPACE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function permitted(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress) || req.headers['x-thoughtdag-storage'] !== '1') return false;
  const host = String(req.headers.host || '');
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}` && origin !== `https://${host}`) return false;
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin';
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function bodyJson(req) {
  if (req.body !== undefined) return req.body;
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES) throw new Error('Request is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function recordPath(base, key) {
  if (typeof key !== 'string' || Buffer.byteLength(key) > 4096) throw new Error('Invalid key');
  const encoded = Buffer.from(key, 'utf8').toString('base64url') || '_';
  const chunks = encoded.match(/.{1,80}/g);
  const parts = chunks.map((part) => `k-${part}`);
  parts[parts.length - 1] += '.json';
  return path.join(base, ...parts);
}

async function atomicWrite(file, text) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, `.write-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, file);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function listKeys(dir, prefixes = []) {
  const found = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (err) { if (err.code === 'ENOENT') return found; throw err; }
  for (const entry of entries) {
    if (!entry.name.startsWith('k-')) continue;
    if (entry.isDirectory()) {
      found.push(...await listKeys(path.join(dir, entry.name), [...prefixes, entry.name.slice(2)]));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      const encoded = [...prefixes, entry.name.slice(2, -5)].join('');
      found.push(encoded === '_' ? '' : Buffer.from(encoded, 'base64url').toString('utf8'));
    }
  }
  return found;
}

/** Return a Connect-compatible handler; requests outside PREFIX are untouched. */
function createBrowserStorage({ dataRoot }) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('An absolute data root is required');
  const root = path.join(dataRoot, 'browser-storage');
  const documentFile = require('./managed-documents.cjs').createManagedDocuments(path.join(dataRoot, 'workspaces'));
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== PREFIX) return next();
    if (!permitted(req)) return send(res, 403, { error: 'Access denied' });
    if (req.method === 'GET') return send(res, 200, { service: 'thoughtdag-local-storage', version: 2 });
    if (req.method !== 'POST' || !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return send(res, 405, { error: 'Unsupported request' });
    }
    try {
      const body = await bodyJson(req);
      const { op, namespace, space, key, value, origin } = body;
      if (op === 'list') {
        if (![ `http://${req.headers.host}`, `https://${req.headers.host}` ].includes(origin)) return send(res, 403, { error: 'Access denied' });
        let entries;
        try { entries = await fs.readdir(root, { withFileTypes: true }); }
        catch (err) { if (err.code === 'ENOENT') return send(res, 200, { namespaces: [] }); throw err; }
        const namespaces = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || !NAMESPACE.test(entry.name)) continue;
          try {
            const manifest = JSON.parse(await fs.readFile(path.join(root, entry.name, 'manifest.json'), 'utf8'));
            if (manifest.version === 1 && manifest.ready === true && manifest.origin === origin) {
              namespaces.push({ namespace: entry.name, createdAt: manifest.createdAt });
            }
          } catch { /* Incomplete migrations are not recovery candidates. */ }
        }
        return send(res, 200, { namespaces });
      }
      if (!NAMESPACE.test(namespace || '')) return send(res, 400, { error: 'Invalid namespace' });
      const session = path.join(root, namespace);
      if (op === 'document') {
        const manifest = JSON.parse(await fs.readFile(path.join(session, 'manifest.json'), 'utf8'));
        if (!manifest.ready || manifest.origin !== origin || ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(origin)) {
          return send(res, 403, { error: 'Access denied' });
        }
        return send(res, 200, await documentFile({ ...body.request, namespace }));
      }
      if (op === 'create') {
        if (![ `http://${req.headers.host}`, `https://${req.headers.host}` ].includes(origin)) return send(res, 403, { error: 'Access denied' });
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        await fs.mkdir(session, { mode: 0o700 });
        await atomicWrite(path.join(session, 'manifest.json'), JSON.stringify({ version: 1, origin, ready: false, createdAt: new Date().toISOString() }));
        return send(res, 200, { ok: true });
      }
      if (op === 'finish') {
        const file = path.join(session, 'manifest.json');
        const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
        if (manifest.version !== 1 || manifest.origin !== origin) return send(res, 403, { error: 'Access denied' });
        await atomicWrite(file, JSON.stringify({ ...manifest, ready: true }));
        return send(res, 200, { ok: true });
      }
      if (op === 'open') {
        try {
          const manifest = JSON.parse(await fs.readFile(path.join(session, 'manifest.json'), 'utf8'));
          const requestOrigin = origin || `http://${req.headers.host}`;
          if (manifest.version !== 1 || manifest.ready === false || manifest.origin !== requestOrigin) throw new Error('Storage is unavailable');
          return send(res, 200, { ok: true });
        } catch {
          return send(res, 404, { error: 'Storage namespace is unavailable' });
        }
      }
      try { await fs.access(path.join(session, 'manifest.json')); }
      catch { return send(res, 404, { error: 'Storage namespace is unavailable' }); }
      if (!['kv', 'settings'].includes(space)) return send(res, 400, { error: 'Invalid space' });
      const base = path.join(session, space);
      if (op === 'keys') return send(res, 200, { keys: await listKeys(base) });
      const file = recordPath(base, key);
      if (op === 'get') {
        try { return send(res, 200, { found: true, value: await fs.readFile(file, 'utf8') }); }
        catch (err) { if (err.code === 'ENOENT') return send(res, 200, { found: false }); throw err; }
      }
      if (op === 'set' && typeof value === 'string') {
        await atomicWrite(file, value);
        return send(res, 200, { ok: true });
      }
      if (op === 'delete') {
        await fs.rm(file, { force: true });
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: 'Invalid operation' });
    } catch {
      return send(res, 500, { error: 'Local storage operation failed' });
    }
  };
}

module.exports = { createBrowserStorage };
