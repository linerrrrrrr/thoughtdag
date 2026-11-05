// A version bump must remove old approval text from disk and vocabulary,
// including unchanged sources and a store containing only internal sessions.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Windows sandbox temp directories can reject replace-by-rename; the index
// deliberately uses that atomic write, so exercise it in the writable repo.
const dir = mkdtempSync(path.join(process.platform === 'win32' ? process.cwd() : tmpdir(), '.tmp-codex-index-'));
const home = path.join(dir, 'index');
const sessions = path.join(dir, 'sessions');
mkdirSync(home);
mkdirSync(sessions);
const envKeys = ['THOUGHTDAG_HOME', 'THOUGHTDAG_SESSION_ROOTS', 'THOUGHTDAG_MEMORY_ROOTS', 'THOUGHTDAG_CANVAS_ROOTS'];
const oldEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
Object.assign(process.env, {
  THOUGHTDAG_HOME: home, THOUGHTDAG_SESSION_ROOTS: sessions,
  THOUGHTDAG_MEMORY_ROOTS: '', THOUGHTDAG_CANVAS_ROOTS: path.join(dir, 'no-canvases'),
});
const sentinel = 'internalguardiansentinel';
const jsonFile = (name, value) => writeFileSync(path.join(home, name), JSON.stringify(value));
const rollout = (id, internal = false) => [
  { type: 'session_meta', payload: { id, cwd: dir, parent_thread_id: id === 'parent' ? undefined : 'parent', thread_source: internal ? 'guardian_review' : id === 'parent' ? 'user' : 'subagent' } },
  { type: 'turn_context', payload: { turn_id: `${id}-turn` } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: internal ? sentinel : `${id}visiblematerial` }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: internal ? '{"outcome":"deny"}' : 'An ordinary answer.' }] } },
].map((line) => JSON.stringify(line)).join('\n');
const files = ['parent', 'delegate', 'guardian'].map((id) => {
  const file = path.join(sessions, `${id}.jsonl`);
  writeFileSync(file, rollout(id, id === 'guardian'));
  return { id, file: realpathSync(file) };
});
const seedLegacy = (sources) => {
  const facts = {}, cache = {}, text = {}, lines = [];
  for (const { id, file } of sources) {
    const stat = statSync(file);
    const q = id === 'guardian' ? sentinel : `${id}visiblematerial`;
    facts[file] = { id, file, runner: 'codex', title: q, cwd: dir, workspace: dir, mtime: stat.mtimeMs, size: stat.size, turns: [{ i: 0, t: `${id}-turn`, q, ops: {} }] };
    cache[file] = { 0: { c: q } };
    text[file] = 1;
    lines.push(JSON.stringify({ k: file, i: 0, q, a: 'Legacy projection.' }));
  }
  jsonFile('fact-index.json', { version: 14, builtAt: new Date().toISOString(), sessions: facts, skipped: {}, names: {}, bundles: {} });
  jsonFile('interpretation-cache.json', { version: 14, sessions: cache });
  jsonFile('text-index.json', { version: 14, sessions: text });
  writeFileSync(path.join(home, 'text-index.jsonl'), lines.join('\n') + '\n');
};

try {
  const out = path.join(dir, 'library.mjs');
  await build({ entryPoints: ['cli/src/lib.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  const api = await import(pathToFileURL(out).href);
  api.setQuiet(true);
  seedLegacy(files);
  const originalStats = files.map(({ file }) => statSync(file).mtimeMs);
  const migrated = await api.buildIndex(false);
  assert.equal(migrated.parsed, 2);
  assert.equal(migrated.skipped, 1);
  assert.deepEqual(files.map(({ file }) => statSync(file).mtimeMs), originalStats, 'migration never rewrites original rollouts');
  for (const name of ['fact-index.json', 'interpretation-cache.json', 'text-index.json']) {
    const value = JSON.parse(readFileSync(path.join(home, name), 'utf8'));
    assert.equal(value.version, 15);
    assert.equal(Object.keys(value.sessions).length, 2);
    assert.ok(!value.sessions[files[2].file], `${name} excludes the guardian`);
  }
  assert.ok(!readFileSync(api.TEXT_LINES, 'utf8').includes(sentinel), 'old approval text is physically removed');
  assert.equal((await api.findJson(sentinel)).hits.length, 0);
  assert.equal((await api.suggestJson(sentinel)).known, 0, 'vocabulary cannot reveal old approval text');
  assert.equal((await api.findJson('parentvisiblematerial')).hits.length, 1);
  assert.equal((await api.findJson('delegatevisiblematerial')).hits.length, 1);
  const stable = await api.buildIndex(false);
  assert.equal(stable.kept, 2);
  assert.equal(stable.parsed, 0, 'subsequent indexing remains incremental');
  console.log('ok 1 - unchanged version 14 sources migrate; ordinary parent and child remain searchable');

  // A current-version source that becomes internal also loses all old rows.
  writeFileSync(files[1].file, rollout('delegate', true));
  const reclassified = await api.buildIndex(false);
  assert.equal(reclassified.removed, 1);
  assert.ok(!(await api.loadFacts()).sessions[files[1].file]);
  assert.ok(!readFileSync(api.TEXT_LINES, 'utf8').includes('delegatevisiblematerial'));
  assert.equal((await api.findJson('delegatevisiblematerial')).hits.length, 0);
  console.log('ok 2 - a source reclassified as internal removes its old facts, cache and text');

  // No new text exists to trigger an incremental rewrite in this case.
  unlinkSync(files[0].file);
  unlinkSync(files[1].file);
  seedLegacy([files[2]]);
  assert.equal((await api.suggestJson(sentinel)).known, 0, 'the first query can be a vocabulary lookup');
  const empty = await api.buildIndex(false);
  assert.equal(empty.parsed, 0);
  assert.equal(empty.skipped, 1);
  assert.deepEqual((await api.loadFacts()).sessions, {});
  assert.equal(readFileSync(api.TEXT_LINES, 'utf8'), '');
  assert.equal((await api.suggestJson(sentinel)).known, 0);
  console.log('ok 3 - an internal-only legacy index rewrites to an empty text file');
  console.log('PASS: 3 Codex index migration regressions');
} finally {
  for (const key of envKeys) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
  rmSync(dir, { recursive: true, force: true });
}
