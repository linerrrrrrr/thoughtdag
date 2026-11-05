#!/usr/bin/env node
// Isolated integration checks: source routing, native resume, controls and transport.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'td-codex-workflow-'));
const storeStub = `export const useStore = {getState:()=>globalThis.graph,setState:p=>Object.assign(globalThis.graph,typeof p==='function'?p(globalThis.graph):p)};`;
const projectsStub = `export const useProjects={getState:()=>globalThis.projects,setState:p=>Object.assign(globalThis.projects,typeof p==='function'?p(globalThis.projects):p)};
export const subscribedSessionIds=meta=>[meta.sourceSession?.sessionId].filter(Boolean),patchLedgerEntry=async()=>{},registerLedgerEntry=async()=>{},updateSourceSession=async()=>{};`;

try {
  const outfile = join(temp, 'workflow.mjs');
  await build({
    stdin: { contents: `export * from './lib/agents/agent-runtime'; export * from './lib/agents/http-bridge';
      export * from './lib/question-draft'; export * from './store/slices/llm';`, resolveDir: join(root, 'src'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'isolated-state', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        let contents;
        if (args.importer.endsWith('agent-runtime.ts')) {
          if (args.path === '../../store') contents = storeStub;
          if (args.path === '../../store/projects') contents = projectsStub;
          if (args.path === '../ui-store') contents = `export const useUiStore={getState:()=>globalThis.ui}; export const toast=(...args)=>globalThis.notices.push(args);`;
          if (args.path === '../../i18n') contents = 'export const t=x=>x;';
          if (args.path === '../adapters') contents = `export const anyRunnerSessionConversation=async()=>globalThis.conversation;`;
          if (args.path === '../adapters/codex-appserver') contents = `export const appServerThreadConversation=()=>globalThis.conversation;`;
          if (args.path === '../attachment-vault') contents = `export const loadAttachmentContent=async a=>a.content;`;
          if (args.path === '../atlas/dsh-bridge') contents = `export const currentDshSession=()=>null;`;
        }
        if (args.importer.endsWith('http-bridge.ts') && args.path === '../embedded') contents = 'export const IN_HARNESS_FRAME=false;';
        if (args.importer.endsWith('question-draft.ts')) {
          if (args.path === '../store') contents = storeStub;
          if (args.path === './ui-store') contents = `export const useUiStore={getState:()=>globalThis.ui};`;
        }
        if (args.importer.endsWith('llm.ts')) {
          if (args.path === '../streaming') contents = `export const activeAbortControllers=new Map(),autoRunCounts=new Map();
            export const runNodeGeneration=async(_set,_get,nodeId,request)=>globalThis.generated.push({nodeId,request}),triggerParadigmCascade=()=>{};`;
          if (args.path === '../../lib/ui-store') contents = `export const useUiStore={getState:()=>globalThis.ui},toast=()=>{},recallSnapshot=()=>({recall:false});`;
          if (args.path === '../../lib/stale-judge') contents = 'export const shownStaleIds=()=>new Set();';
          if (args.path === '../../i18n') contents = 'export const t=x=>x,fmt=x=>x;';
        }
        if (args.importer.endsWith('condense-guard.ts')) {
          if (args.path === './ui-store') contents = `export const useUiStore={getState:()=>globalThis.ui},toast=()=>{};`;
          if (args.path === '../i18n') contents = 'export const t=x=>x;';
        }
        if (args.importer.endsWith('context-builder.ts') && args.path === '../lib/attachments') {
          contents = 'export const attachmentFingerprint=a=>a.id;';
        }
        if (contents) return { path: `${args.importer}:${args.path}`, namespace: 'test-state', pluginData: contents };
      });
      b.onLoad({ filter: /.*/, namespace: 'test-state' }, args => ({ contents: args.pluginData, loader: 'js' }));
    } }],
  });
  globalThis.ui = { condenseRun: { status: 'idle' }, selectedModel: 'api/global' };
  globalThis.notices = [];
  globalThis.graph = { nodes: [], edges: [] };
  globalThis.projects = { activeId: 'canvas', projects: [{ id: 'canvas' }] };
  globalThis.localStorage = { getItem: () => null };
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, location: { origin: 'http://localhost' } };
  const { deriveFollowupModel, agentOutbound, previewAgentFollowup, sessionAllowRules, agentCallStream,
    canSteerAgentNode, steerAgentNode, requestAgentStop, adoptAgentTurn, installAgentsHttpBridge,
    createQuestionDraft, createLlmSlice } = await import(pathToFileURL(outfile));
  const sid = '11111111-1111-4111-8111-111111111111';
  const source = (id, cwd = 'D:\\source') => ({ id, data: { question: `q-${id}`, response: `a-${id}`, responses: [`a-${id}`], responseIndex: 0,
    importSource: { runner: 'codex', sessionId: sid, itemIds: [id], cwd }, source: { question: `q-${id}`, response: `a-${id}` }, isLoading: false } });
  let workspaceCalls = 0;
  let deliver;
  const sent = [], aborted = [], steered = [];
  window.desktopAgents = {
    models: async () => ({ installed: true, models: [{ provider: 'codex', id: 'native-model', name: 'native' }], default: 'codex/native-model' }),
    workspace: async () => { workspaceCalls++; return 'D:\\canvas'; },
    guardWrite: async () => true,
    writeMaterials: async () => ({ dir: null, written: [] }),
    onEvent: cb => { deliver = cb; },
    abort: async id => { aborted.push(id); return true; },
    steer: async (id, prompt) => { steered.push([id, prompt]); return true; },
    run: async req => {
      sent.push(req);
      const runId = `run-${sent.length}`;
      deliver({ runId, event: { type: 'session', sessionId: sid, sessionFile: null, cwd: req.cwd } });
      if (!req.prompt.endsWith('wait')) deliver({ runId, event: { type: 'run_end', how: 'end', text: 'completed' } });
      return runId;
    },
  };
  const parent = source('parent');
  assert.equal(deriveFollowupModel(parent.data, 'api/chat'), 'codex/codex/default', 'Codex imports cannot silently become API chats');
  assert.equal(deriveFollowupModel({ ...parent.data, model: 'api/chosen' }, 'codex/codex/native-model'), 'api/chosen', 'an explicit user model pin wins');
  assert.equal(deriveFollowupModel(parent.data, 'codex/codex/chosen'), 'codex/codex/chosen');
  assert.equal(deriveFollowupModel({ question: 'ordinary' }, 'api/global'), undefined, 'ordinary questions retain global selection');

  // A continuation is a new empty node; it performs no transport work until
  // that node is explicitly sent. The same creator serves wire and text drags.
  let historyWrites = 0;
  globalThis.generated = [];
  const setGraph = patch => Object.assign(graph, typeof patch === 'function' ? patch(graph) : patch);
  Object.assign(graph, createLlmSlice(setGraph, () => graph, {}), { pushHistory: () => { historyWrites++; }, logEvent() {} });
  parent.position = { x: 100, y: 100 }; parent.height = 700; parent.width = 520;
  Object.assign(parent.data, { detailLevel: 'full', isCollapsed: false, layoutDirection: 'vertical', edgeRouteDefault: 'curve', attachments: [], highlights: [], roleMode: 'inherit' });
  parent.selected = true;
  graph.nodes = [parent]; graph.edges = [];
  projects.projects[0].sourceSession = { runner: 'codex', sessionId: sid, tailNodeId: 'parent', importedCount: 1 };
  const draftId = createQuestionDraft({ parentId: 'parent', position: { x: 600, y: 250 } });
  const draft = graph.nodes.find(node => node.id === draftId);
  assert.ok(draft);
  assert.equal(draft.data.question, ''); assert.equal(draft.data.response, '');
  assert.equal(draft.data.isLoading, false); assert.equal(draft.data.isEditing, true);
  assert.equal(draft.data.questionEditor, 'canvas');
  assert.equal(draft.data.model, 'codex/codex/default');
  assert.equal(draft.data.layoutDirection, 'vertical'); assert.equal(draft.data.edgeRouteDefault, 'curve');
  assert.deepEqual(draft.position, { x: 600, y: 250 });
  assert.deepEqual(graph.selectedNodeIds, [draftId]); assert.equal(graph.nodes[0].selected, false);
  assert.equal(historyWrites, 2); assert.equal(generated.length, 0); assert.equal(sent.length, 0);
  assert.deepEqual(await agentOutbound(draft.data.model, draftId), { cwd: 'D:\\source', sessionId: sid, sessionPath: sid, continue: true });
  parent.data.isLoading = true;
  assert.equal((await agentOutbound(draft.data.model, draftId)).continue, undefined, 'an active source turn is not resumed');
  parent.data.isLoading = false;
  graph.edges[0].selected = true;
  const branchId = createQuestionDraft({ parentId: 'parent', branchContext: 'SELECTED_PASSAGE', branchYRatio: 0.3, editor: 'panel' });
  const branch = graph.nodes.find(node => node.id === branchId);
  assert.equal(branch.data.questionEditor, 'panel'); assert.equal(branch.data.isBranch, true);
  assert.equal(graph.edges.at(-1).data.branchYRatio, 0.3);
  assert.equal(graph.edges.some(edge => edge.selected), false, 'creating a draft clears edge selection too');
  assert.equal((await agentOutbound(branch.data.model, branchId)).continue, undefined, 'a selected passage compiles its own context');
  await graph.editQuestion(branchId, 'Explain the selection');
  assert.equal(generated.length, 1);
  assert.equal(generated[0].nodeId, branchId, 'sending the draft fills that node without creating another turn');
  assert.equal(graph.nodes.length, 3);
  assert.ok(generated[0].request.messages.some(message => message.content.includes('SELECTED_PASSAGE')), 'the selected passage reaches the generated request');
  assert.equal(generated[0].request.messages.at(-1).content, 'Explain the selection');
  ui.condenseRun.status = 'building';
  assert.equal(createQuestionDraft({ parentId: 'parent' }), null, 'the graph build lock blocks draft creation');
  ui.condenseRun.status = 'idle';
  assert.equal(createQuestionDraft({ parentId: 'missing' }), null);
  assert.equal(graph.nodes.length, 3);

  const child = { id: 'child', data: { question: 'follow', response: '', responses: [], responseIndex: -1, isLoading: true } };
  graph.nodes = [parent, source('other', 'C:\\elsewhere'), child];
  graph.edges = [{ source: 'parent', target: 'child' }];
  projects.projects[0].sourceSession = { runner: 'codex', sessionId: sid, tailNodeId: 'parent', importedCount: 1 };
  const resumed = await agentOutbound('codex/codex/default', 'child');
  assert.deepEqual(resumed, { cwd: 'D:\\source', sessionId: sid, sessionPath: sid, continue: true });
  assert.equal(workspaceCalls, 0, 'opening a source-backed composer must not create a workspace');
  assert.deepEqual(await previewAgentFollowup('parent', 'codex/codex/default'), resumed);
  assert.equal((await previewAgentFollowup('parent', 'codex/codex/default', { hasAttachments: true })).continue, undefined);
  assert.equal((await previewAgentFollowup('parent', 'codex/codex/default', { hasReferences: true })).continue, undefined);
  projects.projects[0].agentCwd = 'd:/SOURCE/';
  assert.equal((await agentOutbound('codex/native-model', 'child')).continue, true, 'Windows separators/case do not break native resume');
  projects.projects[0].agentCwd = 'D:\\different';
  assert.equal((await agentOutbound('codex/native-model', 'child')).continue, undefined, 'changing the working directory starts compiled context');
  delete projects.projects[0].agentCwd;
  child.data.branchContext = 'selected text';
  assert.equal((await agentOutbound('codex/native-model', 'child')).continue, undefined, 'selection branches must not secretly resume the whole native thread');
  delete child.data.branchContext;
  parent.data.response = 'edited answer';
  assert.equal((await agentOutbound('codex/native-model', 'child')).continue, undefined, 'edited context must actually reach the agent');
  parent.data.response = parent.data.source.response;
  graph.nodes.push({ id: 'rules', data: { importSource: { sessionId: 'unrelated' }, approvals: [{ outcome: 'allowed-session', rule: 'codex:danger' }] } });
  parent.data.approvals = [{ outcome: 'allowed-session', rule: 'codex:read' }];
  assert.deepEqual(sessionAllowRules('codex', resumed, graph.nodes), ['codex:read']);
  assert.deepEqual(sessionAllowRules('codex', { cwd: resumed.cwd }, graph.nodes), [], 'fresh branches inherit no session-wide authorizations');

  const callbackModels = [];
  const messages = [{ role: 'assistant', content: 'history should stay native' }, { role: 'user', content: 'next' }];
  assert.equal(await agentCallStream(messages, () => {}, undefined, undefined,
    { onRerouted: (_from, to) => callbackModels.push(to) }, 'codex/codex/default', resumed, 'child'), 'completed');
  assert.equal(sent[0].prompt, 'next');
  assert.equal(sent[0].sessionPath, sid);
  assert.deepEqual(sent[0].allowRules, ['codex:read']);
  assert.deepEqual(callbackModels, ['codex/codex/native-model'], 'provenance records the actual configured model');
  await agentCallStream(messages, () => {}, undefined, undefined, undefined, 'codex/native-model', { cwd: 'D:\\source' }, 'child');
  assert.match(sent[1].prompt, /history should stay native/);
  assert.equal(sent[1].sessionPath, undefined);

  const preCancelled = new AbortController(); preCancelled.abort();
  const beforeCancel = sent.length;
  await assert.rejects(agentCallStream(messages, () => {}, preCancelled.signal, undefined, undefined, 'codex/native-model', resumed, 'child'), e => e.name === 'AbortError');
  assert.equal(sent.length, beforeCancel, 'an already stopped request never dispatches');
  window.desktopAgents.guardWrite = async () => false;
  await assert.rejects(agentCallStream(messages, () => {}, undefined, undefined, undefined, 'codex/native-model', resumed, 'child'), /permissions could not be saved/);
  assert.equal(sent.length, beforeCancel, 'a stale guard file cannot silently authorize a run');
  window.desktopAgents.guardWrite = async () => true;

  const controller = new AbortController();
  const running = agentCallStream([{ role: 'user', content: 'wait' }], () => {}, controller.signal, undefined, undefined, 'codex/native-model', resumed, 'child');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(canSteerAgentNode('child'), true);
  await steerAgentNode('child', '  focus on tests  ');
  assert.equal(child.data.question, 'follow', 'state updates do not mutate previous node objects');
  assert.equal(graph.nodes.find(n => n.id === 'child').data.question, 'follow\n\nfocus on tests');
  assert.deepEqual(steered.at(-1), ['run-3', 'focus on tests']);
  window.desktopAgents.steer = async () => { throw new Error('not active'); };
  await assert.rejects(steerAgentNode('child', 'retain this draft'), /not active/);
  assert.equal(graph.nodes.find(n => n.id === 'child').data.question.includes('retain this draft'), false);
  controller.abort();
  await assert.rejects(running, e => e.name === 'AbortError');
  assert.deepEqual(aborted, ['run-3']);
  assert.equal(canSteerAgentNode('child'), false);
  window.desktopAgents.abort = async () => false;
  const stopRetry = agentCallStream([{ role: 'user', content: 'wait' }], () => {}, undefined, undefined, undefined, 'codex/native-model', resumed, 'child');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(requestAgentStop('child'), true);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(canSteerAgentNode('child'), true, 'a rejected stop retains the active control handle');
  assert.equal(notices.at(-1)[1], 'agent.stopFailed');
  window.desktopAgents.abort = async () => true;
  assert.equal(requestAgentStop('child'), true, 'Stop can be retried without a new AbortController');
  await assert.rejects(stopRetry, e => e.name === 'AbortError');

  // A native Windows rollout must be adopted even if root and file casing
  // and separators differ. The augmented question remains the user's work.
  window.desktopSessions = { roots: async () => [{ key: 'codex-sessions', path: 'C:\\Users\\A\\.codex\\sessions' }], read: async (_root, rel) => {
    assert.equal(rel, '2026/rollout.jsonl'); return 'session contents';
  } };
  globalThis.conversation = { sessionId: sid, build: () => ({ nodes: [source('native')], edges: [] }) };
  assert.equal(await adoptAgentTurn('child', { runtime: 'codex', sessionId: sid, sessionFile: 'c:/users/a/.codex/sessions/2026/rollout.jsonl', cwd: 'D:\\source' }, 'follow\n\nfocus on tests'), true);
  assert.equal(graph.nodes.find(n => n.id === 'child').data.question, 'follow\n\nfocus on tests');
  window.desktopSessions.codexThreadRead = async id => { assert.equal(id, sid); return { id: sid, turns: [] }; };
  assert.equal(await adoptAgentTurn('child', { runtime: 'codex', sessionId: sid, sessionFile: null, cwd: 'D:\\source' }, 'follow\n\nfocus on tests'), true, 'a native thread without a rollout uses thread/read');
  graph.nodes = [{ ...source('fresh'), data: { ...source('fresh').data, importSource: undefined, source: undefined,
    agentSession: { runtime: 'codex', sessionId: sid, sessionFile: null, cwd: 'D:\\source' } } }];
  graph.edges = [];
  delete projects.projects[0].sourceSession;
  assert.equal((await previewAgentFollowup('fresh', 'codex/codex/default')).continue, true, 'acknowledged sessions remain usable before a rollout is available');

  // HTTP controls preserve server error details, and file links use the same host.
  delete window.desktopAgents;
  globalThis.fetch = async (url, init) => ({ ok: !url.endsWith('/steer'), status: 409, json: async () => init?.method === 'POST' ? { error: 'turn already finished' } : { codex: 'available' } });
  assert.equal(await installAgentsHttpBridge('/api'), true);
  assert.equal(typeof window.desktopLocal.open, 'function');
  await assert.rejects(window.desktopAgents.steer('run', 'hello'), /turn already finished/);
  console.log('PASS: Codex source model, node cwd/native resume, explicit context branches, session permissions, actual model provenance, early/active stop, accepted/rejected steering, Windows adoption, HTTP diagnostics and file bridge.');
} finally {
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('td-codex-workflow-')) throw new Error('Unexpected test cleanup path');
  rmSync(temp, { recursive: true, force: true });
}
