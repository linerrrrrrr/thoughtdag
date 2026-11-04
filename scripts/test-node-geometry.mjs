#!/usr/bin/env node
// Formatting edits are atomic, ratio-aware, spatial, and undoable.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-geometry-'));
const bundle = join(temporary, 'geometry.mjs');
const stubs = {
  'condense-guard': 'export const condenseGuard = () => false;',
  'ui-store': 'export const toast = () => "";',
  i18n: 'export const t = (key) => key; export const fmt = (text) => text;',
  'context-builder': 'export const referenceBlockContent = () => ""; export const upstreamFingerprint = () => ""; export const buildContext = () => ({messages: []});',
  streaming: 'export const activeAbortControllers = new Map();',
  canonical: 'export const unsubscribeOrphanedSessions = () => {};',
  'stale-judge': 'export const judgeStaleness = () => {};',
};
let failures = 0, passes = 0;
function test(label, run) {
  try { run(); passes++; console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}\n${error.stack}`); }
}

try {
  await build({
    stdin: { contents: `
      export * from './lib/node-geometry';
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
  const { applySelectionGeometry: apply, effectiveNodeGeometry, makeStore } = await import(pathToFileURL(bundle).href);
  const node = (id, width = 600, height = 300, data = {}, x = 0, y = 0) => ({ id, type: 'thought', position: { x, y }, width, height, data: {
    question: id, response: 'answer', responses: ['answer'], responseIndex: 0,
    isCollapsed: false, isLoading: false, isEditing: false, isEditingResponse: false,
    attachments: [], highlights: [], tokenCount: 0, ...data,
  } });
  const sizes = nodes => nodes.map(({ width, height }) => [width, height]);

  test('numeric width and height use the stored card size over compact preview measurements', () => {
    const n = { ...node('a'), measured: { width: 520, height: 90 } };
    assert.deepEqual(effectiveNodeGeometry(n), { width: 600, height: 300 });
    assert.deepEqual(effectiveNodeGeometry({ ...n, width: undefined, height: undefined }), { width: 520, height: 90 });
  });
  test('unlocked size edits preserve untouched dimensions and positions', () => {
    const nodes = [node('a', 600, 300, {}, 85, -40), node('b')];
    const next = apply(nodes, ['a'], { width: 720 });
    assert.deepEqual(sizes(next), [[720, 300], [600, 300]]);
    assert.equal(next[0].position, nodes[0].position);
    assert.equal(next[1], nodes[1]);
  });
  test('locked width and height edits preserve each original ratio', () => {
    const nodes = [node('a', 600, 300, { lockAspectRatio: true }), node('b', 600, 450, { lockAspectRatio: true })];
    assert.deepEqual(sizes(apply(nodes, ['a', 'b'], { width: 800 })), [[800, 400], [800, 600]]);
    assert.deepEqual(sizes(apply(nodes, ['a', 'b'], { height: 600 })), [[1200, 600], [800, 600]]);
  });
  test('mixed lock states apply the same requested axis without forcing a common ratio', () => {
    const nodes = [node('a', 600, 300, { lockAspectRatio: true }), node('b')];
    assert.deepEqual(sizes(apply(nodes, ['a', 'b'], { width: 900 })), [[900, 450], [900, 300]]);
  });
  test('proportional minimum clamping does not distort a locked card', () => {
    const nodes = [node('a', 600, 300, { lockAspectRatio: true })];
    assert.deepEqual(sizes(apply(nodes, ['a'], { width: 100 })), [[480, 240]]);
    assert.deepEqual(sizes(apply(nodes, ['a'], { height: 50 })), [[480, 240]]);
  });
  test('material bounds match the visible CSS floor and existing resize maximum', () => {
    const nodes = [node('a', 600, 300, { stepKind: 'note' })];
    assert.deepEqual(sizes(apply(nodes, ['a'], { width: 1, height: 1 })), [[340, 120]]);
    assert.deepEqual(sizes(apply(nodes, ['a'], { width: 1000, lockAspectRatio: true })), [[860, 430]]);
  });
  test('changing only the ratio flag leaves all geometry untouched', () => {
    const nodes = [node('a'), node('b', 700, 450)];
    const next = apply(nodes, ['a', 'b'], { lockAspectRatio: true });
    assert.deepEqual(sizes(next), sizes(nodes));
    assert.ok(next.every(n => n.data.lockAspectRatio));
    assert.ok(next.every((n, i) => n.position === nodes[i].position));
  });
  test('invalid numeric edits are atomic no-ops', () => {
    const nodes = [node('a')];
    for (const patch of [{ width: NaN }, { height: Infinity }, { width: 0 }, { height: -1 }, { x: Infinity, width: 700 }]) {
      assert.equal(apply(nodes, ['a'], patch), nodes);
    }
  });
  test('repeating a committed value and empty selections create no changes', () => {
    const nodes = [node('a')];
    assert.equal(apply(nodes, ['a'], { width: 600, height: 300, x: 0, lockAspectRatio: false }), nodes);
    assert.equal(apply(nodes, [], { width: 900 }), nodes);
    assert.equal(apply(nodes, ['missing'], { width: 900 }), nodes);
  });
  test('multi-selection ignores coordinates while applying common dimensions', () => {
    const nodes = [node('a', 600, 300, {}, 10, 20), node('b', 600, 300, {}, 700, 800)];
    const next = apply(nodes, ['a', 'b'], { x: 45, y: 55, width: 700, height: 400 });
    assert.deepEqual(next.map(n => n.position), nodes.map(n => n.position));
    assert.deepEqual(sizes(next), [[700, 400], [700, 400]]);
  });
  test('group edits expand membership, retain relative positions, and cannot set member coordinates', () => {
    const nodes = [node('a', 600, 300, { canvasGroupId: 'g' }, 10, 20), node('b', 600, 300, { canvasGroupId: 'g' }, 700, 800)];
    const next = apply(nodes, ['a'], { width: 700, x: 500 });
    assert.deepEqual(next.map(n => n.position), nodes.map(n => n.position));
    assert.deepEqual(sizes(next), [[700, 300], [700, 300]]);
    assert.ok(next.every(n => n.data.canvasGroupId === 'g'));
  });
  test('single coordinates permit zero and negative canvas positions', () => {
    const next = apply([node('a', 600, 300, {}, 40, 80)], ['a'], { x: 0, y: -120 });
    assert.deepEqual(next[0].position, { x: 0, y: -120 });
  });
  test('moving a carrying frame translates its members once and preserves their sizes', () => {
    const nodes = [node('f', 1000, 800, { stepKind: 'frame', frameCarry: true }), node('a', 600, 300, {}, 50, 80), node('b', 600, 300, {}, 2000, 0)];
    const next = apply(nodes, ['f'], { x: -100, y: 200 });
    assert.deepEqual(next.map(n => n.position), [{ x: -100, y: 200 }, { x: -50, y: 280 }, { x: 2000, y: 0 }]);
    assert.deepEqual(sizes(next), sizes(nodes));
  });
  test('resizing frames and positioning unlinked frames leave their contents alone', () => {
    const nodes = [node('f', 1000, 800, { stepKind: 'frame', frameCarry: false }), node('a', 600, 300, {}, 50, 80)];
    assert.equal(apply(nodes, ['f'], { x: 500 })[1], nodes[1]);
    nodes[0].data.frameCarry = true;
    assert.equal(apply(nodes, ['f'], { width: 1200, height: 900 })[1], nodes[1]);
  });
  test('a multi-field store commit is one undo step and restores ratio and sizes on redo', () => {
    const store = makeStore();
    const nodes = [node('a'), node('b', 600, 400, {}, 0, 700)];
    const edges = [{ id: 'a-b', source: 'a', target: 'b', data: {} }];
    store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
    store.getState().setSelectionGeometry(['a', 'b'], { width: 900, lockAspectRatio: true });
    assert.equal(store.getState().historyIndex, 1);
    assert.equal(store.getState().edges, edges);
    assert.deepEqual(sizes(store.getState().nodes), [[900, 450], [900, 600]]);
    store.getState().undo();
    assert.deepEqual(sizes(store.getState().nodes), sizes(nodes));
    assert.ok(store.getState().nodes.every(n => !n.data.lockAspectRatio));
    store.getState().redo();
    assert.deepEqual(sizes(store.getState().nodes), [[900, 450], [900, 600]]);
    assert.ok(store.getState().nodes.every(n => n.data.lockAspectRatio));
    store.getState().setSelectionGeometry(['a', 'b'], { width: 900 });
    assert.equal(store.getState().historyIndex, 1);
  });
} finally {
  rmSync(bundle, { force: true });
  rmdirSync(temporary);
}
console.log(`${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
