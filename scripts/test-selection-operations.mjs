#!/usr/bin/env node
// Selection, copying, frame creation and history remain independent of retired metadata.
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-selection-operations-'));
const bundle = join(temporary, 'selection-operations.mjs');
const stubs = {
  'condense-guard': 'export const condenseGuard = () => false;',
  'ui-store': 'export const toast = () => "";',
  i18n: 'export const t = (key) => key; export const fmt = (text) => text;',
  'context-builder': 'export const referenceBlockContent = () => ""; export const upstreamFingerprint = () => ""; export const buildContext = () => ({messages: []});',
  streaming: 'export const activeAbortControllers = new Map();',
  canonical: 'export const unsubscribeOrphanedSessions = () => {};',
  'stale-judge': 'export const judgeStaleness = () => {};',
  projects: 'export const useProjects = { getState: () => ({ activeId: "test-project" }), subscribe: () => () => {} };',
};
let failures = 0;
async function test(label, run) {
  try { await run(); console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}\n${error.stack}`); }
}

try {
  await build({
    stdin: { contents: `
      export * from './lib/frames';
      import { create } from 'zustand';
      import { createNodeSlice } from './store/slices/nodes';
      import { createHistorySlice } from './store/slices/history';
      export const makeStore = () => create((...args) => ({ ...createNodeSlice(...args), ...createHistorySlice(...args), events: [], logEvent: () => {} }));
    `, resolveDir: join(root, 'src'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.DEV': 'false' },
    plugins: [{ name: 'unrelated-runtime-stubs', setup(builder) {
      builder.onResolve({ filter: /(condense-guard|ui-store|i18n|context-builder|streaming|atlas\/canonical|stale-judge|projects)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const { makeStore, frameMembers, resolveCarriedNodeIds, nodeRect } = await import(pathToFileURL(bundle).href);
  const node = (id, x = 0, y = 0) => ({ id, type: 'thought', position: { x, y }, width: 200, height: 100, data: {
    question: id, response: 'answer', responses: ['answer'], responseIndex: 0,
    isCollapsed: false, isLoading: false, isEditing: false, isEditingResponse: false,
    attachments: [], highlights: [], tokenCount: 0,
  } });
  const start = (legacy = false) => {
    const store = makeStore();
    const nodes = [node('a'), node('b', 300, 200), node('c', 700, 400), node('d', 1000, 600)]
      .map((n, index) => legacy && index < 2 ? { ...n, data: { ...n.data, canvasGroupId: 'retired', previousCanvasGroupId: 'older' } } : n);
    const edges = [{ id: 'a-b', source: 'a', target: 'b', data: {} }];
    store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
    return store;
  };

  await test('retired grouping actions are absent from the store', () => {
    const state = start().getState();
    for (const name of ['groupSelection', 'ungroupSelection', 'regroupSelection']) assert.equal(name in state, false);
  });
  await test('selection stays exact even when old metadata links saved nodes', () => {
    const store = start(true), state = () => store.getState();
    state().setSelectedNodeId('b');
    assert.deepEqual(state().selectedNodeIds, ['b']);
    assert.deepEqual(state().nodes.filter(n => n.selected).map(n => n.id), ['b']);
    state().setSelectedNodeIds(['a', 'c']);
    assert.deepEqual(state().selectedNodeIds, ['a', 'c']);
    state().setSelectedNodeIds([]);
    assert.ok(state().nodes.every(n => !n.selected));
    assert.equal(state().historyIndex, 0, 'Selecting objects does not record geometry history');
  });
  await test('selection normalizes missing and duplicate IDs without expanding old metadata', () => {
    const store = start(true);
    store.getState().setSelectedNodeIds(['b', 'b', 'missing']);
    assert.deepEqual(store.getState().selectedNodeIds, ['b']);
    assert.deepEqual(store.getState().nodes.filter(n => n.selected).map(n => n.id), ['b']);
    store.getState().setSelectedNodeId('missing');
    assert.deepEqual(store.getState().selectedNodeIds, []);
  });
  await test('selection copies retain internal edges, omit retired metadata and undo atomically', () => {
    const store = start(true), state = () => store.getState();
    const original = state().nodes;
    state().duplicateSelection(['a', 'b']);
    const copies = state().nodes.slice(4);
    assert.equal(copies.length, 2);
    assert.ok(copies.every(n => !Object.hasOwn(n.data, 'canvasGroupId') && !Object.hasOwn(n.data, 'previousCanvasGroupId')));
    assert.equal(state().nodes[0], original[0]); assert.equal(state().nodes[1], original[1]);
    assert.equal(state().edges.length, 2);
    assert.equal(state().edges[1].source, copies[0].id); assert.equal(state().edges[1].target, copies[1].id);
    assert.deepEqual(state().selectedNodeIds, copies.map(n => n.id));
    assert.equal(copies[1].position.x - copies[0].position.x, 300);
    assert.equal(copies[1].position.y - copies[0].position.y, 200);
    state().undo(); assert.equal(state().nodes.length, 4);
    state().redo(); assert.equal(state().nodes.length, 6);
  });
  await test('single and partial copies discard retired metadata without changing originals', () => {
    const store = start(true), state = () => store.getState();
    state().duplicateSelection(['a']);
    assert.equal(state().nodes.length, 5);
    assert.equal(state().edges.length, 1, 'A selection copy has no boundary wire to the original graph');
    assert.equal(state().nodes.at(-1).data.canvasGroupId, undefined);
    assert.equal(state().nodes.at(-1).data.previousCanvasGroupId, undefined);
    state().duplicateNode('b');
    const copy = state().nodes.at(-1);
    assert.equal(copy.data.canvasGroupId, undefined); assert.equal(copy.data.previousCanvasGroupId, undefined);
    assert.equal(state().edges.at(-1).target, copy.id, 'A single node duplicate retains its original parent relationship');
    assert.equal(state().nodes[0].data.canvasGroupId, 'retired');
    assert.equal(state().nodes[1].data.previousCanvasGroupId, 'older');
  });
  await test('legacy metadata does not block whole-canvas or selection layout and undo', async () => {
    for (const arrange of [state => state.relayout(), state => state.alignSelection(['a', 'b', 'c'])]) {
      const store = start(true); const state = () => store.getState();
      const before = state();
      await arrange(state());
      assert.notDeepEqual(state().nodes.map(n => n.position), before.nodes.map(n => n.position));
      assert.deepEqual(state().nodes.map(n => n.data.canvasGroupId), before.nodes.map(n => n.data.canvasGroupId));
      assert.equal(state().historyIndex, before.historyIndex + 1);
      state().undo();
      assert.deepEqual(state().nodes.map(n => n.position), before.nodes.map(n => n.position));
    }
  });
  await test('legacy selection layout ignores missing or duplicate IDs without recording history', async () => {
    const store = start(); const before = store.getState();
    for (const ids of [['missing-a', 'missing-b'], ['a', 'missing-b'], ['a', 'a']]) {
      await store.getState().alignSelection(ids);
      assert.equal(store.getState().nodes, before.nodes);
      assert.equal(store.getState().history, before.history);
      assert.equal(store.getState().historyIndex, before.historyIndex);
    }
  });
  await test('focusing and selecting imported nodes remain exact', () => {
    const store = start(true); const state = () => store.getState();
    state().setSelectedNodeId('b', { focus: true });
    assert.equal(state().selectedNodeId, 'b');
    assert.deepEqual(state().selectedNodeIds, ['b']);
    assert.deepEqual(state().nodes.filter(n => n.selected).map(n => n.id), ['b']);
    state().setSelectedNodeIds(['a']);
    assert.equal(state().selectedNodeId, 'a');
    assert.deepEqual(state().selectedNodeIds, ['a']);
    assert.equal(state().nodes[0].data.canvasGroupId, state().nodes[1].data.canvasGroupId);
  });
  await test('creating a frame preserves original positions and edges, and is undoable', () => {
    const store = start(true); const state = () => store.getState();
    store.setState({ nodes: state().nodes.map(n => n.id === 'b' ? { ...n, measured: { width: 260, height: 160 } } : n) });
    const before = state();
    const frameId = state().createFrameFromSelection(['b']);
    const frame = state().nodes.find(n => n.id === frameId);
    assert.ok(frame);
    assert.equal(frame.data.stepKind, 'frame');
    assert.equal(frame.data.question, '');
    assert.equal(frame.data.frameCarry, true);
    assert.equal(frame.data.canvasGroupId, undefined);
    assert.deepEqual(frame.position, { x: 268, y: 136 });
    assert.equal(frame.width, 324);
    assert.equal(frame.height, 256);
    assert.equal(state().edges, before.edges);
    for (const original of before.nodes) {
      const current = state().nodes.find(n => n.id === original.id);
      assert.equal(current.data, original.data);
      assert.equal(current.position, original.position);
    }
    assert.equal(state().selectedNodeId, frameId);
    assert.deepEqual(state().selectedNodeIds, [frameId]);
    assert.deepEqual(frameMembers(frame, state().nodes).map(n => n.id), ['b']);
    state().undo(); assert.equal(state().nodes.length, 4);
    state().redo(); assert.equal(state().nodes.length, 5);
    const restored = JSON.parse(JSON.stringify(state().nodes));
    assert.deepEqual(resolveCarriedNodeIds(restored, [frameId]), ['b', frameId]);
  });
  await test('frame creation and legacy selection layout reject frame targets without recording history', async () => {
    const store = start(); const state = () => store.getState();
    const frameId = state().createFrameFromSelection(['a', 'b']);
    const before = state();
    assert.equal(state().createFrameFromSelection([frameId, 'c']), undefined);
    assert.equal(state().createFrameFromSelection(['missing']), undefined);
    assert.equal(state().history, before.history);
    await state().alignSelection([frameId, 'c']);
    assert.equal(state().nodes, before.nodes);
    assert.equal(state().history, before.history);
  });
  await test('frame carry ignores legacy metadata shared by inside and outside nodes', () => {
    const frame = { ...node('frame'), width: 500, height: 500, data: { ...node('frame').data, stepKind: 'frame', frameCarry: true } };
    const a = { ...node('a', 40, 100), data: { ...node('a').data, canvasGroupId: 'cross' } };
    const b = { ...node('b', 440, 300), data: { ...node('b').data, canvasGroupId: 'cross' } };
    const single = node('single', 450, 50); single.width = 50;
    const nodes = [frame, a, b, single];
    assert.deepEqual(frameMembers(frame, nodes).map(n => n.id), ['a', 'single']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['frame']), ['frame', 'a', 'single']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['a']), ['a']);
    const inside = nodes.map(n => n.id === 'b' ? { ...n, position: { x: 250, y: 300 } } : n);
    assert.deepEqual(resolveCarriedNodeIds(inside, ['frame']), ['frame', 'a', 'b', 'single']);
  });
  await test('nested linked frames recurse and legacy frame group metadata remains inert', () => {
    const outer = { ...node('outer'), width: 600, height: 600, data: { ...node('outer').data, stepKind: 'frame', frameCarry: true, canvasGroupId: 'legacy' } };
    const inner = { ...node('inner', 50, 60), width: 300, height: 300, data: { ...node('inner').data, stepKind: 'frame', frameCarry: true } };
    const card = node('card', 80, 120);
    const outside = { ...node('outside', 900, 900), data: { ...node('outside').data, canvasGroupId: 'legacy' } };
    const nodes = [outer, inner, card, outside];
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['outside']), ['outside']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['outer']), ['outer', 'inner', 'card']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['inner']), ['inner', 'card']);
    assert.deepEqual(nodeRect({ ...card, measured: { width: 123, height: 87 } }), { x: 80, y: 120, width: 123, height: 87 });
  });
} finally {
  if (existsSync(bundle)) unlinkSync(bundle);
  rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
