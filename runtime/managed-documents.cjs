'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_FILE = 192 * 1024 * 1024;
const PREVIEW_LIMIT = 256 * 1024;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function identifier(value) {
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Invalid document identifier');
  return digest(value).slice(0, 32);
}

function location(root, scope, key) {
  const { canvasId, nodeId, attachmentId, name } = key;
  const canvasHash = identifier(canvasId);
  const canvas = /^[\w-][\w.-]{0,79}$/.test(canvasId) && !canvasId.endsWith('.') && !RESERVED.test(canvasId)
    ? canvasId : 'canvas-' + canvasHash;
  if (typeof name !== 'string' || !name || name.length > 1024) throw new Error('Invalid document name');
  let filename = name.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/^[. ]+|[. ]+$/g, '') || 'document';
  if (RESERVED.test(filename)) filename = '_' + filename;
  if (filename.length > 120) filename = filename.slice(0, 96) + path.extname(filename).slice(0, 24);
  const scopedCanvas = digest(scope + '/' + canvasHash).slice(0, 24);
  const dir = path.join(root, canvas, '.thoughtdag', 'documents', scopedCanvas, identifier(nodeId), identifier(attachmentId));
  return { dir, file: path.join(dir, filename), preview: path.join(dir, '.preview.json') };
}

/** Additional writable locations come only from existing per-attachment
 * directories below this host's managed workspace. Keep the native cwd. */
async function prepareManagedRun(root, request) {
  if (!request.managedFileDirs?.length) return { ...request, managedFileDirs: [] };
  if (!Array.isArray(request.managedFileDirs)) throw new Error('Invalid canvas file directories');
  const dirs = [...new Set(request.managedFileDirs)];
  for (const dir of dirs) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Invalid canvas file directory');
    const parts = path.relative(root, dir).split(path.sep);
    if (parts.length !== 6 || !/^[\w-][\w.-]{0,79}$/.test(parts[0]) || parts[1] !== '.thoughtdag' || parts[2] !== 'documents'
      || !/^[a-f0-9]{24}$/.test(parts[3]) || !parts.slice(4).every(id => /^[a-f0-9]{32}$/.test(id))) throw new Error('Invalid canvas file directory');
    await checkParents(root, dir, false);
  }
  return { ...request, managedFileDirs: dirs.map(dir => path.resolve(dir)) };
}

// Each parent must be an actual directory. An agent may replace an item in
// its workspace with a link; that must never turn an import into an external reference.
async function checkParents(root, dir, create) {
  if (create) await fs.mkdir(root, { recursive: true, mode: 0o700 });
  let current = root;
  for (const part of path.relative(root, dir).split(path.sep)) {
    current = path.join(current, part);
    if (create) {
      try { await fs.mkdir(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!(await fs.lstat(current)).isDirectory()) throw new Error('Invalid managed document directory');
  }
}

async function fileStat(file, limit = MAX_FILE) {
  const stat = await fs.lstat(file, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(limit)) throw new Error('Invalid managed document file');
  return stat;
}

function stamp(stat) {
  return [stat.ino, stat.size, stat.ctimeNs, stat.mtimeNs].join('/');
}

function decode(base64) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_FILE / 3) * 4 ||
      base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64)) throw new Error('Invalid file contents');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64) throw new Error('Invalid file contents');
  return bytes;
}

async function readPreview(file, revision) {
  try {
    await fileStat(file, PREVIEW_LIMIT);
    const content = JSON.parse(await fs.readFile(file, 'utf8'));
    if (content.baseRevision === revision && typeof content.before === 'string' && typeof content.after === 'string') {
      return { baseRevision: revision, before: content.before, after: content.after };
    }
  } catch { /* A preview is optional and may still be in the process of being written. */ }
}

// The dev server, desktop shell and local server may share one data root.
// Serialize app commits across processes. Ordinary file readers see the
// completed file in one rename; they never have to participate in the lock.
async function lockDocument(dir) {
  const file = path.join(dir, '.commit.lock');
  for (let attempt = 0; attempt < 120; attempt++) {
    let handle;
    try { handle = await fs.open(file, 'wx', 0o600); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (handle) {
      try { await handle.writeFile(String(process.pid)); }
      catch (error) { await handle.close(); await fs.unlink(file); throw error; }
      return async () => { await handle.close(); await fs.unlink(file); };
    }
    try {
      const owner = Number(await fs.readFile(file, 'utf8'));
      if (Number.isSafeInteger(owner) && owner > 0) {
        try { process.kill(owner, 0); }
        catch (error) { if (error.code === 'ESRCH') await fs.unlink(file); }
      } else if (Date.now() - (await fs.stat(file)).mtimeMs > 60_000) {
        await fs.unlink(file);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(25);
  }
  throw new Error('Document is busy');
}

function createManagedDocuments(workspaceRoot) {
  if (!path.isAbsolute(workspaceRoot)) throw new Error('An absolute workspace root is required');
  const cache = new Map();
  const pending = new Map();
  async function inspect(file, includeBytes = false) {
    const stat = await fileStat(file);
    const fingerprint = stamp(stat);
    const cached = cache.get(file);
    if (cached?.stamp === fingerprint && !includeBytes) return cached;
    const handle = await fs.open(file, 'r');
    let bytes;
    try {
      if (stamp(await handle.stat({ bigint: true })) !== fingerprint) throw new Error('Document changed while opening');
      bytes = await handle.readFile();
      if (stamp(await handle.stat({ bigint: true })) !== fingerprint) throw new Error('Document changed while reading');
    } finally { await handle.close(); }
    const info = { stamp: fingerprint, revision: digest(bytes) };
    if (cache.size >= 4096) cache.delete(cache.keys().next().value);
    cache.set(file, info);
    return { ...info, bytes };
  }

  async function operate(loc, request) {
    const { dir, file, preview } = loc;
    const { op, base64, expectedRevision, knownRevision } = request;
    const meta = { path: file, previewPath: preview };
    let current;
    try { current = await inspect(file); }
    catch (err) {
      if (err.code === 'ENOENT' && op === 'read') return { missing: true };
      if (err.code !== 'ENOENT' || op !== 'ensure') throw err;
    }
    const response = async (withContent) => {
      const snapshot = withContent ? await inspect(file, true) : current;
      return { ...meta, revision: snapshot.revision, ...(withContent && { base64: snapshot.bytes.toString('base64') }) };
    };
    if (op === 'read') return response(knownRevision !== current.revision);
    if (op === 'clearPreview') {
      if (await readPreview(preview, expectedRevision)) await fs.rm(preview, { force: true });
      return { ...meta, revision: current.revision };
    }
    const bytes = decode(base64);
    const revision = digest(bytes);
    if (op === 'ensure' && current) return response(current.revision !== revision);
    if (op !== 'write' && op !== 'ensure') throw new Error('Unknown document operation');
    if (op === 'write' && current.revision === revision) return { ...meta, revision };
    if (op === 'write' && current.revision !== expectedRevision) return { ...meta, revision: current.revision, conflict: true };
    const temp = path.join(dir, '.write-' + randomUUID());
    try {
      await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
      const release = await lockDocument(dir);
      try {
        try { current = await inspect(file); }
        catch (error) {
          if (error.code !== 'ENOENT' || op !== 'ensure') throw error;
          current = undefined;
        }
        if (op === 'ensure' && current) return response(current.revision !== revision);
        if (op === 'write' && current.revision === revision) return { ...meta, revision };
        if (op === 'write' && current.revision !== expectedRevision) return { ...meta, revision: current.revision, conflict: true };
        await fs.rename(temp, file);
      } finally { await release(); }
      return { ...meta, revision };
    } finally { await fs.rm(temp, { force: true }); }
  }

  return async (request) => {
    const scope = request?.namespace;
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(scope || '')) throw new Error('Invalid document namespace');
    if (request.op === 'deleteCanvas') {
      const loc = location(workspaceRoot, scope, { canvasId: request.canvasId, nodeId: '_', attachmentId: '_', name: '_' });
      const canvasDir = path.dirname(path.dirname(loc.dir));
      await Promise.allSettled([...pending].filter(([file]) => file.startsWith(canvasDir + path.sep)).map(([, task]) => task));
      try { await checkParents(workspaceRoot, canvasDir, false); }
      catch (error) { if (error.code === 'ENOENT') return { removed: true }; throw error; }
      await fs.rm(canvasDir, { recursive: true, force: true });
      return { removed: true };
    }
    if (request.op === 'probe') {
      if (!Array.isArray(request.items) || request.items.length > 256) throw new Error('Invalid document probe');
      const changes = [];
      for (const key of request.items) {
        const loc = location(workspaceRoot, scope, key);
        try {
          await checkParents(workspaceRoot, loc.dir, false);
          const { revision } = await inspect(loc.file);
          const changed = revision !== key.knownRevision;
          const preview = await readPreview(loc.preview, revision);
          if (changed || preview) changes.push({ nodeId: key.nodeId, attachmentId: key.attachmentId, revision, changed, preview });
        } catch { /* Editors may temporarily lock or rename a file. Poll it again on the next pass. */ }
      }
      return changes;
    }
    if (!['ensure', 'read', 'write', 'clearPreview'].includes(request.op)) throw new Error('Unknown document operation');
    const loc = location(workspaceRoot, scope, request);
    try { await checkParents(workspaceRoot, loc.dir, request.op === 'ensure'); }
    catch (error) { if (error.code === 'ENOENT' && request.op === 'read') return { missing: true }; throw error; }
    const prior = pending.get(loc.file);
    const result = (prior || Promise.resolve()).catch(() => undefined).then(() => operate(loc, request));
    pending.set(loc.file, result);
    try { return await result; }
    finally { if (pending.get(loc.file) === result) pending.delete(loc.file); }
  };
}

module.exports = { createManagedDocuments, prepareManagedRun };
