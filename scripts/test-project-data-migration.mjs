import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { migrateProjectData } from './migrate-project-data.mjs';

const parent = fileURLToPath(new URL('../local-tests/', import.meta.url));
await fs.mkdir(parent, { recursive: true });
const sandbox = await fs.mkdtemp(path.join(parent, 'project-data-migration-'));
const from = path.join(sandbox, 'old');
const to = path.join(sandbox, 'new');
async function put(root, name, value) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}

try {
  const ns = 'ba152143-55aa-444a-9c6f-adf911c2d5d8';
  const records = new Map([
    ['browser-storage/library.json', JSON.stringify({ version: 1, namespace: ns, sources: [] })],
    [`browser-storage/${ns}/manifest.json`, JSON.stringify({ version: 1, kind: 'library', ready: true })],
    [`browser-storage/${ns}/kv/k-YQ.json`, 'canvas record'],
    [`browser-storage/${ns}/settings/k-Yg.json`, 'setting record'],
    [`browser-storage/${ns}/canvas-files.json`, '[]'],
    [`workspaces/${ns}/canvas/external/source.bin`, Buffer.from([0, 255, 32])],
    ['workspaces/canvas/.thoughtdag/documents/a/b/c/原件.pdf', 'document'],
    ['canvases/abc.json', 'mirror'], ['config.json', '{}'], ['topics.json', '[]'], ['dossiers.json', '{}'],
  ]);
  for (const [name, value] of records) await put(from, name, value);
  await fs.mkdir(path.join(from, 'workspaces/empty'), { recursive: true });
  const ignored = ['browser-storage/.locks/1234-test', 'desktop-profile/Cookies', 'fact-index.json', 'tmp/private', 'index.lock'];
  for (const name of ignored) await put(from, name, 'local');
  await assert.rejects(migrateProjectData(from, path.join(from, 'target')), /separate/);
  const rejectedParent = path.join(from, 'nested');
  await assert.rejects(migrateProjectData(from, path.join(rejectedParent, 'subdir/data')), /separate/);
  const alias = path.join(sandbox, 'source-alias');
  await fs.symlink(from, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(migrateProjectData(from, path.join(alias, 'nested/subdir/data')), /separate/);
  await assert.rejects(fs.lstat(rejectedParent), { code: 'ENOENT' });

  const checkout = path.join(sandbox, 'fresh-checkout');
  await fs.mkdir(checkout);
  const newHome = path.join(checkout, 'local-data/missing/data');
  const clean = await migrateProjectData(from, newHome);
  assert.equal(clean.records, 2);
  assert.ok((await fs.stat(path.join(newHome, 'thoughtdag.sqlite'))).isFile());

  const busy = path.join(sandbox, 'existing');
  await put(busy, 'new-user-file', 'edited');
  await assert.rejects(migrateProjectData(from, busy), /already contains/);
  assert.equal(await fs.readFile(path.join(busy, 'new-user-file'), 'utf8'), 'edited');

  // Simulate interruption before the atomic publish and retry with an empty target.
  await put(sandbox, '.new-migration-interrupted/workspaces/file', 'partial');
  await fs.mkdir(to);
  const summary = await migrateProjectData(from, to);
  assert.equal(summary.files, records.size);
  assert.equal(summary.records, 2);
  assert.equal(summary.namespace, ns);
  const receipt = JSON.parse(await fs.readFile(path.join(to, '.thoughtdag-data-migration.json'), 'utf8'));
  assert.equal(receipt.records, summary.records);
  assert.match(summary.sha256, /^[a-f0-9]{64}$/);
  for (const [name, value] of records) {
    for (const root of [from, to]) assert.deepEqual(await fs.readFile(path.join(root, name)), Buffer.from(value));
  }
  for (const name of ignored) await assert.rejects(fs.lstat(path.join(to, name)), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(path.join(to, 'workspaces/empty')), []);

  // Completed migrations may be replayed after users modify or delete copied data.
  await put(to, 'topics.json', 'new edits');
  await fs.unlink(path.join(to, 'canvases/abc.json'));
  const database = path.join(to, 'thoughtdag.sqlite');
  const db = new DatabaseSync(database);
  try {
    assert.equal(db.prepare("SELECT value FROM records WHERE space = 'kv' AND key = 'a'").get().value, 'canvas record');
    db.exec("DELETE FROM records WHERE space = 'settings'");
  } finally { db.close(); }
  assert.deepEqual(await migrateProjectData(from, to), { alreadyMigrated: true, namespace: ns, records: 1 });
  assert.equal(await fs.readFile(path.join(to, 'topics.json'), 'utf8'), 'new edits');
  await assert.rejects(fs.lstat(path.join(to, 'canvases/abc.json')), { code: 'ENOENT' });
  await assert.rejects(migrateProjectData(busy, to), /already contains/);
  await assert.rejects(migrateProjectData(to, path.join(sandbox, 'again')), /already a SQLite/);
  await fs.unlink(database);
  await assert.rejects(migrateProjectData(from, to), /Missing project database/);
  await fs.writeFile(database, 'invalid');
  await assert.rejects(migrateProjectData(from, to), /not a database/);

  const linked = path.join(from, 'workspaces/external-link');
  await fs.symlink(busy, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(migrateProjectData(from, path.join(sandbox, 'unsafe')), /link or special file/);
  console.log('Project data migration checks passed');
} finally {
  if (path.dirname(sandbox) === path.resolve(parent)) await fs.rm(sandbox, { recursive: true, force: true });
}
