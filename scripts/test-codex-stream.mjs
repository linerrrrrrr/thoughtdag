// Recorded-protocol regressions: no network, model credentials, or inference.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { createCodexEventProjector } = require('../runtime/agents/codex.cjs');

const events = [];
const run = { text: '', final: null, turnId: null, emit: (event) => events.push(structuredClone(event)) };
const projector = createCodexEventProjector(run);
const emit = (method, params = {}) => projector.notification(method, { threadId: 'thread-1', turnId: 'turn-1', ...params });
const start = (item) => emit('item/started', { item, startedAtMs: 1000 });
const complete = (item) => emit('item/completed', { item, completedAtMs: 2000 });
const latest = (id) => events.findLast((event) => event.type === 'activity' && event.item.id === id)?.item;
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`ok ${checks} - ${name}`); };

emit('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } });
check('the turn is visible before any model text', () => assert.equal(latest('turn:turn-1').status, 'running'));
start({ id: 'reason-1', type: 'reasoning', summary: [] });
emit('item/reasoning/summaryTextDelta', { itemId: 'reason-1', summaryIndex: 0, delta: 'Inspecting the stream.' });
emit('item/reasoning/textDelta', { itemId: 'reason-1', delta: 'Private raw content must never appear.' });
emit('item/reasoning/summaryPartAdded', { itemId: 'reason-1', summaryIndex: 1 });
emit('item/reasoning/summaryTextDelta', { itemId: 'reason-1', summaryIndex: 1, delta: 'Checking command events.' });
check('summary sections retain their boundaries without raw reasoning', () => assert.equal(latest('reason-1').text, 'Inspecting the stream.\n\nChecking command events.'));
complete({ id: 'reason-1', type: 'reasoning', summary: ['Inspecting the stream.', 'Checking command events.'], content: ['Private raw content must never appear.'] });
check('authoritative reasoning is not appended twice', () => assert.equal(latest('reason-1').text, 'Inspecting the stream.\n\nChecking command events.'));
check('raw reasoning is absent from every emitted event', () => assert.ok(!JSON.stringify(events).includes('Private raw content')));
start({ id: 'comment-1', type: 'agentMessage', phase: 'commentary', text: '' });
emit('item/agentMessage/delta', { itemId: 'comment-1', delta: '我先检查协议。' });
complete({ id: 'comment-1', type: 'agentMessage', phase: 'commentary', text: '我先检查协议。' });
check('commentary appears as activity without contaminating answer text', () => {
  assert.equal(latest('comment-1').kind, 'commentary');
  assert.equal(latest('comment-1').text, '我先检查协议。');
  assert.equal(run.text, '');
});

start({ id: 'cmd-1', type: 'commandExecution', command: 'npm test', cwd: 'D:/workspace', status: 'inProgress', commandActions: [] });
emit('item/commandExecution/outputDelta', { itemId: 'cmd-1', delta: 'first line\n' });
check('command output is visible before completion', () => {
  assert.equal(latest('cmd-1').status, 'running');
  assert.equal(latest('cmd-1').output, 'first line\n');
});
emit('item/commandExecution/outputDelta', { itemId: 'cmd-1', delta: 'second line\n' });
complete({ id: 'cmd-1', type: 'commandExecution', command: 'npm test', cwd: 'D:/workspace', status: 'completed', aggregatedOutput: 'first line\nsecond line\n', exitCode: 0, durationMs: 83 });
check('final command output replaces deltas and retains execution metadata', () => {
  const item = latest('cmd-1');
  assert.equal(item.output, 'first line\nsecond line\n');
  assert.equal(item.exitCode, 0);
  assert.equal(item.durationMs, 83);
  assert.equal(item.startedAt, 1000);
  assert.equal(item.endedAt, 2000);
});
start({ id: 'cmd-big', type: 'commandExecution', command: 'noisy', status: 'inProgress' });
emit('item/commandExecution/outputDelta', { itemId: 'cmd-big', delta: 'x'.repeat(100001) });
emit('item/commandExecution/outputDelta', { itemId: 'cmd-big', delta: 'more' });
check('unbounded command output is explicitly marked as truncated', () => {
  assert.equal(latest('cmd-big').output.length, 100000);
  assert.ok(latest('cmd-big').output.endsWith('more'));
  assert.equal(latest('cmd-big').truncated, true);
});
complete({ id: 'cmd-big', type: 'commandExecution', command: 'noisy', status: 'failed', aggregatedOutput: 'failure', exitCode: 2 });
check('nonzero command exit is a failure', () => assert.equal(latest('cmd-big').status, 'failed'));

start({ id: 'mcp-1', type: 'mcpToolCall', server: 'local', tool: 'lookup', arguments: { q: 'event' }, status: 'inProgress' });
emit('item/mcpToolCall/progress', { itemId: 'mcp-1', message: 'Reading the schema' });
check('tool progress updates the same call', () => assert.equal(latest('mcp-1').text, 'Reading the schema'));
complete({ id: 'mcp-1', type: 'mcpToolCall', server: 'local', tool: 'lookup', arguments: { q: 'event' }, status: 'completed', result: { content: [{ type: 'text', text: 'found' }] } });
check('tool results survive completion', () => assert.match(latest('mcp-1').output, /found/));
start({ id: 'file-1', type: 'fileChange', status: 'inProgress', changes: [] });
emit('item/fileChange/patchUpdated', { itemId: 'file-1', changes: [{ path: 'src/app.ts', kind: { type: 'update' }, diff: '-old\n+new' }] });
check('file changes retain the actual patch', () => assert.equal(latest('file-1').details.changes[0].diff, '-old\n+new'));
complete({ id: 'file-1', type: 'fileChange', status: 'completed', changes: [{ path: 'src/app.ts', kind: { type: 'update' }, diff: '-old\n+new' }] });
emit('turn/plan/updated', { explanation: 'The next steps', plan: [{ step: 'Inspect', status: 'completed' }, { step: 'Implement', status: 'inProgress' }] });
check('plan updates retain structured step statuses', () => assert.equal(latest('plan:turn-1').details.plan[1].status, 'inProgress'));
start({ id: 'plan-text', type: 'plan', text: '' });
emit('item/plan/delta', { itemId: 'plan-text', delta: 'draft' });
complete({ id: 'plan-text', type: 'plan', text: 'revised plan' });
check('completed plan text is authoritative', () => assert.equal(latest('plan-text').text, 'revised plan'));
start({ id: 'child-1', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child-thread'], status: 'inProgress', agentsStates: {} });
complete({ id: 'child-1', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child-thread'], status: 'completed', agentsStates: { 'child-thread': { status: 'running' } } });
check('sub-agent calls retain target and lifecycle data', () => assert.deepEqual(latest('child-1').details.receiverThreadIds, ['child-thread']));
emit('future/event', { value: 'forward compatible' });
check('unrecognized notifications remain inspectable', () => assert.ok(events.some((e) => e.type === 'activity' && e.item.kind === 'unknown' && e.item.details.value === 'forward compatible')));
emit('mcpServer/startupStatus/updated', { name: 'local-tools', status: 'starting' });
emit('mcpServer/startupStatus/updated', { name: 'local-tools', status: 'ready' });
check('tool-server startup updates share one stable status row', () => assert.equal(latest('mcp:local-tools').status, 'completed'));
emit('error', { willRetry: true, error: { message: 'reconnecting' } });
check('retry notifications do not end the run or lose their reason', () => assert.ok(events.some((e) => e.type === 'activity' && e.item.text === 'reconnecting' && e.item.details.willRetry)));

start({ id: 'partial-1', type: 'agentMessage', phase: 'partial_answer', text: '' });
emit('item/agentMessage/delta', { itemId: 'partial-1', delta: 'Initial finding.' });
complete({ id: 'partial-1', type: 'agentMessage', phase: 'partial_answer', text: 'Initial finding.' });
start({ id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '' });
emit('item/agentMessage/delta', { itemId: 'answer-1', delta: 'An incorret ending.' });
complete({ id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: 'A corrected ending.' });
check('partial and final answers both persist in order, without commentary', () => assert.equal(run.final, 'Initial finding.\n\nA corrected ending.'));
check('a corrected authoritative answer emits a full replacement', () => assert.equal(events.findLast((e) => e.type === 'message_update').assistantMessageEvent.type, 'text_replace'));
const countBeforeDuplicate = events.filter((e) => e.type === 'message_update').length;
complete({ id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: 'A corrected ending.' });
check('duplicate completion does not duplicate answer text', () => assert.equal(events.filter((e) => e.type === 'message_update').length, countBeforeDuplicate));
emit('item/agentMessage/delta', { itemId: 'late-phase', delta: 'Temporary message' });
complete({ id: 'late-phase', type: 'agentMessage', phase: 'commentary', text: 'Temporary message' });
check('phase discovered at completion removes commentary from the answer', () => {
  assert.equal(run.text, 'Initial finding.\n\nA corrected ending.');
  assert.equal(latest('late-phase').kind, 'commentary');
});
emit('turn/completed', { turn: { id: 'turn-1', status: 'completed', items: [] } });
check('successful turn completion closes its status', () => assert.equal(latest('turn:turn-1').status, 'completed'));

start({ id: 'interrupted-command', type: 'commandExecution', command: 'long-running', status: 'inProgress' });
projector.finish('aborted');
check('cancellation preserves incomplete work instead of reporting success', () => assert.equal(latest('interrupted-command').status, 'interrupted'));
start({ id: 'failed-command', type: 'commandExecution', command: 'long-running', status: 'inProgress' });
projector.finish('error');
check('runtime failure marks outstanding work as failed', () => assert.equal(latest('failed-command').status, 'failed'));

// Exercise the runtime transport as well as its projector. An app-server stub
// deliberately splits a UTF-8 code point between stdout chunks.
const runtimePath = fileURLToPath(new URL('../runtime/agents/codex.cjs', import.meta.url));
const runtimeRequire = createRequire(runtimePath);
const localRoot = fileURLToPath(new URL('../local-tests/', import.meta.url));
mkdirSync(localRoot, { recursive: true });
const fixtureDir = mkdtempSync(path.join(localRoot, 'codex-stream-'));
const transportEvents = [];
let client;
let requestedSummary;
const notify = (method, params) => client.stdout.emit('data', Buffer.from(JSON.stringify({ method, params: { threadId: 'transport-thread', turnId: 'transport-turn', ...params } }) + '\n'));
const spawn = () => {
  client = new EventEmitter();
  client.stdout = new EventEmitter();
  client.stderr = new EventEmitter();
  client.kill = () => client.emit('exit', 0);
  client.stdin = { write(line) {
    const request = JSON.parse(line);
    const answer = (result) => queueMicrotask(() => client.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result }) + '\n')));
    if (request.method === 'initialize') answer({});
    if (request.method === 'thread/start') answer({ thread: { id: 'transport-thread', path: null } });
    if (request.method === 'turn/start') {
      requestedSummary = request.params.summary;
      answer({ turn: { id: 'transport-turn' } });
      setImmediate(() => {
        notify('turn/started', { turn: { id: 'transport-turn', status: 'inProgress' } });
        notify('item/started', { item: { id: 'transport-message', type: 'agentMessage', phase: 'final_answer', text: '' } });
        const raw = Buffer.from(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'transport-thread', turnId: 'transport-turn', itemId: 'transport-message', delta: '中文输出' } }) + '\n');
        const split = raw.indexOf(Buffer.from('中')) + 1;
        client.stdout.emit('data', raw.subarray(0, split));
        client.stdout.emit('data', raw.subarray(split));
        notify('item/completed', { item: { id: 'transport-message', type: 'agentMessage', phase: 'final_answer', text: '中文输出' } });
        notify('turn/completed', { turn: { id: 'transport-turn', status: 'completed' } });
      });
    }
    return true;
  } };
  return client;
};
const loaded = { exports: {} };
vm.runInNewContext(readFileSync(runtimePath, 'utf8'), {
  module: loaded, exports: loaded.exports, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval,
  require(name) {
    if (name === 'node:child_process') return { spawn };
    if (name === './where.cjs') return { createLocator: () => async () => ({ path: path.join(fixtureDir, 'codex.exe'), searched: [], failures: [] }), childEnv: () => ({}) };
    return runtimeRequire(name);
  },
}, { filename: runtimePath });
const runtime = loaded.exports.createCodexRuntime();
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('mock runtime did not complete')), 3000);
    runtime.run({ cwd: fixtureDir, prompt: 'transport test', model: { id: 'fixture-model' } }, ({ event }) => {
      transportEvents.push(event);
      if (event.type === 'run_end') { clearTimeout(timeout); resolve(); }
    }).catch(reject);
  });
} finally {
  runtime.shutdown();
}
check('UTF-8 transport chunks never corrupt live Chinese text', () => {
  const streamed = transportEvents.filter((e) => e.type === 'message_update').map((e) => e.assistantMessageEvent.delta ?? '').join('');
  assert.equal(streamed, '中文输出');
  assert.equal(transportEvents.find((e) => e.type === 'run_end').text, '中文输出');
});
check('transport emits structured activity and exactly one terminal event', () => {
  assert.ok(transportEvents.some((e) => e.type === 'activity' && e.item.id === 'transport-message'));
  assert.equal(transportEvents.filter((e) => e.type === 'run_end').length, 1);
});
check('the runtime explicitly requests available public reasoning summaries', () => assert.equal(requestedSummary, 'auto'));
console.log(`\n${checks} Codex stream regressions passed.`);
