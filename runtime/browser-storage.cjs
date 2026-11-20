'use strict';

// A same-origin, loopback-only persistence endpoint for a locally hosted canvas.
// A data directory owns one canvas library across local hostnames and ports.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { storageLibrary, validId, failure, readOptional } = require('./storage-library.cjs');
const { withStorageLock } = require('./storage-lock.cjs');

const PREFIX = '/__thoughtdag_storage';
const MAX_REQUEST_BYTES = 256 * 1024 * 1024;
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
  if (typeof key !== 'string' || Buffer.byteLength(key) > 4096) throw failure(400, 'Invalid key');
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
  const workspaceRoot = path.join(dataRoot, 'workspaces');
  const { createManagedDocuments, ensureCanvasWorkspace } = require('./managed-documents.cjs');
  const documentFile = createManagedDocuments(workspaceRoot);
  const library = storageLibrary({ root, workspaceRoot, recordPath, listKeys, atomicWrite });
  const revision = raw => raw === null ? null : crypto.createHash('sha256').update(raw).digest('hex');

  async function operate(body, host) {
    const { op, namespace, space, key, value, origin } = body;
    const imports = ['beginImport', 'stageSet', 'stageGet', 'finishImport'];
    if (origin !== undefined || ['connect', 'open', 'canvasWorkspace', 'document', ...imports].includes(op)) {
      if (origin !== 'http://' + host && origin !== 'https://' + host) throw failure(403, 'Access denied');
    }
    if (op === 'connect') {
      const state = await library.connect();
      const alreadyMigrated = library.migrated(state, body);
      const confirmBrowserImport = !alreadyMigrated && !body.previousNamespace && (body.projectIds?.length > 0 || body.legacyGraph === true)
        && state.sources.some(source => source.origin === origin && !source.browserImport);
      return { namespace: state.namespace, alreadyMigrated, ...(confirmBrowserImport && { confirmBrowserImport: true }) };
    }
    if (['create', 'finish', 'list'].includes(op)) throw failure(409, 'Refresh to use the shared project storage');
    if (!imports.includes(op) && !validId(namespace)) throw failure(400, 'Invalid namespace');
    const state = await library.active();
    if (imports.includes(op)) return library.importing(state, body);
    if (namespace !== state.namespace) throw failure(409, 'Reconnect to the shared project storage');
    if (op === 'open') return { ok: true };
    if (op === 'canvasWorkspace') return { dir: await ensureCanvasWorkspace(workspaceRoot, namespace, body.canvasId) };
    if (op === 'document') {
      if (!['read', 'probe'].includes(body.request?.op) && body.protocol !== 3) throw failure(409, 'Refresh before modifying canvas documents');
      return documentFile({ ...body.request, namespace });
    }
    if (!['kv', 'settings'].includes(space)) throw failure(400, 'Invalid space');
    const base = path.join(root, namespace, space);
    if (op === 'keys') return { keys: await listKeys(base) };
    const file = recordPath(base, key);
    if (op === 'get') {
      const raw = await readOptional(file);
      return raw === null ? { found: false } : { found: true, value: raw,
        ...(space === 'kv' && key.startsWith('thoughtdag:project:') && { revision: revision(raw) }) };
    }
    if (op === 'compareSet' && typeof value === 'string') {
      const current = await readOptional(file);
      if (body.expectedRevision !== undefined) {
        const currentRevision = revision(current);
        if (value === current) return { applied: true, revision: currentRevision };
        if (body.expectedRevision !== currentRevision) return { applied: false, revision: currentRevision };
        await atomicWrite(file, value);
        return { applied: true, revision: revision(value) };
      }
      if (body.expected !== current) return { applied: false, value: current };
      await atomicWrite(file, value);
      return { applied: true };
    }
    if (op === 'set' || op === 'delete') {
      if (body.protocol !== 3) throw failure(409, 'Refresh before writing to shared project storage');
      if (op === 'delete') await fs.rm(file, { force: true });
      else if (typeof value === 'string') await atomicWrite(file, value);
      else throw failure(400, 'Invalid value');
      return { ok: true };
    }
    throw failure(400, 'Invalid operation');
  }
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== PREFIX) return next();
    if (!permitted(req)) return send(res, 403, { error: 'Access denied' });
    if (req.method === 'GET') return send(res, 200, { service: 'thoughtdag-local-storage', version: 3 });
    if (req.method !== 'POST' || !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return send(res, 405, { error: 'Unsupported request' });
    }
    try {
      const body = await bodyJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure(400, 'Invalid request');
      if (req.headers.origin && body.origin !== undefined && body.origin !== req.headers.origin) throw failure(403, 'Access denied');
      const result = await withStorageLock(root, () => operate(body, req.headers.host));
      return send(res, 200, result);
    } catch (error) {
      if (!error.status) console.error('[thoughtdag] local storage operation failed:', error.message);
      return send(res, error.status ?? 500, { error: error.status ? error.message : 'Local storage operation failed' });
    }
  };
}

module.exports = { createBrowserStorage };
