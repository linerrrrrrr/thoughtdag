// Exercise the native request/response boundary without starting Codex.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const runtimePath = fileURLToPath(new URL('../runtime/agents/codex.cjs', import.meta.url));
const runtimeRequire = createRequire(runtimePath);
const fixtureDir = fileURLToPath(new URL('../local-tests/codex-approval-transport/', import.meta.url));
mkdirSync(fixtureDir, { recursive: true });
const questions = [], responses = [];
let client;
const requests = [
  { method: 'item/commandExecution/requestApproval', params: { command: ['powershell', '-NoProfile', 'Write-Output hi'], reason: 'Need to inspect the file.' } },
  { method: 'item/fileChange/requestApproval', params: { grantRoot: 'D:/fixture/output', reason: 'Need to change the file.' } },
  { method: 'item/permissions/requestApproval', params: { permissions: { network: { enabled: true } }, reason: 'Need the network.' } },
];
const receive = data => client.stdout.emit('data', Buffer.from(JSON.stringify(data) + '\n'));
const request = index => receive({ id: 701 + index, ...requests[index], params: { threadId: 'approval-thread', turnId: 'approval-turn', ...requests[index].params } });
const spawn = () => {
  client = new EventEmitter();
  client.stdout = new EventEmitter();
  client.stderr = new EventEmitter();
  client.kill = () => client.emit('exit', 0);
  client.stdin = { write(line) {
    const message = JSON.parse(line);
    const respond = result => queueMicrotask(() => receive({ id: message.id, result }));
    if (message.method === 'initialize') respond({});
    if (message.method === 'thread/start') respond({ thread: { id: 'approval-thread', path: null } });
    if (message.method === 'turn/start') {
      respond({ turn: { id: 'approval-turn' } });
      setImmediate(() => request(0));
    }
    if (message.id >= 701 && message.id <= 703 && !message.method) {
      responses.push(message.result);
      const next = message.id - 700;
      if (next < requests.length) setImmediate(() => request(next));
      else setImmediate(() => receive({ method: 'turn/completed', params: { threadId: 'approval-thread', turnId: 'approval-turn', turn: { id: 'approval-turn', status: 'completed' } } }));
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
    if (name === './codex-launch.cjs') return { createCodexLaunchResolver: () => async () => ({ path: path.join(fixtureDir, 'codex.exe'), command: path.join(fixtureDir, 'codex.exe'), args: ['app-server'], env: {}, searched: [], failures: [] }) };
    return runtimeRequire(name);
  },
}, { filename: runtimePath });
const runtime = loaded.exports.createCodexRuntime();
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('mock approval run did not complete')), 5000);
    runtime.run({ cwd: fixtureDir, prompt: 'fixture', model: { id: 'fixture' } }, ({ runId, event }) => {
      if (event.type === 'question') {
        questions.push(structuredClone(event));
        const answer = questions.length === 1 ? { confirmed: true, scope: 'session' } : { confirmed: questions.length === 3 };
        assert.equal(runtime.answer(runId, event.id, answer), true);
      }
      if (event.type === 'run_end') { clearTimeout(timeout); resolve(); }
    }).catch(reject);
  });
} finally {
  runtime.shutdown();
}
assert.equal(questions.length, 3);
assert.equal(questions[0].message, 'powershell -NoProfile Write-Output hi');
assert.equal(questions[0].reason, 'Need to inspect the file.');
assert.equal(questions[1].message, 'D:/fixture/output');
assert.equal(questions[1].reason, 'Need to change the file.');
assert.equal(questions[2].message, JSON.stringify({ network: { enabled: true } }));
assert.equal(questions[2].reason, 'Need the network.');
assert.deepEqual(responses, [
  { decision: 'acceptForSession' },
  { decision: 'decline' },
  { permissions: { network: { enabled: true } }, scope: 'turn' },
]);
console.log('PASS: command, file, and permission requests retain separate details and reasons; decisions reach the native protocol unchanged.');
