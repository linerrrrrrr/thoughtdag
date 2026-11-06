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
  projects: 'export const useProjects = { getState: () => ({ activeId: "test-project" }), subscribe: () => () => {} };',
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
      export { registerNodeContentHeightMeasure, measureConversationContentHeight } from './lib/node-content-height';
      import { create } from 'zustand';
      import { createNodeSlice } from './store/slices/nodes';
      import { createHistorySlice } from './store/slices/history';
      export const makeStore = () => create((...args) => ({ ...createNodeSlice(...args), ...createHistorySlice(...args), events: [], logEvent: () => {} }));
    `, resolveDir: join(root, 'src'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.DEV': 'false' },
    plugins: [{ name: 'unrelated-runtime-stubs', setup(builder) {
      builder.onResolve({ filter: /(condense-guard|ui-store|i18n|context-builder|streaming|atlas\/canonical|stale-judge|projects)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const { applySelectionGeometry: apply, effectiveNodeGeometry, nodeGeometryMaximum, resizeSelectionBy, registerNodeContentHeightMeasure, measureConversationContentHeight, makeStore } = await import(pathToFileURL(bundle).href);
  const node = (id, width = 600, height = 300, data = {}, x = 0, y = 0) => ({ id, type: 'thought', position: { x, y }, width, height, data: {
    question: id, response: 'answer', responses: ['answer'], responseIndex: 0,
    isCollapsed: false, isLoading: false, isEditing: false, isEditingResponse: false,
    attachments: [], highlights: [], tokenCount: 0, ...data,
  } });
  const sizes = nodes => nodes.map(({ width, height }) => [width, height]);

  test('full-content height sums actual question and answer content without ratio blank space', () => {
    const style = { width: '600px' };
    const content = height => ({ get offsetHeight() { return height * Math.ceil(600 / parseFloat(style.width)); }, get scrollHeight() { return this.offsetHeight; } });
    const questionContent = content(60), answerContent = content(140);
    const question = { style: { flexGrow: '0.9' }, querySelector: () => questionContent };
    const answer = { querySelector: () => answerContent };
    const split = { offsetHeight: 600, querySelector: selector => selector.includes('question') ? question : selector.includes('answer') ? answer : { offsetHeight: 12 } };
    const root = { isConnected: true, dataset: { nodeDetailLevel: 'full' }, style,
      get offsetWidth() { return parseFloat(style.width); }, offsetHeight: 800,
      querySelector: selector => selector.includes('split=') ? split : null };
    assert.equal(measureConversationContentHeight(root), 413);
    question.style.flexGrow = '0.05';
    assert.equal(measureConversationContentHeight(root), 413);
    assert.equal(measureConversationContentHeight(root, 300), 613);
    assert.equal(style.width, '600px');
    root.dataset.nodeDetailLevel = 'summary';
    assert.equal(measureConversationContentHeight(root), undefined);
  });
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
  test('width edits preserve automatic height while explicit height edits fix it', () => {
    const automatic = { ...node('a'), height: undefined, measured: { width: 600, height: 480 } };
    const wider = apply([automatic], ['a'], { width: 720 })[0];
    assert.equal(wider.height, undefined);
    assert.equal(wider.width, 720);
    assert.equal(wider.data.keepOverviewHeight, undefined);
    const dragged = resizeSelectionBy([automatic], [automatic], 80, undefined)[0];
    assert.equal(dragged.height, undefined);
    assert.equal(dragged.width, 680);
    assert.equal(dragged.data.keepOverviewHeight, undefined);
    assert.equal(apply([automatic], ['a'], { height: 480 })[0].height, 480);
  });
  test('restoring auto height clears the fixed size and ratio without moving or rewriting content', () => {
    const original = node('a', 650, 420, { keepOverviewHeight: true, lockAspectRatio: true }, 90, -25);
    const restored = apply([original], ['a'], { autoHeight: true })[0];
    assert.equal(restored.width, original.width);
    assert.equal(restored.height, undefined);
    assert.equal(restored.data.keepOverviewHeight, undefined);
    assert.equal(restored.data.lockAspectRatio, false);
    assert.equal(restored.position, original.position);
    assert.equal(restored.data.response, original.data.response);
    assert.equal(restored.data.attachments, original.data.attachments);
    const repeat = [restored];
    assert.equal(apply(repeat, ['a'], { autoHeight: true }), repeat);
    const resized = apply([original], ['a'], { width: 400, autoHeight: true })[0];
    assert.equal(resized.width, 400);
    assert.equal(resized.height, undefined);
  });
  test('automatic height restores eligible cards in a mixed selection but leaves frame geometry intact', () => {
    const nodes = [node('a'), node('m', 520, 500, { stepKind: 'note' }),
      node('f', 1200, 900, { stepKind: 'frame', lockAspectRatio: true })];
    const next = apply(nodes, ['a', 'm', 'f'], { autoHeight: true });
    assert.equal(next[0].height, undefined);
    assert.equal(next[1].height, undefined);
    assert.equal(next[2], nodes[2]);
    assert.deepEqual(next.map(n => n.position), nodes.map(n => n.position));
  });
  test('retired metadata does not expand single-node formatting or positioning', () => {
    const nodes = [node('a', 600, 300, { canvasGroupId: 'g' }, 85, -40),
      node('b', 600, 300, { canvasGroupId: 'g' }, 800, 400)];
    const next = apply(nodes, ['a'], { width: 720, height: 360, x: 100, y: 50 });
    assert.deepEqual(sizes(next), [[720, 360], [600, 300]]);
    assert.deepEqual(next[0].position, { x: 100, y: 50 });
    assert.equal(next[1], nodes[1]);
    assert.equal(next[0].data.canvasGroupId, 'g');
    assert.deepEqual(sizes(apply(nodes, ['a', 'b'], { width: 720 })), [[720, 300], [720, 300]]);
  });
  test('frame movement ignores retired metadata shared by inside and outside cards', () => {
    const nodes = [node('f', 1200, 1000, { stepKind: 'frame', frameCarry: true }),
      node('a', 400, 300, { canvasGroupId: 'g' }, 100, 100),
      node('b', 400, 300, { canvasGroupId: 'g' }, 1500, 100)];
    const next = apply(nodes, ['f'], { x: 50, y: -20 });
    assert.deepEqual(next[0].position, { x: 50, y: -20 });
    assert.deepEqual(next[1].position, { x: 150, y: 80 });
    assert.equal(next[2], nodes[2]);
    assert.equal(next[1].data.canvasGroupId, 'g');
    const resized = apply(nodes, ['f'], { width: 1300, height: 900 });
    assert.equal(resized[1], nodes[1]);
    assert.equal(resized[2], nodes[2]);
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
  const withHeightLimits = (limits, run) => {
    const unregister = Object.entries(limits).map(([id, height]) => registerNodeContentHeightMeasure(id, typeof height === 'function' ? height : () => height));
    try { run(); } finally { unregister.forEach(remove => remove()); }
  };
  test('measured conversation content caps explicit heights and gesture deltas', () => withHeightLimits({ a: 500 }, () => {
    const nodes = [node('a')];
    assert.equal(nodeGeometryMaximum(nodes[0]).height, 500);
    assert.equal(apply(nodes, ['a'], { height: 900 })[0].height, 500);
    assert.equal(resizeSelectionBy(nodes, nodes, undefined, 600)[0].height, 500);
    assert.equal(nodes[0].height, 300);
  }));
  test('height edits at the content cap are no-ops across formatting and gestures', () => withHeightLimits({ a: 500 }, () => {
    const nodes = [node('a', 600, 500)];
    assert.equal(apply(nodes, ['a'], { height: 900 }), nodes);
    assert.equal(resizeSelectionBy(nodes, nodes, undefined, 1), nodes);
    assert.equal(resizeSelectionBy(nodes, nodes, undefined, 100), nodes);
  }));
  test('saved oversized cards tighten to content height on either resize direction', () => withHeightLimits({ a: 500 }, () => {
    const nodes = [node('a', 600, 800)];
    assert.equal(apply(nodes, ['a'], { height: 799 })[0].height, 500);
    assert.equal(apply(nodes, ['a'], { height: 400 })[0].height, 400);
    assert.equal(apply(nodes, ['a'], { height: 900 })[0].height, 500);
    assert.equal(resizeSelectionBy(nodes, nodes, undefined, -10)[0].height, 500);
    assert.equal(resizeSelectionBy(nodes, nodes, undefined, 10)[0].height, 500);
    assert.equal(apply(nodes, ['a'], { width: 700 })[0].height, 500);
  }));
  test('batch height edits respect each measured content cap without moving nodes', () => withHeightLimits({ a: 500, b: 420 }, () => {
    const nodes = [node('a', 600, 300, {}, 40, 50), node('b', 600, 300, {}, 750, 80)];
    const next = apply(nodes, ['a', 'b'], { height: 900 });
    assert.deepEqual(sizes(next), [[600, 500], [600, 420]]);
    assert.deepEqual(next.map(n => n.position), nodes.map(n => n.position));
    assert.deepEqual(sizes(resizeSelectionBy(nodes, nodes, undefined, 600)), sizes(next));
  }));
  test('unmeasured, material and frame cards retain their existing height behavior', () => {
    const unmeasured = [node('a')];
    assert.equal(nodeGeometryMaximum(unmeasured[0]).height, Infinity);
    assert.equal(apply(unmeasured, ['a'], { height: 9000 })[0].height, 9000);
    withHeightLimits({ a: undefined, m: 500, f: 500 }, () => {
      assert.equal(nodeGeometryMaximum(unmeasured[0]).height, Infinity);
      const nodes = [node('m', 600, 300, { stepKind: 'note' }), node('f', 600, 300, { stepKind: 'frame' })];
      assert.ok(nodes.every(n => nodeGeometryMaximum(n).height === Infinity));
      assert.deepEqual(sizes(apply(nodes, ['m', 'f'], { height: 9000 })), [[600, 9000], [600, 9000]]);
    });
  });
  test('measured limits preserve the conversation minimum height', () => withHeightLimits({ a: 120 }, () => {
    const nodes = [node('a')];
    assert.equal(nodeGeometryMaximum(nodes[0]).height, 240);
    assert.equal(apply(nodes, ['a'], { height: 1 })[0].height, 240);
  }));
  test('content height caps preserve aspect ratio for either edited axis', () => withHeightLimits({ a: 400, b: 500 }, () => {
    const nodes = [node('a', 600, 300, { lockAspectRatio: true })];
    assert.deepEqual(sizes(apply(nodes, ['a'], { width: 1200 })), [[800, 400]]);
    assert.deepEqual(sizes(apply(nodes, ['a'], { height: 900 })), [[800, 400]]);
    assert.deepEqual(sizes(resizeSelectionBy(nodes, nodes, 600, undefined)), [[800, 400]]);
    const legacy = [node('b', 600, 800, { lockAspectRatio: true })];
    assert.deepEqual(sizes(apply(legacy, ['b'], { height: 790 })), [[375, 500]]);
    assert.deepEqual(sizes(apply(legacy, ['b'], { width: 900 })), [[375, 500]]);
  }));
  test('an extreme saved ratio cannot keep height above the content cap', () => withHeightLimits({ a: 500 }, () => {
    const nodes = [node('a', 360, 800, { lockAspectRatio: true })];
    const corrected = apply(nodes, ['a'], { height: 790 })[0];
    assert.deepEqual([corrected.width, corrected.height], [360, 500]);
    assert.equal(corrected.data.lockAspectRatio, true);
    assert.deepEqual(sizes(apply([corrected], ['a'], { height: 400 })), [[360, 500]]);
  }));
  test('simultaneous width and height edits cap using the requested width reflow', () => withHeightLimits({ a: width => Math.max(240, 900 - (width ?? 600) * 0.5) }, () => {
    const nodes = [node('a')];
    assert.deepEqual(sizes(apply(nodes, ['a'], { width: 900, height: 900 })), [[900, 450]]);
    assert.deepEqual(sizes(resizeSelectionBy(nodes, nodes, 300, 600)), [[900, 450]]);
  }));
  test('locked resizing finds the reflow boundary while preserving each original ratio', () => withHeightLimits({ a: width => Math.max(240, 900 - (width ?? 600) * 0.5) }, () => {
    const nodes = [node('a', 600, 300, { lockAspectRatio: true })];
    for (const patch of [{ width: 1200 }, { height: 900 }, { width: 1200, height: 900 }]) {
      const resized = apply(nodes, ['a'], patch)[0];
      assert.equal(resized.width / resized.height, 2);
      assert.ok(Math.abs(resized.height - 450) < 0.25, `height ${resized.height}`);
    }
    const legacy = [node('a', 600, 800, { lockAspectRatio: true })];
    for (const patch of [{ width: 900 }, { height: 790 }]) {
      const corrected = apply(legacy, ['a'], patch)[0];
      assert.ok(Math.abs(corrected.width / corrected.height - 0.75) < 1e-12);
      assert.ok(Math.abs(corrected.height - 900 / 1.375) < 0.25);
    }
  }));
  test('content-capped store height edits remain single undo steps with no step at the cap', () => withHeightLimits({ a: 500 }, () => {
    const store = makeStore();
    const nodes = [node('a', 600, 500)];
    const edges = [];
    store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
    store.getState().setSelectionGeometry(['a'], { height: 900 });
    assert.equal(store.getState().nodes, nodes);
    assert.equal(store.getState().historyIndex, 0);
    store.getState().setSelectionGeometry(['a'], { height: 400 });
    assert.equal(store.getState().historyIndex, 1);
    assert.equal(store.getState().nodes[0].height, 400);
    store.getState().undo();
    assert.equal(store.getState().nodes[0].height, 500);
    store.getState().redo();
    assert.equal(store.getState().nodes[0].height, 400);
  }));
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
  test('batch size edits ignore retired metadata and preserve positions', () => {
    const nodes = [node('a', 600, 300, { canvasGroupId: 'g' }, 10, 20), node('b', 600, 300, { canvasGroupId: 'g' }, 700, 800)];
    const next = apply(nodes, ['a', 'b'], { width: 700, x: 500 });
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
  test('restoring automatic heights and releasing their ratios is one reversible store edit', () => {
    const store = makeStore();
    const nodes = [node('a', 600, 420, { lockAspectRatio: true, keepOverviewHeight: true }), node('b', 520, 350)];
    const edges = [{ id: 'a-b', source: 'a', target: 'b', data: {} }];
    store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
    store.getState().setSelectionGeometry(['a', 'b'], { autoHeight: true });
    assert.equal(store.getState().historyIndex, 1);
    assert.ok(store.getState().nodes.every(n => n.height === undefined));
    assert.equal(store.getState().edges, edges);
    store.getState().undo();
    assert.deepEqual(sizes(store.getState().nodes), sizes(nodes));
    assert.equal(store.getState().nodes[0].data.lockAspectRatio, true);
    assert.equal(store.getState().nodes[0].data.keepOverviewHeight, true);
    store.getState().redo();
    assert.ok(store.getState().nodes.every(n => n.height === undefined));
    assert.equal(store.getState().nodes[0].data.lockAspectRatio, false);
    assert.equal(store.getState().nodes[0].data.keepOverviewHeight, undefined);
    store.getState().setSelectionGeometry(['a', 'b'], { autoHeight: true });
    assert.equal(store.getState().historyIndex, 1);
  });
  test('committing pending fields before enabling ratio lock is one edit without resizing the other axis', () => {
    const store = makeStore();
    const nodes = [node('a', 600, 300)];
    const edges = [];
    store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
    store.getState().setSelectionGeometry(['a'], [{ width: 800 }, { lockAspectRatio: true }]);
    assert.deepEqual(sizes(store.getState().nodes), [[800, 300]]);
    assert.equal(store.getState().nodes[0].data.lockAspectRatio, true);
    assert.equal(store.getState().historyIndex, 1);
    store.getState().undo();
    assert.deepEqual(sizes(store.getState().nodes), [[600, 300]]);
    assert.equal(!!store.getState().nodes[0].data.lockAspectRatio, false);
    store.getState().redo();
    assert.deepEqual(sizes(store.getState().nodes), [[800, 300]]);
    assert.equal(store.getState().nodes[0].data.lockAspectRatio, true);
  });
  test('committing pending fields before disabling ratio lock preserves the previous ratio in one edit', () => {
    const store = makeStore();
    const nodes = [node('a', 600, 300, { lockAspectRatio: true })];
    const edges = [];
    store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
    store.getState().setSelectionGeometry(['a'], [{ width: 800 }, { lockAspectRatio: false }]);
    assert.deepEqual(sizes(store.getState().nodes), [[800, 400]]);
    assert.equal(store.getState().nodes[0].data.lockAspectRatio, false);
    assert.equal(store.getState().historyIndex, 1);
    store.getState().undo();
    assert.deepEqual(sizes(store.getState().nodes), [[600, 300]]);
    assert.equal(store.getState().nodes[0].data.lockAspectRatio, true);
    store.getState().redo();
    assert.deepEqual(sizes(store.getState().nodes), [[800, 400]]);
    assert.equal(store.getState().nodes[0].data.lockAspectRatio, false);
  });
} finally {
  rmSync(bundle, { force: true });
  rmdirSync(temporary);
}
console.log(`${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
