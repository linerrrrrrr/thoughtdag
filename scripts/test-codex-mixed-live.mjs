// Opt-in live verification. Reads one API credential from stdin; never saves it.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

if (!process.argv.includes('--live')) throw new Error('Use --live to authorize two real API calls and bounded Codex test turns.');
const input = createInterface({ input: process.stdin, terminal: false });
console.log('Ready for API credential on stdin (not persisted).');
let key = String(await new Promise(done => input.once('line', done))).trim(); input.close();
assert.ok(key);
const root = resolve('.');
const dir = resolve('local-tests', 'native-mixed', new Date().toISOString().replace(/[:.]/g, '-'));
const cwd = join(dir, 'workspace');
await mkdir(join(cwd, '.thoughtdag'), { recursive: true });
globalThis.graph = { nodes: [], edges: [] };
globalThis.projects = { activeId: 'test', projects: [{ id: 'test', agentCwd: cwd, agentGuard: { mode: 'auto', allow: [] } }] };
globalThis.ui = { agentEffort: 'low' };
globalThis.localStorage = { getItem: () => null };
const file = join(dir, 'client.mjs');
await build({ stdin: { contents: `export {agentCallStream} from './lib/agents/agent-runtime'; export {buildIncomingContext} from './store/context-builder';`, resolveDir: join(root, 'src'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'silent', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'isolated-canvas', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (!args.importer.endsWith('agent-runtime.ts')) return;
      const stubs = {
        '../../store': 'export const useStore={getState:()=>globalThis.graph,setState:p=>Object.assign(globalThis.graph,typeof p==="function"?p(globalThis.graph):p)};',
        '../../store/projects': 'export const useProjects={getState:()=>globalThis.projects}; export const subscribedSessionIds=()=>[]; export const patchLedgerEntry=async()=>{};',
        '../canvas-workspace': 'export const ensureCanvasWorkspace=async()=>window.desktopAgents.canvasWorkspace();',
        '../ui-store': 'export const useUiStore={getState:()=>globalThis.ui};export const toast=()=>{};',
        '../../i18n': 'export const t=x=>x;',
        '../attachment-vault': 'export const loadAttachmentContent=async a=>a.content;',
        './harness-bridge': 'export const currentDshSession=()=>null;',
      };
      if (stubs[args.path]) return { path: args.path, namespace: 'state', pluginData: stubs[args.path] };
    });
    b.onLoad({ filter: /.*/, namespace: 'state' }, args => ({ contents: args.pluginData, loader: 'js' }));
  } }],
});
const { agentCallStream, buildIncomingContext } = await import(pathToFileURL(file));
const { createCodexRuntime } = createRequire(import.meta.url)('../runtime/agents/codex.cjs');
let runtime = createCodexRuntime({ log() {} });
let deliver;
const requests = [];
const events = [];
globalThis.window = { dispatchEvent() {}, desktopAgents: {
  models: async () => runtime.models(), canvasWorkspace: async () => cwd,
  guardWrite: async (where, config) => { await writeFile(join(where, '.thoughtdag', 'guard.json'), JSON.stringify(config)); return true; },
  writeMaterials: async () => ({ dir: null, written: [] }),
  onEvent: cb => { deliver = cb; },
  run: async req => { requests.push(req); return runtime.run(req, event => { events.push(event); deliver(event); }); },
  abort: async id => runtime.abort(id),
} };
const save = (name, data) => writeFile(join(dir, name), JSON.stringify(data, null, 2));
const node = (id, question, kind) => ({ id, type: 'thought', position: { x: 0, y: 0 }, data: { question, response: '', responses: [], responseIndex: -1, attachments: [], isLoading: false, executionKind: kind } });
function add(n, parent) { graph.nodes.push(n); if (parent) graph.edges.push({ id: `${parent}-${n.id}`, source: parent, target: n.id }); }
function context(n) { const c = buildIncomingContext(n.id, graph.nodes, graph.edges); return [...c.messages, { role: 'user', content: n.data.question }]; }
const apiResults = [];
async function api(n) {
  const messages = context(n).map(({ role, content }) => ({ role, content }));
  const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'deepseek-flash', messages, max_tokens: 256, thinking: { type: 'disabled' }, stream: false }), signal: AbortSignal.timeout(90000) });
  const body = await res.json();
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  n.data.response = body.choices[0].message.content;
  n.data.responses = [n.data.response]; n.data.responseIndex = 0;
  apiResults.push({ nodeId: n.id, responseId: body.id, usage: body.usage, messages, answer: n.data.response });
  await save('api-results.json', apiResults);
  console.log(JSON.stringify({ phase: n.id, api: true, responseId: body.id }));
}
async function codex(n) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    n.data.isLoading = true;
    n.data.response = await agentCallStream(context(n), () => {}, controller.signal, [], {
      onAgentSession: session => { n.data.agentSession = { ...n.data.agentSession, ...session }; },
      onApproval: () => { controller.abort(); },
    }, 'codex/codex/default', { cwd }, n.id);
    n.data.responses = [n.data.response]; n.data.responseIndex = 0; n.data.isLoading = false;
    n.data.codexHistories = [n.data.agentSession.nativeHistory];
    assert.equal(n.data.agentSession.nativeHistory.capture, 'complete', n.data.agentSession.nativeHistory.reason);
    await save('canvas.json', graph); await save('requests.json', requests); await save('events.json', events);
    console.log(JSON.stringify({ phase: n.id, sessionId: n.data.agentSession.sessionId, turnId: n.data.agentSession.turnId, continued: n.data.agentSession.continued, rawItems: n.data.agentSession.nativeHistory.items.length }));
  } finally { clearTimeout(timeout); }
}
try {
  const a = node('A', 'Choose a random five-digit integer seed and a short English plant word. Reply only valid JSON with keys seed and word.', 'api'); add(a); await api(a);
  const av = JSON.parse(a.data.response.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  const b = node('B', 'Bounded integration test. Recall API A seed and word from history. Use one shell command to write b-proof.json in the current directory with JSON {seed,word,value} where value=seed*3+11. Do not read other directories or use network. Then answer only the same JSON. Do not ask questions.', 'codex'); add(b, 'A'); await codex(b);
  const bp = JSON.parse(await readFile(join(cwd, 'b-proof.json'), 'utf8'));
  assert.equal(bp.seed, av.seed); assert.equal(bp.word, av.word); assert.equal(bp.value, av.seed * 3 + 11);
  const c = node('C', 'From API A and Codex B above, reply only valid JSON {seed,word,finalValue}, where finalValue=B value*2+7.', 'api'); add(c, 'B'); await api(c);
  const cv = JSON.parse(c.data.response.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  assert.equal(cv.finalValue, bp.value * 2 + 7);
  runtime.shutdown();
  graph = JSON.parse(JSON.stringify(graph));
  runtime = createCodexRuntime({ log() {} });
  const d = node('D', 'After process restart: recover seed, word and finalValue from API C in structured history. Use one shell command to write d-proof.json with those three JSON keys. Do not read any other file or use network. Reply only that JSON.', 'codex'); add(d, 'C'); await codex(d);
  const dp = JSON.parse(await readFile(join(cwd, 'd-proof.json'), 'utf8'));
  assert.deepEqual(dp, cv);
  assert.equal(d.data.agentSession.continued, true, 'restart must resume the validated native prefix');
  assert.equal(d.data.agentSession.sessionId, b.data.agentSession.sessionId);
  assert.equal(requests[1].prompt, d.data.question);
  assert.equal(requests[1].codexHistory.items.filter(item => item.type.endsWith('_call')).length > 0, true);
  // A different canvas history must materialize a fresh native thread.
  const editedA = graph.nodes.find(n => n.id === 'A');
  editedA.data.response = JSON.stringify({ seed: 71983, word: 'cypress' }); editedA.data.responses = [editedA.data.response];
  const e = node('E', 'Reply only with the seed and word originally given by API A. Do not invoke tools.', 'codex'); add(e, 'A'); await codex(e);
  assert.notEqual(e.data.agentSession.sessionId, d.data.agentSession.sessionId);
  assert.match(e.data.response, /71983/); assert.match(e.data.response, /cypress/);
  const report = { ok: true, artifactDirectory: dir, apiCalls: apiResults.length, codexTurns: 3, restartResumed: true, editRebuilt: true, toolsVerified: ['b-proof.json', 'd-proof.json'], originalThread: d.data.agentSession.sessionId, rebuiltThread: e.data.agentSession.sessionId };
  await save('result.json', report); console.log(JSON.stringify(report));
} catch (error) {
  await save('requests.json', requests); await save('events.json', events);
  const message = String(error?.stack ?? error).replaceAll(key, '[REDACTED]');
  await save('result.json', { ok: false, artifactDirectory: dir, error: message });
  console.error(message); process.exitCode = 1;
} finally { key = ''; runtime.shutdown(); }
