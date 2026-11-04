// Explicit arrangement keeps geometry, group membership, and DAG order intact.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'thoughtdag-arrange-'));
const bundle = join(temp, 'arrange.mjs');
execFileSync(process.execPath, [join(root, 'node_modules/esbuild/bin/esbuild'),
  join(root, 'src/lib/arrange-selection.ts'), '--bundle', '--format=esm', '--platform=node',
  `--outfile=${bundle}`, '--define:import.meta.env={}',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const { arrangeNodes, arrangementUnitCount } = await import(pathToFileURL(bundle).href);
const framesBundle = join(temp, 'frames.mjs');
execFileSync(process.execPath, [join(root, 'node_modules/esbuild/bin/esbuild'),
  join(root, 'src/lib/frames.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${framesBundle}`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
const { resolveCarriedNodeIds } = await import(pathToFileURL(framesBundle).href);
const node = (id, x, y, width = 100, height = 80, data = {}) => ({
  id, type: 'thought', position: { x, y }, width, height,
  data: { question: 'Question', response: '', isCollapsed: false, ...data },
});
const edge = (source, target, data) => ({ id: `${source}-${target}`, source, target, data });
const position = (result, id) => result.nodes.find((n) => n.id === id).position;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const all = (nodes, action, reference, viewport, edges = []) => arrangeNodes(nodes, edges, nodes.map((n) => n.id), action, reference, viewport);
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
  test('distribution refuses negative spacing instead of overlapping cards', () => {
    const nodes = [node('a', 0, 0, 300), node('b', 30, 200, 300), node('c', 60, 400, 300)];
    assert.equal(all(nodes, 'distribute-horizontal').reason, 'overlap');
  });
  test('one selected group member expands to a rigid unit', () => {
    const nodes = [node('g1', 200, 0, 100, 80, { canvasGroupId: 'group' }),
      node('g2', 300, 120, 100, 80, { canvasGroupId: 'group' }), node('other', 0, 400)];
    const result = arrangeNodes(nodes, [], ['g1', 'other'], 'left');
    assert.equal(result.changed, true);
    close(position(result, 'g1').x, 0);
    close(position(result, 'g2').x, 100);
    close(position(result, 'g2').y - position(result, 'g1').y, 120);
    assert.equal(arrangementUnitCount(nodes, ['g1', 'g2']), 1);
  });
  test('a rigid group moves to viewport center by its bounding box', () => {
    const nodes = [node('a', 0, 0, 100, 80, { canvasGroupId: 'g' }), node('b', 150, 150, 100, 80, { canvasGroupId: 'g' })];
    const result = all(nodes, 'center', 'viewport', { x: 0, y: 0, width: 1000, height: 800 });
    close(position(result, 'a').x, 375);
    close(position(result, 'b').x, 525);
  });
  test('unselected nodes remain identical and block new collisions', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 200), node('fixed', 0, 200)];
    const blocked = arrangeNodes(nodes, [], ['a', 'b'], 'left');
    assert.equal(blocked.reason, 'overlap');
    assert.equal(blocked.nodes, nodes);
    const changed = arrangeNodes(nodes, [], ['a', 'b'], 'right');
    assert.equal(changed.changed, true);
    assert.equal(changed.nodes[2], nodes[2]);
  });
  test('continuation nodes cannot be flattened onto one row', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 200)];
    const result = all(nodes, 'top', 'selection', undefined, [edge('parent', 'child')]);
    assert.equal(result.reason, 'context-order');
    assert.equal(result.nodes, nodes);
  });
  test('a boundary edge protects its unselected parent and chain column', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 200), node('other', 400, 500)];
    const result = arrangeNodes(nodes, [edge('parent', 'child')], ['child', 'other'], 'right');
    assert.equal(result.reason, 'chain-alignment');
    assert.equal(result.nodes, nodes);
  });
  test('a boundary edge protects its unselected child against moving the parent below it', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 200), node('other', 400, 500)];
    const result = arrangeNodes(nodes, [edge('parent', 'child')], ['parent', 'other'], 'bottom');
    assert.equal(result.reason, 'context-order');
  });
  test('horizontal continuation cannot be flattened onto one column', () => {
    const nodes = [node('parent', 0, 80, 100, 80, { layoutDirection: 'horizontal' }), node('child', 300, 80)];
    const result = all(nodes, 'left', 'selection', undefined, [edge('parent', 'child')]);
    assert.equal(result.reason, 'context-order');
    assert.equal(result.nodes, nodes);
  });
  test('horizontal distribution preserves a conversation row with unequal widths', () => {
    const nodes = [node('a', 0, 80, 100, 80, { layoutDirection: 'horizontal' }),
      node('b', 300, 80, 180, 120, { layoutDirection: 'horizontal' }), node('c', 900, 80, 120, 100)];
    const result = all(nodes, 'distribute-horizontal', 'selection', undefined, [edge('a', 'b'), edge('b', 'c')]);
    assert.equal(result.changed, true);
    assert.equal(result.reason, undefined);
    close(position(result, 'b').x - 100, position(result, 'c').x - position(result, 'b').x - 180);
    for (const n of result.nodes) close(n.position.y, 80);
  });
  test('horizontal boundary protects the unselected parent row', () => {
    const nodes = [node('parent', 0, 80, 100, 80, { layoutDirection: 'horizontal' }),
      node('child', 300, 80), node('other', 700, 500)];
    const result = arrangeNodes(nodes, [edge('parent', 'child')], ['child', 'other'], 'bottom');
    assert.equal(result.reason, 'chain-alignment');
    assert.equal(result.nodes, nodes);
  });
  test('horizontal boundary prevents moving the parent beyond its unselected child', () => {
    const nodes = [node('parent', 0, 80, 100, 80, { layoutDirection: 'horizontal' }),
      node('child', 300, 80), node('other', 800, 500)];
    const result = arrangeNodes(nodes, [edge('parent', 'child')], ['parent', 'other'], 'right');
    assert.equal(result.reason, 'context-order');
    assert.equal(result.nodes, nodes);
  });
  test('horizontal chain with unequal heights keeps its top-aligned row', () => {
    const nodes = [node('parent', 0, 80, 100, 180, { layoutDirection: 'horizontal' }), node('child', 300, 80, 100, 80)];
    assert.equal(all(nodes, 'bottom', 'selection', undefined, [edge('parent', 'child')]).reason, 'chain-alignment');
    assert.equal(all(nodes, 'top', 'selection', undefined, [edge('parent', 'child')]).changed, false);
  });
  test('horizontal metadata on a child supports an older parent without direction', () => {
    const nodes = [node('parent', 0, 80), node('child', 300, 80, 100, 80, { layoutDirection: 'horizontal' })];
    assert.equal(all(nodes, 'left', 'selection', undefined, [edge('parent', 'child')]).reason, 'context-order');
  });
  test('a sole horizontal reference preserves the same input order', () => {
    const nodes = [node('parent', 0, 80, 100, 80, { layoutDirection: 'horizontal' }), node('child', 300, 80)];
    assert.equal(all(nodes, 'right', 'selection', undefined, [edge('parent', 'child', { isCrossLink: true })]).reason, 'context-order');
  });
  test('horizontal exploration may align below its parent but cannot precede it', () => {
    const nodes = [node('parent', 100, 80, 100, 80, { layoutDirection: 'horizontal' }), node('branch', 400, 400)];
    const edges = [edge('parent', 'branch', { isBranchFromSelection: true })];
    assert.equal(all(nodes, 'left', 'selection', undefined, edges).changed, true);
    assert.equal(arrangeNodes(nodes, edges, ['branch'], 'left', 'viewport', { x: 0, y: 0, width: 1000, height: 1000 }).reason, 'context-order');
  });
  test('watch edges do not impose context order', () => {
    const nodes = [node('parent', 0, 0), node('watcher', 400, 200)];
    const result = all(nodes, 'bottom', 'selection', undefined, [edge('parent', 'watcher', { isWatch: true })]);
    assert.equal(result.changed, true);
  });
  test('a cross-link that is the only parent preserves continuation order', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 200)];
    assert.equal(all(nodes, 'bottom', 'selection', undefined, [edge('parent', 'child', { isCrossLink: true })]).reason, 'context-order');
  });
  test('an ordinary reference does not replace a real continuation parent', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 200), node('reference', 400, 500)];
    const result = arrangeNodes(nodes, [edge('parent', 'child'), edge('reference', 'child', { isCrossLink: true })], ['reference'], 'top', 'viewport', { x: 0, y: 300, width: 1000, height: 800 });
    assert.equal(result.changed, true);
  });
  test('exploration may align beside the parent but cannot move above it', () => {
    const nodes = [node('parent', 0, 100), node('branch', 400, 300)];
    const edges = [edge('parent', 'branch', { isBranchFromSelection: true })];
    assert.equal(all(nodes, 'top', 'selection', undefined, edges).changed, true);
    assert.equal(arrangeNodes(nodes, edges, ['branch'], 'top', 'viewport', { x: 0, y: 0, width: 1000, height: 1000 }).reason, 'context-order');
  });
  test('an alternative answer can move laterally without moving the main chain', () => {
    const nodes = [node('parent', 0, 0), node('main', 0, 200), node('alternative', 400, 200)];
    const result = arrangeNodes(nodes, [edge('parent', 'main'), edge('parent', 'alternative')], ['alternative'],
      'right', 'viewport', { x: 0, y: 0, width: 1000, height: 800 });
    assert.equal(result.changed, true);
    close(position(result, 'alternative').x, 900);
    assert.equal(result.nodes[0], nodes[0]);
    assert.equal(result.nodes[1], nodes[1]);
  });
  test('a merge keeps the first continued parent column rather than an exploration column', () => {
    const nodes = [node('explore', 400, 0), node('main', 0, 0), node('merge', 0, 200)];
    const result = arrangeNodes(nodes, [edge('explore', 'merge', { isBranchFromSelection: true }), edge('main', 'merge')], ['merge'],
      'right', 'viewport', { x: 0, y: 0, width: 1000, height: 800 });
    assert.equal(result.reason, 'chain-alignment');
  });
  test('unrelated existing violations do not block a valid arrangement', () => {
    const nodes = [...fixture(), node('bad-parent', 2000, 200), node('bad-child', 2400, 0)];
    const result = arrangeNodes(nodes, [edge('bad-parent', 'bad-child')], ['a', 'b', 'c'], 'left');
    assert.equal(result.changed, true);
    assert.equal(result.nodes[3], nodes[3]);
    assert.equal(result.nodes[4], nodes[4]);
  });
  test('moving an imperfect chain as a rigid group does not worsen it', () => {
    const nodes = [node('a', 0, 100, 100, 80, { canvasGroupId: 'g' }), node('b', 200, 50, 100, 80, { canvasGroupId: 'g' })];
    const result = all(nodes, 'bottom', 'viewport', { x: 0, y: 0, width: 1000, height: 800 }, [edge('a', 'b')]);
    assert.equal(result.changed, true);
    close(position(result, 'b').y - position(result, 'a').y, -50);
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
    const result = arrangeNodes(nodes, [], ['frame', 'a'], 'left', 'viewport', { x: 0, y: 0, width: 1600, height: 1000 });
    assert.equal(result.changed, true);
    for (const original of nodes) {
      if (carried.includes(original.id)) close(position(result, original.id).x - original.position.x, -100);
      else assert.equal(result.nodes.find(n => n.id === original.id), original);
    }
  });
  test('an unlinked frame aligns alone and a cross-boundary group stays outside its carrying set', () => {
    const nodes = [
      node('frame', 100, 100, 500, 500, { stepKind: 'frame', frameCarry: false }),
      node('a', 150, 180, 100, 80, { canvasGroupId: 'g' }),
      node('b', 600, 350, 100, 80, { canvasGroupId: 'g' }),
      node('single', 300, 450),
    ];
    const viewport = { x: 0, y: 0, width: 1600, height: 1000 };
    const result = arrangeNodes(nodes, [], ['frame'], 'left', 'viewport', viewport);
    assert.equal(result.changed, true);
    assert.ok(result.nodes.slice(1).every((n, i) => n === nodes[i + 1]));
    const linked = nodes.map(n => n.id === 'frame' ? { ...n, data: { ...n.data, frameCarry: true } } : n);
    assert.deepEqual(resolveCarriedNodeIds(linked, ['frame']), ['frame', 'single']);
    const moved = arrangeNodes(linked, [], ['frame'], 'left', 'viewport', viewport);
    assert.equal(moved.changed, true);
    assert.equal(moved.nodes[1], linked[1]);
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
    const result = arrangeNodes(nodes, [], ids, 'right', 'viewport', { x: 0, y: 0, width: 1600, height: 1000 });
    assert.equal(result.changed, true);
    for (const original of nodes) close(position(result, original.id).x - original.position.x, 500);
    const invalid = arrangeNodes(nodes, [], ids, 'distribute-horizontal');
    assert.equal(invalid.reason, 'insufficient');
    assert.equal(invalid.nodes, nodes);
  });
  console.log(`\n${passed} arrangement checks passed.`);
} finally {
  unlinkSync(bundle);
  unlinkSync(framesBundle);
  rmdirSync(temp);
}
