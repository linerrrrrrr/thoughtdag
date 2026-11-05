// Render routing regressions in an isolated browser; no conversation/API writes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDir = 'local-tests/edge-curves';
await mkdir(outputDir, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
assert.ok(executablePath);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
const checks = [], errors = [], blockedWrites = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.routeWebSocket('**', (socket) => socket.close());
await context.route('**/api/**', (route) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  blockedWrites.push(route.request().url()); return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const seed = async (kind) => {
  await page.evaluate(async (kind) => {
    window.__canvasEditing.getState().reset();
    const { useAppearance } = await import('/src/lib/appearance.ts');
    useAppearance.getState().setLighting('dark');
    const make = (id, x, y, name, width = 360, height = 240) => ({ id, type: 'thought', position: { x, y },
      width, height, measured: { width, height }, dragHandle: '.drag-handle', data: {
        displayName: name, question: name, response: '用于检查连接的走向与节点避让。', responses: ['用于检查连接的走向与节点避让。'],
        responseIndex: 0, summaries: [], isCollapsed: kind === 'compact', isEditing: false, isEditingResponse: false,
        isLoading: false, tokenCount: 100, highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', isRoot: id === 'source', isBranch: false, layoutDirection: 'horizontal', edgeRouteDefault: 'auto',
      } });
    let nodes;
    if (kind === 'compact') nodes = [make('source', -800, -80, '上游对话', 420),
      make('target-1', 200, 400, '汇总三轮讨论', 420), make('target-2', 1000, 500, '继续汇总讨论', 420)];
    else if (kind === 'tight') nodes = [make('source', 40, 100, '上游对话'),
      make('target-1', 410, 360, '近距离续接'), make('target-2', 410, 660, '另一个引用')];
    else if (kind === 'vertical') nodes = [make('source', 120, 20, '上游对话'), make('target-1', 420, 850, '纵向错位')];
    else nodes = [make('source', 60, 140, '梳理设计规范'), make('target-1', 1260, kind === 'offset' ? 620 : 140, '继续深入分析'),
      ...(kind === 'obstacle' ? [make('target-2', 1260, 650, '引用这轮问答'), make('obstacle', 650, 370, '其他讨论', 420, 220)] : [])];
    if (kind === 'vertical') nodes.forEach((n) => { n.data.layoutDirection = 'vertical'; });
    const edges = nodes.filter((n) => n.id.startsWith('target')).map((n, i) => ({
      id: `edge-${i + 1}`, source: 'source', target: n.id, type: 'smoothstep', data: { route: 'curve', ...(i ? { isCrossLink: true } : {}) },
      style: { stroke: '#aaa1ed', strokeWidth: 2, ...(i ? { strokeDasharray: '8 4' } : {}) },
      markerEnd: { type: 'arrowclosed', color: '#aaa1ed' },
    }));
    window.__store.setState({ nodes, edges, selectedNodeId: null, selectedNodeIds: [], staleIds: [], staleFps: {}, staleVerdicts: {},
      history: [{ nodes, edges }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setPanelOpen(false); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setAutoRefreshPaused(true);
    window.__rf.setViewport({ x: 40, y: 80, zoom: kind === 'compact' ? 0.6 : 0.75 }, { duration: 0 });
  }, kind);
  await page.waitForTimeout(800);
  await page.evaluate((kind) => window.__rf.setViewport({ x: 40, y: 80, zoom: kind === 'compact' ? 0.6 : 0.75 }, { duration: 0 }), kind);
  await page.waitForTimeout(300);
};
const geometry = () => page.evaluate(() => window.__rf.getEdges().map((e) => {
  const path = document.querySelector(`.react-flow__edge[data-id="${e.id}"] .react-flow__edge-path`);
  const length = path.getTotalLength(), matrix = path.getScreenCTM();
  const samples = Array.from({ length: 801 }, (_, i) => {
    const p = path.getPointAtLength(length * i / 800), screen = new DOMPoint(p.x, p.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  const hits = [...document.querySelectorAll('.react-flow__node')].filter((n) => {
    const r = n.getBoundingClientRect();
    return samples.slice(2, -2).some((p) => p.x > r.left + 1 && p.x < r.right - 1 && p.y > r.top + 1 && p.y < r.bottom - 1);
  }).map((n) => n.dataset.id);
  const port = (id, role, side) => {
    const handle = document.querySelector(`.react-flow__node[data-id="${id}"] [data-connection-role="${role}"][data-connection-side="${side}"]`);
    if (!handle) return null; // Offscreen nodes can be culled by React Flow.
    const r = handle.getBoundingClientRect();
    // React Flow attaches to the outward face of the measured handle box.
    return { x: side === 'left' ? r.left : side === 'right' ? r.right : r.left + r.width / 2,
      y: side === 'top' ? r.top : side === 'bottom' ? r.bottom : r.top + r.height / 2 };
  };
  return { id: e.id, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
    d: path.getAttribute('d'), start: samples[0], end: samples.at(-1), samples, hits,
    sourcePort: port(e.source, 'source', e.sourceHandle.slice(4)), targetPort: port(e.target, 'target', e.targetHandle.slice(3)) };
}));
const safe = (edges) => edges.forEach((e) => {
  assert.deepEqual(e.hits, [], `${e.id} crosses node interior`);
  for (const [p, q] of [[e.start, e.sourcePort], [e.end, e.targetPort]])
    if (q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 5, `${e.id} endpoint ${JSON.stringify(p)} must match DOM handle ${JSON.stringify(q)}`);
});
const naturalS = (e) => {
  const dx = e.end.x - e.start.x, dy = e.end.y - e.start.y, span = Math.hypot(dx, dy);
  const offsets = e.samples.map((p) => ((p.x - e.start.x) * dy - (p.y - e.start.y) * dx) / span);
  assert.ok(Math.max(...offsets) > span * 0.025 && Math.min(...offsets) < -span * 0.025, `${e.id} lacks full-span S curvature`);
  assert.ok(e.samples.every((p, i, all) => !i || p.x >= all[i - 1].x - 0.1 && p.y >= all[i - 1].y - 0.1), `${e.id} reverses into a hook`);
};
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5176', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rf && window.__store?.persist.hasHydrated() && window.__canvasEditing);
  for (const kind of ['aligned', 'offset', 'vertical', 'compact', 'tight', 'obstacle']) {
    await seed(kind);
    const edges = await geometry(); safe(edges);
    if (['offset', 'vertical'].includes(kind)) edges.forEach(naturalS);
    if (kind === 'vertical') { assert.equal(edges[0].sourceHandle, 'out-bottom'); assert.equal(edges[0].targetHandle, 'in-top'); }
    if (kind === 'compact') naturalS(edges[0]); // The nearer target obstructs the second edge's natural S.
    if (kind === 'aligned') assert.ok(edges[0].samples.every((p) => Math.abs(p.y - edges[0].start.y) < 1));
    if (kind === 'tight') {
      // The 10px card gap is narrower than the two physical handle boxes;
      // allow their small reverse entry, but never a loop behind the source.
      assert.ok(edges[0].samples.every((p) => p.x >= edges[0].start.x - 20));
    }
    if (kind === 'obstacle') {
      const overlap = edges[0].samples.slice(20, -20).filter((p) => edges[1].samples.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 2));
      assert.ok(overlap.length < 80, 'shared routes must separate');
      await page.evaluate(() => {
        window.__store.getState().setSelectedNodeIds([]);
        window.__store.setState(state => ({ edges: state.edges.map(edge => ({ ...edge, selected: edge.id === 'edge-2' })) }));
        window.__canvasEditing.getState().requestProperties();
      });
      await page.waitForTimeout(150);
      assert.deepEqual((await geometry()).map((e) => e.d), edges.map((e) => e.d), 'selection cannot change routes');
    }
    await page.screenshot({ path: `${outputDir}/${kind}.png` });
    check(`${kind}: actual rendered curve, obstacle clearance and DOM endpoint alignment`);
    if (kind === 'compact') {
      for (const zoom of [0.8, 0.25, 1]) {
        await page.evaluate((zoom) => window.__rf.setViewport({ x: zoom === 0.25 ? 250 : 40, y: 80, zoom }, { duration: 0 }), zoom);
        await page.waitForTimeout(600); safe(await geometry());
      }
      check('semantic zoom remeasures compact and working cards without stale endpoint geometry');
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(blockedWrites, []);
} catch (error) {
  await page.screenshot({ path: `${outputDir}/failure.png` }).catch(() => {});
  await writeFile(`${outputDir}/failure-geometry.json`, JSON.stringify(await page.evaluate(() => ({
    nodes: window.__store.getState().nodes.map(({ id, position, width, height, measured }) => ({ id, position, width, height, measured })),
    edges: window.__rf.getEdges().map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle, targetHandle,
      path: document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`)?.getAttribute('d') })),
    viewport: window.__rf.getViewport(),
    cards: [...document.querySelectorAll('.react-flow__node')].map((n) => ({ id: n.dataset.id, bounds: n.getBoundingClientRect().toJSON() })),
  })), null, 2));
  throw error;
} finally {
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors, blockedWrites }, null, 2));
  await browser.close();
}
