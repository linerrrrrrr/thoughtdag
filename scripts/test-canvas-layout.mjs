// Selectable graph layouts and future-node direction invariants.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'tdag-canvas-layout-'));
const bundle = join(temporary, 'layout.mjs');
const placementBundle = join(temporary, 'placement.mjs');
let failures = 0;
const test = (name, run) => {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
const node = (id, x = 0, y = 0, width = 200, height = 120, data = {}) => ({
  id, type: 'thought', position: { x, y }, width, height, measured: { width, height },
  data: { question: id, response: 'Answer', isCollapsed: false, ...data },
});
const edge = (source, target, data = {}) => ({ id: `${source}-${target}`, source, target, data });
const defaults = { direction: 'vertical', method: 'chains', density: 'standard', route: 'auto' };
const get = (nodes, id) => nodes.find((n) => n.id === id);
const assertClear = (nodes) => {
  const cards = nodes.filter((n) => n.data.stepKind !== 'frame');
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x
      || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y, `${a.id} overlaps ${b.id}`);
  }
};
try {
  const compile = (entry, outfile) => buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  compile('src/lib/canvas-layout.ts', bundle); compile('src/lib/layout.ts', placementBundle);
  const { planCanvasLayout } = await import(pathToFileURL(bundle).href);
  const { placeNewNodes } = await import(pathToFileURL(placementBundle).href);
  const plan = (nodes, edges, options = {}, ids) => planCanvasLayout(nodes, edges, { ...defaults, ...options }, ids);
  for (const direction of ['vertical', 'horizontal']) {
    test(`${direction} chains align continuations, order merges and clear resized cards`, () => {
      const nodes = [node('a', 0, 0, 900, 400), node('b', 20, 10, 300, 800), node('c', 30, 50, 700, 300),
        node('merge', 40, 40, 500, 300), node('root', 700, 300, 400, 650)];
      const edges = [edge('a', 'b'), edge('a', 'c', { isBranchFromSelection: true }), edge('b', 'merge'), edge('c', 'merge')];
      const original = JSON.stringify(nodes);
      const result = plan(nodes, edges, { direction });
      assert.equal(result.error, undefined);
      assert.equal(JSON.stringify(nodes), original, 'input must remain unchanged');
      const cross = direction === 'horizontal' ? 'y' : 'x', primary = direction === 'horizontal' ? 'x' : 'y';
      assert.equal(get(result.nodes, 'a').position[cross], get(result.nodes, 'b').position[cross]);
      assert.equal(get(result.nodes, 'b').position[cross], get(result.nodes, 'merge').position[cross]);
      for (const e of edges) {
        const a = get(result.nodes, e.source), b = get(result.nodes, e.target);
        assert.ok(b.position[primary] >= a.position[primary] + (direction === 'horizontal' ? a.width : a.height));
      }
      assertClear(result.nodes);
      assert.ok(result.nodes.every((n) => n.data.layoutDirection === direction));
      const reversed = plan([...nodes].reverse(), edges, { direction });
      for (const n of result.nodes) assert.deepEqual(n.position, get(reversed.nodes, n.id).position);
    });
    test(`${direction} layer layout uses one coordinate for each dependency rank`, () => {
      const nodes = [node('a'), node('b', 20, 30, 400, 700), node('c', 400, 30, 800, 200), node('d'), node('e')];
      const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'e')];
      const result = plan(nodes, edges, { direction, method: 'layers' });
      assert.equal(result.error, undefined);
      const axis = direction === 'horizontal' ? 'x' : 'y';
      assert.equal(get(result.nodes, 'b').position[axis], get(result.nodes, 'c').position[axis]);
      assert.equal(get(result.nodes, 'd').position[axis], get(result.nodes, 'e').position[axis]);
      assertClear(result.nodes);
    });
  }
  test('density changes spacing without changing context or lane ownership', () => {
    const nodes = [node('a'), node('b')], edges = [edge('a', 'b')];
    const positions = ['compact', 'standard', 'relaxed'].map((density) => get(plan(nodes, edges, { density }).nodes, 'b').position.y);
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
  });
  test('manual keeps every position and group intact while saving selected defaults', () => {
    const nodes = [node('a', 200, 100, 200, 100, { canvasGroupId: 'g' }), node('b', 400, 120, 200, 100, { canvasGroupId: 'g' }), node('c')];
    const result = plan(nodes, [], { method: 'manual', direction: 'horizontal', route: 'orthogonal' }, ['a', 'b']);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.nodes.map((n) => n.position), nodes.map((n) => n.position));
    assert.equal(result.nodes[0].data.edgeRouteDefault, 'orthogonal');
    assert.equal(result.nodes[0].data.canvasGroupId, 'g');
    assert.equal(result.nodes[2], nodes[2]);
  });
  test('automatic layouts refuse rigid groups atomically', () => {
    const nodes = [node('a', 0, 0, 200, 100, { canvasGroupId: 'g' }), node('b', 300, 100, 200, 100, { canvasGroupId: 'g' })];
    for (const ids of [undefined, ['a'], ['a', 'b']]) {
      const result = plan(nodes, [edge('a', 'b')], {}, ids);
      assert.equal(result.error, 'grouped-nodes'); assert.equal(result.nodes, nodes);
    }
  });
  test('selected middle turn respects fixed upstream/downstream and chain column', () => {
    const nodes = [node('a', 80, 0), node('b', 20, 400), node('c', 80, 1000)];
    const result = plan(nodes, [edge('a', 'b'), edge('b', 'c')], {}, ['b']);
    assert.equal(result.error, undefined);
    assert.equal(result.nodes[0], nodes[0]); assert.equal(result.nodes[2], nodes[2]);
    assert.equal(result.nodes[1].position.x, 80);
    assert.ok(result.nodes[1].position.y >= 120 && result.nodes[1].position.y + 120 < 1000);
  });
  test('insufficient boundary space refuses without moving any node', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 150), node('c', 0, 300)];
    const result = plan(nodes, [edge('a', 'b'), edge('b', 'c')], {}, ['b']);
    assert.equal(result.error, 'boundary-conflict'); assert.equal(result.nodes, nodes);
  });
  test('horizontal selected turns keep their fixed parent and child row', () => {
    const nodes = [node('a', 0, 80), node('b', 400, 20), node('c', 1400, 80)];
    const result = plan(nodes, [edge('a', 'b'), edge('b', 'c')], { direction: 'horizontal' }, ['b']);
    assert.equal(result.error, undefined);
    assert.equal(result.nodes[0], nodes[0]); assert.equal(result.nodes[2], nodes[2]);
    assert.equal(result.nodes[1].position.y, 80);
    assert.ok(result.nodes[1].position.x >= 200 && result.nodes[1].position.x + 200 < 1400);
  });
  test('materials and frames remain fixed and their children clear the material', () => {
    const nodes = [node('file', 100, 100, 700, 400, { stepKind: 'file' }), node('frame', -100, -100, 2000, 2000, { stepKind: 'frame' }), node('a', 100, 50), node('b', 100, 200)];
    const result = plan(nodes, [edge('file', 'a'), edge('a', 'b')]);
    assert.equal(result.error, undefined);
    assert.equal(result.nodes[0], nodes[0]); assert.equal(result.nodes[1], nodes[1]);
    assert.ok(result.nodes[2].position.y >= 500); assertClear(result.nodes);
  });
  test('selection avoids unselected obstacles without moving them', () => {
    const nodes = [node('a'), node('b'), node('fixed', 0, 400, 400, 400)];
    const result = plan(nodes, [edge('a', 'b')], {}, ['a', 'b']);
    assert.equal(result.error, undefined); assert.equal(result.nodes[2], nodes[2]); assertClear(result.nodes);
  });
  test('cycles and empty scopes produce explicit failures', () => {
    const nodes = [node('a'), node('b')];
    assert.equal(plan(nodes, [edge('a', 'b'), edge('b', 'a')]).error, 'cycle');
    assert.equal(plan(nodes, [], {}, []).error, 'empty-selection');
  });
  test('new horizontal turns inherit direction and route across a batch', () => {
    const parent = node('p', 100, 200, 600, 300, { layoutDirection: 'horizontal', edgeRouteDefault: 'orthogonal' });
    const result = placeNewNodes([parent, node('a'), node('b')], [edge('p', 'a'), edge('a', 'b')], ['a', 'b']);
    assert.equal(result[0], parent);
    for (const id of ['a', 'b']) {
      const n = get(result, id); assert.equal(n.position.y, 200);
      assert.equal(n.data.layoutDirection, 'horizontal'); assert.equal(n.data.edgeRouteDefault, 'orthogonal');
    }
    assert.ok(get(result, 'a').position.x >= 700); assertClear(result);
  });
  test('horizontal merge advances past every parent and keeps its owner row', () => {
    const a = node('a', 0, 0, 200, 120, { layoutDirection: 'horizontal' }), b = node('b', 1000, 500, 800, 200);
    const result = placeNewNodes([a, b, node('m')], [edge('a', 'm'), edge('b', 'm')], ['m']);
    assert.equal(result[0], a); assert.equal(result[1], b);
    assert.equal(result[2].position.y, 0); assert.ok(result[2].position.x >= 1800); assertClear(result);
  });
  test('horizontal continuation skips occupied space without drifting off its row', () => {
    const p = node('p', 0, 0, 200, 120, { layoutDirection: 'horizontal' }), blocker = node('blocker', 280, 0, 400, 400);
    const result = placeNewNodes([p, blocker, node('new')], [edge('p', 'new')], ['new']);
    assert.equal(result[0], p); assert.equal(result[1], blocker);
    assert.equal(result[2].position.y, 0); assert.ok(result[2].position.x >= 680); assertClear(result);
  });
  test('vertical continuation skips occupied space without drifting off its column', () => {
    const p = node('p', 0, 0), blocker = node('blocker', 0, 180, 400, 400);
    const result = placeNewNodes([p, blocker, node('new')], [edge('p', 'new')], ['new']);
    assert.equal(result[2].position.x, 0); assert.ok(result[2].position.y >= 580); assertClear(result);
  });
  test('horizontal sibling branches use separate rows', () => {
    const p = node('p', 0, 0, 200, 200, { layoutDirection: 'horizontal' });
    const siblings = [node('a', 0, 0, 400, 300), node('b', 0, 0, 700, 600)];
    const result = placeNewNodes([p, ...siblings], siblings.map((n) => edge('p', n.id, { isBranchFromSelection: true })), ['a', 'b']);
    assertClear(result); assert.ok(result[1].position.x >= 200 && result[2].position.x >= 200);
    assert.notEqual(result[1].position.y, result[2].position.y);
  });
} finally {
  unlinkSync(bundle); unlinkSync(placementBundle); rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
