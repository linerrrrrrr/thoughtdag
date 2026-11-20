// Exercise the local storage boundary without touching the user's browser data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { createBrowserStorage } = require('../runtime/browser-storage.cjs');
const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'local-tests');
await mkdir(parent, { recursive: true });
const worker = process.argv[2] === '--connect';
const temporary = worker ? path.resolve(process.argv[3]) : await mkdtemp(path.join(parent, 'browser-storage-'));
assert.ok(path.resolve(temporary).startsWith(`${parent}${path.sep}`));

function call(handler, { method = 'POST', data, headers = {}, remote = '127.0.0.1' } = {}) {
  const body = data === undefined ? [] : [Buffer.from(JSON.stringify({ protocol: 3, ...data }))];
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

if (worker) {
  const origin = process.argv[4];
  const result = await call(createBrowserStorage({ dataRoot: temporary }), {
    data: { op: 'connect', origin }, headers: { host: new URL(origin).host, origin },
  });
  assert.equal(result.status, 200);
  process.stdout.write(result.data.namespace);
} else try {
  let handler = createBrowserStorage({ dataRoot: temporary });
  const namespace = '12345678-1234-4234-8234-123456789abc';
  const other = '87654321-4321-4321-8321-cba987654321';
  const local = 'http://localhost:5173';
  const alternate = 'http://127.0.0.1:5180';
  const independent = path.join(temporary, 'separate-project');
  const workers = await Promise.all([local, alternate, 'http://localhost:3001'].map(origin =>
    promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), '--connect', independent, origin], { windowsHide: true })));
  assert.equal(new Set(workers.map(result => result.stdout)).size, 1, 'independent host processes publish one library for a new data root');
  assert.notEqual(workers[0].stdout, namespace);
  const storage = path.join(temporary, 'browser-storage');
  const metaKey = 'thoughtdag:projects';
  const record = key => 'k-' + Buffer.from(key).toString('base64url') + '.json';
  const encode = value => JSON.stringify({ format: 1, value, special: [] });
  for (const [id, origin, canvas, name] of [[namespace, local, 'storage-test', 'My research'], [other, alternate, 'empty', 'My Canvas']]) {
    const profile = path.join(storage, id);
    await mkdir(path.join(profile, 'kv'), { recursive: true });
    await writeFile(path.join(profile, 'manifest.json'), JSON.stringify({ version: 1, ready: true, origin, createdAt: new Date().toISOString() }));
    await writeFile(path.join(profile, 'kv', record(metaKey)), encode({ activeId: canvas, projects: [{ id: canvas, name, createdAt: 1, updatedAt: 1 }] }));
  }
  const canvasWorkspace = (canvasId, scope = namespace, origin = 'http://localhost:5173') =>
    call(handler, { data: { op: 'canvasWorkspace', namespace: scope, origin, canvasId } });
  assert.equal((await call(handler, { method: 'GET' })).data.service, 'thoughtdag-local-storage');
  assert.equal((await call(handler, { method: 'GET', headers: { origin: 'https://example.com' } })).status, 403);
  assert.equal((await call(handler, { method: 'GET', headers: { 'x-thoughtdag-storage': undefined } })).status, 403);
  assert.equal((await call(handler, { method: 'GET', remote: '192.0.2.1' })).status, 403);
  const connect = (origin, data = {}) => call(createBrowserStorage({ dataRoot: temporary }), {
    data: { op: 'connect', origin, ...data }, headers: { host: new URL(origin).host, origin },
  });
  for (const opened of await Promise.all([connect(local, { previousNamespace: namespace }), connect(alternate, { previousNamespace: other })])) {
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.data, { namespace, alreadyMigrated: true });
  }
  assert.equal(JSON.parse(await readFile(path.join(storage, 'legacy-backup', other, 'manifest.json'), 'utf8')).origin, alternate);
  const joined = JSON.parse((await call(handler, { data: { op: 'get', namespace, space: 'kv', key: metaKey } })).data.value);
  assert.deepEqual(joined.value.projects.map(p => p.name), ['My research']);
  assert.equal((await connect(alternate, { projectIds: ['empty'] })).data.alreadyMigrated, true);
  const uncertain = (await connect(alternate, { projectIds: ['unseen-local-canvas'] })).data;
  assert.equal(uncertain.alreadyMigrated, false);
  assert.equal(uncertain.confirmBrowserImport, true);
  assert.equal((await connect('http://localhost:8190', { projectIds: ['unseen-local-canvas'] })).data.confirmBrowserImport, undefined);
  assert.equal((await call(handler, { data: { op: 'open', namespace, origin: 'http://localhost:5173' } })).status, 200);
  const document = async (request, origin = 'http://localhost:5173') => call(handler, { data: { op: 'document', namespace, origin, request } });
  const key = { canvasId: 'storage-test', nodeId: 'node-1', attachmentId: 'a1', name: '研究方案.docx' };
  assert.equal((await canvasWorkspace(key.canvasId, namespace, 'http://localhost:5174')).status, 403);
  const external = path.join(temporary, 'workspaces', namespace, key.canvasId, 'external');
  for (const result of await Promise.all([canvasWorkspace(key.canvasId), canvasWorkspace(key.canvasId)])) {
    assert.equal(result.status, 200);
    assert.equal(result.data.dir, external);
  }
  assert.deepEqual(await readdir(external), []);
  const externalFile = path.join(external, 'outside-editor.txt');
  await writeFile(externalFile, 'owned by the external editor', { flag: 'wx' });
  const encoded = (s) => Buffer.from(s).toString('base64');
  const initial = { ...key, op: 'ensure', base64: encoded('first') };
  assert.equal((await document(initial, 'http://localhost:5174')).status, 403);
  const { data: file } = await document(initial);
  assert.deepEqual(await readdir(external), ['outside-editor.txt'], 'canvas attachments stay outside the external folder');
  assert.equal(path.basename(file.path), key.name);
  assert.equal(await readFile(file.path, 'utf8'), 'first');
  assert.equal((await document(initial)).data.revision, file.revision);
  const known = { ...key, knownRevision: file.revision };
  const probe = { op: 'probe', items: [known] };
  assert.deepEqual((await document(probe)).data, []);
  const preview = { baseRevision: file.revision, before: 'first', after: 'preview' };
  await writeFile(file.previewPath, JSON.stringify(preview));
  assert.deepEqual((await document(probe)).data[0].preview, preview);
  // Exercise the same normal file an unadapted editor would save.
  await writeFile(file.path, 'an external editor saved');
  const [change] = (await document(probe)).data;
  assert.equal(change.changed, true);
  assert.equal(change.preview, undefined);
  assert.equal((await document(initial)).data.base64, encoded('an external editor saved'));
  assert.equal((await document({ ...known, op: 'read' })).data.revision, change.revision);
  assert.equal((await document({ ...known, op: 'read', knownRevision: change.revision })).data.base64, undefined);
  assert.equal((await document({ ...initial, op: 'write', expectedRevision: file.revision })).data.conflict, true);
  const save = { ...key, op: 'write', expectedRevision: change.revision };
  const competing = await Promise.all(['A', 'B'].map(value => call(createBrowserStorage({ dataRoot: temporary }), {
    data: { op: 'document', namespace, origin: 'http://localhost:5173', request: { ...save, base64: encoded(value) } },
  })));
  assert.equal(competing.filter(({ data }) => data.conflict).length, 1);
  assert.notEqual((await document({ ...initial, nodeId: 'node-2' })).data.path, file.path);
  const { prepareManagedRun } = require('../runtime/managed-documents.cjs');
  const workspace = path.join(temporary, 'workspaces');
  const run = { cwd: temporary, managedFileDirs: [path.dirname(file.path)] };
  assert.deepEqual(await prepareManagedRun(workspace, run), run);
  for (const dir of [temporary, workspace, path.dirname(path.dirname(file.path))]) {
    await assert.rejects(prepareManagedRun(workspace, { ...run, managedFileDirs: [dir] }), /Invalid canvas file directory/);
  }
  const siblingCanvas = (await document({ ...initial, canvasId: 'other-canvas' })).data.path;
  assert.equal((await call(handler, { data: { op: 'document', protocol: 2, namespace, origin: local,
    request: { op: 'deleteCanvas', canvasId: key.canvasId } } })).status, 409);
  assert.deepEqual((await document({ op: 'deleteCanvas', canvasId: key.canvasId })).data, { removed: true });
  await assert.rejects(readFile(file.path), { code: 'ENOENT' });
  assert.equal(await readFile(externalFile, 'utf8'), 'owned by the external editor');
  assert.equal(await readFile(siblingCanvas, 'utf8'), 'first');
  assert.equal((await call(handler, { data: { op: 'keys', namespace: other, space: 'kv' } })).status, 409);
  assert.equal((await call(handler, { data: { op: 'create', namespace: other, origin: local } })).status, 409);
  assert.equal((await call(handler, { data: { op: 'set', namespace, protocol: 2, space: 'kv', key: metaKey, value: '{}' } })).status, 409);
  const sharedFolder = await call(handler, { data: { op: 'canvasWorkspace', canvasId: key.canvasId, namespace, origin: alternate },
    headers: { host: new URL(alternate).host, origin: alternate } });
  assert.equal(sharedFolder.data.dir, external);
  assert.equal(await readFile(path.join(sharedFolder.data.dir, 'outside-editor.txt'), 'utf8'), 'owned by the external editor');
  const third = '3d456789-4321-4321-8321-cba987654321';
  const stage = (op, props = {}) => call(handler, { data: { op, importId: third, origin: local, ...props } });
  assert.deepEqual((await stage('beginImport')).data, { alreadyMigrated: false });
  await stage('stageSet', { space: 'kv', key: 'dropped', value: 'stale' });
  await stage('stageSet', { space: 'settings', key: 'pref', value: encode('imported') });
  const finish = { keys: { kv: [], settings: ['pref'] } };
  assert.equal((await stage('finishImport', finish)).data.namespace, namespace);
  assert.equal((await stage('finishImport', finish)).data.alreadyMigrated, true);
  assert.equal((await call(handler, { data: { op: 'get', space: 'settings', key: 'pref', namespace } })).data.value, encode('imported'));

  const graphKey = 'thoughtdag:project:123';
  const attachmentKey = `att-content:${'文档'.repeat(90)}`;
  const graph = JSON.stringify({ state: { nodes: [{ data: { attachments: [{ contentInVault: true }] } }], edges: [] } });
  const docx = 'UEsDB' + 'Q'.repeat(1024 * 1024);
  for (const [key, value] of [[graphKey, graph], [attachmentKey, docx]]) {
    assert.equal((await call(handler, { data: { op: 'set', namespace, space: 'kv', key, value } })).status, 200);
    const read = await call(handler, { data: { op: 'get', namespace, space: 'kv', key } });
    assert.equal(read.data.value, value);
  }
  assert.deepEqual(new Set((await call(handler, { data: { op: 'keys', namespace, space: 'kv' } })).data.keys), new Set([metaKey, graphKey, attachmentKey]));
  assert.equal((await call(handler, { data: { op: 'get', namespace, space: 'settings', key: graphKey } })).data.found, false);
  const versions = ['revision-one', 'revision-two', 'revision-three'];
  await Promise.all(versions.map(value => call(handler, { data: { op: 'set', namespace, space: 'kv', key: graphKey, value } })));
  handler = createBrowserStorage({ dataRoot: temporary });
  const final = await call(handler, { data: { op: 'get', namespace, space: 'kv', key: graphKey } });
  assert.ok(versions.includes(final.data.value));
  const swapped = await Promise.all(['a', 'b'].map(value => call(createBrowserStorage({ dataRoot: temporary }), {
    data: { op: 'compareSet', namespace, space: 'kv', key: graphKey, expectedRevision: final.data.revision, value },
  })));
  assert.equal(swapped.filter(result => result.data.applied).length, 1, 'only one editor can save a graph at a given revision');
  const winner = swapped.findIndex(result => result.data.applied);
  const repeated = await call(handler, { data: { op: 'compareSet', namespace, space: 'kv', key: graphKey,
    expectedRevision: final.data.revision, value: ['a', 'b'][winner] } });
  assert.equal(repeated.data.applied, true, 'an identical edit is idempotent even if another window saved it first');
  assert.equal((await call(handler, { data: { op: 'delete', namespace, space: 'kv', key: attachmentKey } })).status, 200);
  assert.equal((await call(handler, { data: { op: 'get', namespace, space: 'kv', key: attachmentKey } })).data.found, false);
  assert.equal((await call(handler, { data: { op: 'set', namespace: '../bad', space: 'kv', key: 'x', value: 'x' } })).status, 400);
  const previousHome = process.env.THOUGHTDAG_HOME;
  process.env.THOUGHTDAG_HOME = temporary;
  const agents = require('../runtime/agents/http.cjs').createAgentsHttp();
  try {
    const agentPath = (route, body) => new Promise((resolve, reject) => {
      const req = { method: 'POST', url: '/api' + route };
      const res = { writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
      agents.handle(req, res, route, body).catch(reject);
    });
    const result = await agentPath('/agents/workspace', { canvasId: key.canvasId });
    assert.equal(result.status, 200);
    assert.equal(result.body.dir, path.join(temporary, 'workspaces', 'storage-test'));
    const codex = await agentPath('/agents/canvas-workspace', { canvasId: key.canvasId, namespace });
    assert.equal(codex.status, 200);
    assert.equal(codex.body.dir, external, 'the agent host resolves the same physical folder as disk storage');
    assert.equal(await readFile(path.join(codex.body.dir, 'outside-editor.txt'), 'utf8'), 'owned by the external editor');
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
  console.log('PASS local-only access, legacy consolidation, shared roots, verified browser imports, atomic writes and editor conflicts');
} finally {
  assert.ok(path.resolve(temporary).startsWith(`${parent}${path.sep}`));
  await rm(temporary, { recursive: true, force: true });
}
