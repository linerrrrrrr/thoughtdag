import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { createLocalFiles, nativePath } = require('../runtime/local-files.cjs');
const compiled = await build({ entryPoints: ['src/lib/local-target.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const { localTargetOf, localFileHref, safeMarkdownUrl, basenameOf } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

assert.deepEqual(localTargetOf('C:\\work\\file.ts:12:4'), { path: 'C:/work/file.ts', line: 12, column: 4 });
assert.deepEqual(localTargetOf('/C:/work/中文 文件.ts#L8'), { path: 'C:/work/中文 文件.ts', line: 8 });
assert.deepEqual(localTargetOf('file:///D:/work/file.ts#L9C3'), { path: 'D:/work/file.ts', line: 9, column: 3 });
assert.deepEqual(localTargetOf('./src/../hello.ts:3', 'D:\\work\\app'), { path: 'D:/work/app/hello.ts', line: 3 });
assert.deepEqual(localTargetOf('../hello.ts#L4-L9', '/home/work/app'), { path: '/home/work/hello.ts', line: 4 });
assert.equal(basenameOf('C:\\work\\hello.ts'), 'hello.ts');
for (const value of ['https://example.com/a.ts', 'mailto:a@b.test', '//server/share', 'file://server/share', 'javascript:alert(1)', 'data:text/html,a', '\\\\server\\share', 'C:/x\u0000']) assert.equal(localTargetOf(value), null, value);
assert.equal(localTargetOf('src/file.ts'), null);
assert.equal(safeMarkdownUrl('javascript:alert(1)'), '');
assert.equal(safeMarkdownUrl('command:anything'), '');
for (const target of [{ path: 'C:/work/中文 文件.pdf' }, { path: '/tmp/100% #done?.txt', line: 12, column: 4 }, { path: '~/docs/a.pdf' }]) {
  assert.deepEqual(localTargetOf(localFileHref(target)), target);
}
assert.match(localFileHref({ path: 'C:/work/a.zip' }), /^file:\/\/\/C:\//);
console.log('PASS local references preserve cwd, Windows paths, Unicode, and source locations; unsafe schemes rejected');

const dir = await mkdtemp(path.join(tmpdir(), 'td-local-files-'));
try {
  const source = path.join(dir, 'sample.ps1');
  const image = path.join(dir, 'sample.png');
  const archive = path.join(dir, '中文 文件.zip');
  const pdf = path.join(dir, 'ascii.pdf');
  await writeFile(source, 'one\ntwo\nthree\n');
  await writeFile(image, Buffer.from([137, 80, 78, 71, 0, 255]));
  await writeFile(archive, Buffer.from([80, 75, 3, 4, 0]));
  await writeFile(pdf, '%PDF-1.4\nASCII-only document');
  const launched = [], revealed = [];
  const files = createLocalFiles({ shell: { openPath: async p => { launched.push(p); return ''; }, showItemInFolder: p => revealed.push(p) } });
  assert.deepEqual(await files.read(source), { ok: true, text: 'one\ntwo\nthree\n', truncated: false });
  assert.equal((await files.read(image)).reason, 'not-text');
  assert.equal((await files.read(path.join(dir, 'missing'))).reason, 'missing');
  await files.open(source);
  assert.equal(launched.length, 0, 'script link cannot execute');
  assert.deepEqual(revealed, [source]);
  await files.open(image);
  assert.deepEqual(launched, [image]);
  assert.equal((await files.read(pdf)).reason, 'not-text');
  assert.equal((await files.read(archive)).reason, 'not-text');
  await files.open(pdf);
  await files.open(archive);
  assert.deepEqual(launched, [image, pdf, archive]);
  assert.deepEqual(revealed, [source], 'Archives and documents use their viewer; scripts are only revealed');
  assert.match(await files.image(image), /^data:image\/png;base64,/);
  await writeFile(source, 'x'.repeat(1024 * 1024 + 10));
  assert.equal((await files.read(source)).text.length, 1024 * 1024);
  assert.equal((await files.read(source)).truncated, true);
  for (const value of ['relative/path', '//server/share', '\\\\server\\share', 'file:///tmp/x', 'C:/x\u0000']) assert.equal(nativePath(value), null, value);
  console.log('PASS bounded text preview, binary fallback, missing files, and executable-file reveal');
  const request = async (origin, method = 'POST', type = 'application/json') => {
    let status, result;
    const handled = await files.handle({ method, headers: { origin, host: 'localhost:3001', 'content-type': type } }, { writeHead(code) { status = code; }, end(body) { result = JSON.parse(body); } }, '/local/read', { path: source });
    return { handled, status, result };
  };
  assert.equal((await request('https://evil.example')).status, 403);
  assert.equal((await request('http://localhost:5173')).status, 200);
  assert.equal((await request('http://localhost:5173', 'GET')).status, 405);
  assert.equal((await request('http://localhost:5173', 'POST', 'text/plain')).status, 405);
  console.log('PASS file HTTP endpoints require JSON POST from a trusted origin');

  // Exercise the Windows branch without opening viewers on a test runner.
  const calls = [];
  let launchError = false;
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../runtime/local-files.cjs', import.meta.url), 'utf8'), {
    module, Buffer, TextDecoder, process: { platform: 'win32', env: {} },
    require: name => name === 'node:path' ? path.win32 : name === 'node:fs/promises' ? { stat: async () => ({ isDirectory: () => false }) } : name !== 'node:child_process' ? require(name) : {
      spawn(command, args, options) {
        calls.push({ command, args, options });
        const child = new EventEmitter();
        queueMicrotask(() => launchError ? child.emit('error', new Error('Shell unavailable')) : child.emit('exit', 0));
        return child;
      },
    },
  });
  const windows = module.exports.createLocalFiles();
  const tricky = 'C:\\work\\中文 [a], $(test) `quoted` file.zip';
  assert.equal((await windows.open(tricky)).ok, true);
  assert.equal((await windows.reveal(tricky)).ok, true);
  assert.deepEqual(calls.map(call => call.options.env.THOUGHTDAG_LOCAL_SELECT), ['0', '1']);
  for (const call of calls) {
    assert.equal(call.command, 'powershell.exe');
    assert.equal(call.options.env.THOUGHTDAG_LOCAL_PATH, tricky, 'Path travels as data, never command text');
    assert.equal(call.options.shell, false);
    const script = call.args.at(-1);
    assert.ok(!script.includes(tricky));
    assert.match(script, /UseShellExecute = \$true/);
    assert.doesNotMatch(script, /WaitForExit|-Wait/);
  }
  launchError = true;
  assert.equal((await windows.open(tricky)).reason, 'error', 'Failed shell launches still report failure');
  console.log('PASS Windows shell handoff does not wait on Explorer and preserves literal paths; launch failures remain visible');
} finally {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
  assert.ok(path.basename(dir).startsWith('td-local-files-'));
  await rm(dir, { recursive: true, force: true });
}
