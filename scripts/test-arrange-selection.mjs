// Manual arrangement follows the selection, including overlaps and offset chains.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'thoughtdag-arrange-'));
const bundle = join(temp, 'arrange.mjs');
buildSync({ entryPoints: [join(root, 'src/lib/arrange-selection.ts')], bundle: true,
  format: 'esm', platform: 'node', outfile: bundle, define: { 'import.meta.env': '{}' } });
const { arrangeNodes, arrangementUnitCount } = await import(pathToFileURL(bundle).href);
const framesBundle = join(temp, 'frames.mjs');
buildSync({ entryPoints: [join(root, 'src/lib/frames.ts')], bundle: true,
  format: 'esm', platform: 'node', outfile: framesBundle, define: { 'import.meta.env': '{}' } });
const { resolveCarriedNodeIds } = await import(pathToFileURL(framesBundle).href);
const node = (id, x, y, width = 100, height = 80, data = {}) => ({
  id, type: 'thought', position: { x, y }, width, height,
  data: { question: 'Question', response: '', isCollapsed: false, ...data },
});
const position = (result, id) => result.nodes.find((n) => n.id === id).position;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const all = (nodes, action, reference, viewport) => arrangeNodes(nodes, nodes.map((n) => n.id), action, reference, viewport);
const fixture = () => [node('a', 20, 30, 100, 80), node('b', 400, 300, 160, 120), node('c', 800, 600, 120, 100)];

try {
  for (const action of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
    test(`${action} uses the selected objects' measured edges and centers`, () => {
      const nodes = fixture();
      nodes[1].measured = { width: 180, height: 140 };
      const result = all(nodes, action);
      assert.equal(result.changed, true);
      assert.equal(result.reason, undefined);
      for (const original of nodes) {
        const next = position(result, original.id);
        const width = original.measured?.width ?? original.width;
        const height = original.measured?.height ?? original.height;
        if (action === 'left') close(next.x, 20);
        if (action === 'center') close(next.x + width / 2, 470);
        if (action === 'right') close(next.x + width, 920);
        if (action === 'top') close(next.y, 30);
        if (action === 'middle') close(next.y + height / 2, 365);
        if (action === 'bottom') close(next.y + height, 700);
        if (['left', 'center', 'right'].includes(action)) close(next.y, original.position.y);
        else close(next.x, original.position.x);
      }
    });
  }
  test('horizontal distribution equalizes edge gaps for unequal widths', () => {
    const nodes = fixture();
    const result = all(nodes, 'distribute-horizontal');
    const left = position(result, 'a').x;
    const middle = position(result, 'b').x;
    const right = position(result, 'c').x;
    close(left, 20);
    close(right, 800);
    close(middle - left - 100, right - middle - 160);
  });
  test('vertical distribution equalizes edge gaps for unequal heights', () => {
    const result = all(fixture(), 'distribute-vertical');
    close(position(result, 'a').y, 30);
    close(position(result, 'c').y, 600);
    close(position(result, 'b').y - 30 - 80, 600 - position(result, 'b').y - 120);
  });
  test('viewport alignment supports one object and negative canvas coordinates', () => {
    const viewport = { x: -1000, y: -800, width: 900, height: 600 };
    const result = all([node('one', 10, 20)], 'center', 'viewport', viewport);
    close(position(result, 'one').x, -600);
    close(position(result, 'one').y, 20);
  });
  test('viewport distribution places two objects at the viewport edges', () => {
    const result = all(fixture().slice(0, 2), 'distribute-vertical', 'viewport', { x: 0, y: -200, width: 1000, height: 1000 });
    close(position(result, 'a').y, -200);
    close(position(result, 'b').y, 680);
  });
  test('selection distribution requires three independent objects', () => {
    const nodes = fixture().slice(0, 2);
    const result = all(nodes, 'distribute-horizontal');
    assert.equal(result.reason, 'insufficient');
    assert.equal(result.nodes, nodes);
  });
  test('viewport validation rejects non-finite or empty rectangles', () => {
    const nodes = fixture();
    for (const rect of [undefined, { x: 0, y: 0, width: 0, height: 100 }, { x: Infinity, y: 0, width: 100, height: 100 }]) {
      assert.equal(all(nodes, 'left', 'viewport', rect).reason, 'invalid-viewport');
    }
  });
  for (const axis of ['horizontal', 'vertical']) {
    test(`${axis} distribution allows equal negative gaps and preserves the outer bounds`, () => {
      const nodes = [node('a', 0, 0, 300, 300), node('b', 20, 20, 200, 200), node('c', 60, 60, 300, 300)];
      const result = all(nodes, `distribute-${axis}`);
      assert.equal(result.changed, true);
      assert.equal(result.reason, undefined);
      const coordinate = axis === 'horizontal' ? 'x' : 'y';
      close(position(result, 'a')[coordinate], 0);
      close(position(result, 'b')[coordinate], 80);
      close(position(result, 'c')[coordinate], 60);
      close(position(result, 'b')[coordinate] - 300, -220);
      close(position(result, 'c')[coordinate] - position(result, 'b')[coordinate] - 200, -220);
    });
  }
  test('viewport distribution allows cards wider than the visible canvas', () => {
    const result = all([node('a', 0, 0, 300), node('b', 600, 200, 200)],
      'distribute-horizontal', 'viewport', { x: 10, y: 0, width: 100, height: 800 });
    assert.equal(result.reason, undefined);
    close(position(result, 'a').x, 10);
    close(position(result, 'b').x + 200, 110);
  });
  test('legacy metadata never expands the selected alignment scope', () => {
    const nodes = [node('g1', 200, 0, 100, 80, { canvasGroupId: 'group' }),
      node('g2', 300, 120, 100, 80, { canvasGroupId: 'group' }), node('other', 0, 400)];
    const result = arrangeNodes(nodes, ['g1', 'other'], 'left');
    assert.equal(result.changed, true);
    close(position(result, 'g1').x, 0);
    assert.equal(result.nodes[1], nodes[1]);
    close(position(result, 'g2').y - position(result, 'g1').y, 120);
    assert.equal(result.nodes[0].data.canvasGroupId, 'group');
    assert.equal(arrangementUnitCount(nodes, ['g1', 'g2']), 2);
    assert.equal(arrangementUnitCount(nodes, ['g1', 'other']), 2);
  });
  test('nodes sharing retired metadata always remain independent alignment objects', () => {
    const nodes = [node('g1', 200, 0, 100, 80, { canvasGroupId: 'group' }),
      node('g2', 300, 120, 100, 80, { canvasGroupId: 'group' }),
      node('g3', 600, 300, 100, 80, { canvasGroupId: 'group' })];
    const result = arrangeNodes(nodes, ['g1', 'g2'], 'left');
    assert.equal(result.changed, true);
    close(position(result, 'g1').x, 200);
    close(position(result, 'g2').x, 200);
    assert.equal(result.nodes[2], nodes[2]);
    assert.equal(arrangementUnitCount(nodes, ['g1', 'g2']), 2);
    assert.equal(arrangementUnitCount(nodes, ['g1', 'g2', 'g3']), 3);
  });
  test('centering ignores retired metadata and centers each selected card', () => {
    const nodes = [node('a', 0, 0, 100, 80, { canvasGroupId: 'g' }), node('b', 150, 150, 100, 80, { canvasGroupId: 'g' })];
    const result = all(nodes, 'center', 'viewport', { x: 0, y: 0, width: 1000, height: 800 });
    close(position(result, 'a').x, 450);
    close(position(result, 'b').x, 450);
  });
  test('distribution treats imported nodes with matching retired metadata independently', () => {
    const nodes = [node('a', 0, 0, 100, 80, { canvasGroupId: 'retired' }),
      node('b', 350, 150, 100, 80, { canvasGroupId: 'retired' }),
      node('c', 600, 300, 100, 80, { canvasGroupId: 'retired' })];
    const result = all(nodes, 'distribute-horizontal');
    assert.equal(result.changed, true);
    close(position(result, 'a').x, 0); close(position(result, 'b').x, 300); close(position(result, 'c').x, 600);
  });
  test('alignment may overlap an unselected node without moving it', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 200), node('fixed', 0, 200)];
    const result = arrangeNodes(nodes, ['a', 'b'], 'left');
    assert.equal(result.changed, true);
    assert.equal(result.reason, undefined);
    assert.deepEqual(position(result, 'b'), nodes[2].position);
    assert.equal(result.nodes[2], nodes[2]);
  });
  test('vertical conversation nodes may align onto one row', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 200)];
    const result = all(nodes, 'top');
    assert.equal(result.changed, true);
    assert.equal(result.reason, undefined);
    assert.deepEqual(position(result, 'child'), position(result, 'parent'));
  });
  test('partial alignment may offset a child while its unselected parent stays fixed', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 200), node('other', 400, 500)];
    const result = arrangeNodes(nodes, ['child', 'other'], 'right');
    assert.equal(result.changed, true);
    close(position(result, 'child').x, 400);
    assert.equal(result.nodes[0], nodes[0]);
  });
  test('manual alignment may move a parent below its unselected child', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 200), node('other', 400, 500)];
    const result = arrangeNodes(nodes, ['parent', 'other'], 'bottom');
    assert.equal(result.changed, true);
    close(position(result, 'parent').y, 500);
    assert.equal(result.nodes[1], nodes[1]);
  });
  test('horizontal conversation nodes may align onto one column', () => {
    const nodes = [node('parent', 0, 80, 100, 80, { layoutDirection: 'horizontal' }), node('child', 300, 80)];
    const result = all(nodes, 'left');
    assert.equal(result.changed, true);
    assert.equal(result.reason, undefined);
    assert.deepEqual(position(result, 'child'), position(result, 'parent'));
  });
  test('horizontal nodes with unequal heights support bottom alignment', () => {
    const nodes = [node('parent', 0, 80, 100, 180, { layoutDirection: 'horizontal' }), node('child', 300, 80, 100, 80)];
    const result = all(nodes, 'bottom');
    assert.equal(result.changed, true);
    close(position(result, 'parent').y + 180, position(result, 'child').y + 80);
    assert.equal(all(nodes, 'top').changed, false);
  });
  test('manual placement preserves node data, dimensions and the unselected objects', () => {
    const nodes = [...fixture(), node('fixed', 0, 300)];
    const result = arrangeNodes(nodes, ['a', 'b', 'c'], 'left');
    assert.equal(result.changed, true);
    for (let index = 0; index < 3; index++) {
      assert.equal(result.nodes[index].data, nodes[index].data);
      assert.equal(result.nodes[index].width, nodes[index].width);
      assert.equal(result.nodes[index].height, nodes[index].height);
    }
    assert.equal(result.nodes[3], nodes[3]);
  });
  test('idempotent arrangement is not an undo step and preserves references', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 200)];
    const result = all(nodes, 'left');
    assert.equal(result.changed, false);
    assert.equal(result.nodes, nodes);
    assert.equal(result.reason, undefined);
  });
  test('linked-frame alignment uses the exact same carried nodes as dragging', () => {
    const nodes = [
      node('frame', 100, 100, 500, 500, { stepKind: 'frame', frameCarry: true }),
      node('a', 150, 180, 100, 80, { canvasGroupId: 'g' }),
      node('b', 350, 350, 100, 80, { canvasGroupId: 'g' }),
      node('unrelated', 1300, 800),
    ];
    const carried = resolveCarriedNodeIds(nodes, ['frame']);
    assert.deepEqual(carried, ['frame', 'a', 'b']);
    assert.equal(arrangementUnitCount(nodes, ['frame', 'a']), 1);
    const result = arrangeNodes(nodes, ['frame', 'a'], 'left', 'viewport', { x: 0, y: 0, width: 1600, height: 1000 });
    assert.equal(result.changed, true);
    for (const original of nodes) {
      if (carried.includes(original.id)) close(position(result, original.id).x - original.position.x, -100);
      else assert.equal(result.nodes.find(n => n.id === original.id), original);
    }
  });
  test('an unlinked frame aligns alone and a linked frame carries only contained nodes', () => {
    const nodes = [
      node('frame', 100, 100, 500, 500, { stepKind: 'frame', frameCarry: false }),
      node('a', 150, 180, 100, 80, { canvasGroupId: 'g' }),
      node('b', 600, 350, 100, 80, { canvasGroupId: 'g' }),
      node('single', 300, 450),
    ];
    const viewport = { x: 0, y: 0, width: 1600, height: 1000 };
    const result = arrangeNodes(nodes, ['frame'], 'left', 'viewport', viewport);
    assert.equal(result.changed, true);
    assert.ok(result.nodes.slice(1).every((n, i) => n === nodes[i + 1]));
    const linked = nodes.map(n => n.id === 'frame' ? { ...n, data: { ...n.data, frameCarry: true } } : n);
    assert.deepEqual(resolveCarriedNodeIds(linked, ['frame']), ['frame', 'a', 'single']);
    const moved = arrangeNodes(linked, ['frame'], 'left', 'viewport', viewport);
    assert.equal(moved.changed, true);
    close(position(moved, 'a').x, 50);
    assert.equal(moved.nodes[2], linked[2]);
    close(position(moved, 'single').x, 200);
  });
  test('overlapping frames merge shared carrying sets instead of moving cards twice', () => {
    const nodes = [
      node('f1', 0, 0, 500, 500, { stepKind: 'frame' }),
      node('f2', 300, 0, 500, 500, { stepKind: 'frame' }),
      node('f3', 600, 0, 500, 500, { stepKind: 'frame' }),
      node('shared12', 350, 100), node('shared23', 650, 100),
      node('only1', 50, 300), node('only3', 950, 300),
    ];
    const ids = ['f1', 'f3', 'f2'];
    assert.equal(arrangementUnitCount(nodes, ids), 1);
    const result = arrangeNodes(nodes, ids, 'right', 'viewport', { x: 0, y: 0, width: 1600, height: 1000 });
    assert.equal(result.changed, true);
    for (const original of nodes) close(position(result, original.id).x - original.position.x, 500);
    const invalid = arrangeNodes(nodes, ids, 'distribute-horizontal');
    assert.equal(invalid.reason, 'insufficient');
    assert.equal(invalid.nodes, nodes);
  });
  console.log(`\n${passed} arrangement checks passed.`);
} finally {
  unlinkSync(bundle);
  unlinkSync(framesBundle);
  rmdirSync(temp);
}
