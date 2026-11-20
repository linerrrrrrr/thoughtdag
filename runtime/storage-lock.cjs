'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

// Each contender owns a unique file, so recovering a crashed process can
// never unlink a successor's lock. Publish a ticket before entering and
// wait for earlier tickets (the Lamport bakery ordering).
async function contenders(dir) {
  const entries = await fs.readdir(dir);
  const active = [];
  for (const name of entries) {
    const match = /^(\d+)-([a-f\d-]{36})$/.exec(name);
    if (!match) continue;
    const file = path.join(dir, name);
    if (Number(match[1]) !== process.pid) {
      try { process.kill(Number(match[1]), 0); }
      catch (error) {
        if (error.code === 'ESRCH') {
          await fs.rm(file, { force: true });
          continue;
        }
        if (error.code !== 'EPERM') throw error;
      }
    }
    try { active.push({ name, ticket: Number(await fs.readFile(file, 'utf8')) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return active;
}

async function runWithTicket(root, action) {
  const dir = path.join(root, '.locks');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const name = process.pid + '-' + randomUUID();
  const file = path.join(dir, name);
  await fs.writeFile(file, '0', { flag: 'wx', mode: 0o600 });
  try {
    const present = await contenders(dir);
    const ticket = 1 + present.reduce((max, item) => Math.max(max, item.ticket), 0);
    await fs.writeFile(file, String(ticket));
    while ((await contenders(dir)).some(item => item.name !== name &&
      (!item.ticket || item.ticket < ticket || (item.ticket === ticket && item.name < name)))) {
      await delay(15);
    }
    return await action();
  } finally { await fs.rm(file, { force: true }); }
}

// A single outstanding filesystem ticket per root and process bounds disk
// work even when opening a library provisions many canvases in parallel.
const queues = new Map();
function withStorageLock(root, action) {
  const previous = queues.get(root) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => runWithTicket(root, action));
  queues.set(root, next);
  return next.finally(() => { if (queues.get(root) === next) queues.delete(root); });
}

module.exports = { withStorageLock };
