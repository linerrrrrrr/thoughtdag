// Run with the old and new hosts stopped. Only publish a fully verified data tree.
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { initializeProjectDatabase } from '../runtime/browser-storage.cjs';

const businessEntries = ['browser-storage', 'canvases', 'config.json', 'dossiers.json', 'topics.json', 'workspaces'];
const receiptName = '.thoughtdag-data-migration.json';

async function optionalStat(file) {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(root) {
  const entries = [];
  async function visit(relative) {
    const file = path.join(root, relative);
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) {
      entries.push({ relative, type: 'directory' });
      for (const child of (await fs.readdir(file)).sort()) {
        if (relative === 'browser-storage' && child === '.locks') continue;
        await visit(path.join(relative, child));
      }
    } else if (stat.isFile()) {
      entries.push({ relative, type: 'file', bytes: stat.size, hash: await digest(file) });
    } else {
      throw new Error(`Review this link or special file before migration: ${file}`);
    }
  }
  for (const name of businessEntries) {
    if (await optionalStat(path.join(root, name))) await visit(name);
  }
  return entries;
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function requireSeparateTrees(source, target) {
  if (within(source, target) || within(target, source)) throw new Error('Use separate source and destination trees');
}

async function resolveTarget(targetPath, source) {
  const parent = path.dirname(targetPath);
  let existing = parent;
  while (!(await optionalStat(existing))) {
    const next = path.dirname(existing);
    if (next === existing) throw new Error(`Missing destination volume: ${existing}`);
    existing = next;
  }
  const base = await fs.realpath(existing);
  const target = path.join(base, path.relative(existing, targetPath));
  requireSeparateTrees(source, target);
  return target;
}

async function verifyDatabase(home, namespace) {
  const file = path.join(home, 'thoughtdag.sqlite');
  if (!(await optionalStat(file))?.isFile()) throw new Error(`Missing project database: ${file}`);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('PRAGMA quick_check').all();
    if (rows.length !== 1 || rows[0].quick_check !== 'ok') throw new Error('SQLite integrity check failed');
    const state = db.prepare('SELECT state FROM library WHERE id = 1').get();
    if (!state || JSON.parse(state.state).namespace !== namespace) throw new Error('Project database namespace does not match the migration');
    return db.prepare('SELECT count(*) AS records FROM records').get().records;
  } finally { db.close(); }
}

async function destinationState(destination, source) {
  const stat = await optionalStat(destination);
  if (!stat) return 'missing';
  if (!stat.isDirectory()) throw new Error(`Expected a directory: ${destination}`);
  if (!(await fs.readdir(destination)).length) return 'empty';
  const receipt = path.join(destination, receiptName);
  if ((await optionalStat(receipt))?.isFile()) {
    const info = JSON.parse(await fs.readFile(receipt, 'utf8'));
    if (info.version === 1 && typeof info.source === 'string' && path.relative(info.source, source) === '') {
      const records = await verifyDatabase(destination, info.namespace);
      return { alreadyMigrated: true, namespace: info.namespace, records };
    }
  }
  throw new Error(`Destination already contains data: ${destination}`);
}

export async function migrateProjectData(sourceHome, targetHome) {
  const source = await fs.realpath(sourceHome);
  const targetPath = path.resolve(targetHome);
  requireSeparateTrees(path.resolve(sourceHome), targetPath);
  const target = await resolveTarget(targetPath, source);
  const parent = path.dirname(target);
  const initial = await destinationState(target, source);
  if (initial.alreadyMigrated) return initial;
  async function checkLegacySource() {
    const names = await fs.readdir(source);
    if (names.some(name => name === receiptName || /^thoughtdag\.sqlite(?:-|$)/i.test(name))) {
      throw new Error('Source is already a SQLite project. Copy or back up the complete stopped project instead of importing legacy records');
    }
  }
  await checkLegacySource();

  // A terminated process can leave a staging directory beside the target. A retry
  // starts a fresh snapshot and never exposes or reuses partially copied files.
  const before = await inventory(source);
  if (!before.length) throw new Error(`No project data found in ${source}`);
  const expected = JSON.stringify(before);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  if (path.relative(parent, await fs.realpath(parent)) !== '') throw new Error('Destination parent changed during migration');
  const stage = await fs.mkdtemp(path.join(parent, `.${path.basename(target)}-migration-`));
  let published = false;
  try {
    for (const entry of before) {
      const from = path.join(source, entry.relative);
      const to = path.join(stage, entry.relative);
      if (entry.type === 'directory') await fs.mkdir(to, { mode: 0o700 });
      else {
        await fs.copyFile(from, to, constants.COPYFILE_EXCL);
        const stat = await fs.stat(from);
        await fs.utimes(to, stat.atime, stat.mtime);
      }
    }
    if (JSON.stringify(await inventory(stage)) !== expected) throw new Error('Copied files failed SHA-256 verification');
    const { namespace, records } = await initializeProjectDatabase(stage);
    if (await verifyDatabase(stage, namespace) !== records) throw new Error('Published record count does not match import');
    await checkLegacySource();
    if (JSON.stringify(await inventory(source)) !== expected) throw new Error('Source changed during migration. Stop writers and retry');
    const files = before.filter(entry => entry.type === 'file');
    const summary = { namespace, records, files: files.length, bytes: files.reduce((total, entry) => total + entry.bytes, 0),
      sha256: createHash('sha256').update(expected).digest('hex') };
    await fs.writeFile(path.join(stage, receiptName), JSON.stringify({ version: 1, source, ...summary }), { flag: 'wx', mode: 0o600 });

    const state = await destinationState(target, source);
    if (state.alreadyMigrated) return state;
    if (state === 'empty') await fs.rmdir(target);
    await fs.rename(stage, target);
    published = true;
    return summary;
  } finally {
    if (!published && path.dirname(stage) === parent) await fs.rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/migrate-project-data.mjs <old-home> <new-home>');
    console.log(JSON.stringify(await migrateProjectData(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
