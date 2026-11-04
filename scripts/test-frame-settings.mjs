// Frame metadata, explicit content scopes and geometric containment regression.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-frame-settings-'));
const bundle = join(temporary, 'frame-settings.mjs');
const stubs = {
  'condense-guard': 'export const condenseGuard = () => false;',
  'ui-store': 'export const toast = () => "";',
  i18n: 'export const t = key => key; export const fmt = text => text;',
  'context-builder': 'export const referenceBlockContent = () => ""; export const upstreamFingerprint = () => ""; export const buildContext = () => ({messages: []});',
  streaming: 'export const activeAbortControllers = new Map();',
  canonical: 'export const unsubscribeOrphanedSessions = () => {};',
  'stale-judge': 'export const judgeStaleness = () => {};',
};
let passed = 0, failed = 0;
function test(label, run) {
  try { run(); passed++; console.log(`PASS ${label}`); }
  catch (error) { failed++; console.error(`FAIL ${label}\n${error.stack}`); }
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
      builder.onResolve({ filter: /(condense-guard|ui-store|i18n|context-builder|streaming|atlas\/canonical|stale-judge)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const { makeStore, frameMembers, frameContentIds, fittedFrameRect, resolveCarriedNodeIds } = await import(pathToFileURL(bundle).href);
  const card = (id, x, y, width = 120, height = 80, data = {}) => ({
    id, type: 'thought', position: { x, y }, width, height,
    data: { question: id, response: 'answer', responses: ['answer'], responseIndex: 0,
      isCollapsed: false, isLoading: false, isEditing: false, isEditingResponse: false,
      attachments: [], highlights: [], tokenCount: 0, ...data },
  });
  const frame = (id, x = 0, y = 0, width = 700, height = 600, data = {}) => card(id, x, y, width, height, { stepKind: 'frame', frameCarry: true, ...data });
  const start = (nodes, edges = []) => {
    const store = makeStore();
    store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
    return store;
  };
  const nodeIds = nodes => nodes.map(node => node.id);

  test('a node with only its center inside the region is excluded; exact bounds are included', () => {
    const f = frame('f', 0, 0, 500, 400);
    const nodes = [f, card('inside', 40, 80), card('crossing', 450, 100), card('exact', 380, 320)];
    assert.deepEqual(nodeIds(frameMembers(f, nodes)), ['inside', 'exact']);
    assert.deepEqual(frameContentIds(nodes, ['f']), ['inside', 'exact']);
  });
  test('groups cross a boundary only as complete objects', () => {
    const f = frame('f', 0, 0, 500, 400);
    const grouped = (id, x, group) => card(id, x, 100, 80, 80, { canvasGroupId: group });
    const nodes = [f, grouped('a', 50, 'partial'), grouped('b', 450, 'partial'), grouped('c', 170, 'whole'), grouped('d', 280, 'whole')];
    assert.deepEqual(frameContentIds(nodes, ['f']), ['c', 'd']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['f']), ['f', 'c', 'd']);
  });
  test('nested frames are optional in explicit scopes and equal-sized frames never contain one another', () => {
    const nodes = [frame('outer'), frame('inner', 40, 80, 300, 300, { frameCarry: false }), frame('equal'), card('a', 80, 140)];
    assert.deepEqual(frameContentIds(nodes, ['outer']), ['a']);
    assert.deepEqual(frameContentIds(nodes, ['outer'], true), ['inner', 'a']);
    assert.deepEqual(frameContentIds(nodes, ['outer', 'inner'], true), ['a']);
  });
  test('overlapping frame scopes deduplicate members regardless of movement switches', () => {
    const nodes = [frame('f1', 0, 0, 500, 400, { frameCarry: false }), frame('f2', 200, 0, 500, 400), card('shared', 240, 100), card('right', 550, 100)];
    assert.deepEqual(frameContentIds(nodes, ['f1', 'f2', 'missing']), ['shared', 'right']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['f1']), ['f1']);
    assert.deepEqual(resolveCarriedNodeIds(nodes, ['f1', 'f2', 'shared']), ['f1', 'f2', 'shared', 'right']);
  });
  test('selection commands distinguish contents from the frames and never change context', () => {
    const nodes = [frame('f'), frame('inner', 40, 80, 300, 300), card('a', 80, 140, 100, 80, { canvasGroupId: 'g' }), card('b', 200, 140, 100, 80, { canvasGroupId: 'g' })];
    const edges = [{ id: 'ab', source: 'a', target: 'b' }];
    const store = start(nodes, edges);
    store.getState().selectFrameContents(['f']);
    assert.deepEqual(store.getState().selectedNodeIds, ['a', 'b']);
    assert.deepEqual(nodeIds(store.getState().nodes.filter(node => node.selected)), ['a', 'b']);
    store.getState().selectFrameContents(['f'], true);
    assert.deepEqual(store.getState().selectedNodeIds, ['f', 'inner', 'a', 'b']);
    assert.equal(store.getState().edges, edges);
    assert.equal(store.getState().historyIndex, 0);
  });
  test('frame properties affect only frames, keep mixed names, and commit one undo step', () => {
    const nodes = [frame('f1'), frame('f2', 800), card('a', 80, 140)];
    const store = start(nodes);
    store.getState().setFrameProperties(['f1', 'f2', 'a'], { title: 'Do not unify', color: 'sky', carry: false });
    assert.deepEqual(store.getState().nodes.map(node => node.data.question), ['f1', 'f2', 'a']);
    assert.ok(store.getState().nodes.slice(0, 2).every(node => node.data.frameColor === 'sky' && node.data.frameCarry === false));
    assert.equal(store.getState().nodes[2], nodes[2]);
    assert.equal(store.getState().historyIndex, 1);
    store.getState().undo();
    assert.ok(store.getState().nodes.slice(0, 2).every(node => !node.data.frameColor && node.data.frameCarry));
    store.getState().redo();
    assert.ok(store.getState().nodes.slice(0, 2).every(node => node.data.frameColor === 'sky' && node.data.frameCarry === false));
  });
  test('single frame titles trim whitespace and can return to the unnamed state', () => {
    const store = start([frame('f'), card('a', 80, 140)]);
    store.getState().setFrameProperties(['f', 'a'], { title: '  Research region  ' });
    assert.equal(store.getState().nodes[0].data.question, 'Research region');
    store.getState().setFrameProperties(['f'], { title: '   ' });
    assert.equal(store.getState().nodes[0].data.question, '');
    store.getState().undo();
    assert.equal(store.getState().nodes[0].data.question, 'Research region');
  });
  test('invalid colors, no-op properties and empty frame scopes do not create history', () => {
    const store = start([frame('f'), card('a', 80, 140)]);
    const before = store.getState().nodes;
    store.getState().setFrameProperties(['f'], { color: 'not-a-palette-color', carry: false });
    store.getState().setFrameProperties(['f'], { title: 'f', carry: true, color: 'gray' });
    store.getState().setFrameProperties(['a'], { title: 'not a frame' });
    store.getState().fitFramesToContents(['a', 'missing']);
    store.getState().duplicateFrames(['missing'], true);
    assert.equal(store.getState().nodes, before);
    assert.equal(store.getState().historyIndex, 0);
  });
  test('fit adds measured padding while keeping content geometry and edges unchanged', () => {
    const nodes = [frame('f', 0, 0, 900, 700), card('a', 150, 180), card('b', 420, 330)];
    const edges = [{ id: 'ab', source: 'a', target: 'b' }];
    const store = start(nodes, edges);
    store.getState().fitFramesToContents(['f']);
    const result = store.getState();
    assert.deepEqual(result.nodes[0].position, { x: 118, y: 116 });
    assert.equal(result.nodes[0].width, 454);
    assert.equal(result.nodes[0].height, 326);
    assert.equal(result.nodes[1], nodes[1]);
    assert.equal(result.nodes[2], nodes[2]);
    assert.equal(result.edges, edges);
    assert.equal(result.historyIndex, 1);
    store.getState().undo();
    assert.equal(store.getState().nodes[0].width, 900);
    store.getState().redo();
    assert.equal(store.getState().nodes[0].width, 454);
  });
  test('fit preserves a locked ratio by expanding enough to enclose padded contents', () => {
    const f = frame('f', 0, 0, 900, 600, { lockAspectRatio: true });
    const a = card('a', 150, 180, 200, 100);
    const bounds = fittedFrameRect(f, [f, a]);
    assert.equal(bounds.width / bounds.height, 1.5);
    assert.ok(bounds.width >= 280 && bounds.height >= 196);
    assert.ok(bounds.x <= a.position.x - 32 && bounds.y <= a.position.y - 64);
    const store = start([f, a]);
    store.getState().fitFramesToContents(['f']);
    assert.equal(store.getState().nodes[0].data.lockAspectRatio, true);
    assert.equal(store.getState().nodes[1], a);
  });
  test('multi-frame fit uses one membership snapshot and one history step', () => {
    const nodes = [frame('outer', 0, 0, 1000, 800), frame('inner', 100, 100, 500, 500), card('a', 200, 250)];
    const expected = nodes.slice(0, 2).map(f => fittedFrameRect(f, nodes));
    const store = start(nodes);
    store.getState().fitFramesToContents(['outer', 'inner']);
    store.getState().nodes.slice(0, 2).forEach((f, index) => {
      assert.equal(f.width, expected[index].width);
      assert.equal(f.height, expected[index].height);
      assert.deepEqual(f.position, { x: expected[index].x, y: expected[index].y });
    });
    assert.equal(store.getState().nodes[2], nodes[2]);
    assert.equal(store.getState().historyIndex, 1);
  });
  test('copy frame only never copies contained nodes, even with carrying enabled', () => {
    const nodes = [frame('f'), card('a', 80, 140)];
    const store = start(nodes);
    store.getState().duplicateFrames(['f', 'a'], false);
    const copies = store.getState().nodes.slice(nodes.length);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].data.stepKind, 'frame');
    assert.equal(copies[0].data.frameCarry, true);
    assert.equal(store.getState().nodes[1], nodes[1]);
  });
  test('copy with contents includes nested frames, remaps complete groups and copies only internal edges', () => {
    const nodes = [frame('f'), frame('inner', 40, 80, 400, 300), card('a', 80, 140, 100, 80, { canvasGroupId: 'g' }), card('b', 240, 140, 100, 80, { canvasGroupId: 'g' }), card('outside', 1000, 100)];
    const edges = [{ id: 'ab', source: 'a', target: 'b' }, { id: 'oa', source: 'outside', target: 'a' }];
    const store = start(nodes, edges);
    store.getState().duplicateFrames(['f'], true);
    const result = store.getState();
    const copies = result.nodes.slice(nodes.length);
    assert.equal(copies.length, 4);
    const copyOf = title => copies.find(node => node.data.question === title);
    assert.ok(copyOf('a').data.canvasGroupId && copyOf('a').data.canvasGroupId !== 'g');
    assert.equal(copyOf('a').data.canvasGroupId, copyOf('b').data.canvasGroupId);
    assert.equal(result.edges.length, 3);
    assert.equal(result.edges[2].source, copyOf('a').id);
    assert.equal(result.edges[2].target, copyOf('b').id);
    assert.equal(copyOf('b').position.x - copyOf('a').position.x, 160);
    assert.equal(copyOf('inner').position.x - copyOf('f').position.x, 40);
    store.getState().undo();
    assert.equal(store.getState().nodes.length, nodes.length);
    assert.equal(store.getState().edges.length, edges.length);
  });
  test('copy overlapping regions copies shared contents once and frame-only deletion retains all content', () => {
    const nodes = [frame('f1', 0, 0, 500, 400), frame('f2', 200, 0, 500, 400), card('shared', 240, 100)];
    const store = start(nodes);
    store.getState().duplicateFrames(['f1', 'f2'], true);
    assert.equal(store.getState().nodes.slice(nodes.length).length, 3);
    store.getState().undo();
    store.getState().batchDelete(['f1', 'f2']);
    assert.deepEqual(nodeIds(store.getState().nodes), ['shared']);
    store.getState().undo();
    assert.deepEqual(nodeIds(store.getState().nodes), ['f1', 'f2', 'shared']);
  });
} finally {
  rmSync(bundle, { force: true });
  rmdirSync(temporary);
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
