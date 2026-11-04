// Independent geometry acceptance: S shape, endpoint normals, smooth joins,
// tight shared ports, obstacle safety and stable lanes. No app state/network.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-mature-router-'));
const bundle = join(temporary, 'router.mjs');
let passed = 0, failed = 0;
const test = (name, run) => {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
};
const node = (id, x, y, width = 200, height = 80) => ({ id, type: 'thought', position: { x, y },
  measured: { width, height }, data: { question: id, response: 'Answer', layoutDirection: 'horizontal' } });
const edge = (id, source, target, sourceSide = 'right', targetSide = 'left') => ({ id, source, target,
  sourceHandle: `out-${sourceSide}`, targetHandle: `in-${targetSide}` });
const normal = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
const point = (n, side) => side === 'left' || side === 'right'
  ? { x: n.position.x + (side === 'right' ? n.measured.width : 0), y: n.position.y + Math.min(56, Math.max(0, n.measured.height - 12)) }
  : { x: n.position.x + n.measured.width / 2, y: n.position.y + (side === 'bottom' ? n.measured.height : 0) };
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const length = (a) => Math.hypot(a.x, a.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const distance = (a, b) => length(subtract(a, b));
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Parse the emitted geometry independently; do not reuse router helpers.
function segments(path) {
  assert.ok(!/NaN|Infinity/.test(path), 'route must remain finite');
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g);
  let at = 0, cursor;
  const result = [];
  const read = () => ({ x: Number(tokens[at++]), y: Number(tokens[at++]) });
  while (at < tokens.length) {
    const command = tokens[at++];
    if (command === 'M') { cursor = read(); continue; }
    assert.ok(['L', 'Q', 'C'].includes(command), `unsupported SVG command ${command}`);
    const points = [cursor, read()];
    if (command === 'Q' || command === 'C') points.push(read());
    if (command === 'C') points.push(read());
    assert.ok(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    result.push({ command, points }); cursor = points.at(-1);
  }
  assert.ok(result.length);
  return result;
}
function samples(curves, step = 1.5) {
  const result = [curves[0].points[0]];
  for (const { points } of curves) {
    const bound = points.slice(1).reduce((sum, p, i) => sum + distance(p, points[i]), 0);
    const count = Math.max(2, Math.ceil(bound / step));
    for (let i = 1; i <= count; i++) {
      let row = points;
      while (row.length > 1) row = row.slice(1).map((p, index) => lerp(row[index], p, i / count));
      result.push(row[0]);
    }
  }
  return result;
}
function tangent(points, end = false) {
  const p = end ? [...points].reverse() : points;
  for (let i = 1; i < p.length; i++) {
    const vector = subtract(p[i], p[0]);
    if (length(vector) > 1e-7) return end ? { x: -vector.x, y: -vector.y } : vector;
  }
  assert.fail('degenerate segment cannot define a tangent');
}
function parallelForward(a, b, message) {
  const product = length(a) * length(b);
  assert.ok(product > 1e-8 && dot(a, b) / product > 0.99999, message);
}
function geometry(route, cards, sourceSide, targetSide) {
  const curves = segments(route.path), points = samples(curves);
  parallelForward(tangent(curves[0].points), normal[sourceSide], 'source tangent must follow its outward port normal');
  const targetNormal = normal[targetSide];
  parallelForward(tangent(curves.at(-1).points, true), { x: -targetNormal.x, y: -targetNormal.y }, 'target tangent must enter along its inward normal');
  for (let i = 1; i < curves.length; i++) {
    // SVG segments have independent parameter speeds. Compare geometric
    // tangent continuity, rather than equating their control-arm lengths.
    if (distance(curves[i - 1].points[0], curves[i - 1].points.at(-1)) < 1e-7
      || distance(curves[i].points[0], curves[i].points.at(-1)) < 1e-7) continue;
    parallelForward(tangent(curves[i - 1].points, true), tangent(curves[i].points), `angular cusp at segment ${i}`);
  }
  for (const card of cards) {
    const { x, y } = card.position, { width, height } = card.measured;
    assert.ok(points.every((p) => p.x <= x + 0.1 || p.x >= x + width - 0.1 || p.y <= y + 0.1 || p.y >= y + height - 0.1), `path intersects ${card.id}`);
  }
  assert.ok(points.some((p) => distance(p, { x: route.labelX, y: route.labelY }) < 2), 'annotation must stay on the actual route');
  return points;
}
function crossings(left, right) {
  let count = 0;
  // Coarse segments retain crossing topology while keeping this independent
  // pairwise check cheap. Ignore a shared endpoint's small fan-out region.
  const compact = (points) => points.filter((_, i) => i % 4 === 0 || i === points.length - 1);
  const a = compact(left), b = compact(right);
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    if (distance(a[i], left[0]) < 16 || distance(a[i], left.at(-1)) < 16
      || distance(b[j], right[0]) < 16 || distance(b[j], right.at(-1)) < 16) continue;
    const av = subtract(a[i], a[i - 1]), bv = subtract(b[j], b[j - 1]);
    const determinant = cross(av, bv);
    if (Math.abs(determinant) < 1e-9) continue;
    const delta = subtract(b[j - 1], a[i - 1]);
    const t = cross(delta, bv) / determinant, u = cross(delta, av) / determinant;
    if (t > 0 && t < 1 && u > 0 && u < 1) count++;
  }
  return count;
}
function sharedLength(a, b, tolerance = 2) {
  const cell = (p) => [Math.floor(p.x / tolerance), Math.floor(p.y / tolerance)];
  const grid = new Map();
  for (const p of b) { const key = cell(p).join(':'); const group = grid.get(key) ?? []; group.push(p); grid.set(key, group); }
  let total = 0;
  for (let i = 1; i < a.length; i++) {
    const [cx, cy] = cell(a[i]); let close = false;
    for (let x = cx - 1; x <= cx + 1 && !close; x++) for (let y = cy - 1; y <= cy + 1 && !close; y++) {
      close = (grid.get(`${x}:${y}`) ?? []).some((p) => distance(p, a[i]) < tolerance);
    }
    if (close) total += distance(a[i - 1], a[i]);
  }
  return total;
}
function maxTurnOver(points, distanceBudget) {
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + distance(points[i - 1], points[i]));
  let maximum = 0, j = 1;
  for (let i = 1; i < points.length; i++) {
    j = Math.max(i, j);
    while (j + 1 < points.length && along[j] - along[i] < distanceBudget) j++;
    if (along[j] - along[i] < distanceBudget * 0.9) continue;
    const a = subtract(points[i], points[i - 1]), b = subtract(points[j], points[j - 1]);
    const denominator = length(a) * length(b);
    if (denominator > 1e-8) maximum = Math.max(maximum, Math.acos(Math.max(-1, Math.min(1, dot(a, b) / denominator))));
  }
  return maximum;
}

try {
  buildSync({ entryPoints: [join(root, 'src/lib/edge-path.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { routeEdge, createEdgeRoutingContext } = await import(pathToFileURL(bundle).href);
  const route = (cards, e, mode = 'curve', context) => {
    const source = cards.find((n) => n.id === e.source), target = cards.find((n) => n.id === e.target);
    const ss = e.sourceHandle.slice(4), ts = e.targetHandle.slice(3), s = point(source, ss), t = point(target, ts);
    return routeEdge(s.x, s.y, ss, t.x, t.y, ts, e.source, e.target, cards, mode, context ? { edgeId: e.id, context } : {});
  };
  for (const vertical of [false, true]) test(`long ${vertical ? 'vertical' : 'horizontal'} offset keeps a broad, natural S instead of a near-diagonal`, () => {
    const cards = vertical ? [node('s', 0, 0), node('t', 500, 1280)] : [node('s', 0, 0), node('t', 1400, 500)];
    const e = edge('s-t', 's', 't', vertical ? 'bottom' : 'right', vertical ? 'top' : 'left');
    const result = route(cards, e);
    const points = geometry(result, cards, vertical ? 'bottom' : 'right', vertical ? 'top' : 'left');
    const chord = subtract(points.at(-1), points[0]), span = length(chord);
    const bow = Math.max(...points.map((p) => Math.abs(cross(chord, subtract(p, points[0]))) / span));
    assert.ok(bow > span * 0.03, `long S has only ${bow.toFixed(2)}px deviation over ${span.toFixed(0)}px span`);
    assert.ok(points.every((p, i) => !i || (p.x >= points[i - 1].x - 1e-5 && p.y >= points[i - 1].y - 1e-5)), 'clear S must not turn backward');
  });

  test('aligned endpoints stay naturally straight without a decorative bow', () => {
    const cards = [node('s', 0, 0), node('t', 1000, 0)];
    for (const mode of ['auto', 'curve']) {
      const points = geometry(route(cards, edge('s-t', 's', 't'), mode), cards, 'right', 'left');
      assert.ok(points.every((p) => Math.abs(p.y - 56) < 1e-5));
    }
  });

  test('mixed, reverse and neighboring-side endpoints retain outward/inward normals', () => {
    const failures = [];
    for (const [ss, ts] of [['right', 'top'], ['bottom', 'left'], ['top', 'bottom'], ['left', 'right'], ['right', 'right'], ['bottom', 'bottom']]) {
      const cards = [node('s', 0, 0), node('t', 600, 400)];
      try { geometry(route(cards, edge('s-t', 's', 't', ss, ts)), cards, ss, ts); }
      catch (error) { failures.push(`${ss} → ${ts}: ${error.message}`); }
    }
    assert.equal(failures.join('; '), '');
  });

  test('tight axial gaps with large transverse offset do not send a shared edge behind its source', () => {
    const cards = [node('s', 0, 0, 200, 200), node('a', 210, 200, 200, 200), node('b', 210, 500, 200, 200)];
    const edges = [edge('s-a', 's', 'a'), edge('s-b', 's', 'b')], context = createEdgeRoutingContext(cards, edges);
    const points = geometry(route(cards, edges[0], 'curve', context), cards, 'right', 'left');
    assert.ok(Math.min(...points.map((p) => p.x)) >= 199.9, 'fan-out cannot loop around the source back');
    assert.ok(Math.min(...points.map((p) => p.y)) >= 45.9, 'nearby clear target does not need a detour above the source');
    const total = points.slice(1).reduce((sum, p, i) => sum + distance(p, points[i]), 0);
    assert.ok(total < 350, `nearby edge takes an unnecessary ${total.toFixed(0)}px detour`);
  });

  test('obstructed long edges clear all cards and preserve tangent continuity at every splice', () => {
    const cards = [node('s', 0, 0, 260, 140), node('a', 820, 400, 280, 120), node('b', 1370, 520, 280, 120),
      node('blocker', 360, 240, 320, 180)];
    const edges = [edge('s-a', 's', 'a'), edge('s-b', 's', 'b')], context = createEdgeRoutingContext(cards, edges);
    for (const e of edges) {
      const result = route(cards, e, 'curve', context);
      const points = geometry(result, cards, 'right', 'left');
      const turn = maxTurnOver(points, 24);
      assert.ok(turn < Math.PI / 3, `open obstacle route turns ${(turn * 180 / Math.PI).toFixed(1)} degrees in 24px instead of bending broadly`);
    }
  });

  for (const converging of [false, true]) test(`${converging ? 'same-target' : 'same-source'} curves separate without middle crossings or long overlap`, () => {
    const cards = converging ? [node('a', 0, 0), node('b', 0, 450), node('t', 1200, 200)]
      : [node('s', 0, 200), node('a', 1200, 0), node('b', 1200, 450)];
    const edges = converging ? [edge('a-t', 'a', 't'), edge('b-t', 'b', 't')] : [edge('s-a', 's', 'a'), edge('s-b', 's', 'b')];
    const context = createEdgeRoutingContext(cards, edges);
    const paths = edges.map((e) => route(cards, e, 'curve', context));
    const points = paths.map((result) => geometry(result, cards, 'right', 'left'));
    assert.equal(crossings(points[0], points[1]), 0);
    assert.ok(sharedLength(points[0], points[1]) < 90, 'shared endpoint must not create a shared long trunk');
    const reversed = createEdgeRoutingContext([...cards].reverse(), [...edges].reverse());
    edges.forEach((e, i) => assert.equal(route(cards, e, 'curve', reversed).path, paths[i].path, 'input enumeration cannot reorder lanes'));
  });

  test('normal React Flow outer-rim ports remain exact through large measured-size changes in every direction', () => {
    const cases = [
      { cards: [node('s', -800, -80, 420, 240), node('t', 200, 400, 420, 93)], ss: 'right', ts: 'left' },
      { cards: [node('s', 900, 500, 1200, 900), node('t', -700, -40, 120, 36)], ss: 'left', ts: 'right' },
      { cards: [node('s', 0, 0, 120, 36), node('t', 600, 500, 900, 240)], ss: 'bottom', ts: 'top' },
      { cards: [node('s', 0, 500, 900, 240), node('t', 600, 0, 120, 36)], ss: 'top', ts: 'bottom' },
    ];
    for (const { cards, ss, ts } of cases) for (const mode of ['auto', 'curve', 'orthogonal']) {
      // Stored size can lag semantic zoom/resize; measured size is current.
      cards[0].width = 180; cards[0].height = 1200;
      cards[1].width = 1200; cards[1].height = 800;
      const anchor = (n, side) => {
        const center = point(n, side), outward = normal[side];
        return { x: center.x + outward.x * 7, y: center.y + outward.y * 7 };
      };
      const start = anchor(cards[0], ss), end = anchor(cards[1], ts);
      const result = routeEdge(start.x, start.y, ss, end.x, end.y, ts, 's', 't', cards, mode);
      const points = geometry(result, cards, ss, ts);
      assert.deepEqual(points[0], start, `${mode} ${ss}: do not relocate a valid outer-rim source port`);
      assert.deepEqual(points.at(-1), end, `${mode} ${ts}: do not relocate a valid outer-rim target port`);
    }
  });

  test('clearly stale ports after extreme shrinking and reverse-side resizing recover to their own outward sides', () => {
    const cases = [
      { cards: [node('s', 0, 0, 120, 36), node('t', 800, 500, 900, 240)],
        input: [847, 56, 'right', 793, 556, 'left'], start: { x: 127, y: 24 }, end: { x: 793, y: 556 } },
      { cards: [node('s', 900, 500, 120, 36), node('t', -700, -40, 1200, 900)],
        input: [1000, 800, 'left', 427, 16, 'right'], start: { x: 893, y: 524 }, end: { x: 507, y: 16 } },
      { cards: [node('s', 0, 0, 120, 36), node('t', 600, 500, 900, 240)],
        input: [450, 1007, 'bottom', 1050, 493, 'top'], start: { x: 60, y: 43 }, end: { x: 1050, y: 493 } },
    ];
    for (const { cards, input, start, end } of cases) for (const mode of ['auto', 'curve', 'orthogonal']) {
      const result = routeEdge(...input, 's', 't', cards, mode);
      const points = geometry(result, cards, input[2], input[5]);
      assert.deepEqual(points[0], start, `${mode}: stale source returns to its own side`);
      assert.deepEqual(points.at(-1), end, `${mode}: target side remains outward and visible`);
    }
  });

} finally {
  try { unlinkSync(bundle); } catch { /* Build may fail before creating it. */ }
  rmdirSync(temporary);
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
