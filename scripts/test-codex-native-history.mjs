// Offline protocol contract tests. The stub never executes a model or a tool.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const runtimePath = fileURLToPath(new URL('../runtime/agents/codex.cjs', import.meta.url));
const runtimeRequire = createRequire(runtimePath);
const { validateHistory, captureNativeTurn, readRollout } = runtimeRequire('./codex-history.cjs');
const root = fileURLToPath(new URL('../local-tests/', import.meta.url));
mkdirSync(root, { recursive: true });
const fixture = mkdtempSync(path.join(root, 'codex-native-'));
const user = (text) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const assistant = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const upstream = [user('API question'), assistant('API answer')];
const history = (items = upstream, extra = {}) => ({ version: 1, items, mappings: [{ nodeId: 'api-a', revision: 1, itemStart: 0, itemEnd: items.length }], fingerprint: 'history-test', ...extra });
const longOutput = 'raw-output-'.repeat(16000);
let checks = 0;
const check = (name, fn) => { fn(); console.log(`ok ${++checks} - ${name}`); };

function harness({ failInjection = false, noFile = false, hold = false } = {}) {
  const requests = [];
  const threads = new Map();
  const queuedTurns = [];
  let client;
  let serial = 0;
  let approvalCommand = null;
  const record = (file, type, payload) => appendFileSync(file, JSON.stringify({ timestamp: 'ignored', type, payload }) + '\n');
  const notify = (method, params) => client.stdout.emit('data', Buffer.from(JSON.stringify({ method, params }) + '\n'));
  const finish = ({ thread, turnId, input }) => {
    if (approvalCommand) client.stdout.emit('data', Buffer.from(JSON.stringify({ id: `approval-${turnId}`, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id, turnId, command: approvalCommand } }) + '\n'));
    if (thread.path) {
      record(thread.path, 'turn_context', { turn_id: turnId, effort: 'medium' });
      record(thread.path, 'response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'runtime config' }] });
      record(thread.path, 'response_item', user('<environment_context>runtime state</environment_context>'));
      record(thread.path, 'response_item', user(input[0].text));
      record(thread.path, 'response_item', { type: 'reasoning', encrypted_content: 'opaque-private-content' });
      record(thread.path, 'response_item', { type: 'function_call', call_id: `call-${turnId}`, name: 'exec_command', arguments: '{"cmd":"never execute during replay"}' });
      record(thread.path, 'response_item', { type: 'function_call_output', call_id: `call-${turnId}`, output: longOutput });
      record(thread.path, 'response_item', assistant('native answer'));
      record(thread.path, 'event_msg', { type: 'task_complete', turn_id: turnId });
    }
    notify('item/completed', { threadId: thread.id, turnId, item: { id: `answer-${turnId}`, type: 'agentMessage', text: 'native answer', phase: 'final_answer' } });
    notify('turn/completed', { threadId: thread.id, turn: { id: turnId, status: 'completed' } });
  };
  const spawn = () => {
    client = new EventEmitter();
    client.stdout = new EventEmitter(); client.stderr = new EventEmitter();
    client.kill = () => client.emit('exit', 0);
    client.stdin = { write(line) {
      const request = JSON.parse(line); requests.push(request);
      const answer = (result, error) => queueMicrotask(() => client.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, ...(error ? { error: { message: error } } : { result }) }) + '\n')));
      if (request.method === 'initialize') answer({});
      else if (request.method === 'thread/start' || request.method === 'thread/fork') {
        const id = `thread-${++serial}`;
        const file = noFile ? null : path.join(fixture, `${id}-${Date.now()}-${Math.random()}.jsonl`);
        const thread = { id, path: file, status: { type: 'idle' } };
        if (file) writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n');
        threads.set(id, thread); answer({ thread });
      } else if (request.method === 'thread/read' || request.method === 'thread/resume') answer({ thread: threads.get(request.params.threadId) });
      else if (request.method === 'thread/inject_items') {
        if (failInjection) answer(null, 'injected failure');
        else {
          const thread = threads.get(request.params.threadId);
          if (thread.path) for (const item of request.params.items) record(thread.path, 'response_item', item);
          answer({});
        }
      } else if (request.method === 'thread/archive') answer({});
      else if (request.method === 'turn/start') {
        const thread = threads.get(request.params.threadId);
        const turnId = `turn-${++serial}`;
        const turn = { thread, turnId, input: request.params.input };
        answer({ turn: { id: turnId } });
        setImmediate(() => {
          notify('turn/started', { threadId: thread.id, turn: { id: turnId, status: 'inProgress' } });
          if (hold) queuedTurns.push(turn); else finish(turn);
        });
      } else if (request.method === 'turn/interrupt') answer({});
      return true;
    } };
    return client;
  };
  const loaded = { exports: {} };
  vm.runInNewContext(readFileSync(runtimePath, 'utf8'), {
    module: loaded, exports: loaded.exports, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (name === 'node:child_process') return { spawn };
      if (name === './where.cjs') return { createLocator: () => async () => ({ path: path.join(fixture, 'codex.exe') }), childEnv: () => ({}) };
      if (name === './codex-launch.cjs') return { createCodexLaunchResolver: () => async () => ({ path: path.join(fixture, 'codex.exe'), command: path.join(fixture, 'codex.exe'), args: ['app-server'], env: {} }) };
      return runtimeRequire(name);
    },
  }, { filename: runtimePath });
  const runtime = loaded.exports.createCodexRuntime();
  const run = async (req) => {
    const events = [];
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const runId = await runtime.run({ cwd: fixture, prompt: 'current question', model: { id: 'test-model' }, codexHistory: history(), ...req }, ({ event }) => { events.push(event); if (event.type === 'run_end') resolve(events); });
    return { runId, events, done };
  };
  return { runtime, run, requests, threads, setApproval: (value) => { approvalCommand = value; }, setHold: (value) => { hold = value; }, finishPending: () => { for (const turn of queuedTurns.splice(0)) finish(turn); }, queuedTurns, record };
}

const native = harness();
try {
  const first = await native.run({ instructions: 'Canvas system instruction' });
  await first.done;
  const captured = first.events.findLast((e) => e.nativeHistory)?.nativeHistory;
  check('history is injected before the current prompt starts a turn', () => {
    const methods = native.requests.map((r) => r.method);
    assert.ok(methods.indexOf('thread/inject_items') < methods.indexOf('turn/start'));
    assert.deepEqual(native.requests.find((r) => r.method === 'thread/inject_items').params.items, upstream);
    assert.equal(native.requests.find((r) => r.method === 'turn/start').params.input[0].text, 'current question');
    assert.equal(native.requests.find((r) => r.method === 'thread/start').params.developerInstructions, 'Canvas system instruction');
  });
  check('capture preserves the raw user message and full tool result without display truncation', () => {
    assert.equal(captured.capture, 'complete');
    assert.equal(captured.items[0].content[0].text, 'current question');
    assert.equal(captured.items.find((i) => i.type === 'function_call_output').output, longOutput);
    assert.equal(captured.items[1].call_id, captured.items[2].call_id);
    assert.ok(!JSON.stringify(captured.items).includes('opaque-private-content'));
    assert.ok(!JSON.stringify(captured.items).includes('runtime state'));
    assert.ok(!JSON.stringify(captured.items).includes('API question'));
  });
  const session = first.events.findLast((e) => e.nativeHistory);
  const prefix = [...upstream, ...captured.items];
  const suffix = [user('another API node'), assistant('another API answer')];
  const base = { threadId: session.sessionId, turnId: captured.turnId, checkpoint: captured.checkpoint, sessionFile: session.sessionFile, itemCount: prefix.length };
  const beforeContinue = native.requests.length;
  native.setApproval('check permission scope');
  const second = await native.run({ prompt: 'next question', allowRules: ['codex:cmd:check permission scope'], codexHistory: history([...prefix, ...suffix], { base }) });
  await second.done;
  check('matching checkpoints resume and inject only new nodes', () => {
    const reqs = native.requests.slice(beforeContinue);
    assert.ok(reqs.some((r) => r.method === 'thread/resume'));
    assert.ok(!reqs.some((r) => r.method === 'thread/start'));
    assert.deepEqual(reqs.find((r) => r.method === 'thread/inject_items').params.items, suffix);
    assert.equal(second.events.findLast((e) => e.nativeHistory).continued, true);
    assert.ok(second.events.some((e) => e.type === 'question_answered' && e.auto));
  });
  const beforeStale = native.requests.length;
  const stale = await native.run({ allowRules: ['codex:cmd:check permission scope'], codexHistory: history([...prefix, ...suffix], { base }) });
  await stale.done;
  check('changed history never silently includes an external or later turn', () => {
    const reqs = native.requests.slice(beforeStale);
    assert.ok(reqs.some((r) => r.method === 'thread/start'));
    assert.equal(reqs.find((r) => r.method === 'thread/inject_items').params.items.length, prefix.length + suffix.length);
    assert.equal(stale.events.findLast((e) => e.nativeHistory).continued, false);
  });
  check('a fresh fallback never inherits the prior thread session allowance', () => {
    assert.ok(stale.events.some((e) => e.type === 'question'));
    assert.ok(!stale.events.some((e) => e.type === 'question_answered' && e.auto));
  });
  native.setApproval(null);
  const state = await readRollout(session.sessionFile);
  native.record(session.sessionFile, 'event_msg', { type: 'token_count', info: { total: 999999 } });
  check('usage-only updates do not invalidate the semantic checkpoint', () => assert.equal(state.checkpoint.length, 64));
  assert.equal((await readRollout(session.sessionFile)).checkpoint, state.checkpoint);
  const beforeFork = native.requests.length;
  const fork = await native.run({ codexHistory: undefined, sessionId: session.sessionId, forkEntryId: captured.turnId });
  await fork.done;
  check('legacy fork forwards the exact completed turn boundary', () => assert.equal(native.requests.slice(beforeFork).find((r) => r.method === 'thread/fork').params.lastTurnId, captured.turnId));
} finally { native.runtime.shutdown(); }

const failure = harness({ failInjection: true });
try {
  const result = await failure.run({}); await result.done;
  check('injection failure never starts inference or falls back to a text transcript', () => {
    assert.ok(!failure.requests.some((r) => r.method === 'turn/start'));
    assert.ok(failure.requests.some((r) => r.method === 'thread/archive'));
    assert.equal(result.events.at(-1).how, 'error');
    assert.ok(!result.events.some((e) => e.nativeHistory?.capture === 'complete'));
  });
} finally { failure.runtime.shutdown(); }

check('unpaired calls and privileged roles are rejected before modifying a thread', () => {
  assert.throws(() => validateHistory(history([{ type: 'function_call', call_id: 'orphan', name: 'x', arguments: '{}' }])), /unfinished/);
  assert.throws(() => validateHistory(history([{ type: 'message', role: 'system', content: [{ type: 'input_text', text: 'x' }] }])), /Only user/);
});
const missing = await captureNativeTurn(null, { turnId: 'missing', userTexts: ['q'] });
check('missing raw storage is explicitly unavailable, never synthesized from UI text', () => {
  assert.equal(missing.capture, 'unavailable'); assert.deepEqual(missing.items, []); assert.equal(missing.checkpoint, null);
});

const parallel = harness();
try {
  const initial = await parallel.run({}); await initial.done;
  const session = initial.events.findLast((e) => e.nativeHistory);
  const complete = [...upstream, ...session.nativeHistory.items];
  const base = { threadId: session.sessionId, turnId: session.turnId, checkpoint: session.nativeHistory.checkpoint, sessionFile: session.sessionFile, itemCount: complete.length };
  parallel.setHold(true);
  const a = await parallel.run({ prompt: 'parallel A', codexHistory: history(complete, { base }) });
  const b = await parallel.run({ prompt: 'parallel B', codexHistory: history(complete, { base }) });
  for (let i = 0; parallel.queuedTurns.length < 2 && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  check('concurrent requests never share a mutable continuation thread', () => {
    assert.equal(parallel.queuedTurns.length, 2);
    assert.notEqual(parallel.queuedTurns[0].thread.id, parallel.queuedTurns[1].thread.id);
    assert.equal([a, b].filter((run) => run.events.some((event) => event.type === 'session' && event.continued)).length, 1);
  });
  parallel.finishPending(); await Promise.all([a.done, b.done]);
} finally { parallel.runtime.shutdown(); }

console.log(`${checks} native history checks passed`);
