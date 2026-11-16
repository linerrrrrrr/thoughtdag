// Migrate synthetic browser data through the real local storage handler.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { createBrowserStorage } = require('../runtime/browser-storage.cjs');
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
  const handler = createBrowserStorage({ dataRoot: temporary });
  let rejectWrites = false;
  globalThis.fetch = async (_url, options = {}) => {
    if (rejectWrites && options.body && JSON.parse(options.body).op === 'set') {
      return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    req.url = '/__thoughtdag_storage';
    req.method = options.method ?? 'GET';
    req.socket = { remoteAddress: '127.0.0.1' };
    req.headers = { host: 'localhost:5173', ...options.headers };
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
  globalThis.__testIdb.set('thoughtdag:projects', { projects: [{ id: 'canvas' }], activeId: 'canvas' });
  globalThis.__testIdb.set('thoughtdag:project:canvas', graph);
  globalThis.__testIdb.set('att-content:doc', 'UEsDB-original');
  localStorage.setItem('thoughtdag.providers', 'example-provider-settings');
  localStorage.setItem('unrelated-site-key', 'leave-alone');
  await assert.rejects(first.initializeDiskStorage(), /revision is missing/);
  assert.equal(globalThis.__testIdb.has('thoughtdag:disk-storage:locator:v1'), false);
  assert.equal(globalThis.__testIdb.get('att-content:doc'), 'UEsDB-original');
  globalThis.__testIdb.set('att-docx-revision:rev', 'UEsDB-edited');
  assert.equal(await first.initializeDiskStorage(), 'disk');
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
  globalThis.__testIdb = new Map();
  globalThis.__THOUGHTDAG_DISK_STORAGE_REQUIRED__ = true;
  globalThis.fetch = async () => { throw new Error('service offline'); };
  const required = await import(`${pathToFileURL(bundle).href}?required`);
  await assert.rejects(required.initializeDiskStorage(), /service is unavailable/);
  assert.equal(globalThis.__testIdb.size, 0);
  console.log('PASS canvas, DOCX originals/revisions, settings, failed-write protection and restart without deleting source');
} finally {
  assert.ok(path.resolve(temporary).startsWith(`${parent}${path.sep}`));
  await rm(temporary, { recursive: true, force: true });
}
