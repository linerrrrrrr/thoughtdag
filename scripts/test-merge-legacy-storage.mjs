import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { mergeLegacyStorage, selectPrimaryNamespace } = require('../runtime/merge-legacy-storage.cjs');
const { createManagedDocuments, ensureCanvasWorkspace } = require('../runtime/managed-documents.cjs');
const parent = path.resolve(os.tmpdir());
const temp = await mkdtemp(path.join(parent, 'thoughtdag-merge-'));
const root = path.join(temp, 'browser-storage');
const workspaceRoot = path.join(temp, 'workspaces');
const profile = () => ({ namespace: randomUUID(), createdAt: '2026-01-01T00:00:00Z' });
const main = profile(), source = profile(), empty = profile(), legacy = profile(), deleted = profile();
const profiles = [empty, main, source, legacy, deleted];
const recordPath = (dir, key) => path.join(dir, Buffer.from(key).toString('base64url') + '.json');
const listKeys = async dir => {
  try { return (await readdir(dir)).map(name => Buffer.from(name.slice(0, -5), 'base64url').toString()); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const atomicWrite = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
const ctx = { root, workspaceRoot, profiles, namespace: main.namespace, recordPath, listKeys, atomicWrite };
const packed = value => JSON.stringify({ format: 1, value, special: [] });
const file = (profile, space, key) => recordPath(path.join(root, profile.namespace, space), key);
const put = (profile, space, key, value) => atomicWrite(file(profile, space, key), packed(value));
const get = async (profile, space, key) => JSON.parse(await readFile(file(profile, space, key), 'utf8')).value;
const meta = (id, name) => ({ id, name, createdAt: 1, updatedAt: 1 });
const INDEX = 'thoughtdag:projects', GRAPH = 'thoughtdag:project:';
const index = (profile, projects) => put(profile, 'kv', INDEX, { projects, activeId: projects[0].id });
const graph = (text, attachments = []) => ({ state: { nodes: [{ id: 'n', data: { question: text, attachments } }], edges: [] }, version: 1 });
const doc = createManagedDocuments(workspaceRoot);

try {
  await index(main, [meta('same', 'Main'), meta('two', 'Second'), meta('three', 'Third')]);
  await index(empty, [meta('placeholder', 'My Canvas')]);
  await put(empty, 'kv', GRAPH + 'placeholder', { state: { nodes: [], edges: [], events: [], provenanceSessions: [] } });
  await ensureCanvasWorkspace(workspaceRoot, empty.namespace, 'placeholder');
  await index(source, [meta('same', 'Another canvas'), meta('unique', 'Other')]);
  await put(main, 'kv', GRAPH + 'same', graph('primary'));
  const attachment = { id: 'a', contentInVault: true, editedDocxRevision: 'rev', pdfFileRevision: 'pdf' };
  await put(source, 'kv', GRAPH + 'same', JSON.stringify(graph('conflict', [attachment])));
  await put(source, 'kv', GRAPH + 'unique', graph('unique'));
  await put(legacy, 'kv', 'thoughtdag', JSON.stringify(graph('old format')));
  await put(deleted, 'kv', INDEX, { projects: [], activeId: null });
  for (const owner of [main, source, deleted]) {
    await put(owner, 'kv', GRAPH + 'removed', graph('removed from the catalogue'));
    await put(owner, 'kv', 'thoughtdag', JSON.stringify(graph('residual single-canvas record')));
  }
  for (const key of ['att-content:a', 'att-docx-revision:rev', 'att-pdf-revision:pdf']) {
    await put(main, 'kv', key, 'main-bytes');
    await put(source, 'kv', key, 'secondary-bytes');
  }
  await put(source, 'settings', 'thoughtdag.canvasChat.same', '[{"text":"secondary"}]');
  await put(main, 'settings', 'thoughtdag.canvasChat.same', '[{"text":"main"}]');
  const external = await ensureCanvasWorkspace(workspaceRoot, source.namespace, 'same');
  await writeFile(path.join(external, 'user.txt'), 'external bytes');
  const oldEmptyFolder = await ensureCanvasWorkspace(workspaceRoot, source.namespace, 'unique');
  const document = { namespace: source.namespace, canvasId: 'same', nodeId: 'n', attachmentId: 'a', name: 'data.txt' };
  const priorFile = await doc({ ...document, op: 'ensure', base64: Buffer.from('file bytes').toString('base64') });
  assert.equal(await selectPrimaryNamespace(ctx), main.namespace);
  // Simulate a crash after copying the new graphs but before publishing their catalogue.
  const originalIndex = await readFile(file(main, 'kv', INDEX), 'utf8');
  await assert.rejects(mergeLegacyStorage({ ...ctx, atomicWrite(filePath, value) {
    if (filePath === file(main, 'kv', INDEX)) throw new Error('simulated interruption');
    return atomicWrite(filePath, value);
  } }), /simulated interruption/);
  assert.equal(await readFile(file(main, 'kv', INDEX), 'utf8'), originalIndex);
  await mergeLegacyStorage(ctx);
  const merged = await get(main, 'kv', INDEX);
  assert.equal(merged.projects.length, 6);
  assert.equal(merged.activeId, 'same');
  assert.equal(merged.projects.some(p => p.id === 'placeholder'), false);
  assert.equal(merged.projects.some(p => p.id === 'removed'), false);
  assert.equal((await get(main, 'kv', GRAPH + 'removed')).state.nodes[0].data.question, 'removed from the catalogue');
  await assert.rejects(stat(path.join(workspaceRoot, empty.namespace)), { code: 'ENOENT' });
  assert.ok((await stat(path.join(root, 'legacy-backup', 'empty-workspaces', empty.namespace, 'placeholder', 'external'))).isDirectory());
  const id = merged.projects.find(p => p.name === 'Another canvas').id;
  assert.notEqual(id, 'same');
  const att = JSON.parse(await get(main, 'kv', GRAPH + id)).state.nodes[0].data.attachments[0];
  for (const key of ['att-content:' + att.contentVaultId, 'att-docx-revision:' + att.editedDocxRevision, 'att-pdf-revision:' + att.pdfFileRevision]) {
    assert.equal(await get(main, 'kv', key), 'secondary-bytes');
  }
  assert.equal(await get(main, 'kv', 'att-content:a'), 'main-bytes');
  assert.equal(await get(main, 'settings', 'thoughtdag.canvasChat.' + id), '[{"text":"secondary"}]');
  assert.equal(await get(main, 'settings', 'thoughtdag.canvasChat.same'), '[{"text":"main"}]');
  assert.equal(await ensureCanvasWorkspace(workspaceRoot, main.namespace, id), external);
  assert.equal(await readFile(path.join(external, 'user.txt'), 'utf8'), 'external bytes');
  assert.equal((await doc({ ...document, namespace: main.namespace, canvasId: id, op: 'read' })).path, priorFile.path);
  const moved = await ensureCanvasWorkspace(workspaceRoot, main.namespace, 'unique');
  assert.equal(moved, path.join(workspaceRoot, main.namespace, 'unique', 'external'));
  await assert.rejects(stat(oldEmptyFolder), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, 'legacy-backup', 'primary-index-' + main.namespace + '.json'), 'utf8'), originalIndex);
  await mergeLegacyStorage(ctx);
  assert.deepEqual(await get(main, 'kv', INDEX), merged, 'retry after the index commit does not duplicate canvases');
  const single = profile();
  await put(single, 'kv', 'thoughtdag', graph('primary from the single-canvas era'));
  const initial = { ...ctx, namespace: single.namespace, profiles: [single] };
  await assert.rejects(mergeLegacyStorage({ ...initial, atomicWrite(filePath, value) {
    if (filePath === file(single, 'kv', INDEX)) throw new Error('interrupted initial migration');
    return atomicWrite(filePath, value);
  } }), /interrupted initial migration/);
  await mergeLegacyStorage(initial);
  const recovered = await get(single, 'kv', INDEX);
  assert.deepEqual(recovered.projects.map(p => p.name), ['My Canvas']);
  assert.deepEqual(await get(single, 'kv', GRAPH + recovered.activeId), graph('primary from the single-canvas era'));
  const unindexed = profile();
  await put(unindexed, 'kv', GRAPH + 'bare-graph', graph('old data without an index'));
  await mergeLegacyStorage({ ...ctx, profiles: [unindexed] });
  assert.ok((await get(main, 'kv', INDEX)).projects.some(p => p.id === 'bare-graph'));
  console.log('PASS legacy graph recovery, original index backup, conflicting canvas/chat/attachment preservation, stable file paths, empty-folder consolidation and interrupted migration retry');
} finally {
  assert.equal(path.dirname(temp), parent);
  assert.ok(path.basename(temp).startsWith('thoughtdag-merge-'));
  await rm(temp, { recursive: true, force: true });
}
