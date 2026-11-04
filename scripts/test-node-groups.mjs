#!/usr/bin/env node
// Explicit grouping is spatial only, undoable, and cannot alias copies to originals.
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-groups-'));
const bundle = join(temporary, 'groups.mjs');
const stubs = {
  'condense-guard': 'export const condenseGuard = () => false;',
  'ui-store': 'export const toast = () => "";',
  i18n: 'export const t = (key) => key; export const fmt = (text) => text;',
  'context-builder': 'export const referenceBlockContent = () => ""; export const upstreamFingerprint = () => ""; export const buildContext = () => ({messages: []});',
  streaming: 'export const activeAbortControllers = new Map();',
  canonical: 'export const unsubscribeOrphanedSessions = () => {};',
  'stale-judge': 'export const judgeStaleness = () => {};',
};
let failures = 0;
function test(label, run) {
  try { run(); console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}\n${error.stack}`); }
}

try {
  await build({
    stdin: { contents: `
      export * from './lib/node-groups';
      export * from './lib/frames';
      import { create } from 'zustand';
      import { createNodeSlice } from './store/slices/nodes';
      import { createHistorySlice } from './store/slices/history';
      export const makeStore = () => create((...args) => ({ ...createNodeSlice(...args), ...createHistorySlice(...args), events: [], logEvent: () => {} }));
    `, resolveDir: join(root, 'src'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.DEV': 'false' },
    plugins: [{ name: 'unrelated-runtime-stubs', setup(builder) {
      builder.onResolve({ filter: /(condense-guard|ui-store|i18n|context-builder|streaming|atlas\/canonical|stale-judge)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const { makeStore, expandGroupSelection, canGroup, canUngroup, canRegroup, applyGroupSelectionChanges, frameMembers, resolveCarriedNodeIds, nodeRect } = await import(pathToFileURL(bundle).href);
  const node = (id, x = 0, y = 0) => ({ id, type: 'thought', position: { x, y }, width: 200, height: 100, data: {
    question: id, response: 'answer', responses: ['answer'], responseIndex: 0,
    isCollapsed: false, isLoading: false, isEditing: false, isEditingResponse: false,
    attachments: [], highlights: [], tokenCount: 0,
  } });
  const start = () => {
    const store = makeStore();
    const nodes = [node('a'), node('b', 300, 200), node('c', 700, 400), node('d', 1000, 600)];
    const edges = [{ id: 'a-b', source: 'a', target: 'b', data: {} }];
    store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
    return store;
  };

  test('grouping preserves node geometry, content, and context edges', () => {
    const store = start(); const before = store.getState();
    store.getState().groupSelection(['a', 'b']);
    const after = store.getState();
    assert.equal(after.edges, before.edges);
    for (let i = 0; i < before.nodes.length; i++) {
      assert.deepEqual(after.nodes[i].position, before.nodes[i].position);
      assert.equal(after.nodes[i].data.question, before.nodes[i].data.question);
    }
    assert.ok(after.nodes[0].data.canvasGroupId);
    assert.equal(after.nodes[0].data.canvasGroupId, after.nodes[1].data.canvasGroupId);
    assert.deepEqual(expandGroupSelection(after.nodes, ['b']), ['a', 'b']);
    assert.equal(canGroup(after.nodes, ['a', 'b']), false);
    assert.equal(canUngroup(after.nodes, ['a']), true);
  });
  test('selecting one group member selects the whole group, clearing clears flags', () => {
    const store = start(); store.getState().groupSelection(['a', 'b']);
    store.getState().setSelectedNodeId(null);
    store.getState().setSelectedNodeId('b');
    assert.deepEqual(store.getState().selectedNodeIds, ['a', 'b']);
    assert.deepEqual(store.getState().nodes.filter(n => n.selected).map(n => n.id), ['a', 'b']);
    store.getState().setSelectedNodeId('c');
    assert.deepEqual(store.getState().selectedNodeIds, ['c']);
    assert.deepEqual(store.getState().nodes.filter(n => n.selected).map(n => n.id), ['c']);
    store.getState().setSelectedNodeIds([]);
    assert.ok(store.getState().nodes.every(n => !n.selected));
  });
  test('React Flow selection and deselection preserve group boundaries', () => {
    const store = start(); store.getState().groupSelection(['a', 'b']);
    const nodes = store.getState().nodes;
    assert.ok(applyGroupSelectionChanges(nodes, [{ id: 'a', selected: false }]).slice(0, 2).every(n => !n.selected));
    assert.ok(applyGroupSelectionChanges(nodes, [{ id: 'a', selected: false }, { id: 'b', selected: true }]).slice(0, 2).every(n => n.selected));
  });
  test('group, ungroup, and regroup each undo and redo independently', () => {
    const store = start(); const state = () => store.getState();
    state().groupSelection(['a', 'b']); const group = state().nodes[0].data.canvasGroupId;
    state().ungroupSelection(['a']);
    assert.equal(state().nodes[1].data.canvasGroupId, undefined);
    assert.equal(canRegroup(state().nodes, ['b']), true);
    state().regroupSelection(['b']);
    assert.equal(state().nodes[0].data.canvasGroupId, group);
    state().undo(); assert.equal(state().nodes[0].data.canvasGroupId, undefined);
    state().undo(); assert.equal(state().nodes[0].data.canvasGroupId, group);
    state().undo(); assert.equal(state().nodes[0].data.canvasGroupId, undefined);
    state().redo(); state().redo(); state().redo();
    assert.equal(state().nodes[1].data.canvasGroupId, group);
  });
  test('regroup cannot steal members subsequently placed in another group', () => {
    const store = start(); const state = () => store.getState();
    state().groupSelection(['a', 'b']); state().ungroupSelection(['a']);
    state().groupSelection(['b', 'c']);
    assert.equal(canRegroup(state().nodes, ['a']), false);
    const group = state().nodes[1].data.canvasGroupId;
    state().regroupSelection(['a']);
    assert.equal(state().nodes[0].data.canvasGroupId, undefined);
    assert.equal(state().nodes[1].data.canvasGroupId, group);
  });
  test('regroup ignores deleted members and requires two living members', () => {
    const store = start(); const state = () => store.getState();
    state().groupSelection(['a', 'b', 'c']); state().ungroupSelection(['a']);
    store.setState({ nodes: state().nodes.filter(n => n.id !== 'b') });
    state().regroupSelection(['a']);
    assert.deepEqual(state().selectedNodeIds, ['a', 'c']);
    state().ungroupSelection(['a']);
    store.setState({ nodes: state().nodes.filter(n => n.id !== 'c') });
    assert.equal(canRegroup(state().nodes, ['a']), false);
  });
  test('combining a group and another node includes every previous member', () => {
    const store = start(); const state = () => store.getState();
    state().groupSelection(['a', 'b']); state().groupSelection(['b', 'c']);
    assert.deepEqual(state().selectedNodeIds, ['a', 'b', 'c']);
    assert.equal(new Set(state().nodes.slice(0, 3).map(n => n.data.canvasGroupId)).size, 1);
  });
  test('duplicated complete groups get their own group ID and retained inner edges', () => {
    const store = start(); const state = () => store.getState();
    state().groupSelection(['a', 'b']); const group = state().nodes[0].data.canvasGroupId;
    state().duplicateSelection(['a', 'b']);
    const copies = state().nodes.slice(4);
    assert.equal(copies.length, 2);
    assert.ok(copies[0].data.canvasGroupId);
    assert.notEqual(copies[0].data.canvasGroupId, group);
    assert.equal(copies[0].data.canvasGroupId, copies[1].data.canvasGroupId);
    assert.equal(state().edges.length, 2);
    state().undo(); assert.equal(state().nodes.length, 4);
    state().redo(); assert.equal(state().nodes.length, 6);
  });
  test('single and partial copies never inherit the original group or regroup history', () => {
    const store = start(); const state = () => store.getState();
    state().groupSelection(['a', 'b']); state().duplicateSelection(['a']);
    assert.equal(state().nodes.at(-1).data.canvasGroupId, undefined);
    state().duplicateNode('a');
    assert.equal(state().nodes.at(-1).data.canvasGroupId, undefined);
    state().ungroupSelection(['a']); state().duplicateSelection(['a', 'b']);
    assert.ok(state().nodes.slice(-2).every(n => !n.data.previousCanvasGroupId));
  });
  test('group metadata survives ordinary JSON persistence', () => {
    const store = start(); store.getState().groupSelection(['a', 'b']);
    const restored = JSON.parse(JSON.stringify(store.getState().nodes));
    assert.deepEqual(expandGroupSelection(restored, ['a']), ['a', 'b']);
  });
  test('legacy layouts cannot change grouped geometry or create a history step', () => {
    for (const arrange of [state => state.relayout(), state => state.alignSelection(['a', 'b', 'c'])]) {
      const store = start(); const state = () => store.getState();
      state().groupSelection(['a', 'b']);
      const before = state();
      arrange(state());
      assert.equal(state().nodes, before.nodes);
      assert.equal(state().history, before.history);
      assert.equal(state().historyIndex, before.historyIndex);
      state().ungroupSelection(['a']);
      const ungrouped = state();
      arrange(state());
      assert.notDeepEqual(state().nodes.map(n => n.position), ungrouped.nodes.map(n => n.position));
      assert.equal(state().historyIndex, ungrouped.historyIndex + 1);
      state().undo();
      assert.deepEqual(state().nodes.map(n => n.position), ungrouped.nodes.map(n => n.position));
    }
  });
  test('legacy selection layout ignores missing or duplicate IDs without recording history', () => {
    const store = start(); const before = store.getState();
    for (const ids of [['missing-a', 'missing-b'], ['a', 'missing-b'], ['a', 'a']]) {
      store.getState().alignSelection(ids);
      assert.equal(store.getState().nodes, before.nodes);
      assert.equal(store.getState().history, before.history);
      assert.equal(store.getState().historyIndex, before.historyIndex);
    }
  });
  test('focusing a group member preserves the rigid selection for spatial actions', () => {
    const store = start(); const state = () => store.getState();
    state().groupSelection(['a', 'b']);
    state().setSelectedNodeId('b', { focus: true });
    assert.equal(state().selectedNodeId, 'b');
    assert.deepEqual(state().selectedNodeIds, ['a', 'b']);
    assert.deepEqual(state().nodes.filter(n => n.selected).map(n => n.id), ['a', 'b']);
    state().setSelectedNodeIds(['a']);
    assert.equal(state().selectedNodeId, null);
    assert.deepEqual(state().selectedNodeIds, ['a', 'b']);
  });
  test('creating a frame preserves original positions, groups and edges, and is undoable', () => {
    const store = start(); const state = () => store.getState();
    state().groupSelection(['a', 'b']);
    store.setState({ nodes: state().nodes.map(n => n.id === 'b' ? { ...n, measured: { width: 260, height: 160 } } : n) });
    const before = state();
    const frameId = state().createFrameFromSelection(['b']);
    const frame = state().nodes.find(n => n.id === frameId);
    assert.ok(frame);
    assert.equal(frame.data.stepKind, 'frame');
    assert.equal(frame.data.question, '');
    assert.equal(frame.data.frameCarry, true);
    assert.equal(frame.data.canvasGroupId, undefined);
    assert.deepEqual(frame.position, { x: -32, y: -64 });
    assert.equal(frame.width, 624);
    assert.equal(frame.height, 456);
    assert.equal(state().edges, before.edges);
    for (const original of before.nodes) {
      const current = state().nodes.find(n => n.id === original.id);
      assert.equal(current.data, original.data);
      assert.equal(current.position, original.position);
    }
    assert.equal(state().selectedNodeId, frameId);
    assert.deepEqual(state().selectedNodeIds, [frameId]);
    assert.deepEqual(frameMembers(frame, state().nodes).map(n => n.id), ['a', 'b']);
    state().undo(); assert.equal(state().nodes.length, 4);
    state().redo(); assert.equal(state().nodes.length, 5);
    const restored = JSON.parse(JSON.stringify(state().nodes));
    assert.deepEqual(resolveCarriedNodeIds(restored, [frameId]), ['a', 'b', frameId]);
  });
  test('a frame selection cannot be grouped or enclosed by the selection action', () => {
    const store = start(); const state = () => store.getState();
    const frameId = state().createFrameFromSelection(['a', 'b']);
    const before = state();
    assert.equal(canGroup(state().nodes, [frameId, 'c']), false);
    state().groupSelection([frameId, 'c']);
    assert.equal(state().nodes, before.nodes);
    assert.equal(state().createFrameFromSelection([frameId, 'c']), undefined);
    assert.equal(state().createFrameFromSelection(['missing']), undefined);
    assert.equal(state().history, before.history);
    state().alignSelection([frameId, 'c']);
    assert.equal(state().nodes, before.nodes);
    assert.equal(state().history, before.history);
  });
  test('frames carry complete rigid groups but leave every cross-boundary member behind', () => {
    const frame = { ...node('frame'), width: 500, height: 500, data: { ...node('frame').data, stepKind: 'frame', frameCarry: true } };
    const a = { ...node('a', 40, 100), data: { ...node('a').data, canvasGroupId: 'cross' } };
    const b = { ...node('b', 440, 300), data: { ...node('b').data, canvasGroupId: 'cross' } };
    const single = node('single', 450, 50); single.width = 50;
    const nodes = [frame, a, b, single];
    assert.deepEqual(frameMembers(frame, nodes).map(n => n.id), ['single']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['frame']), ['frame', 'single']);
    const inside = nodes.map(n => n.id === 'b' ? { ...n, position: { x: 250, y: 300 } } : n);
    assert.deepEqual(resolveCarriedNodeIds(inside, ['frame']), ['frame', 'a', 'b', 'single']);
  });
  test('nested linked frames recurse and legacy frame group metadata remains inert', () => {
    const outer = { ...node('outer'), width: 600, height: 600, data: { ...node('outer').data, stepKind: 'frame', frameCarry: true, canvasGroupId: 'legacy' } };
    const inner = { ...node('inner', 50, 60), width: 300, height: 300, data: { ...node('inner').data, stepKind: 'frame', frameCarry: true } };
    const card = node('card', 80, 120);
    const outside = { ...node('outside', 900, 900), data: { ...node('outside').data, canvasGroupId: 'legacy' } };
    const nodes = [outer, inner, card, outside];
    assert.deepEqual(expandGroupSelection(nodes, ['outer']), ['outer']);
    assert.deepEqual(expandGroupSelection(nodes, ['outside']), ['outside']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['outer']), ['outer', 'inner', 'card']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['inner']), ['inner', 'card']);
    assert.deepEqual(nodeRect({ ...card, measured: { width: 123, height: 87 } }), { x: 80, y: 120, width: 123, height: 87 });
  });
} finally {
  if (existsSync(bundle)) unlinkSync(bundle);
  rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
