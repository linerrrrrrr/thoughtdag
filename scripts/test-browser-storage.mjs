// Exercise the local storage boundary without touching the user's browser data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createBrowserStorage } = require('../runtime/browser-storage.cjs');
const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'local-tests');
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(path.join(parent, 'browser-storage-'));
assert.ok(path.resolve(temporary).startsWith(`${parent}${path.sep}`));

function call(handler, { method = 'POST', data, headers = {}, remote = '127.0.0.1' } = {}) {
  const body = data === undefined ? [] : [Buffer.from(JSON.stringify(data))];
  const req = Readable.from(body);
  req.method = method;
  req.url = '/__thoughtdag_storage';
  req.socket = { remoteAddress: remote };
  req.headers = { host: 'localhost:5173', 'x-thoughtdag-storage': '1', 'content-type': 'application/json', ...headers };
  return new Promise((resolve, reject) => {
    const res = {
      writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; },
      end(payload) { resolve({ status: this.status, data: JSON.parse(payload), headers: this.headers }); },
    };
    Promise.resolve(handler(req, res, () => reject(new Error('Unexpected route')))).catch(reject);
  });
}

try {
  let handler = createBrowserStorage({ dataRoot: temporary });
  const namespace = '12345678-1234-4234-8234-123456789abc';
  const other = '87654321-4321-4321-8321-cba987654321';
  assert.equal((await call(handler, { method: 'GET' })).data.service, 'thoughtdag-local-storage');
  assert.equal((await call(handler, { method: 'GET', headers: { origin: 'https://example.com' } })).status, 403);
  assert.equal((await call(handler, { method: 'GET', headers: { 'x-thoughtdag-storage': undefined } })).status, 403);
  assert.equal((await call(handler, { method: 'GET', remote: '192.0.2.1' })).status, 403);
  assert.equal((await call(handler, { data: { op: 'open', namespace, origin: 'http://localhost:5173' } })).status, 404);
  assert.equal((await call(handler, { data: { op: 'create', namespace, origin: 'http://localhost:5173' } })).status, 200);
  assert.deepEqual((await call(handler, { data: { op: 'list', origin: 'http://localhost:5173' } })).data.namespaces, []);
  assert.equal((await call(handler, { data: { op: 'open', namespace, origin: 'http://localhost:5173' } })).status, 404);
  assert.equal((await call(handler, { data: { op: 'finish', namespace, origin: 'http://localhost:5173' } })).status, 200);
  assert.equal((await call(handler, { data: { op: 'open', namespace, origin: 'http://localhost:5173' } })).status, 200);
  assert.equal((await call(handler, { data: { op: 'list', origin: 'http://localhost:5173' } })).data.namespaces.length, 1);
  assert.equal((await call(handler, { data: { op: 'keys', namespace: other, space: 'kv' } })).status, 404);

  const graphKey = 'thoughtdag:project:123';
  const attachmentKey = `att-content:${'文档'.repeat(90)}`;
  const graph = JSON.stringify({ state: { nodes: [{ data: { attachments: [{ contentInVault: true }] } }], edges: [] } });
  const docx = 'UEsDB' + 'Q'.repeat(1024 * 1024);
  for (const [key, value] of [[graphKey, graph], [attachmentKey, docx]]) {
    assert.equal((await call(handler, { data: { op: 'set', namespace, space: 'kv', key, value } })).status, 200);
    const read = await call(handler, { data: { op: 'get', namespace, space: 'kv', key } });
    assert.equal(read.data.value, value);
  }
  assert.deepEqual(new Set((await call(handler, { data: { op: 'keys', namespace, space: 'kv' } })).data.keys), new Set([graphKey, attachmentKey]));
  assert.equal((await call(handler, { data: { op: 'get', namespace, space: 'settings', key: graphKey } })).data.found, false);
  const versions = ['revision-one', 'revision-two', 'revision-three'];
  await Promise.all(versions.map(value => call(handler, { data: { op: 'set', namespace, space: 'kv', key: graphKey, value } })));
  handler = createBrowserStorage({ dataRoot: temporary });
  const final = await call(handler, { data: { op: 'get', namespace, space: 'kv', key: graphKey } });
  assert.ok(versions.includes(final.data.value));
  assert.equal((await call(handler, { data: { op: 'delete', namespace, space: 'kv', key: attachmentKey } })).status, 200);
  assert.equal((await call(handler, { data: { op: 'get', namespace, space: 'kv', key: attachmentKey } })).data.found, false);
  assert.equal((await call(handler, { data: { op: 'set', namespace: '../bad', space: 'kv', key: 'x', value: 'x' } })).status, 400);
  const previousHome = process.env.THOUGHTDAG_HOME;
  process.env.THOUGHTDAG_HOME = temporary;
  const agents = require('../runtime/agents/http.cjs').createAgentsHttp();
  try {
    const result = await new Promise((resolve, reject) => {
      const req = { method: 'POST', url: '/api/agents/workspace' };
      const res = { writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
      agents.handle(req, res, '/agents/workspace', { canvasId: 'storage-test' }).catch(reject);
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.dir, path.join(temporary, 'workspaces', 'storage-test'));
  } finally {
    agents.shutdown();
    if (previousHome === undefined) delete process.env.THOUGHTDAG_HOME;
    else process.env.THOUGHTDAG_HOME = previousHome;
  }
  const previousMode = process.env.THOUGHTDAG_DISK_STORAGE;
  process.env.THOUGHTDAG_HOME = temporary;
  process.env.THOUGHTDAG_DISK_STORAGE = '1';
  try {
    const { thoughtdagTempRoot } = require('../runtime/local-temp.cjs');
    assert.equal(thoughtdagTempRoot(), path.join(temporary, 'tmp'));
    process.env.THOUGHTDAG_HOME = 'relative-path';
    assert.throws(() => thoughtdagTempRoot(), /absolute/);
  } finally {
    if (previousHome === undefined) delete process.env.THOUGHTDAG_HOME;
    else process.env.THOUGHTDAG_HOME = previousHome;
    if (previousMode === undefined) delete process.env.THOUGHTDAG_DISK_STORAGE;
    else process.env.THOUGHTDAG_DISK_STORAGE = previousMode;
  }
  console.log('PASS local-only access, canvas/attachment round trip, atomic writes and namespace isolation');
} finally {
  assert.ok(path.resolve(temporary).startsWith(`${parent}${path.sep}`));
  await rm(temporary, { recursive: true, force: true });
}
