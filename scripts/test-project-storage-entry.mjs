import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile, normalizePath } from 'vite';
import { projectStorage } from '../runtime/project-storage.cjs';
import { createTestServer } from './fixtures/vite-test-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, 'local-tests');
await mkdir(scratch, { recursive: true });
const fixture = await mkdtemp(path.join(scratch, 'storage-entry-'));
let server;
try {
  const projectHome = path.join(fixture, 'local-data', 'data');
  assert.deepEqual(projectStorage(fixture, {}), { dataRoot: projectHome, database: true });
  assert.deepEqual(projectStorage(fixture, { THOUGHTDAG_HOME: projectHome, THOUGHTDAG_DISK_STORAGE: '1' }),
    { dataRoot: projectHome, database: true });
  assert.equal(projectStorage(fixture, { THOUGHTDAG_DISK_STORAGE: '0' }), null);
  assert.equal(projectStorage(fixture, {}, false), null);
  assert.throws(() => projectStorage(fixture, { THOUGHTDAG_HOME: 'relative' }), /absolute/);

  // Load the build configuration from a checkout without machine-specific .env files.
  delete process.env.THOUGHTDAG_DISK_STORAGE;
  delete process.env.THOUGHTDAG_HOME;
  const configFile = path.join(fixture, 'vite.config.ts');
  await copyFile(path.join(root, 'vite.config.ts'), configFile);
  await symlink(path.join(root, 'scripts'), path.join(fixture, 'scripts'), 'junction');
  await symlink(path.join(root, 'runtime'), path.join(fixture, 'runtime'), 'junction');
  const built = await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile);
  assert.equal(built.config.define.__THOUGHTDAG_DISK_STORAGE_REQUIRED__, 'false');

  const isolated = projectHome;
  const assets = path.join(fixture, 'public');
  await mkdir(isolated, { recursive: true });
  await mkdir(assets);
  await writeFile(path.join(isolated, 'record.txt'), 'private fixture');
  await writeFile(path.join(assets, 'visible.txt'), 'public fixture');
  await symlink(isolated, path.join(assets, 'linked'), 'junction');
  server = await createTestServer({
    configFile, mode: 'development', publicDir: assets, logLevel: 'silent', server: { watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const endpoint = new URL('/__thoughtdag_storage', origin);
  const headers = { 'x-thoughtdag-storage': '1', 'content-type': 'application/json' };
  const service = await fetch(endpoint, { headers });
  assert.equal((await service.json()).engine, 'sqlite');
  const connected = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ op: 'connect', origin: endpoint.origin }) });
  assert.equal(connected.status, 200);
  assert.equal((await readFile(path.join(isolated, 'thoughtdag.sqlite'))).toString('ascii', 0, 15), 'SQLite format 3');
  assert.equal(await (await fetch(new URL('/visible.txt', origin))).text(), 'public fixture');
  const direct = '/' + normalizePath(path.relative(root, path.join(isolated, 'record.txt')));
  for (const url of [direct, direct + '?raw', '/@fs/' + normalizePath(path.join(isolated, 'record.txt')), '/linked/record.txt']) {
    assert.equal((await fetch(new URL(url, origin))).status, 403);
  }
  console.log('PASS project storage selection, static build and private directory handling');
} finally {
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}
