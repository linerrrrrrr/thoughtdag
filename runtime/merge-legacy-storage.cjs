'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { canvasFilePaths, readCanvasFileOrigins, ensurePhysicalWorkspace } = require('./managed-documents.cjs');

const INDEX = 'thoughtdag:projects';
const GRAPH = 'thoughtdag:project:';
const CHAT = 'thoughtdag.canvasChat.';
const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const VAULT = ['att-content:', 'att-docx-revision:', 'att-pdf-revision:'];

function stableId(...parts) {
  const bytes = createHash('sha256').update(JSON.stringify(parts)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

async function read(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function unpack(raw) {
  const encoded = JSON.parse(raw);
  if (!encoded || encoded.format !== 1 || !Array.isArray(encoded.special)) throw new Error('Unrecognized stored value');
  return encoded;
}

function graphValue(encoded) {
  return typeof encoded.value === 'string' ? JSON.parse(encoded.value) : encoded.value;
}

function repo(ctx, namespace) {
  if (!UUID.test(namespace)) throw new Error('Invalid storage namespace');
  const dir = path.join(ctx.root, namespace);
  const file = (space, key) => ctx.recordPath(path.join(dir, space), key);
  return {
    dir,
    get: (space, key) => read(file(space, key)),
    set: (space, key, value) => ctx.atomicWrite(file(space, key), value),
    keys: space => ctx.listKeys(path.join(dir, space)),
  };
}

function freshIndex() {
  return { format: 1, value: { projects: [], activeId: null }, special: [] };
}

async function catalogue(ctx, profile, recoverOrphans = true) {
  const storage = repo(ctx, profile.namespace);
  const rawIndex = await storage.get('kv', INDEX);
  const index = rawIndex === null ? freshIndex() : unpack(rawIndex);
  const projects = index.value?.projects;
  if (!Array.isArray(projects) || projects.some(p => !p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string')
      || new Set(projects.map(p => p.id)).size !== projects.length) throw new Error('Invalid canvas catalogue');
  const keys = await storage.keys('kv');
  const ids = new Set(projects.map(project => project.id));
  const createdAt = Date.parse(profile.createdAt) || 0;
  for (const key of keys) {
    if (rawIndex !== null || !recoverOrphans || !key.startsWith(GRAPH)) continue;
    const id = key.slice(GRAPH.length);
    if (id && !ids.has(id)) {
      projects.push({ id, name: 'Recovered Canvas', createdAt, updatedAt: createdAt });
      ids.add(id);
    }
  }
  // Once a catalogue exists it also records removals. Older graph blobs can
  // still be present for recovery, including the old single-canvas key.
  const legacy = rawIndex === null ? await storage.get('kv', 'thoughtdag') : null;
  let legacyId;
  if (legacy !== null) {
    // A crash in the original single-canvas migration may have left both keys.
    const id = stableId(profile.namespace, 'thoughtdag');
    let duplicate = false;
    for (const key of keys) {
      if (key !== GRAPH + id && key.startsWith(GRAPH) && await storage.get('kv', key) === legacy) { duplicate = true; break; }
    }
    if (!duplicate) {
      if (!ids.has(id)) {
        legacyId = id;
        projects.push({ id, name: 'My Canvas', createdAt, updatedAt: createdAt });
      }
    }
  }
  const graph = id => id === legacyId ? Promise.resolve(legacy) : storage.get('kv', GRAPH + id);
  return { storage, index, keys, graph, legacyId, rawIndex };
}

async function entries(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function populated(dir) {
  try {
    if (!(await fs.lstat(dir)).isDirectory()) return true;
    return (await entries(dir)).length > 0;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function fileData(ctx, namespace, id) {
  const paths = canvasFilePaths(ctx.workspaceRoot, namespace, id);
  const container = await entries(path.dirname(paths.external));
  if (container.some(entry => entry.name !== 'external' || !entry.isDirectory())) return true;
  return await populated(paths.external) || await populated(paths.documents);
}

async function placeholder(ctx, source, project, fileNamespace) {
  if (source.index.value.projects.length !== 1 || project.name !== 'My Canvas' ||
      Object.keys(project).some(key => !['name', 'id', 'createdAt', 'updatedAt'].includes(key))) return false;
  const raw = await source.graph(project.id);
  if (raw !== null) {
    const encoded = unpack(raw);
    const state = graphValue(encoded)?.state;
    if (!state || Object.keys(state).some(key => !['nodes', 'edges', 'events', 'lastNodeNumber', 'provenanceSessions'].includes(key))
        || !Array.isArray(state.nodes) || state.nodes.length || !Array.isArray(state.edges) || state.edges.length
        || (state.events !== undefined && (!Array.isArray(state.events) || state.events.length))
        || (state.provenanceSessions !== undefined && (!Array.isArray(state.provenanceSessions) || state.provenanceSessions.length))
        || (state.lastNodeNumber ?? 0) !== 0 || encoded.special.some(item => item.kind === 'reference')) return false;
  }
  if (await fileData(ctx, fileNamespace, project.id)) return false;
  const chat = await source.storage.get('settings', CHAT + project.id);
  if (chat !== null) {
    try {
      const turns = JSON.parse(unpack(chat).value);
      if (!Array.isArray(turns) || turns.length) return false;
    } catch { return false; }
  }
  // Before dedicated folders, agents could put user files next to .thoughtdag.
  const paths = canvasFilePaths(ctx.workspaceRoot, fileNamespace, project.id);
  const legacyRoot = path.dirname(path.dirname(path.dirname(paths.documents)));
  return !(await entries(legacyRoot)).some(entry => entry.name !== '.thoughtdag');
}

async function selectPrimaryNamespace(ctx) {
  let winner = null;
  for (const profile of [...ctx.profiles].sort((a, b) => a.namespace.localeCompare(b.namespace))) {
    const source = await catalogue(ctx, profile);
    const projects = source.index.value.projects;
    let count = projects.length;
    if (count === 1 && await placeholder(ctx, source, projects[0], profile.namespace)) count = 0;
    if (!winner || count > winner.count || (count === winner.count && profile.createdAt < winner.createdAt)) {
      winner = { ...profile, count };
    }
  }
  return winner?.namespace;
}

async function copyValues(source, dest, space, keys) {
  const remapped = new Map();
  for (const key of keys) {
    if (space === 'kv' && (key === INDEX || key === 'thoughtdag' || key.startsWith(GRAPH))) continue;
    const value = await source.get(space, key);
    if (value === null) throw new Error('A storage record disappeared during migration');
    const existing = await dest.get(space, key);
    if (existing === null) await dest.set(space, key, value);
    else if (space === 'kv' && existing !== value) {
      const prefix = VAULT.find(prefix => key.startsWith(prefix));
      if (!prefix) continue; // The full original remains in the backup.
      const id = stableId('vault', key, createHash('sha256').update(value).digest('hex'));
      const relocated = await dest.get(space, prefix + id);
      if (relocated !== null && relocated !== value) throw new Error('Conflicting migrated attachment');
      if (relocated === null) await dest.set(space, prefix + id, value);
      remapped.set(key, id);
    }
  }
  return remapped;
}

function rewriteVault(raw, remapped, sourceKeys) {
  if (raw === null) return raw;
  const encoded = unpack(raw);
  const graph = graphValue(encoded);
  let changed = false;
  for (const [i, node] of (graph?.state?.nodes ?? []).entries()) {
    for (const [j, att] of (node?.data?.attachments ?? []).entries()) {
      if (!att) continue;
      for (const [field, prefix, old, inline] of [
        ['contentVaultId', VAULT[0], att.contentInVault && (att.contentVaultId ?? att.id), att.content || undefined],
        ['editedDocxRevision', VAULT[1], att.editedDocxRevision, att.editedDocxContent],
        ['pdfFileRevision', VAULT[2], att.pdfFileRevision, att.pdfFileContent],
      ]) {
        if (old && !sourceKeys.has(prefix + old) && inline === undefined) throw new Error('An attachment referenced by a migrated canvas is missing');
        const id = old && remapped.get(prefix + old);
        if (!id) continue;
        changed = true;
        att[field] = id;
        const at = JSON.stringify(['state', 'nodes', i, 'data', 'attachments', j, field]);
        encoded.special = encoded.special.filter(item => JSON.stringify(item.path) !== at);
      }
    }
  }
  if (!changed) return raw;
  if (typeof encoded.value === 'string') encoded.value = JSON.stringify(graph);
  return JSON.stringify(encoded);
}

// Preserve optional fields stored by the structured clone codec when combining
// two metadata arrays. Project metadata consists of plain values and arrays.
function appendProject(dest, source, from, id, projectIndexes) {
  const index = dest.value.projects.length;
  projectIndexes.set(from, index);
  dest.value.projects.push({ ...source.value.projects[from], id });
  for (const item of source.special) {
    if (item.path[0] !== 'projects' || item.path[1] !== from) continue;
    const path = ['projects', index, ...item.path.slice(2)];
    if (item.kind !== 'reference') { dest.special.push({ ...item, path }); continue; }
    const targetIndex = projectIndexes.get(item.target[1]);
    if (item.target[0] !== 'projects' || targetIndex === undefined) throw new Error('Unsupported shared canvas metadata');
    dest.special.push({ ...item, path, target: ['projects', targetIndex, ...item.target.slice(2)] });
  }
}

async function archiveEmptyWorkspace(ctx, namespace, id) {
  if (namespace === ctx.namespace) return;
  const external = canvasFilePaths(ctx.workspaceRoot, namespace, id).external;
  const scope = path.join(ctx.workspaceRoot, namespace);
  const canvas = path.dirname(external);
  try {
    for (const dir of [scope, canvas, external]) {
      if (!(await fs.lstat(dir)).isDirectory()) return;
    }
  } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (await populated(external)) return;
  const archived = path.join(ctx.root, 'legacy-backup', 'empty-workspaces', namespace, path.basename(canvas), 'external');
  await fs.mkdir(archived, { recursive: true, mode: 0o700 });
  for (const dir of [external, canvas, scope]) {
    try { await fs.rmdir(dir); }
    catch (error) {
      // An external tool may have created a file since inspection. rmdir
      // can remove only empty directories and will leave that file in place.
      if (['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) return;
      throw error;
    }
  }
}

/** Caller serializes migrations across hosts. Publish each index only after
 * all referenced data and the original file locations are durably written. */
async function mergeLegacyStorage(ctx) {
  const primaryProfile = ctx.profiles.find(p => p.namespace === ctx.namespace) ?? { namespace: ctx.namespace };
  const primary = await catalogue(ctx, primaryProfile, false);
  const dest = primary.storage;
  if (primary.legacyId) await dest.set('kv', GRAPH + primary.legacyId, await primary.graph(primary.legacyId));
  const index = primary.index;
  const origins = await readCanvasFileOrigins(ctx.workspaceRoot, ctx.namespace);
  const originFile = path.join(dest.dir, 'canvas-files.json');
  for (const profile of ctx.profiles) {
    if (profile.namespace === ctx.namespace) continue;
    const source = await catalogue(ctx, profile);
    const browserScope = profile.browserImport && await source.storage.get('settings', 'thoughtdag:managed-document-namespace');
    const originalScope = browserScope && unpack(browserScope).value;
    const fileNamespace = (UUID.test(originalScope) && originalScope) || profile.namespace;
    const remapped = await copyValues(source.storage, dest, 'kv', source.keys);
    const sourceKeys = new Set(source.keys);
    const chatKeys = new Set(source.index.value.projects.map(project => CHAT + project.id));
    const settings = (await source.storage.keys('settings')).filter(key => !chatKeys.has(key));
    await copyValues(source.storage, dest, 'settings', settings);
    const projectIndexes = new Map();
    for (const [i, project] of source.index.value.projects.entries()) {
      if (index.value.projects.length && await placeholder(ctx, source, project, fileNamespace)) {
        await archiveEmptyWorkspace(ctx, fileNamespace, project.id);
        continue;
      }
      const raw = rewriteVault(await source.graph(project.id), remapped, sourceKeys);
      const chat = await source.storage.get('settings', CHAT + project.id);
      let id = project.id;
      const existing = index.value.projects.find(p => p.id === id);
      const currentRaw = await dest.get('kv', GRAPH + id);
      if ((existing && origins.get(id)?.sourceNamespace !== profile.namespace) || (currentRaw !== null && currentRaw !== raw)) {
        if (JSON.stringify(existing) === JSON.stringify(project) && currentRaw === raw && await dest.get('settings', CHAT + id) === chat &&
            !await fileData(ctx, fileNamespace, id)) {
          projectIndexes.set(i, index.value.projects.indexOf(existing));
          await archiveEmptyWorkspace(ctx, fileNamespace, id);
          continue;
        }
        id = stableId(profile.namespace, 'canvas', project.id);
      }
      const previous = await dest.get('kv', GRAPH + id);
      if (previous !== null && previous !== raw) throw new Error('Conflicting migrated canvas');
      if (raw !== null && previous === null) await dest.set('kv', GRAPH + id, raw);
      if (chat !== null) await dest.set('settings', CHAT + id, chat);
      const position = index.value.projects.findIndex(p => p.id === id);
      if (position < 0) appendProject(index, source.index, i, id, projectIndexes);
      else projectIndexes.set(i, position);
      const ref = { namespace: fileNamespace, canvasId: project.id };
      const paths = canvasFilePaths(ctx.workspaceRoot, fileNamespace, project.id);
      await archiveEmptyWorkspace(ctx, fileNamespace, project.id);
      origins.set(id, { id, sourceNamespace: profile.namespace,
        ...(await populated(paths.external) && { external: ref }),
        ...(await populated(paths.documents) && { documents: ref }),
      });
      if (!index.value.activeId) index.value.activeId = id;
    }
  }
  for (const key of primary.keys) {
    if (primary.rawIndex !== null || !key.startsWith(GRAPH)) continue;
    const id = key.slice(GRAPH.length);
    if (id && !index.value.projects.some(p => p.id === id)) {
      const timestamp = Date.parse(primaryProfile.createdAt) || 0;
      index.value.projects.push({ id, name: 'Recovered Canvas', createdAt: timestamp, updatedAt: timestamp });
    }
  }
  if (origins.size) await ctx.atomicWrite(originFile, JSON.stringify([...origins.values()]));
  if (index.value.projects.length) {
    if (!index.value.projects.some(p => p.id === index.value.activeId)) index.value.activeId = index.value.projects[0].id;
    for (const project of index.value.projects) {
      const ref = origins.get(project.id)?.external;
      await ensurePhysicalWorkspace(ctx.workspaceRoot, ref?.namespace ?? ctx.namespace, ref?.canvasId ?? project.id);
    }
    if (primary.rawIndex !== JSON.stringify(index)) {
      if (primary.rawIndex !== null) {
        const backup = path.join(ctx.root, 'legacy-backup', 'primary-index-' + ctx.namespace + '.json');
        if (await read(backup) === null) await ctx.atomicWrite(backup, primary.rawIndex);
      }
      await dest.set('kv', INDEX, JSON.stringify(index));
    }
  }
}

module.exports = { selectPrimaryNamespace, mergeLegacyStorage };
