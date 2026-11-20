#!/usr/bin/env node
// Marquee containment is measured, inclusive, and independent of retired metadata.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-selection-'));
const output = join(temporary, 'selection.mjs');
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
try {
  await build({ entryPoints: [join(root, 'src/lib/canvas-selection.ts')], bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  const { enclosedSelection: enclosed, partitionSpatialSelection, layoutSelectionIds } = await import(pathToFileURL(output).href);
  const node = (id, x, y, extra = {}) => ({ id, type: 'thought', position: { x, y }, width: 200, height: 100, data: {}, ...extra });
  const rect = (x, y, width, height) => ({ x, y, width, height });
  test('touching or intersecting a card never selects it', () => {
    const nodes = [node('a', 100, 100)];
    assert.deepEqual(enclosed(nodes, rect(0, 0, 150, 150)), []);
    assert.deepEqual(enclosed(nodes, rect(0, 0, 100, 100)), []);
    assert.deepEqual(enclosed(nodes, rect(100, 100, 199, 100)), []);
  });
  test('exact full bounds select the card inclusively', () => {
    assert.deepEqual(enclosed([node('a', 100, 100)], rect(100, 100, 200, 100)), ['a']);
  });
  test('marquee uses visible measured footprints rather than stored work size', () => {
    const nodes = [node('a', 100, 100, { measured: { width: 300, height: 180 } })];
    assert.deepEqual(enclosed(nodes, rect(100, 100, 200, 100)), []);
    assert.deepEqual(enclosed(nodes, rect(100, 100, 300, 180)), ['a']);
  });
  test('retired metadata never enlarges the marquee selection', () => {
    const nodes = [node('a', 100, 100, { data: { canvasGroupId: 'g' } }), node('b', 500, 100, { data: { canvasGroupId: 'g' } })];
    assert.deepEqual(enclosed(nodes, rect(100, 100, 200, 100)), ['a']);
    assert.deepEqual(enclosed(nodes, rect(100, 100, 600, 100)), ['a', 'b']);
  });
  test('additive marquee preserves its baseline without toggling overlapping objects', () => {
    const nodes = [node('a', 100, 100), node('b', 500, 100)];
    assert.deepEqual(enclosed(nodes, rect(500, 100, 200, 100), ['a']), ['a', 'b']);
    assert.deepEqual(enclosed(nodes, rect(100, 100, 200, 100), ['a']), ['a']);
    assert.deepEqual(enclosed(nodes, rect(900, 100, 200, 100), ['a']), ['a']);
  });
  test('additive baseline preserves exact members and omits deleted IDs', () => {
    const nodes = [node('a', 100, 100, { data: { canvasGroupId: 'g' } }), node('b', 500, 100, { data: { canvasGroupId: 'g' } })];
    assert.deepEqual(enclosed(nodes, rect(900, 900, 50, 50), ['a', 'a', 'missing']), ['a']);
  });
  test('hidden and non-selectable objects cannot newly enter the marquee', () => {
    const nodes = [node('a', 0, 0, { hidden: true }), node('b', 0, 0, { selectable: false }), node('c', 0, 0)];
    assert.deepEqual(enclosed(nodes, rect(0, 0, 200, 100)), ['c']);
  });
  test('retired metadata never enlarges a frame selection', () => {
    const nodes = [node('f', 0, 0, { data: { stepKind: 'frame', canvasGroupId: 'g' } }), node('a', 500, 0, { data: { canvasGroupId: 'g' } })];
    assert.deepEqual(enclosed(nodes, rect(0, 0, 200, 100)), ['f']);
  });
  const frame = (id, x, y, width, height) => node(id, x, y, { width, height, data: { stepKind: 'frame' } });
  const nodeMarquee = (nodes, bounds) => ({
    rect: bounds, ...partitionSpatialSelection(nodes, enclosed(nodes, bounds)), edgeIds: [],
  });
  test('layout includes only complete frames from a matching node marquee, even with reversed selection order', () => {
    const nodes = [frame('inside', 0, 0, 400, 380), frame('nested', 30, 40, 330, 270), frame('partial', 500, 0, 1200, 400),
      frame('empty', 0, 430, 320, 200), node('a', 100, 100), node('b', 550, 100)];
    const region = nodeMarquee(nodes, rect(0, 0, 850, 700));
    assert.deepEqual(region.frameIds, ['inside', 'nested', 'empty']);
    const selected = [...region.nodeIds].reverse();
    const ids = layoutSelectionIds(nodes, selected, 'nodes', region);
    assert.deepEqual([...ids].sort(), ['a', 'b', 'empty', 'inside', 'nested']);
    assert.deepEqual(selected, ['b', 'a'], 'layout scope must not mutate the visible node selection');
    assert.deepEqual(region.nodeIds, ['a', 'b']);
  });
  test('layout keeps frames with hidden or non-selectable members fixed', () => {
    const nodes = [frame('first', 0, 0, 600, 500), node('a', 60, 80), node('hidden', 80, 250, { hidden: true }),
      frame('second', 800, 0, 600, 500), node('b', 850, 80), node('locked', 850, 250, { selectable: false })];
    const region = nodeMarquee(nodes, rect(0, 0, 1500, 500));
    assert.deepEqual(region.frameIds, ['first', 'second']);
    assert.deepEqual(layoutSelectionIds(nodes, region.nodeIds, 'nodes', region), ['a', 'b']);
  });
  test('manual, changed and non-node selections keep their explicit layout scope', () => {
    const nodes = [frame('f', 0, 0, 900, 700), node('a', 100, 80), node('b', 450, 200), node('other', 1200, 100)];
    const region = nodeMarquee(nodes, rect(0, 0, 900, 700));
    assert.deepEqual(layoutSelectionIds(nodes, ['a', 'b'], 'nodes', null), ['a', 'b']);
    for (const ids of [['a'], ['a', 'b', 'other'], ['a', 'other']]) {
      assert.deepEqual(layoutSelectionIds(nodes, ids, 'nodes', region), ids);
    }
    for (const target of ['frames', 'edges']) {
      assert.deepEqual(layoutSelectionIds(nodes, region.nodeIds, target, region), region.nodeIds);
    }
    assert.deepEqual(layoutSelectionIds(nodes, ['f'], 'frames', region), ['f']);
  });
  test('obsolete frame candidates cannot add a deleted frame or an ordinary card to layout', () => {
    const nodes = [frame('f', 0, 0, 600, 500), node('a', 100, 100)];
    const region = nodeMarquee(nodes, rect(0, 0, 700, 600));
    const card = node('f', 60, 60);
    for (const current of [[nodes[1]], [card, nodes[1]]]) {
      assert.deepEqual(layoutSelectionIds(current, region.nodeIds, 'nodes', region), ['a']);
    }
  });
} finally {
  unlinkSync(output);
  rmdirSync(temporary);
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
