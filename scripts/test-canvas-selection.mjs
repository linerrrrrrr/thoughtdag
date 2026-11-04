#!/usr/bin/env node
// Marquee containment is measured, inclusive, and atomic for rigid groups.
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
  await build({ entryPoints: [join(root, 'src/lib/canvas-selection.ts')], bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' });
  const { enclosedSelection: enclosed } = await import(pathToFileURL(output).href);
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
  test('a rigid group enters only when every member is enclosed', () => {
    const nodes = [node('a', 100, 100, { data: { canvasGroupId: 'g' } }), node('b', 500, 100, { data: { canvasGroupId: 'g' } })];
    assert.deepEqual(enclosed(nodes, rect(100, 100, 200, 100)), []);
    assert.deepEqual(enclosed(nodes, rect(100, 100, 600, 100)), ['a', 'b']);
  });
  test('additive marquee preserves its baseline without toggling overlapping objects', () => {
    const nodes = [node('a', 100, 100), node('b', 500, 100)];
    assert.deepEqual(enclosed(nodes, rect(500, 100, 200, 100), ['a']), ['a', 'b']);
    assert.deepEqual(enclosed(nodes, rect(100, 100, 200, 100), ['a']), ['a']);
    assert.deepEqual(enclosed(nodes, rect(900, 100, 200, 100), ['a']), ['a']);
  });
  test('additive baseline expands groups and omits deleted IDs', () => {
    const nodes = [node('a', 100, 100, { data: { canvasGroupId: 'g' } }), node('b', 500, 100, { data: { canvasGroupId: 'g' } })];
    assert.deepEqual(enclosed(nodes, rect(900, 900, 50, 50), ['a', 'a', 'missing']), ['a', 'b']);
  });
  test('hidden and non-selectable objects cannot newly enter the marquee', () => {
    const nodes = [node('a', 0, 0, { hidden: true }), node('b', 0, 0, { selectable: false }), node('c', 0, 0)];
    assert.deepEqual(enclosed(nodes, rect(0, 0, 200, 100)), ['c']);
  });
  test('legacy frame group metadata does not enlarge a frame selection', () => {
    const nodes = [node('f', 0, 0, { data: { stepKind: 'frame', canvasGroupId: 'g' } }), node('a', 500, 0, { data: { canvasGroupId: 'g' } })];
    assert.deepEqual(enclosed(nodes, rect(0, 0, 200, 100)), ['f']);
  });
} finally {
  unlinkSync(output);
  rmdirSync(temporary);
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
