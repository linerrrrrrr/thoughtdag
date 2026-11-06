// Offline filesystem and runtime discovery regressions. No CLI is launched.
// --baseline runs the same assertions against HEAD to show the pre-fix failures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const baseline = process.argv.includes('--baseline');
const win = path.win32;
const source = (relative) => baseline
  ? execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, encoding: 'utf8' })
  : readFileSync(path.join(root, relative), 'utf8');
const codedError = (code, candidate) => Object.assign(new Error(`${code}: ${candidate}`), { code, path: candidate });

function fixture() {
  const entries = new Map();
  const accessCalls = [];
  const spawns = [];
  const modules = new Map();
  const env = { PATH: 'C:\\tools', APPDATA: 'C:\\user\\AppData\\Roaming' };
  const key = (candidate) => win.normalize(candidate).toLowerCase();
  const entry = (candidate) => {
    const found = entries.get(key(candidate));
    if (!found) throw codedError('ENOENT', candidate);
    if (Object.hasOwn(found, 'exception')) throw found.exception;
    if (found.error) throw codedError(found.error, candidate);
    return found;
  };
  let gate = null;
  const fs = {
    constants: { F_OK: 0, X_OK: 1 },
    existsSync: (candidate) => entries.has(key(candidate)),
    readdirSync(candidate) { return entry(candidate).children ?? []; },
    promises: {
      async access(candidate) {
        accessCalls.push(key(candidate));
        if (gate) await gate;
        entry(candidate);
      },
      async stat(candidate) {
        const found = entry(candidate);
        if (found.statError) throw codedError(found.statError, candidate);
        return { isFile: () => found.kind !== 'directory' };
      },
      async readFile(candidate) { throw codedError('ENOENT', candidate); },
    },
  };
  const spawn = (binary, args) => {
    spawns.push({ binary, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('exit', 0);
    child.stdin = { write(line) {
      const request = JSON.parse(line);
      if (!request.id) return true;
      assert.ok(['initialize', 'model/list'].includes(request.method), 'catalog discovery must not start an inference turn');
      const result = request.method === 'model/list'
        ? { data: [{ id: 'test-model', model: 'test-model', displayName: 'Fixture model', isDefault: true, supportedReasoningEfforts: [] }] }
        : {};
      queueMicrotask(() => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result }) + '\n')));
      return true;
    } };
    return child;
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} };
    modules.set(relative, module);
    const filename = path.join(root, relative);
    vm.runInNewContext(source(relative), {
      module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
      Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
      process: { platform: 'win32', env, execPath: 'C:\\node\\node.exe' },
      require(name) {
        if (name === 'node:fs') return fs;
        if (name === 'node:path') return win;
        if (name === 'node:os') return { homedir: () => 'C:\\user' };
        if (name === 'node:child_process') return {
          spawn,
          execFile() { throw new Error('Discovery must not execute a shell or CLI in these fixtures'); },
        };
        if (name === './where.cjs') return load('runtime/agents/where.cjs');
        if (name === './fs-diff.cjs') return {};
        return require(name);
      },
    }, { filename });
    return module.exports;
  }
  return {
    env, accessCalls, spawns, load,
    put(candidate, value = {}) { entries.set(key(candidate), value); },
    remove(candidate) { entries.delete(key(candidate)); },
    hold() { return new Promise((resolve) => { gate = new Promise((release) => resolve(() => { gate = null; release(); })); }); },
    where: () => load('runtime/agents/where.cjs'),
  };
}

let passed = 0;
let failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log(`ok - ${name}`); }
  catch (error) { failed++; console.error(`not ok - ${name}\n  ${error.message}`); }
}

await check('Windows npm shims are found without npm on PATH', async () => {
  const f = fixture();
  const binary = 'C:\\user\\AppData\\Roaming\\npm\\codex.cmd';
  f.put(binary);
  assert.equal((await f.where().locate('codex')).path, binary);
  assert.equal(f.spawns.length, 0);
});

await check('missing files remain an ordinary not-installed result', async () => {
  const f = fixture();
  const result = await f.where().locate('codex');
  assert.equal(result.path, null);
  assert.equal(result.error, undefined);
  assert.equal(result.failures?.length ?? 0, 0);
});

for (const code of ['EACCES', 'EPERM', 'ERR_ACCESS_DENIED']) {
  await check(`${code} retains the failing path and reason`, async () => {
    const f = fixture();
    const binary = 'C:\\tools\\codex.cmd';
    f.put(binary, { error: code });
    const result = await f.where().locate('codex');
    assert.equal(result.path, null);
    assert.ok(result.failures?.some((failure) => failure.path === binary && failure.code === code));
    assert.ok(result.error?.includes(code) && result.error.includes(binary));
  });
}

for (const exception of [new TypeError('Unexpected filesystem failure'), 'Filesystem probe rejected']) {
  await check('unexpected errors retain their original explanation', async () => {
    const f = fixture();
    const binary = 'C:\\tools\\codex.cmd';
    const message = typeof exception === 'string' ? exception : exception.message;
    f.put(binary, { exception });
    const result = await f.where().locate('codex');
    assert.equal(result.path, null);
    assert.ok(result.failures?.some((failure) => failure.path === binary && failure.code === 'UNKNOWN' && failure.message === message));
    assert.ok(result.error?.includes(message));
  });
}

await check('an inaccessible candidate does not hide a later usable installation', async () => {
  const f = fixture();
  f.env.PATH = 'C:\\blocked;C:\\working';
  f.put('C:\\blocked\\codex.cmd', { error: 'EACCES' });
  f.put('C:\\working\\codex.exe');
  const result = await f.where().locate('codex');
  assert.equal(result.path, 'C:\\working\\codex.exe');
  assert.equal(result.error, undefined);
  assert.ok(result.failures?.some((failure) => failure.code === 'EACCES'));
});

await check('a same-named directory is not an executable', async () => {
  const f = fixture();
  f.put('C:\\tools\\codex.cmd', { kind: 'directory' });
  f.put('C:\\tools\\codex.exe');
  assert.equal((await f.where().locate('codex')).path, 'C:\\tools\\codex.exe');
});

await check('metadata access failures are preserved too', async () => {
  const f = fixture();
  f.put('C:\\tools\\codex.cmd', { statError: 'EPERM' });
  const result = await f.where().locate('codex');
  assert.equal(result.path, null);
  assert.ok(result.failures?.some((failure) => failure.code === 'EPERM'));
});

await check('inaccessible version-manager directories remain diagnosable', async () => {
  const f = fixture();
  f.put('C:\\user\\.nvm\\versions\\node', { error: 'EACCES' });
  const result = await f.where().locate('codex');
  assert.ok(result.failures?.some((failure) => failure.path === 'C:\\user\\.nvm\\versions\\node' && failure.code === 'EACCES'));
});

const runtimes = [
  ['codex', 'createCodexRuntime'],
  ['pi', 'createPiRuntime'],
  ['claude', 'createClaudeRuntime'],
];
for (const [name, factory] of runtimes) {
  await check(`${name}: a missing catalog uses one consistent filesystem probe`, async () => {
    const f = fixture();
    const runtime = f.load(`runtime/agents/${name}.cjs`)[factory]();
    try {
      assert.equal((await runtime.models()).installed, false);
      assert.equal(f.accessCalls.filter((candidate) => candidate === `c:\\tools\\${name}.cmd`).length, 1);
    } finally { runtime.shutdown(); }
  });

  await check(`${name}: the first recheck sees an installation after a missing catalog`, async () => {
    const f = fixture();
    const runtime = f.load(`runtime/agents/${name}.cjs`)[factory]();
    try {
      assert.equal((await runtime.models()).installed, false);
      f.put(`C:\\tools\\${name}.exe`);
      assert.equal(await runtime.available(), `C:\\tools\\${name}.exe`);
    } finally { runtime.shutdown(); }
  });

  await check(`${name}: catalog failure reports permission diagnostics`, async () => {
    const f = fixture();
    f.put(`C:\\tools\\${name}.cmd`, { error: 'EACCES' });
    const runtime = f.load(`runtime/agents/${name}.cjs`)[factory]();
    try {
      const result = await runtime.models();
      assert.equal(result.installed, false);
      assert.ok(result.error?.includes('EACCES'));
      assert.ok(result.failures?.some((failure) => failure.path === `C:\\tools\\${name}.cmd`));
      assert.equal(f.spawns.length, 0);
    } finally { runtime.shutdown(); }
  });

  await check(`${name}: moved installations are found without restarting the host`, async () => {
    const f = fixture();
    const first = `C:\\tools\\${name}.cmd`;
    const next = `C:\\tools\\${name}.exe`;
    f.put(first);
    const runtime = f.load(`runtime/agents/${name}.cjs`)[factory]();
    try {
      assert.equal(await runtime.available(), first);
      f.remove(first);
      f.put(next);
      assert.equal(await runtime.available(), next);
    } finally { runtime.shutdown(); }
  });
}

await check('simultaneous rechecks share one scan, while the next request rechecks', async () => {
  const f = fixture();
  f.put('C:\\tools\\codex.cmd');
  const runtime = f.load('runtime/agents/codex.cjs').createCodexRuntime();
  try {
    const release = await f.hold();
    const first = runtime.available();
    const second = runtime.available();
    release();
    assert.deepEqual(await Promise.all([first, second]), ['C:\\tools\\codex.cmd', 'C:\\tools\\codex.cmd']);
    assert.equal(f.accessCalls.filter((candidate) => candidate === 'c:\\tools\\codex.cmd').length, 1);
    await runtime.available();
    assert.equal(f.accessCalls.filter((candidate) => candidate === 'c:\\tools\\codex.cmd').length, 2);
  } finally { runtime.shutdown(); }
});

await check('the first model retry after access recovers starts only a catalog query', async () => {
  const f = fixture();
  const binary = 'C:\\tools\\codex.exe';
  f.put(binary, { error: 'EACCES' });
  const runtime = f.load('runtime/agents/codex.cjs').createCodexRuntime();
  try {
    assert.equal((await runtime.models()).installed, false);
    f.put(binary);
    const result = await runtime.models();
    assert.equal(result.installed, true);
    assert.equal(result.default, 'codex/test-model');
    assert.equal(f.spawns.length, 1);
    assert.equal(f.spawns[0].binary, binary);
  } finally { runtime.shutdown(); }
});

console.log(`\n${passed} passed, ${failed} failed${baseline ? ' (HEAD baseline)' : ''}.`);
if (failed) process.exitCode = 1;
