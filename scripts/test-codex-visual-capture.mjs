import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import visuals from '../runtime/codex-visual.cjs';
import localFiles from '../runtime/local-files.cjs';

const fixtureRoot = fileURLToPath(new URL('../local-tests/', import.meta.url));
await mkdir(fixtureRoot, { recursive: true });
const root = await mkdtemp(path.join(fixtureRoot, 'td-visual-capture-'));
const home = path.join(root, 'codex');
const workspace = path.join(root, 'workspace');
const id = randomUUID();
const reference = file => '\uE200visualize\uE202' + JSON.stringify({ path: file }) + '\uE201';
const capture = file => visuals.readCodexVisual({ threadId: id, path: file }, home);
const message = (text, role = 'assistant', phase = 'final_answer') => ({
  type: 'response_item', payload: { type: 'message', role, phase, content: [{ type: 'output_text', text }] },
});
const rolloutDir = path.join(home, 'sessions', '2026', '11', '22');
const rollout = path.join(rolloutDir, 'rollout-2026-11-22T12-00-00-' + id + '.jsonl');
const draft = path.join(workspace, 'draft.html');
const outside = path.join(root, 'outside', 'private.html');
const redirected = path.join(workspace, 'redirect', 'private.html');
const hardlinked = path.join(workspace, 'linked.html');
const official = path.join(home, 'visualizations', '2026', '11', '22', id, '交互 演示.html');
const wrongThread = path.join(home, 'visualizations', randomUUID(), 'other.html');
const fragment = '<input type="range"><script>document.body.dataset.result="$&"</script>';

try {
  for (const dir of [rolloutDir, workspace, path.dirname(official), path.dirname(outside), path.dirname(wrongThread)])
    await mkdir(dir, { recursive: true });
  for (const file of [draft, official, outside, wrongThread]) await writeFile(file, fragment);
  await symlink(path.dirname(outside), path.dirname(redirected), process.platform === 'win32' ? 'junction' : 'dir');
  await link(outside, hardlinked);
  const header = { type: 'session_meta', payload: { id, cwd: workspace } };
  const messages = [
    header, message(reference(draft), 'user'), message(reference(draft), 'assistant', 'commentary'),
    message(['```text', reference(draft), '```'].join('\n')),
    message([official, outside, wrongThread, redirected, hardlinked].map(reference).join('\n')),
  ];
  const save = () => writeFile(rollout, messages.map(m => JSON.stringify(m)).join('\n'));
  await save();
  assert.match(await capture(official), /<input type="range">/);
  assert.ok((await capture(official)).includes(fragment));
  for (const file of [draft, outside, wrongThread, redirected, hardlinked]) assert.equal(await capture(file), null, file);
  assert.equal(await visuals.readCodexVisual({ path: official, threadId: '../escape' }, home), null);
  console.log('PASS only local assistant references in the correct thread and authorized directories can load');

  const previousHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = home;
    const host = localFiles.createLocalFiles();
    async function request(origin, method = 'POST', contentType = 'application/json', file = official) {
      let status, data;
      await host.handle({ method, headers: { origin, host: 'localhost:3001', 'content-type': contentType } }, {
        writeHead(code) { status = code; }, end(body) { data = JSON.parse(body); },
      }, '/local/codex-visual', { path: file, threadId: id, cwd: path.dirname(file) });
      return { status, data };
    }
    assert.equal((await request('https://elsewhere.invalid')).status, 403);
    assert.equal((await request('null')).status, 403);
    assert.equal((await request('http://localhost:5173', 'GET')).status, 405);
    assert.equal((await request('http://localhost:5173', 'POST', 'text/plain')).status, 405);
    assert.ok((await request('http://localhost:5173')).data.includes(fragment));
    assert.equal((await request('http://localhost:5173', 'POST', 'application/json', outside)).data, null);
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
  }
  console.log('PASS isolated frames and untrusted origins cannot request capture; HTTP ignores client-supplied roots');

  const assets = path.join(home, 'plugins', 'cache', 'openai-curated-remote', 'visualize', '1.2.0', 'skills', 'visualize', 'assets');
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, 'visualize.css'), '.local-visual{}');
  await writeFile(path.join(assets, 'visualize.html'), '<main><!--__INLINE_VISUALIZATION_FRAGMENT__--></main>');
  await writeFile(path.join(assets, 'standalone-host-bridge.js'), 'window.openai={};');
  messages.push(message(reference(draft)));
  await save();
  const html = await capture(draft);
  assert.ok(html.includes('<main>' + fragment + '</main>'));
  assert.ok(html.includes('.local-visual{}') && html.includes('window.openai={}'));
  await writeFile(draft, Buffer.from([0xff]));
  assert.equal(await capture(draft), null);
  await writeFile(draft, Buffer.alloc(1_000_001, 97));
  assert.equal(await capture(draft), null);
  await writeFile(draft, '<!doctype html><html lang="zh"></html>');
  await mkdir(path.join(home, 'archived_sessions'));
  await rename(rollout, path.join(home, 'archived_sessions', path.basename(rollout)));
  assert.equal(await capture(draft), '<!doctype html><html lang="zh"></html>');
  console.log('PASS captured original markup and installed visual assets; archived records, file limits and cache invalidation');
  // Both distributions copy runtime/ recursively. Exercise mixed CJS + ESM
  // imports after relocation, without relying on this checkout's module cache.
  const packagedRuntime = path.join(root, 'payload', 'runtime');
  await cp(new URL('../runtime/', import.meta.url), packagedRuntime, { recursive: true });
  const packaged = createRequire(import.meta.url)(path.join(packagedRuntime, 'codex-visual.cjs'));
  assert.equal(await packaged.readCodexVisual({ path: draft, threadId: id }, home), await capture(draft));
  console.log('PASS capture uses the bundled parser from a relocated desktop/harness runtime');
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(fixtureRoot));
  assert.ok(path.basename(root).startsWith('td-visual-capture-'));
  await rm(root, { recursive: true, force: true });
}
