// Stacking edits preserve the graph while changing one visual ordering.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'thoughtdag-layer-'));
const bundle = join(temp, 'layer.mjs');
buildSync({ entryPoints: [join(root, 'src/lib/node-layer.ts')], outfile: bundle,
  bundle: true, format: 'esm', platform: 'node', define: { 'import.meta.env': '{}' } });
const { nodeLayerOrder, nodeLayerIndices, reorderNodeLayers, canReorderNodeLayer } = await import(pathToFileURL(bundle).href);
const node = (id, extra = {}) => ({ id, type: 'thought', position: { x: 20, y: 30 }, width: 360, height: 240,
  data: { question: id, response: '', isCollapsed: false }, ...extra });
const fixture = () => ['a', 'b', 'c', 'd'].map(id => node(id));
const order = nodes => nodeLayerOrder(nodes).map(node => node.id);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };

try {
  test('one step forward crosses exactly one neighboring object', () => {
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['b'], 'forward')), ['a', 'c', 'b', 'd']);
  });
  test('one step backward crosses exactly one neighboring object', () => {
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['c'], 'backward')), ['a', 'c', 'b', 'd']);
  });
  test('front and back move directly to the requested boundary', () => {
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['b'], 'front')), ['a', 'c', 'd', 'b']);
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['c'], 'back')), ['c', 'a', 'b', 'd']);
  });
  test('adjacent selected objects move as a stable block', () => {
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['b', 'c'], 'forward')), ['a', 'd', 'b', 'c']);
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['b', 'c'], 'backward')), ['b', 'c', 'a', 'd']);
  });
  test('disjoint selections preserve both selected and unselected relative orders', () => {
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['c', 'a'], 'forward')), ['b', 'a', 'd', 'c']);
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['d', 'b'], 'backward')), ['b', 'a', 'd', 'c']);
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['c', 'a'], 'front')), ['b', 'd', 'a', 'c']);
    assert.deepEqual(order(reorderNodeLayers(fixture(), ['d', 'b'], 'back')), ['b', 'd', 'a', 'c']);
  });
  test('boundaries, empty selections and select-all are no-ops', () => {
    const nodes = fixture();
    for (const [ids, action] of [[['d'], 'forward'], [['d'], 'front'], [['a'], 'backward'], [['a'], 'back'],
      [[], 'front'], [['missing'], 'back'], [['a', 'b', 'c', 'd'], 'front']]) {
      assert.equal(canReorderNodeLayer(nodes, ids, action), false);
      assert.equal(reorderNodeLayers(nodes, ids, action), nodes);
    }
  });
  test('explicit sparse layers determine order independently from the node array', () => {
    const nodes = [node('high', { zIndex: 50 }), node('low', { zIndex: -20 }), node('middle', { zIndex: 10 })];
    assert.deepEqual(order(nodes), ['low', 'middle', 'high']);
    assert.deepEqual(order(reorderNodeLayers(nodes, ['low'], 'forward')), ['middle', 'low', 'high']);
  });
  test('geometry, data and creation order survive every command', () => {
    for (const action of ['forward', 'backward', 'front', 'back']) {
      const nodes = fixture();
      const next = reorderNodeLayers(nodes, ['b'], action);
      assert.deepEqual(next.map(node => node.id), nodes.map(node => node.id));
      for (let index = 0; index < nodes.length; index++) {
        assert.equal(next[index].data, nodes[index].data);
        assert.equal(next[index].position, nodes[index].position);
        assert.equal(next[index].width, nodes[index].width);
        assert.equal(next[index].height, nodes[index].height);
      }
      assert.ok(nodes.every(node => node.zIndex === undefined), 'Inputs are immutable');
    }
  });
  test('untouched frames keep the established size-based background order', () => {
    const small = node('small', { zIndex: -1, width: 500, height: 400, data: { stepKind: 'frame' } });
    const large = node('large', { zIndex: -1, width: 1000, height: 800, data: { stepKind: 'frame' } });
    assert.deepEqual(order([node('card'), small, large]), ['large', 'small', 'card']);
  });
  test('a frame can explicitly move over its contents without carrying them', () => {
    const nodes = [node('frame', { zIndex: -1, data: { stepKind: 'frame', frameCarry: true } }), ...fixture()];
    const next = reorderNodeLayers(nodes, ['frame'], 'front');
    assert.deepEqual(order(next), ['a', 'b', 'c', 'd', 'frame']);
    assert.deepEqual(order(next.map(node => node.id === 'frame' ? { ...node, width: 5000, height: 5000 } : node)), order(next));
  });
  test('new cards appear above authored layers and new frames start behind them', () => {
    const authored = reorderNodeLayers(fixture(), ['b'], 'front');
    assert.deepEqual(order([...authored, node('new')]), ['a', 'c', 'd', 'b', 'new']);
    assert.deepEqual(order([...authored, node('frame', { zIndex: -1, data: { stepKind: 'frame' } })]), ['frame', 'a', 'c', 'd', 'b']);
  });
  test('serialized layers and deselection retain the same rendered order', () => {
    const next = reorderNodeLayers(fixture(), ['a'], 'front');
    const copy = JSON.parse(JSON.stringify(next)).map(node => ({ ...node, selected: false }));
    assert.deepEqual(order(copy), ['b', 'c', 'd', 'a']);
    assert.deepEqual([...nodeLayerIndices(copy)], [...nodeLayerIndices(next)]);
  });
  console.log(`\n${passed} node-layer checks passed.`);
} finally {
  rmSync(bundle);
  rmdirSync(temp);
}
