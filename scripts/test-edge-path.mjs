// Geometry regressions for visible-card routing. No app state or model calls.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'tdag-edge-path-'));
const bundle = join(temporary, 'edge-path.mjs');
let failures = 0;
const test = (name, run) => {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
const node = (id, x, y, width = 200, height = 80, extra = {}) => ({
  id, position: { x, y }, measured: { width, height },
  data: { question: 'A long expanded question'.repeat(50), response: 'Answer'.repeat(100), isCollapsed: false }, ...extra,
});
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
// Sample SVG geometry independently of the router's collision routines.
function sample(path) {
  const tokens = path.match(/[MCQL]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi);
  let i = 0, current;
  const points = [];
  const read = () => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) });
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') { current = read(); points.push(current); continue; }
    const controls = [current, read()];
    if (command === 'Q' || command === 'C') controls.push(read());
    if (command === 'C') controls.push(read());
    const lengthBound = controls.slice(1).reduce((sum, p, index) => sum + Math.hypot(p.x - controls[index].x, p.y - controls[index].y), 0);
    const steps = Math.max(2, Math.ceil(lengthBound * 2));
    for (let step = 1; step <= steps; step++) {
      let row = controls;
      while (row.length > 1) row = row.slice(1).map((p, index) => lerp(row[index], p, step / steps));
      points.push(row[0]);
    }
    current = controls.at(-1);
  }
  return points;
}
const clear = (route, cards) => {
  const points = sample(route.path);
  assert.ok(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  for (const card of cards) {
    assert.ok(points.every((p) => p.x <= card.position.x + 0.01 || p.x >= card.position.x + card.measured.width - 0.01
      || p.y <= card.position.y + 0.01 || p.y >= card.position.y + card.measured.height - 0.01), `path intersects ${card.id}`);
  }
  assert.ok(points.some((p) => Math.hypot(p.x - route.labelX, p.y - route.labelY) < 1), 'edge actions sit on the rendered path');
  return points;
};
// Independent screen-space overlap estimate, ignoring mere crossings.
function sharedLength(left, right, tolerance = 2) {
  const cells = new Map(), key = (x, y) => `${x}:${y}`;
  for (const point of right) {
    const cell = key(Math.floor(point.x / tolerance), Math.floor(point.y / tolerance));
    const points = cells.get(cell) ?? []; points.push(point); cells.set(cell, points);
  }
  let overlap = 0;
  for (let i = 1; i < left.length; i++) {
    const point = left[i], cx = Math.floor(point.x / tolerance), cy = Math.floor(point.y / tolerance);
    let near = false;
    for (let x = cx - 1; x <= cx + 1 && !near; x++) for (let y = cy - 1; y <= cy + 1 && !near; y++) {
      near = (cells.get(key(x, y)) ?? []).some((other) => Math.hypot(other.x - point.x, other.y - point.y) <= tolerance);
    }
    if (near) overlap += Math.hypot(point.x - left[i - 1].x, point.y - left[i - 1].y);
  }
  return overlap;
}
try {
  buildSync({ entryPoints: ['src/lib/edge-path.ts'], bundle: true, platform: 'node', format: 'esm', outfile: bundle,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { routeEdge, createEdgeRoutingContext } = await import(pathToFileURL(bundle).href);
  const vertical = (cards, routeMode) => {
    const [s, t] = cards;
    return routeEdge(s.position.x + s.measured.width / 2, s.position.y + s.measured.height, 'bottom',
      t.position.x + t.measured.width / 2, t.position.y, 'top', s.id, t.id, cards, routeMode);
  };
  test('aligned chain is straight and flows downward', () => {
    const cards = [node('s', 0, 0), node('t', 0, 400)];
    const points = clear(vertical(cards), cards);
    assert.ok(points.every((p, i) => p.x === 100 && (!i || p.y >= points[i - 1].y)));
  });
  test('automatic and curve modes preserve the natural unobstructed route', () => {
    const cards = [node('s', 0, 0), node('t', 240, 400)];
    const natural = vertical(cards);
    assert.ok(natural.path.includes('C'));
    assert.deepEqual(vertical(cards, 'auto'), natural);
    assert.deepEqual(vertical(cards, 'curve'), natural);
    clear(natural, cards);
  });
  test('orthogonal mode uses rounded corners even without a blocker', () => {
    const cards = [node('s', 0, 0), node('t', 240, 400)];
    const route = vertical(cards, 'orthogonal'), points = clear(route, cards);
    assert.ok(route.path.includes('Q') && !route.path.includes('C'));
    assert.equal(points[1].x, points[0].x);
    assert.equal(points.at(-2).x, points.at(-1).x);
    assert.ok(points[1].y > points[0].y && points.at(-1).y > points.at(-2).y);
  });
  test('every route mode safely detours around visible cards', () => {
    const cards = [node('s', 0, 0), node('t', 0, 600), node('block', -80, 210, 360, 200)];
    for (const mode of ['auto', 'curve', 'orthogonal']) {
      const route = vertical(cards, mode);
      assert.notEqual(route.path, vertical(cards.slice(0, 2), mode).path, `${mode} must keep its obstacle detour`);
      clear(route, cards);
    }
  });
  test('horizontal orthogonal routes respect side normals for unequal heights', () => {
    const cards = [node('s', 0, 0, 200, 600), node('t', 500, 120, 200, 80)];
    const route = routeEdge(200, 56, 'right', 500, 176, 'left', 's', 't', cards, 'orthogonal');
    const points = clear(route, cards);
    assert.ok(route.path.includes('Q') && !route.path.includes('C'));
    assert.equal(points[1].y, points[0].y);
    assert.equal(points.at(-2).y, points.at(-1).y);
    assert.ok(points[1].x > points[0].x && points.at(-1).x > points.at(-2).x);
  });
  test('mixed port directions and backward links remain clear in every mode', () => {
    const cards = [node('s', 500, 400), node('t', 0, 0)];
    for (const mode of ['auto', 'curve', 'orthogonal']) {
      clear(routeEdge(500, 456, 'left', 100, 80, 'bottom', 's', 't', cards, mode), cards);
      clear(vertical(cards, mode), cards);
    }
  });
  test('orthogonal close gaps and aligned endpoints remain finite and clear', () => {
    for (const gap of [1, 5, 40]) {
      const cards = [node('s', 0, 0), node('t', 500, 80 + gap)];
      const route = vertical(cards, 'orthogonal');
      assert.ok(!route.path.includes('C'));
      clear(route, cards);
    }
    clear(vertical([node('s', 0, 0), node('t', 0, 400)], 'orthogonal'), [node('s', 0, 0), node('t', 0, 400)]);
    assert.ok(!/NaN|Infinity/.test(routeEdge(0, 0, undefined, 0, 0, undefined, 's', 't', [], 'orthogonal').path));
  });
  test('compact cards do not reserve invisible expanded space', () => {
    const cards = [node('s', 0, 240), node('t', 170, 600), node('upstream', 0, 0)];
    const route = vertical(cards);
    assert.equal(route.path, vertical(cards.slice(0, 2)).path);
    const points = clear(route, cards);
    assert.ok(points.every((p) => p.x >= 100 && p.x <= 270), 'no backward sway');
  });
  test('frames and hidden annotations never bend a connection', () => {
    const cards = [node('s', 0, 0), node('t', 170, 400)];
    const extras = [node('frame', -200, -200, 1200, 1200, { data: { stepKind: 'frame' } }), node('hidden', 0, 150, 500, 200, { hidden: true })];
    assert.deepEqual(vertical([...cards, ...extras]), vertical(cards));
  });
  test('wide shallow edges stay between the ports without overshoot', () => {
    for (const gap of [1, 5, 40]) {
      const cards = [node('s', 0, 0), node('t', 1000, 80 + gap)];
      const points = clear(vertical(cards), cards);
      assert.ok(points.every((p, i) => p.y >= 80 && p.y <= 80 + gap && (!i || p.y >= points[i - 1].y)));
    }
  });
  test('a real blocker gets a smooth detour with vertical port tangents', () => {
    const cards = [node('s', 0, 0), node('t', 0, 600), node('block', -80, 210, 360, 200)];
    const route = vertical(cards), points = clear(route, cards);
    assert.ok(Math.abs(points[1].x - points[0].x) < 0.02);
    assert.ok(Math.abs(points.at(-2).x - points.at(-1).x) < 0.02);
    assert.ok(points[1].y > points[0].y && points.at(-1).y > points.at(-2).y);
    assert.ok(Math.max(...points.map((p) => Math.abs(p.x - 100))) <= 260);
  });
  test('thin blockers cannot fall between collision samples', () => {
    const cards = [node('s', 0, 0), node('t', 0, 4000), node('thin', 50, 1888, 100, 1)];
    clear(vertical(cards), cards);
  });
  test('tight gaps reduce clearance instead of crossing the neighboring card', () => {
    for (const gap of [2, 5, 12, 25]) {
      const cards = [node('s', 0, 0), node('t', 0, 500), node('close', -50, 80 + gap, 300, 80)];
      clear(vertical(cards), cards);
    }
  });
  test('detours discover neighboring obstacles and stay independent of node order', () => {
    const cards = [node('s', 0, 0), node('t', 0, 1000), node('middle', -60, 220, 320, 180),
      node('left', -220, 450, 300, 160), node('right', 80, 650, 300, 160)];
    const route = vertical(cards);
    clear(route, cards);
    assert.deepEqual(route, vertical([...cards.slice(0, 2), ...cards.slice(2).reverse()]));
  });
  test('upward hand-placed connections go around both endpoint cards', () => {
    const cards = [node('s', 0, 500), node('t', 60, 0)];
    clear(vertical(cards), cards);
  });
  test('leftward reference links use facing sides', () => {
    const cards = [node('s', 500, 0), node('t', 0, 80)];
    const route = routeEdge(700, 40, 'right', 0, 120, 'left', 's', 't', cards);
    const points = clear(route, cards);
    assert.deepEqual(points[0], { x: 500, y: 40 });
    assert.deepEqual(points.at(-1), { x: 200, y: 120 });
  });
  test('measured resized geometry takes precedence over stored work height', () => {
    const cards = [node('s', 0, 250), node('t', 180, 650), node('resized', 0, 0, 220, 80, { height: 1500 })];
    assert.equal(vertical(cards).path, vertical(cards.slice(0, 2)).path);
  });
  test('default ports, close gaps and coincident points remain finite', () => {
    for (const gap of [0, 1, 5, 100]) {
      const route = routeEdge(0, 0, undefined, 0, gap, undefined, 's', 't', []);
      assert.ok(!/NaN|Infinity/.test(route.path));
    }
  });
  test('distant nodes do not change a local detour', () => {
    const cards = [node('s', 0, 0), node('t', 0, 600), node('block', -80, 210, 360, 200)];
    const extras = Array.from({ length: 2000 }, (_, i) => node(`distant-${i}`, 10000 + i * 300, 10000));
    const started = performance.now();
    assert.deepEqual(vertical([...cards, ...extras]), vertical(cards));
    assert.ok(performance.now() - started < 1000, 'unrelated cards must not produce a huge routing grid');
  });
  test('explicit curves keep aligned ports naturally straight with endpoint normals', () => {
    for (const horizontal of [false, true]) {
      const cards = horizontal ? [node('s', 0, 0), node('t', 800, 0)] : [node('s', 0, 0), node('t', 0, 800)];
      const route = horizontal ? routeEdge(200, 56, 'right', 800, 56, 'left', 's', 't', cards, 'curve') : vertical(cards, 'curve');
      const points = clear(route, cards);
      const offset = points.map((point) => Math.abs(horizontal ? point.y - 56 : point.x - 100));
      assert.ok(Math.max(...offset) < 0.01, 'mature bezier routing does not invent a bow for aligned ports');
      const tangentStart = horizontal ? Math.abs(points[1].y - 56) : Math.abs(points[1].x - 100);
      const tangentEnd = horizontal ? Math.abs(points.at(-2).y - 56) : Math.abs(points.at(-2).x - 100);
      assert.ok(tangentStart < 0.02 && tangentEnd < 0.02, 'the arrow and source retain their port normals');
    }
  });
  test('explicit curves preserve clear corridors and remain safe around narrow obstacles', () => {
    const cards = [node('s', 0, 0), node('t', 0, 900), node('right', 140, 240, 80, 300)];
    clear(vertical(cards, 'curve'), cards);
    assert.equal(vertical(cards, 'curve').path, vertical(cards.slice(0, 2), 'curve').path, 'a nearby card must not create an unnecessary detour');
    for (const gap of [2, 8, 30]) {
      const tight = [node('s', 0, 0), node('t', 0, 700), node('block', -60, 80 + gap, 320, 260)];
      const route = vertical(tight, 'curve');
      assert.ok(!/[LQ]/.test(route.path));
      clear(route, tight);
    }
  });
  test('same-source long trunks separate geometrically in every route mode', () => {
    const cards = [node('s', 0, 300, 200, 140), node('a', 1400, 0), node('b', 1400, 600), node('block', 600, 100, 300, 600)];
    const edges = ['a', 'b'].map((target) => ({ id: `s-${target}`, source: 's', target, sourceHandle: 'out-right', targetHandle: 'in-left' }));
    const context = createEdgeRoutingContext(cards, edges);
    for (const mode of ['auto', 'curve', 'orthogonal']) {
      const old = edges.map((edge) => {
        const target = cards.find((card) => card.id === edge.target);
        return routeEdge(200, 356, 'right', 1400, target.position.y + 56, 'left', 's', edge.target, cards, mode);
      });
      const routes = edges.map((edge) => {
        const target = cards.find((card) => card.id === edge.target);
        return routeEdge(200, 356, 'right', 1400, target.position.y + 56, 'left', 's', edge.target, cards, mode, { edgeId: edge.id, context });
      });
      const before = sharedLength(sample(old[0].path), sample(old[1].path));
      const after = sharedLength(clear(routes[0], cards), clear(routes[1], cards));
      console.log(`  ${mode} shared trunk: ${before.toFixed(1)}px -> ${after.toFixed(1)}px`);
      assert.ok(after < Math.max(55, before * 0.3), `${mode}: shared length ${before.toFixed(1)} → ${after.toFixed(1)}`);
      assert.deepEqual(sample(routes[0].path)[0], { x: 200, y: 356 });
      assert.ok(!/[LQ]/.test(routes[0].path) || mode !== 'curve');
    }
  });
  test('multi-input merges separate long incoming trunks without moving arrow endpoints', () => {
    const cards = [node('a', 0, 0), node('b', 0, 600), node('t', 1400, 300, 200, 140), node('block', 600, 100, 300, 600)];
    const edges = ['a', 'b'].map((source) => ({ id: `${source}-t`, source, target: 't', sourceHandle: 'out-right', targetHandle: 'in-left' }));
    const context = createEdgeRoutingContext(cards, edges);
    for (const mode of ['auto', 'curve', 'orthogonal']) {
      const routes = edges.map((edge) => routeEdge(200, cards.find((card) => card.id === edge.source).position.y + 56, 'right',
        1400, 356, 'left', edge.source, 't', cards, mode, { edgeId: edge.id, context }));
      const points = routes.map((route) => clear(route, cards));
      assert.ok(sharedLength(points[0], points[1]) < 65, `${mode} incoming trunks must not collapse onto one lane`);
      for (const path of points) assert.deepEqual(path.at(-1), { x: 1400, y: 356 });
    }
  });
  test('lane plans are independent of edge order, selection, and unrelated nodes', () => {
    const cards = [node('s', 0, 0), node('a', 1000, 0), node('b', 1000, 300)];
    const edges = ['a', 'b'].map((target) => ({ id: `s-${target}`, source: 's', target, sourceHandle: 'out-right', targetHandle: 'in-left' }));
    const first = createEdgeRoutingContext(cards, edges);
    const second = createEdgeRoutingContext([...cards].reverse(), [...edges].reverse().map((edge) => ({ ...edge, selected: true, style: { strokeWidth: 3 } })));
    for (const edge of edges) assert.deepEqual(first.lanes.get(edge.id), second.lanes.get(edge.id));
    assert.deepEqual(routeEdge(200, 56, 'right', 1000, 56, 'left', 's', 'a', cards, 'curve', { edgeId: 's-a', context: first }),
      routeEdge(200, 56, 'right', 1000, 56, 'left', 's', 'a', cards, 'curve', { edgeId: 's-a', context: second }));
  });
  test('opposite-node geometry orders fan-out and merges before random edge IDs', () => {
    const cards = [node('s', 0, 300), node('upper', 1000, 0), node('lower', 1000, 600), node('t', 2000, 300)];
    const edges = [
      { id: 'z-out', source: 's', target: 'upper' }, { id: 'a-out', source: 's', target: 'lower' },
      { id: 'z-in', source: 'upper', target: 't' }, { id: 'a-in', source: 'lower', target: 't' },
    ].map((edge) => ({ ...edge, sourceHandle: 'out-right', targetHandle: 'in-left' }));
    const context = createEdgeRoutingContext(cards, edges);
    assert.ok(context.lanes.get('z-out').sourceOffset < context.lanes.get('a-out').sourceOffset);
    assert.ok(context.lanes.get('z-in').targetOffset < context.lanes.get('a-in').targetOffset);
    const route = (id, y, target) => routeEdge(200, 356, 'right', 1000, y + 56, 'left', 's', target, cards, 'curve', { edgeId: id, context });
    const upper = sample(route('z-out', 0, 'upper').path).find((point) => point.x >= 230);
    const lower = sample(route('a-out', 600, 'lower').path).find((point) => point.x >= 230);
    assert.ok(upper.y < lower.y, 'the near-port fan should not reverse the target order');
  });
  test('an unobstructed upper edge does not loop through its lower sibling twice', () => {
    const cards = [node('s', 60, 160, 360, 240), node('upper', 1260, 160, 360, 240),
      node('lower', 1260, 650, 360, 240), node('obstacle', 650, 370, 420, 220)];
    const edges = ['upper', 'lower'].map((target) => ({ id: target, source: 's', target, sourceHandle: 'out-right', targetHandle: 'in-left' }));
    const context = createEdgeRoutingContext(cards, edges);
    const paths = edges.map((edge) => clear(routeEdge(420, 216, 'right', 1260, edge.target === 'upper' ? 216 : 706, 'left',
      's', edge.target, cards, 'curve', { edgeId: edge.id, context }), cards));
    const atX = (points, x) => {
      const index = points.findIndex((point) => point.x >= x), a = points[index - 1], b = points[index];
      return a.y + (b.y - a.y) * (x - a.x) / Math.max(0.00001, b.x - a.x);
    };
    let crossings = 0, previousSign = 0;
    for (let x = 450; x < 1230; x += 4) {
      const difference = atX(paths[0], x) - atX(paths[1], x), sign = Math.sign(difference);
      if (previousSign && sign !== previousSign) crossings++;
      previousSign = sign;
      assert.ok(difference < 0, 'a clear upper connection stays above its sibling');
    }
    assert.equal(crossings, 0, 'lane-aware curvature must not introduce a gratuitous double crossing');
  });
  test('a shared plan routes 200 edges without recursive graph routing', () => {
    const cards = [], edges = [];
    for (let i = 0; i < 100; i++) {
      cards.push(node(`s${i}`, 0, i * 500), node(`a${i}`, 900, i * 500), node(`b${i}`, 900, i * 500 + 200));
      for (const suffix of ['a', 'b']) edges.push({ id: `${i}-${suffix}`, source: `s${i}`, target: `${suffix}${i}`, sourceHandle: 'out-right', targetHandle: 'in-left' });
    }
    const started = performance.now(), context = createEdgeRoutingContext(cards, edges);
    for (const edge of edges) {
      const source = cards.find((card) => card.id === edge.source), target = cards.find((card) => card.id === edge.target);
      const route = routeEdge(200, source.position.y + 56, 'right', 900, target.position.y + 56, 'left', source.id, target.id, cards, 'curve', { edgeId: edge.id, context });
      assert.ok(!/NaN|Infinity/.test(route.path));
    }
    const elapsed = performance.now() - started;
    console.log(`  200 edges: ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 1500, '200 graph edges should remain interactive');
  });
  test('stale offscreen source handles cannot force a route through visible compact cards', () => {
    const cards = [node('source', -800, -80, 420, 240), node('target-1', 200, 400, 420, 93), node('target-2', 1000, 500, 420, 93)];
    const edges = [1, 2].map((index) => ({ id: `edge-${index}`, source: 'source', target: `target-${index}`,
      sourceHandle: 'out-right', targetHandle: 'in-left' }));
    const context = createEdgeRoutingContext(cards, edges);
    for (const mode of ['auto', 'curve', 'orthogonal']) {
      const route = routeEdge(-433, -23, 'right', 993, 557, 'left', 'source', 'target-2', cards, mode, { edgeId: 'edge-2', context });
      const points = clear(route, cards);
      assert.deepEqual(points[0], { x: -373, y: -23 }, 'stale right port projects to the newest right boundary, without mirroring');
      assert.deepEqual(points.at(-1), { x: 993, y: 557 }, 'the valid seven-pixel target protrusion stays unchanged');
    }
  });
  test('normal outward handle offsets survive geometry normalization on every side', () => {
    const cards = [node('s', 0, 0), node('t', 700, 300)];
    const cases = [
      [207, 56, 'right', 693, 356, 'left'], [100, -7, 'top', 800, 387, 'bottom'],
      [-7, 56, 'left', 907, 356, 'right'], [100, 87, 'bottom', 800, 293, 'top'],
    ];
    for (const [sx, sy, sp, tx, ty, tp] of cases) {
      const points = clear(routeEdge(sx, sy, sp, tx, ty, tp, 's', 't', cards, 'curve'), cards);
      assert.deepEqual(points[0], { x: sx, y: sy });
      assert.deepEqual(points.at(-1), { x: tx, y: ty });
    }
  });
} finally {
  unlinkSync(bundle);
  rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
