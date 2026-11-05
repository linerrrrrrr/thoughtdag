#!/usr/bin/env node
// Opt-in live smoke: one bounded native turn, reading one disposable fixture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = resolve(root, 'local-tests', 'codex-live');
const cwd = join(base, new Date().toISOString().replace(/[:.]/g, '-'));
assert.ok(cwd.startsWith(base + '\\') || cwd.startsWith(base + '/'));
await mkdir(cwd, { recursive: true });
const marker = 'THOUGHTDAG_NATIVE_WORKFLOW_VERIFIED';
await writeFile(join(cwd, 'marker.txt'), marker + '\n', 'utf8');
const { createCodexRuntime } = createRequire(import.meta.url)('../runtime/agents/codex.cjs');
const runtime = createCodexRuntime({ log() {} });
const items = new Map();
let session = false;
let text = '';
let runId;
let timer;
const started = Date.now();
try {
  const ended = new Promise((resolveTurn, rejectTurn) => {
    timer = setTimeout(() => { if (runId) runtime.abort(runId); runtime.shutdown(); rejectTurn(new Error('The one live verification turn exceeded 90 seconds.')); }, 90000);
    void runtime.run({ runtime: 'codex', cwd,
      prompt: 'This is a bounded integration verification. Use one command to read only marker.txt in the current working directory, then reply with its exact content. Do not read any other path, modify files, access the network, or request any further task. Keep the final answer to the marker alone.' }, ({ event }) => {
      if (event.type === 'session') session ||= !!event.sessionId;
      if (event.type === 'activity' && event.item?.id) items.set(event.item.id, event.item);
      if (event.type === 'question') { if (runId) runtime.abort(runId); rejectTurn(new Error('The verification asked for interactive input; no approval was granted automatically.')); }
      if (event.type === 'run_error') rejectTurn(new Error(String(event.message ?? 'Native runtime failed.')));
      if (event.type === 'run_end') { text = typeof event.text === 'string' ? event.text : ''; resolveTurn(event.how); }
    }).then(id => { runId = id; }).catch(rejectTurn);
  });
  const how = await ended;
  assert.ok(how === 'completed' || how === 'end', `Unexpected terminal state: ${how}`);
  assert.equal(session, true);
  assert.ok([...items.values()].some(item => item.kind === 'command'), 'Expected a real command activity');
  assert.ok(text.includes(marker), 'Native final answer must contain the file marker');
  console.log(JSON.stringify({ ok: true, session, activityKinds: [...new Set([...items.values()].map(item => item.kind))], commandCount: [...items.values()].filter(item => item.kind === 'command').length, finalContainsMarker: true, elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), session, activityKinds: [...new Set([...items.values()].map(item => item.kind))], elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  if (runId) runtime.abort(runId);
  runtime.shutdown();
}
