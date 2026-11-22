// Migrate synthetic browser data through the real local storage handler.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { createBrowserStorage, initializeProjectDatabase } = require('../runtime/browser-storage.cjs');
const database = process.argv.includes('--sqlite');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = path.join(root, 'local-tests');
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(path.join(parent, 'disk-migration-'));
assert.ok(path.resolve(temporary).startsWith(`${parent}${path.sep}`));
const bundle = path.join(temporary, 'storage.mjs');

class FakeStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

try {
  globalThis.__testIdb = new Map();
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeStorage(), configurable: true });
  const testWindow = new EventTarget();
  testWindow.location = new URL('http://localhost:5173/');
  Object.defineProperty(globalThis, 'window', { value: testWindow, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_name, callback) => callback() } }, configurable: true });
  let handler = createBrowserStorage({ dataRoot: temporary, database });
  let rejectWrites = false;
  let interruptImport = false;
  let importedRows = 0;
  globalThis.fetch = async (_url, options = {}) => {
    const payload = options.body && JSON.parse(options.body);
    if (payload?.op === 'stageSet') importedRows++;
    if ((rejectWrites && payload?.op === 'set') || (interruptImport && payload?.op === 'finishImport')) {
      return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    req.url = '/__thoughtdag_storage';
    req.method = options.method ?? 'GET';
    req.socket = { remoteAddress: '127.0.0.1' };
    req.headers = { host: testWindow.location.host, ...options.headers };
    return new Promise((resolve, reject) => {
      const res = {
        writeHead(status, headers) { this.status = status; this.headers = headers; },
        end(payload) { resolve(new Response(payload, { status: this.status, headers: this.headers })); },
      };
      Promise.resolve(handler(req, res, () => reject(new Error('Unexpected route')))).catch(reject);
    });
  };
  await build({
    entryPoints: [path.join(root, 'src/lib/disk-storage.ts')], outfile: bundle, bundle: true,
    format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'fake-browser-db', setup(builder) {
      builder.onResolve({ filter: /^idb-keyval$/ }, () => ({ path: 'idb-keyval', namespace: 'fake' }));
      builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ loader: 'js', contents: `
        export const get = async key => globalThis.__testIdb.get(key);
        export const set = async (key, value) => { globalThis.__testIdb.set(key, structuredClone(value)); };
        export const update = async (key, fn) => { globalThis.__testIdb.set(key, fn(globalThis.__testIdb.get(key))); };
        export const del = async key => { globalThis.__testIdb.delete(key); };
        export const keys = async () => [...globalThis.__testIdb.keys()];
      ` }));
    } }],
  });
  const first = await import(`${pathToFileURL(bundle).href}?first`);
  const shared = { text: 'same object' };
  const complex = { undefinedField: undefined, empty: '', number: -0, nested: [NaN, Infinity, 8n], shared, again: shared };
  complex.cycle = complex;
  const restored = first.decodeStoredValue(first.encodeStoredValue(complex));
  assert.equal(restored.undefinedField, undefined);
  assert.ok(Object.hasOwn(restored, 'undefinedField'));
  assert.ok(Object.is(restored.number, -0));
  assert.ok(Number.isNaN(restored.nested[0]));
  assert.equal(restored.nested[1], Infinity);
  assert.equal(restored.nested[2], 8n);
  assert.equal(restored.shared, restored.again);
  assert.equal(restored.cycle, restored);
  assert.throws(() => first.encodeStoredValue(new Map()), /Unsupported/);

  const graph = { state: { nodes: [{ id: 'node', data: { attachments: [{ id: 'doc', contentInVault: true, editedDocxRevision: 'rev' }] } }], edges: [] }, version: 1 };
  globalThis.__testIdb.set('thoughtdag:projects', { projects: [{ id: 'canvas', name: 'Research', createdAt: 1, updatedAt: 1 }], activeId: 'canvas' });
  globalThis.__testIdb.set('thoughtdag:project:canvas', graph);
  globalThis.__testIdb.set('att-content:doc', 'UEsDB-original');
  localStorage.setItem('thoughtdag.providers', 'example-provider-settings');
  localStorage.setItem('unrelated-site-key', 'leave-alone');
  await assert.rejects(first.initializeDiskStorage(), /revision is missing/);
  assert.equal(globalThis.__testIdb.has('thoughtdag:disk-storage:locator:v1'), false);
  assert.equal(globalThis.__testIdb.get('att-content:doc'), 'UEsDB-original');
  globalThis.__testIdb.set('att-docx-revision:rev', 'UEsDB-edited');
  interruptImport = true;
  await assert.rejects(first.initializeDiskStorage(), /503/);
  assert.equal(globalThis.__testIdb.has('thoughtdag:disk-storage:locator:v1'), false);
  const interruptedId = globalThis.__testIdb.get('thoughtdag:disk-storage:import-id');
  assert.ok(interruptedId);
  interruptImport = false;
  assert.equal(await first.initializeDiskStorage(), 'disk');
  assert.equal(globalThis.__testIdb.get('thoughtdag:disk-storage:import-id'), interruptedId);
  assert.deepEqual(await first.get('thoughtdag:project:canvas'), graph);
  assert.equal(await first.get('att-content:doc'), 'UEsDB-original');
  assert.equal(await first.get('att-docx-revision:rev'), 'UEsDB-edited');
  assert.equal(first.appSettings.getItem('thoughtdag.providers'), 'example-provider-settings');
  assert.equal(first.appSettings.getItem('unrelated-site-key'), null);
  assert.equal(localStorage.getItem('unrelated-site-key'), 'leave-alone');
  assert.equal(globalThis.__testIdb.get('att-content:doc'), 'UEsDB-original');
  await first.set('att-docx-revision:new', 'UEsDB-new');
  first.appSettings.setItem('thoughtdag.lang', 'zh');
  await first.flushDiskWrites();
  const second = await import(`${pathToFileURL(bundle).href}?second`);
  assert.equal(await second.initializeDiskStorage(), 'disk');
  assert.equal(await second.get('att-docx-revision:new'), 'UEsDB-new');
  assert.equal(second.appSettings.getItem('thoughtdag.lang'), 'zh');
  assert.ok((await second.keys()).includes('att-content:doc'));
  rejectWrites = true;
  await assert.rejects(second.set('att-docx-revision:new', 'failed-write'));
  const blockedExit = new Event('beforeunload', { cancelable: true });
  testWindow.dispatchEvent(blockedExit);
  assert.equal(blockedExit.defaultPrevented, true);
  rejectWrites = false;
  await second.set('att-docx-revision:new', 'recovered-write');
  await second.flushDiskWrites();
  const safeExit = new Event('beforeunload', { cancelable: true });
  testWindow.dispatchEvent(safeExit);
  assert.equal(safeExit.defaultPrevented, false);
  await second.del('att-docx-revision:new');
  assert.equal(await second.get('att-docx-revision:new'), undefined);

  const rowsBeforeReconnect = importedRows;
  await second.set('att-docx-revision:rev', 'updated-on-disk');
  globalThis.__testIdb.delete('thoughtdag:disk-storage:locator:v1');
  const restoredClient = await import(`${pathToFileURL(bundle).href}?restored`);
  await restoredClient.initializeDiskStorage();
  assert.equal(await restoredClient.get('att-docx-revision:rev'), 'updated-on-disk');
  assert.equal(importedRows, rowsBeforeReconnect, 'a lost locator must not reimport the retained browser snapshot');

  globalThis.__testIdb = new Map();
  testWindow.location = new URL('http://127.0.0.1:5180');
  localStorage.data.clear();
  const otherPort = await import(`${pathToFileURL(bundle).href}?other-port`);
  await otherPort.initializeDiskStorage();
  assert.equal(otherPort.diskStorageNamespace(), first.diskStorageNamespace());
  assert.equal(importedRows, rowsBeforeReconnect, 'an empty origin does not create an import');
  assert.deepEqual(await otherPort.getCanvasForEditing('thoughtdag:project:canvas'), graph);
  await first.getCanvasForEditing('thoughtdag:project:canvas');
  const revisedGraph = structuredClone(graph);
  revisedGraph.state.nodes[0].data.question = 'edited in the first window';
  await first.saveEditedCanvas('thoughtdag:project:canvas', revisedGraph);
  await assert.rejects(otherPort.saveEditedCanvas('thoughtdag:project:canvas', graph), /another window/);
  assert.deepEqual(await first.get('thoughtdag:project:canvas'), revisedGraph);
  const increment = (n = 0) => n + 1;
  await Promise.all([first.updateStoredValue('counter', increment), otherPort.updateStoredValue('counter', increment)]);
  assert.equal(await second.get('counter'), 2);

  // A v2 browser retained the OLD IndexedDB even after deleting a canvas
  // on disk. Without a locator, fresh data from another browser at the same
  // origin can look identical. Both decisions keep the same disk library.
  const ambiguousRoot = path.join(temporary, 'old-data');
  const legacyNamespace = '00000000-0000-4000-8000-000000000001';
  const profile = path.join(ambiguousRoot, 'browser-storage', legacyNamespace);
  await mkdir(path.join(profile, 'kv'), { recursive: true });
  await writeFile(path.join(profile, 'manifest.json'), JSON.stringify({
    version: 1, ready: true, createdAt: '2024-01-01', origin: testWindow.location.origin,
  }));
  const projectIndex = id => ({ projects: [{ id, name: id, createdAt: 1, updatedAt: 1 }], activeId: id });
  for (const [key, value] of [['thoughtdag:projects', projectIndex('saved')], ['thoughtdag:project:saved', graph]]) {
    await writeFile(path.join(profile, 'kv', 'k-' + Buffer.from(key).toString('base64url') + '.json'), first.encodeStoredValue(value));
  }
  handler = createBrowserStorage({ dataRoot: ambiguousRoot, database });
  // A locator issued by another root must not bring its stale data here.
  globalThis.__testIdb.set('thoughtdag:projects', projectIndex('browser-copy'));
  globalThis.__testIdb.set('thoughtdag:project:browser-copy', { state: { nodes: [], edges: [] }, version: 1 });
  const freshRoot = await import(`${pathToFileURL(bundle).href}?independent-root`);
  await freshRoot.initializeDiskStorage();
  assert.equal(freshRoot.diskStorageNamespace(), legacyNamespace);
  assert.deepEqual((await freshRoot.get('thoughtdag:projects')).projects.map(p => p.id), ['saved']);

  globalThis.__testIdb.delete('thoughtdag:disk-storage:locator:v1');
  const undecided = await import(`${pathToFileURL(bundle).href}?ambiguous`);
  await assert.rejects(undecided.initializeDiskStorage(), undecided.BrowserImportChoiceRequired);
  assert.equal(globalThis.__testIdb.has('thoughtdag:disk-storage:import-id'), false);
  await undecided.initializeDiskStorage(undefined, 'project');
  assert.deepEqual((await undecided.get('thoughtdag:projects')).projects.map(p => p.id), ['saved']);
  globalThis.__testIdb.delete('thoughtdag:disk-storage:locator:v1');
  const explicitImport = await import(`${pathToFileURL(bundle).href}?include`);
  await explicitImport.initializeDiskStorage(undefined, 'import');
  assert.equal(explicitImport.diskStorageNamespace(), legacyNamespace);
  assert.deepEqual(new Set((await explicitImport.get('thoughtdag:projects')).projects.map(p => p.id)), new Set(['saved', 'browser-copy']));
  if (database) {
    const { namespace, records } = await initializeProjectDatabase(ambiguousRoot);
    assert.equal(namespace, legacyNamespace);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(ambiguousRoot, 'thoughtdag.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT count(*) AS total FROM records').get().total, records);
      const index = db.prepare('SELECT value FROM records WHERE space = ? AND key = ?').get('kv', 'thoughtdag:projects');
      assert.deepEqual(new Set(first.decodeStoredValue(index.value).projects.map(p => p.id)), new Set(['saved', 'browser-copy']));
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { db.close(); }
    // Reopening the database must never resurrect the old on-disk snapshot.
    await explicitImport.del('thoughtdag:project:saved');
    await initializeProjectDatabase(ambiguousRoot);
    assert.equal(await explicitImport.get('thoughtdag:project:saved'), undefined);
  }
  globalThis.__testIdb = new Map();
  globalThis.__THOUGHTDAG_DISK_STORAGE_REQUIRED__ = true;
  globalThis.fetch = async () => { throw new Error('service offline'); };
  const required = await import(`${pathToFileURL(bundle).href}?required`);
  await assert.rejects(required.initializeDiskStorage(), /service is unavailable/);
  assert.equal(globalThis.__testIdb.size, 0);
  globalThis.fetch = async () => Response.json({ service: 'thoughtdag-local-storage', version: 2 });
  await assert.rejects(required.initializeDiskStorage(), required.StorageHostUpdateRequired);
  console.log('PASS staged migration and retry, reconnect, shared ports, concurrent writes, older host and source preservation');
} finally {
  assert.ok(path.resolve(temporary).startsWith(`${parent}${path.sep}`));
  await rm(temporary, { recursive: true, force: true });
}
