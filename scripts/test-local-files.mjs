import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLocalFiles, nativePath } = require('../runtime/local-files.cjs');
const compiled = await build({ entryPoints: ['src/lib/local-target.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const { localTargetOf, safeMarkdownUrl, basenameOf } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

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
console.log('PASS local references preserve cwd, Windows paths, Unicode, and source locations; unsafe schemes rejected');

const dir = await mkdtemp(path.join(tmpdir(), 'td-local-files-'));
try {
  const source = path.join(dir, 'sample.ps1');
  const image = path.join(dir, 'sample.png');
  await writeFile(source, 'one\ntwo\nthree\n');
  await writeFile(image, Buffer.from([137, 80, 78, 71, 0, 255]));
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
} finally {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
  assert.ok(path.basename(dir).startsWith('td-local-files-'));
  await rm(dir, { recursive: true, force: true });
}
