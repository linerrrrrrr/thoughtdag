#!/usr/bin/env node
// Regression fixtures for public activity, delivery races, and terminal flushes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'td-activity-'));
const uiStub = `export const useUiStore={getState:()=>({selectedModel:'codex/model',recallEnabled:false,autoRefreshPaused:true})}; export const toast=()=>{};`;
const stubs = {
  '../lib/graph': 'export const walkUpAncestors=()=>({ordered:[]});',
  './context-builder': 'export const upstreamFingerprint=()=>"hash", upstreamParts=()=>[], recordParts=x=>x, recordsForAgent=x=>x, recordsWithTools=x=>x;',
  '../lib/context-bundle': 'export const sha256Hex=async()=>"hash", canonicalStringify=JSON.stringify;',
  '../lib/highlight-match': 'export const pruneHighlights=x=>x;',
  '../lib/api': 'export const llmCallStream=(...args)=>globalThis.testStream(...args), declaresTools=()=>false;',
  '../lib/atlas/dsh-bridge': 'export const harnessOutbound=async()=>undefined, claimHarnessTurn=async()=>false, stampHarnessTurn=async()=>{}, isHarnessAgentModel=()=>false;',
  '../lib/agents/agent-runtime': 'export const agentOutbound=async()=>undefined, adoptAgentTurn=async()=>false, claimAgentTurn=async()=>{}, deriveFollowupModel=d=>d?.model, isAgentModel=()=>true;',
  '../utils': 'export const countTokens=x=>x.length, activeSummary=()=>"";',
  '../lib/ui-store': uiStub,
  '../lib/use-models': 'export const getModelsOnce=async()=>({models:[],default:"codex/model"}), reconcileModelId=x=>x, describeModel=x=>x;',
  '../lib/runtime-providers': 'export const contextLengthFor=()=>undefined;',
  '../lib/memory': 'export const memoryContextBlock=()=>null, judgeMemory=()=>{};',
  '../lib/recall': 'export const fetchRecallItems=async()=>({items:[],meta:{}}), recallContextBlock=()=>null;',
  '../lib/recall-cards': 'export const fillCards=()=>{};',
  '../lib/judge': 'export const judgeAvailable=()=>false, decideTakeaway=async()=>({});',
  '../lib/ladder': 'export const buildLadder=async()=>null, ladderPreference=()=>undefined, inFlight=new Set(), levelText=()=>"";',
  '../lib/background-model': 'export const backgroundCall=async()=>({text:""}); export class BackgroundCallError extends Error{}',
  '../lib/ladder-context': 'export const ladderContextFor=()=>({});',
  '../i18n': 'export const t=x=>x, fmt=x=>x;',
  '../lib/agents/waiting': 'export const notifyWaiting=()=>{};',
  '../lib/viewer': 'export const isViewerMode=false;',
  './projects': 'export const useProjects={getState:()=>({projects:[],activeId:null})};',
};

try {
  const bundle = join(temp, 'activity.mjs');
  await build({
    stdin: { contents: `export * from './lib/agent-activity'; export {agentCallStream} from './lib/agents/agent-runtime'; export {installAgentsHttpBridge} from './lib/agents/http-bridge'; export {runNodeGeneration} from './store/streaming';`, resolveDir: join(root, 'src'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
    plugins: [{ name: 'isolated-host', setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        let contents;
        if (args.importer.endsWith('streaming.ts')) contents = stubs[args.path];
        if (args.importer.endsWith('agent-runtime.ts') && args.path === '../ui-store') contents = uiStub;
        if (args.importer.endsWith('agent-runtime.ts') && args.path === '../../i18n') contents = 'export const t=x=>x;';
        if (args.importer.endsWith('agent-runtime.ts') && args.path === '../../store') contents = 'export const useStore={getState:()=>({nodes:[]}),setState:()=>{}};';
        if (args.importer.endsWith('agent-runtime.ts') && args.path === '../../store/projects') contents = stubs['./projects'];
        if (args.importer.endsWith('agent-runtime.ts') && args.kind === 'dynamic-import' && !contents) contents = 'export const unused=true;';
        if (args.importer.endsWith('http-bridge.ts') && args.path === '../embedded') contents = 'export const IN_HARNESS_FRAME=false;';
        if (contents) return { path: args.importer + ':' + args.path, namespace: 'host-stub', pluginData: contents };
      });
      b.onLoad({ filter: /.*/, namespace: 'host-stub' }, (args) => ({ contents: args.pluginData, loader: 'js' }));
    } }],
  });
  globalThis.window = { setTimeout, addEventListener() {}, dispatchEvent() {} };
  const { activeAgentActivity, originalQuestionBeforeInstructions, upsertAgentActivity, settleAgentActivity, recoverInterruptedAgentRun, agentCallStream, installAgentsHttpBridge, runNodeGeneration } = await import(pathToFileURL(bundle));
  const item = (id, extra = {}) => ({ id, kind: 'command', status: 'running', command: 'npm run build', startedAt: 100, ...extra });
  const ordered = upsertAgentActivity(upsertAgentActivity([], item('a')), item('b'));
  assert.deepEqual(upsertAgentActivity(ordered, item('a', { output: 'ready', status: 'completed' })).map(x => x.id), ['a', 'b']);
  assert.equal(ordered[0].output, undefined, 'snapshot updates are immutable');
  assert.equal(settleAgentActivity(ordered, 'interrupted', 200)[0].status, 'interrupted');
  assert.deepEqual(activeAgentActivity({ responseIndex: 1, agentActivities: [[item('old')], [item('new')]] }).map(x => x.id), ['new']);
  const instructions = [item('u1', { kind: 'user', status: 'completed', text: 'First inspect the tests.' }),
    item('between', { kind: 'commentary', status: 'completed', text: 'Reading tests.' }),
    item('u2', { kind: 'user', status: 'completed', text: 'Keep **compatibility**.\nDo not deploy.' })];
  const canonicalQuestion = 'Fix the issue.\n\nFirst inspect the tests.\n\nKeep **compatibility**.\nDo not deploy.';
  assert.equal(originalQuestionBeforeInstructions(canonicalQuestion, instructions), 'Fix the issue.', 'supplementary instructions display only at their activity positions');
  assert.equal(originalQuestionBeforeInstructions('Original\n\nFirst inspect the tests.', [instructions[0]]), 'Original');
  assert.equal(originalQuestionBeforeInstructions(canonicalQuestion, []), canonicalQuestion, 'no activity never changes question presentation');
  assert.equal(originalQuestionBeforeInstructions(`${canonicalQuestion}\nEdited`, instructions), `${canonicalQuestion}\nEdited`, 'an edited suffix stays intact');
  assert.equal(originalQuestionBeforeInstructions('Fix the issue.\nFirst inspect the tests.', [instructions[0]]), 'Fix the issue.\nFirst inspect the tests.', 'matching is exact, including separators');
  assert.equal(originalQuestionBeforeInstructions('First inspect the tests.\n\nFix the issue.', [instructions[0]]), 'First inspect the tests.\n\nFix the issue.', 'an instruction in the middle or start is not removed');
  assert.equal(originalQuestionBeforeInstructions('\n\nFirst inspect the tests.', [instructions[0]]), '\n\nFirst inspect the tests.', 'the entire question is never erased');
  assert.equal(originalQuestionBeforeInstructions('Original\n\nFirst inspect the tests.', [item('pending', { kind: 'user', text: 'First inspect the tests.' })]), 'Original\n\nFirst inspect the tests.', 'unconfirmed user items cannot hide question text');
  assert.equal(canonicalQuestion, 'Fix the issue.\n\nFirst inspect the tests.\n\nKeep **compatibility**.\nDo not deploy.', 'canonical context remains unchanged');

  let deliver;
  window.desktopAgents = {
    onEvent: cb => { deliver = cb; }, guardWrite: async () => true, abort: async () => true,
    run: async req => {
      const runId = req.prompt;
      const emit = event => deliver({ runId, event });
      if (runId === 'overflow') {
        for (let i = 0; i < 2002; i++) emit({ type: 'activity', item: item(String(i)) });
        return runId;
      }
      emit({ type: 'activity', item: item(runId, { kind: 'commentary', text: 'Checking the parser.' }) });
      emit({ type: 'tool_execution_start', toolCallId: 'legacy', toolName: 'shell', args: { command: 'echo' } });
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'draft' } });
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_replace', text: `answer ${runId}` } });
      emit({ type: 'run_end', text: `answer ${runId}`, how: runId === 'stop' ? 'interrupted' : 'end' });
      return runId;
    },
  };
  const records = new Map();
  const invoke = name => {
    const seen = { activity: [], chunks: [], legacy: [] }; records.set(name, seen);
    return agentCallStream([{ role: 'user', content: name }], (_chunk, text) => seen.chunks.push(text), undefined, undefined,
      { onAgentActivity: entry => seen.activity.push(entry), onAgentTool: entry => seen.legacy.push(entry) }, 'codex/model', { cwd: root });
  };
  assert.deepEqual(await Promise.all([invoke('one'), invoke('two')]), ['answer one', 'answer two']);
  assert.equal(records.get('one').activity[0].id, 'one', 'early events route only to their own run');
  assert.equal(records.get('two').activity[0].id, 'two');
  assert.deepEqual(records.get('one').chunks, ['draft', 'answer one']);
  assert.equal(records.get('one').legacy.length, 0, 'Codex activity is not duplicated as legacy trace');
  await assert.rejects(invoke('stop'), error => error.name === 'AbortError');
  await assert.rejects(invoke('overflow'), /buffer overflowed/);

  const stateFor = () => ({ nodes: [{ id: 'n', data: { question: 'q', response: '', responses: [], responseIndex: -1, isLoading: true, attachments: [], recall: false, stepKind: 'prompt' } }], edges: [], logEvent() {}, settleNode() {}, setSummary() {}, setLadder() {} });
  async function generate(stream, initial = stateFor(), opts = {}) {
    globalThis.testStream = stream;
    let state = initial;
    await runNodeGeneration(patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; }, () => state, 'n', { question: 'q', messages: [{ role: 'user', content: 'q' }], ...opts });
    return () => state.nodes[0].data;
  }
  const failed = await generate(async (_messages, chunk, _signal, _images, callbacks) => {
    chunk('A', 'A');
    callbacks.onAgentActivity(item('cmd'));
    callbacks.onAgentActivity(item('cmd', { output: 'last output' }));
    chunk('B', 'AB');
    throw new Error('transport lost');
  });
  assert.equal(failed().response, 'AB', 'error flush retains the last buffered text');
  assert.equal(failed().agentActivities[0][0].output, 'last output');
  assert.equal(failed().agentActivities[0][0].status, 'failed');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(failed().agentActivity, undefined, 'no late timer restores live activity after completion');
  const stopped = await generate(async (_messages, _chunk, _signal, _images, callbacks) => {
    callbacks.onAgentActivity(item('cmd', { output: 'partial' }));
    throw new DOMException('Stopped', 'AbortError');
  });
  assert.equal(stopped().agentActivities[0][0].status, 'interrupted');
  assert.equal(stopped().generationFailed, undefined);
  const rerun = stateFor();
  Object.assign(rerun.nodes[0].data, { response: 'old answer', responses: ['old answer'], responseIndex: 0 });
  const rerunStopped = await generate(async () => { throw new DOMException('Stopped', 'AbortError'); }, rerun);
  assert.deepEqual(rerunStopped().responses, ['old answer', 'node.stoppedPlaceholder'], 'a cancelled rerun preserves the prior version without claiming it as new output');
  const history = stateFor();
  Object.assign(history.nodes[0].data, { response: 'earlier', responses: ['earlier'], responseIndex: 0, agentActivities: [[item('earlier', { status: 'completed' })]] });
  const liveRerun = { ...history.nodes[0].data, restreaming: true, agentActivity: [item('rerun-note', { kind: 'commentary', text: 'Checking' })] };
  const recovered = recoverInterruptedAgentRun(liveRerun, 'stopped', 300);
  assert.deepEqual(recovered.responses, ['earlier', 'stopped']);
  assert.equal(recovered.responseIndex, 1);
  assert.equal(activeAgentActivity(recovered)[0].id, 'rerun-note');
  assert.equal(activeAgentActivity(recovered)[0].status, 'interrupted');
  assert.equal(activeAgentActivity({ ...recovered, responseIndex: 0 })[0].id, 'earlier');
  assert.equal(recoverInterruptedAgentRun(recovered, 'stopped'), recovered, 'recovery does not append twice');
  assert.equal(liveRerun.isLoading, true, 'storage snapshots do not stop the live run');
  assert.equal(liveRerun.agentActivity[0].status, 'running');
  const recoveredPartial = recoverInterruptedAgentRun({ ...liveRerun, restreaming: undefined, response: 'actual partial' }, 'stopped', 300);
  assert.equal(recoveredPartial.responses[1], 'actual partial');
  const complete = await generate(async (_messages, _chunk, _signal, _images, callbacks) => { callbacks.onAgentActivity(item('new')); return 'new answer'; }, history, { versionMode: 'append' });
  assert.deepEqual(complete().agentActivities.map(entries => entries[0].id), ['earlier', 'new']);
  assert.equal(activeAgentActivity(complete())[0].status, 'completed');
  const empty = await generate(async (_messages, _chunk, _signal, _images, callbacks) => { callbacks.onAgentActivity(item('only-tool', { status: 'completed' })); return ''; });
  assert.equal(empty().agentActivities[0][0].id, 'only-tool', 'tool-only runs retain their activity');

  delete window.desktopAgents;
  let source;
  const posted = [];
  globalThis.EventSource = class {
    readyState = 0;
    constructor() { source = this; }
    close() { this.readyState = 2; }
  };
  globalThis.fetch = async (url, opts) => {
    if (opts?.method !== 'POST') return { ok: true, json: async () => ({ codex: 'available' }) };
    posted.push(url);
    return { ok: true, json: async () => url.endsWith('/run') ? { runId: 'http' } : { ok: true } };
  };
  await installAgentsHttpBridge('/api');
  const events = [];
  window.desktopAgents.onEvent(event => events.push(event));
  const starting = window.desktopAgents.run({ prompt: 'hello' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(posted.length, 0, 'run must wait until SSE is listening');
  source.readyState = 1; source.onopen();
  assert.equal(await starting, 'http');
  source.readyState = 0; source.onerror();
  assert.equal(events[0].event.type, 'run_error', 'a disconnected non-replayable stream cannot silently finish');
  assert.ok(posted.some(url => url.endsWith('/abort')));
  console.log('PASS: activity snapshots, concurrent early delivery, replacement text, error/abort flush, version history, tool-only turns, SSE readiness and disconnect.');
} finally {
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('td-activity-')) throw new Error('Unexpected test cleanup path');
  rmSync(temp, { recursive: true, force: true });
}
