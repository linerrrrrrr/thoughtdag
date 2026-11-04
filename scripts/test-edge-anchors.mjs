// Automatic ports preserve content semantics and remain stable across display changes.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'tdag-edge-anchors-'));
const bundle = join(temporary, 'edge-anchors.mjs');
let failures = 0;
const test = (name, run) => {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
const node = (id, x, y, width = 520, height = 240, data = {}) => ({
  id, position: { x, y }, measured: { width, height }, data,
});
const edge = (source = 'a', target = 'b', data = {}) => ({ id: `${source}-${target}`, source, target, data });
try {
  buildSync({ entryPoints: ['src/lib/edge-anchors.ts'], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { resolveEdgeAnchors, createEdgeAnchorResolver, sideAnchorOffset, handleSide } = await import(pathToFileURL(bundle).href);
  const sides = (result) => [result?.sourceSide, result?.targetSide];
  test('an aligned vertical chain remains bottom to top', () => {
    assert.deepEqual(sides(resolveEdgeAnchors(edge(), [node('a', 0, 0), node('b', 0, 400)])), ['bottom', 'top']);
  });
  test('manual horizontal placement overrides the default vertical preference', () => {
    assert.deepEqual(sides(resolveEdgeAnchors(edge(), [node('a', 0, 0), node('b', 680, 0)])), ['right', 'left']);
  });
  test('short and tall side-by-side cards share a near-top baseline', () => {
    const result = resolveEdgeAnchors(edge(), [node('a', 0, 40, 520, 80), node('b', 680, 40, 520, 900)]);
    assert.deepEqual(sides(result), ['right', 'left']);
    assert.equal(result.sourceAnchor.y, result.targetAnchor.y);
    assert.equal(result.sourceAnchor.y, 96);
    assert.ok(sideAnchorOffset(20) < 20);
  });
  test('reverse geometry mirrors faces without reversing source and target', () => {
    const e = edge('b', 'a', { isCrossLink: true });
    const before = structuredClone(e);
    assert.deepEqual(sides(resolveEdgeAnchors(e, [node('a', 0, 0), node('b', 680, 0)])), ['left', 'right']);
    assert.deepEqual(e, before);
    assert.deepEqual(sides(resolveEdgeAnchors(edge(), [node('a', 0, 500), node('b', 0, 0)])), ['top', 'bottom']);
  });
  test('mixed horizontal and vertical chains resolve each connection independently', () => {
    const nodes = [node('a', 0, 0), node('b', 680, 0), node('c', 680, 500)];
    assert.deepEqual(sides(resolveEdgeAnchors(edge(), nodes)), ['right', 'left']);
    assert.deepEqual(sides(resolveEdgeAnchors(edge('b', 'c'), nodes)), ['bottom', 'top']);
  });
  test('direction preference breaks ambiguous diagonal ties', () => {
    const nodes = [node('a', 0, 0, 200, 200), node('b', 400, 400, 200, 200)];
    const a = resolveEdgeAnchors(edge(), nodes, 'horizontal');
    const b = resolveEdgeAnchors(edge(), nodes, 'vertical');
    assert.ok(a && b);
    assert.equal(a.axis, 'horizontal');
    assert.equal(b.axis, 'vertical');
  });
  test('material sources can face sideways but materials and frames cannot receive', () => {
    for (const kind of ['note', 'file', 'link']) {
      const nodes = [node('a', 0, 0, 350, 200, { stepKind: kind }), node('b', 600, 0)];
      assert.deepEqual(sides(resolveEdgeAnchors(edge(), nodes)), ['right', 'left']);
      assert.equal(resolveEdgeAnchors(edge('b', 'a'), nodes), null);
    }
    assert.equal(resolveEdgeAnchors(edge(), [node('a', 0, 0, 600, 400, { stepKind: 'frame' }), node('b', 800, 0)]), null);
  });
  test('missing nodes and self-links return no anchors', () => {
    assert.equal(resolveEdgeAnchors(edge(), []), null);
    assert.equal(resolveEdgeAnchors(edge('a', 'a'), [node('a', 0, 0)]), null);
  });
  test('legacy handle aliases remain geometry only', () => {
    assert.equal(handleSide('continue'), 'bottom'); assert.equal(handleSide('branch'), 'right');
    assert.equal(handleSide('in-left'), 'left'); assert.equal(handleSide('out-top'), 'top');
    const nodes = [node('a', 0, 0), node('b', 680, 0)];
    for (const data of [{}, { isCrossLink: true }, { isWatch: true }, { isBranchFromSelection: true }]) {
      assert.deepEqual(sides(resolveEdgeAnchors(edge('a', 'b', data), nodes)), ['right', 'left']);
    }
  });
  test('body measurements cannot rotate a settled edge during semantic zoom', () => {
    const resolver = createEdgeAnchorResolver();
    const nodes = [node('a', 0, 0, 520, 800), node('b', 680, 300, 520, 300)];
    assert.equal(resolver.resolve(edge(), nodes).axis, 'horizontal');
    const compact = nodes.map(n => ({ ...n, measured: { width: 520, height: 80 } }));
    assert.equal(resolver.resolve(edge(), compact).axis, 'horizontal');
    assert.equal(resolver.resolve(edge(), compact).sourceAnchor.y, 56);
  });
  test('dragging keeps ports stable and release re-evaluates the final row', () => {
    const resolver = createEdgeAnchorResolver();
    const a = node('a', 0, 0), b = node('b', 0, 400);
    assert.equal(resolver.resolve(edge(), [a, b]).axis, 'vertical');
    const dragged = { ...b, position: { x: 680, y: 0 }, dragging: true };
    assert.equal(resolver.resolve(edge(), [a, dragged]).axis, 'vertical');
    assert.equal(resolver.resolve(edge(), [a, { ...dragged, dragging: false }]).axis, 'horizontal');
  });
  test('explicit direction changes invalidate remembered preference', () => {
    const resolver = createEdgeAnchorResolver();
    const nodes = [node('a', 0, 0, 200, 200), node('b', 400, 400, 200, 200)];
    assert.equal(resolver.resolve(edge(), nodes, 'vertical').axis, 'vertical');
    assert.deepEqual(resolver.resolve(edge(), nodes, 'horizontal'), resolveEdgeAnchors(edge(), nodes, 'horizontal'));
  });
  test('canvas resolver state is isolated and can be cleared or pruned', () => {
    const first = createEdgeAnchorResolver(), second = createEdgeAnchorResolver();
    const tall = [node('a', 0, 0, 520, 1200), node('b', 680, 1400, 520, 240)];
    assert.equal(first.resolve(edge(), tall).axis, 'vertical');
    const short = tall.map(n => ({ ...n, measured: { width: 520, height: 80 } }));
    assert.equal(first.resolve(edge(), short).axis, 'vertical');
    assert.equal(second.resolve(edge(), short).axis, 'horizontal');
    assert.deepEqual(second.resolve(edge(), short), resolveEdgeAnchors(edge(), short));
    first.clear();
    assert.deepEqual(first.resolve(edge(), short), resolveEdgeAnchors(edge(), short));
    first.prune([]);
    assert.deepEqual(first.resolve(edge(), tall), resolveEdgeAnchors(edge(), tall));
  });
  test('initial DOM measurement corrects the unmeasured fallback', () => {
    const resolver = createEdgeAnchorResolver();
    const nodes = [node('a', 0, 0, 100, 80), node('b', 180, 0, 100, 80)];
    resolver.resolve(edge(), nodes.map(({ measured, ...n }) => n));
    assert.deepEqual(resolver.resolve(edge(), nodes), resolveEdgeAnchors(edge(), nodes));
  });
} finally {
  unlinkSync(bundle); rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
