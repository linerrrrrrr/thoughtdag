'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { selectPrimaryNamespace, mergeLegacyStorage, fileRecords } = require('./merge-legacy-storage.cjs');

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const validId = value => typeof value === 'string' && UUID.test(value);
function failure(status, message) { return Object.assign(new Error(message), { status }); }
async function readOptional(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function readJson(file) {
  const raw = await readOptional(file);
  return raw === null ? null : JSON.parse(raw);
}

function storageLibrary(io) {
  const { root, recordPath, atomicWrite, listKeys, database } = io;
  const pointer = path.join(root, 'library.json');
  const newManifest = (kind, origin) => ({ version: 1, kind, origin, ready: kind === 'library', createdAt: new Date().toISOString() });
  const save = state => database ? database.saveState(state) : atomicWrite(pointer, JSON.stringify(state));
  async function stateOnDisk() {
    const raw = database?.readState() ?? await readOptional(pointer);
    if (raw === null) return null;
    const state = JSON.parse(raw);
    if (!state || state.version !== 1 || !validId(state.namespace) || !Array.isArray(state.sources)) {
      throw failure(500, 'Invalid project storage manifest');
    }
    if (database && database.readState() === null) {
      if (!await readOptional(path.join(root, state.namespace, 'manifest.json'))) throw failure(503, 'Project storage is missing');
      await database.adopt(state, fileRecords(io, state.namespace));
    }
    return state;
  }
  async function legacyProfiles() {
    const profiles = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const manifest = await readJson(path.join(root, entry.name, 'manifest.json'));
      if (manifest?.version === 1 && manifest.ready !== false && !manifest.kind) {
        profiles.push({ namespace: entry.name, origin: manifest.origin ?? null, createdAt: manifest.createdAt ?? '' });
      }
    }
    return profiles;
  }
  async function receipt(profile) {
    const index = await readJson(recordPath(path.join(root, profile.namespace, 'kv'), 'thoughtdag:projects'));
    return { ...profile, projectIds: index?.value?.projects?.map(project => project.id) ?? [] };
  }
  async function archive(state) {
    for (const source of state.sources) {
      if (source.namespace === state.namespace) continue;
      if (!validId(source.namespace)) throw failure(500, 'Invalid migration source');
      const dir = path.join(root, source.namespace);
      const destination = path.join(root, 'legacy-backup', source.namespace);
      if (!await readOptional(path.join(dir, 'manifest.json'))) continue;
      if (await readOptional(path.join(destination, 'manifest.json'))) throw failure(409, 'Migration backup already exists');
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.rename(dir, destination);
    }
  }

  // Publish intent before editing records. If a host exits during merge,
  // the next connection completes the same inputs before serving the library.
  async function finishPending(state) {
    if (!state.pending) return;
    const profiles = state.pending;
    for (const profile of profiles) {
      if (!validId(profile.namespace) || !await readOptional(path.join(root, profile.namespace, 'manifest.json'))) {
        throw failure(503, 'A migration source is missing');
      }
    }
    await mergeLegacyStorage({ ...io, namespace: state.namespace, profiles });
    state.sources.push(...profiles);
    delete state.pending;
    await save(state);
    await archive(state);
  }

  async function connect() {
    let state = await stateOnDisk();
    const initialize = !state;
    if (state) {
      if (!database && !await readOptional(path.join(root, state.namespace, 'manifest.json'))) throw failure(503, 'Project storage is missing');
      await finishPending(state);
      await archive(state);
    }
    const profiles = await legacyProfiles();
    if (!state) {
      const namespace = profiles.length ? await selectPrimaryNamespace({ ...io, profiles }) : randomUUID();
      if (!validId(namespace)) throw failure(500, 'Invalid primary storage selection');
      if (!profiles.length) {
        await atomicWrite(path.join(root, namespace, 'manifest.json'), JSON.stringify(newManifest('library', null)));
      }
      state = { version: 1, namespace, sources: [] };
      if (database) await database.adopt(state, fileRecords(io, namespace));
    }
    const fresh = profiles.filter(profile => !state.sources.some(source => source.namespace === profile.namespace));
    if (fresh.length) state.pending = await Promise.all(fresh.map(receipt));
    if (fresh.length || initialize) await save(state);
    await finishPending(state);
    return state;
  }
  async function active() {
    const state = await stateOnDisk();
    if (!state || state.pending) throw failure(409, 'Reconnect to the project storage');
    if (!database && !await readOptional(path.join(root, state.namespace, 'manifest.json'))) throw failure(503, 'Project storage is missing');
    return state;
  }
  function migrated(state, body) {
    if (body.previousNamespace === state.namespace) return true;
    return state.sources.some(source => source.origin === body.origin && (
      source.namespace === body.previousNamespace || source.namespace === body.importId ||
      (!body.legacyGraph && Array.isArray(body.projectIds) && body.projectIds.length > 0 &&
        body.projectIds.every(id => source.projectIds.includes(id)))
    ));
  }

  async function importing(state, body) {
    const { op, importId, origin, space, key, value } = body;
    if (!validId(importId) || importId === state.namespace) throw failure(400, 'Invalid import identifier');
    const prior = state.sources.find(source => source.namespace === importId);
    if (prior) {
      if (prior.origin !== origin) throw failure(403, 'Access denied');
      if (op === 'beginImport' || op === 'finishImport') return { namespace: state.namespace, alreadyMigrated: true };
      throw failure(409, 'Browser migration has already completed');
    }
    const dir = path.join(root, importId);
    const file = path.join(dir, 'manifest.json');
    const manifest = await readJson(file);
    if (manifest && (manifest.kind !== 'browser-import' || manifest.origin !== origin)) throw failure(403, 'Access denied');
    if (op === 'beginImport') {
      if (!manifest) {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        await atomicWrite(file, JSON.stringify(newManifest('browser-import', origin)));
      }
      return { alreadyMigrated: false };
    }
    if (!manifest) throw failure(404, 'Browser migration is missing');
    if (op === 'finishImport') {
      for (const area of ['kv', 'settings']) {
        if (!Array.isArray(body.keys?.[area]) || !body.keys[area].every(key => typeof key === 'string')) throw failure(400, 'Invalid browser migration key list');
        const retained = new Set(body.keys[area]);
        const base = path.join(dir, area);
        for (const existing of await listKeys(base)) {
          if (!retained.delete(existing)) await fs.unlink(recordPath(base, existing));
        }
        if (retained.size) throw failure(409, 'Incomplete browser migration');
      }
      state.pending = [await receipt({ namespace: importId, origin, createdAt: manifest.createdAt, browserImport: true })];
      await save(state);
      await finishPending(state);
      return { namespace: state.namespace, alreadyMigrated: true };
    }
    if (!['kv', 'settings'].includes(space)) throw failure(400, 'Invalid space');
    const dest = recordPath(path.join(dir, space), key);
    if (op === 'stageGet') {
      const raw = await readOptional(dest);
      return raw === null ? { found: false } : { found: true, value: raw };
    }
    if (op !== 'stageSet' || typeof value !== 'string') throw failure(400, 'Invalid import write');
    await atomicWrite(dest, value);
    return { ok: true };
  }
  return { active, connect, migrated, importing };
}

module.exports = { storageLibrary, validId, failure, readOptional };
