// Compare layout quality on real canvas content, without a browser or model API.
// node scripts/benchmark-canvas-layout.mjs [--assert-improvement]
// Optional baseline: --baseline-engine local-tests/layout-baseline.mjs
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const baselineFlag = args.indexOf('--baseline-engine');
const baselinePath = resolve(baselineFlag >= 0 ? args[baselineFlag + 1] : 'local-tests/layout-baseline.mjs');
const output = resolve('local-tests/layout-quality');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-layout-quality-'));
mkdirSync(output, { recursive: true });
const files = [];
const compile = async (name, entry) => {
  const outfile = join(temporary, `${name}.mjs`);
  buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    banner: { js: "import { createRequire as createLayoutRequire } from 'node:module'; const require = createLayoutRequire(import.meta.url);" } });
  files.push(outfile);
  return import(pathToFileURL(outfile).href);
};
const node = (id, width = 520, height = 360) => ({ id, type: 'thought', position: { x: 0, y: 0 }, width, height,
  measured: { width, height }, data: { question: id, response: 'Layout fixture', isCollapsed: false } });
const edge = (source, target, data = {}) => ({ id: `${source}-${target}`, source, target, data });
const bounds = (rects) => {
  const x = Math.min(...rects.map((n) => n.x)), y = Math.min(...rects.map((n) => n.y));
  const width = Math.max(...rects.map((n) => n.x + n.width)) - x;
  const height = Math.max(...rects.map((n) => n.y + n.height)) - y;
  return { x, y, width, height, area: width * height };
};
const rounded = (n) => Math.round(n * 1000) / 1000;
const median = (items) => [...items].sort((a, b) => a - b)[Math.floor(items.length / 2)];
const intersects = (a, b) => a.x < b.x + b.width - 0.01 && a.x + a.width > b.x + 0.01
  && a.y < b.y + b.height - 0.01 && a.y + a.height > b.y + 0.01;
const contains = (a, b) => a.x <= b.x + 0.01 && a.y <= b.y + 0.01
  && a.x + a.width + 0.01 >= b.x + b.width && a.y + a.height + 0.01 >= b.y + b.height;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const linesCross = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < -0.01 && cross(c, d, a) * cross(c, d, b) < -0.01;
const escapeXml = (text) => String(text).replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]);

try {
  const [{ planCanvasLayout }, { buildExampleGraph }, { nodeHeight }, { frameMembers }] = await Promise.all([
    compile('current', 'src/lib/canvas-layout.ts'), compile('example', 'src/lib/example-graph.ts'),
    compile('dimensions', 'src/lib/layout.ts'), compile('frames', 'src/lib/frames.ts'),
  ]);
  const baseline = existsSync(baselinePath) ? (await import(pathToFileURL(baselinePath).href)).planCanvasLayout : undefined;
  if (args.includes('--assert-improvement')) assert.ok(baseline, `Missing baseline engine: ${baselinePath}`);
  const size = (n) => ({ width: n.width ?? n.measured?.width ?? 520,
    height: n.data.stepKind === 'frame' ? n.height ?? n.measured?.height ?? 420 : nodeHeight(n) });
  const dimensions = (nodes) => nodes.map((n) => ({ ...n, ...size(n), measured: size(n) }));
  const example = buildExampleGraph('zh');
  const fixture = (name, nodes, edges) => ({ name, nodes: dimensions(nodes), edges });
  const fixtures = [
    fixture('example', example.nodes, example.edges),
    fixture('diamond', [node('a'), node('b', 900, 250), node('c', 400, 900), node('d'), node('e', 640, 180)],
      [edge('a', 'b'), edge('a', 'c', { isBranchFromSelection: true }), edge('b', 'd'), edge('c', 'd'), edge('d', 'e')]),
    fixture('reviewer', [node('a'), node('b'), node('c'), node('review', 520, 280), node('quote', 520, 220)],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'review', { isWatch: true, isCrossLink: true }), edge('quote', 'b', { isCrossLink: true })]),
    fixture('disconnected', Array.from({ length: 12 }, (_, i) => node(`root-${String(i).padStart(2, '0')}`, i % 3 ? 520 : 700, 220 + (i % 4) * 160)), []),
    fixture('fanout', [node('root'), ...Array.from({ length: 6 }, (_, i) => node(`branch-${i}`, 360 + i * 60, 220 + (i % 3) * 180)), node('merge')],
      [...Array.from({ length: 6 }, (_, i) => edge('root', `branch-${i}`, { isBranchFromSelection: true })),
        ...Array.from({ length: 6 }, (_, i) => edge(`branch-${i}`, 'merge'))]),
  ];
  const measure = (nodes, edges) => {
    const rectangles = nodes.map((n) => ({ id: n.id, frame: n.data.stepKind === 'frame',
      x: n.position.x, y: n.position.y, ...size(n) }));
    const cards = rectangles.filter((n) => !n.frame), cardBounds = bounds(cards), sceneBounds = bounds(rectangles);
    const area = cards.reduce((sum, n) => sum + n.width * n.height, 0);
    const byId = new Map(rectangles.map((n) => [n.id, n]));
    const center = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
    const segments = edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ ...e,
      a: center(byId.get(e.source)), b: center(byId.get(e.target)),
      kind: e.data?.isWatch ? 'watch' : e.data?.isCrossLink ? 'reference' : 'structural' }));
    const lengths = { structural: 0, reference: 0, watch: 0 };
    for (const e of segments) lengths[e.kind] += Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    let crossings = 0;
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if ([a.source, a.target].some((id) => id === b.source || id === b.target)) continue;
      if (linesCross(a.a, a.b, b.a, b.b)) crossings++;
    }
    const zoom = Math.min(1, 1344 / sceneBounds.width, 900 / sceneBounds.height);
    return {
      nodeCount: cards.length, frameCount: rectangles.length - cards.length,
      cardBounds: Object.fromEntries(Object.entries(cardBounds).map(([key, value]) => [key, rounded(value)])),
      sceneBounds: Object.fromEntries(Object.entries(sceneBounds).map(([key, value]) => [key, rounded(value)])),
      occupancy: rounded(area / cardBounds.area), fitCardWidth: rounded(median(cards.map((n) => n.width)) * zoom),
      centerDistance: Object.fromEntries(Object.entries(lengths).map(([key, value]) => [key, rounded(value)])),
      totalCenterDistance: rounded(Object.values(lengths).reduce((sum, value) => sum + value, 0)),
      longestCenterDistance: rounded(Math.max(0, ...segments.map((e) => Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)))),
      straightEdgeCrossings: crossings, rectangles,
    };
  };
  const check = (before, after, edges, direction) => {
    for (const n of after) assert.ok([n.position.x, n.position.y, ...Object.values(size(n))].every(Number.isFinite), `${n.id} has nonfinite geometry`);
    const rectangles = measure(after, edges).rectangles;
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      if (!a.frame && !b.frame) assert.ok(!intersects(a, b), `${a.id} overlaps ${b.id}`);
      if (a.frame && b.frame && !contains(a, b) && !contains(b, a)) assert.ok(!intersects(a, b), `${a.id} overlaps sibling ${b.id}`);
    }
    const byId = new Map(after.map((n) => [n.id, n]));
    const axis = direction === 'horizontal' ? 'x' : 'y';
    for (const e of edges.filter((e) => !e.data?.isWatch && !e.data?.isCrossLink)) {
      const a = byId.get(e.source), b = byId.get(e.target);
      assert.ok(b.position[axis] + 0.01 >= a.position[axis] + (direction === 'horizontal' ? size(a).width : size(a).height), `${e.id} violates flow order`);
    }
    for (const frame of before.filter((n) => n.data.stepKind === 'frame')) {
      assert.deepEqual(frameMembers(byId.get(frame.id), after).map((n) => n.id).sort(),
        frameMembers(frame, before).map((n) => n.id).sort(), `${frame.id} changed membership`);
    }
  };
  const draw = (name, nodes, edges, measured) => {
    const r = measured.rectangles, box = measured.sceneBounds, map = new Map(r.map((n) => [n.id, n]));
    const markup = ['<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="950"',
      ` viewBox="${box.x - 40} ${box.y - 40} ${box.width + 80} ${box.height + 80}">`,
      '<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6d60b8"/></marker></defs>',
      '<rect x="-100000" y="-100000" width="200000" height="200000" fill="#fafbfe"/>'];
    for (const n of r.filter((n) => n.frame).sort((a, b) => b.width * b.height - a.width * a.height)) {
      const original = nodes.find((node) => node.id === n.id);
      markup.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" fill="#e8edfa" stroke="#9cadd3" stroke-width="3"/>`,
        `<text x="${n.x + 24}" y="${n.y + 48}" font-size="28" fill="#475878">${escapeXml(original.data.question.slice(0, 36))}</text>`);
    }
    for (const e of edges) {
      const a = map.get(e.source), b = map.get(e.target);
      if (!a || !b) continue;
      markup.push(`<path d="M${a.x + a.width / 2} ${a.y + a.height / 2}L${b.x + b.width / 2} ${b.y + b.height / 2}" fill="none" stroke="${e.data?.isWatch ? '#c75e69' : '#6d60b8'}" stroke-width="4" ${e.data?.isCrossLink ? 'stroke-dasharray="12 10"' : ''} marker-end="url(#arrow)"/>`);
    }
    for (const n of r.filter((n) => !n.frame)) {
      markup.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" fill="white" stroke="#9daac2" stroke-width="3"/>`,
        `<text x="${n.x + 20}" y="${n.y + 44}" font-size="27" fill="#20324b">${escapeXml(n.id)}</text>`);
    }
    markup.push('</svg>');
    writeFileSync(join(output, `${name}.svg`), markup.join('\n'));
  };
  const report = { note: 'Center-distance and straight crossings describe layout geometry, not the rendered routed paths.',
    baseline: baseline ? baselinePath : null, viewport: { width: 1344, height: 900 }, results: [] };
  for (const item of fixtures) for (const direction of ['vertical', 'horizontal']) {
    const options = { method: 'chains', direction, density: 'standard', route: 'curve' };
    const started = performance.now();
    const current = await planCanvasLayout(item.nodes, item.edges, options);
    assert.equal(current.error, undefined, `${item.name} ${direction}: ${current.error}`);
    check(item.nodes, current.nodes, item.edges, direction);
    const metrics = measure(current.nodes, item.edges);
    const record = { fixture: item.name, direction, milliseconds: rounded(performance.now() - started), current: metrics };
    draw(`${item.name}-${direction}-current`, current.nodes, item.edges, metrics);
    if (baseline) {
      const previous = await baseline(item.nodes, item.edges, options);
      assert.equal(previous.error, undefined, `baseline ${item.name} ${direction}: ${previous.error}`);
      record.baseline = measure(previous.nodes, item.edges);
      record.ratio = { cardArea: rounded(metrics.cardBounds.area / record.baseline.cardBounds.area),
        sceneArea: rounded(metrics.sceneBounds.area / record.baseline.sceneBounds.area),
        edgeDistance: record.baseline.totalCenterDistance ? rounded(metrics.totalCenterDistance / record.baseline.totalCenterDistance) : null,
        fitCardWidth: rounded(metrics.fitCardWidth / record.baseline.fitCardWidth) };
      draw(`${item.name}-${direction}-baseline`, previous.nodes, item.edges, record.baseline);
    }
    report.results.push(record);
    console.log(`${item.name} ${direction}: occupancy=${metrics.occupancy} fitCard=${metrics.fitCardWidth}px` + (record.ratio ? ` area=${record.ratio.cardArea}x edge=${record.ratio.edgeDistance ?? 'n/a'}x baseline` : ''));
  }
  // Keep the larger corpus available for explicit performance/quality audits.
  report.corpusFiles = readdirSync(new URL('../benchmark/canvases/inputs/', import.meta.url)).filter((name) => name.endsWith('.thoughtdag.json')).length;
  writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (args.includes('--assert-improvement')) {
    for (const result of report.results.filter((r) => r.fixture === 'example')) {
      assert.ok(result.ratio.cardArea < 0.95, `${result.direction}: example should use at least 5% less node bounding area`);
      assert.ok(result.ratio.edgeDistance < 0.95, `${result.direction}: example should shorten total connection distance by at least 5%`);
      assert.ok(result.ratio.fitCardWidth >= 0.98, `${result.direction}: overview legibility regressed`);
    }
    for (const result of report.results.filter((r) => r.fixture === 'disconnected')) {
      const aspect = result.current.sceneBounds.width / result.current.sceneBounds.height;
      assert.ok(result.ratio.fitCardWidth >= 1.8,
        `${result.direction}: disconnected roots must pack into a readable overview (fitCard ${result.ratio.fitCardWidth}x baseline, expected at least 1.8x)`);
      assert.ok(aspect >= 0.5 && aspect <= 2.5,
        `${result.direction}: disconnected roots must not form a long strip (scene aspect ${aspect.toFixed(2)}, expected 0.5..2.5)`);
    }
  }
  console.log(`Quality report: ${join(output, 'report.json')}`);
} finally {
  for (const file of files) unlinkSync(file);
  rmdirSync(temporary);
}
