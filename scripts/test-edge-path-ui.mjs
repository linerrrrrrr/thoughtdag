// Real canvas routing checks in isolated browser storage; no model calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5176';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/edge-path';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1400, height: 1100 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], checks = [];
page.on('pageerror', (error) => errors.push(error.message));
// Keep unrelated workspace edits from reloading this isolated fixture via HMR.
await page.routeWebSocket('**', (socket) => socket.close());
await context.route('**/api/**', (route) => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
  ? route.continue() : route.abort('blockedbyclient'));
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const fixture = async (blocked = false) => {
  await page.evaluate((blocked) => {
    const make = (id, x, y, name, extra = {}) => ({ id, type: 'thought', position: { x, y }, ...extra,
      data: { question: name, displayName: name, response: '这里是节点的分析内容。'.repeat(60), responses: ['答复'], responseIndex: 0,
        isCollapsed: true, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 600,
        highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', isRoot: id === 'a', isBranch: false } });
    const nodes = blocked ? [make('a', 100, 50, '上游问题'), make('b', 100, 1050, '下游结论'), make('blocker', -20, 500, '中间的其他节点', { width: 760 })]
      : [make('a', 80, 40, '设计手册主要描述了什么'), make('b', 80, 350, '设计原则与组件规范'),
        make('c', 80, 660, '当前有哪些可用组件'), make('d', 250, 1050, '清单是怎样的，罗列给我看'), make('e', 1250, 1430, '下载完整清单')];
    const edges = nodes.slice(0, blocked ? 1 : -1).map((node, i) => ({ id: `route-${node.id}-${nodes[i + 1].id}`,
      source: node.id, target: nodes[i + 1].id, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top',
      style: { stroke: '#6B5CE7', strokeWidth: 2 }, markerEnd: { type: 'arrowclosed', color: '#6B5CE7', width: 20, height: 20 } }));
    window.__store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0, selectedNodeIds: [], selectedNodeId: null });
    const ui = window.__ui.getState();
    ui.setPanelOpen(false); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setAutoRefreshPaused(true);
  }, blocked);
  await page.waitForFunction(() => window.__store.getState().nodes.every((n) => n.measured?.width && n.measured?.height));
  await page.evaluate(() => window.__rf.setViewport({ x: 70, y: 100, zoom: 0.55 }, { duration: 0 }));
  await page.waitForTimeout(500);
};
const geometry = () => page.evaluate(() => {
  const cards = [...document.querySelectorAll('.react-flow__node')].map((node) => ({ id: node.dataset.id, rect: node.getBoundingClientRect() }));
  return [...document.querySelectorAll('.react-flow__edge-path')].map((path) => {
    const edgeId = path.closest('.react-flow__edge').dataset.id;
    const points = Array.from({ length: 1001 }, (_, i) => path.getPointAtLength(path.getTotalLength() * i / 1000));
    const screenPoints = points.map((p) => new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()));
    const hits = cards.filter(({ rect }) => screenPoints.slice(5, -5).some((p) => p.x > rect.left + 2 && p.x < rect.right - 2
      && p.y > rect.top + 2 && p.y < rect.bottom - 2)).map((n) => n.id);
    const middle = screenPoints[500];
    return { edgeId, d: path.getAttribute('d'), hits, midpoint: { x: middle.x, y: middle.y },
      backwards: points.some((p, i) => i && p.y < points[i - 1].y - 0.01) };
  });
});
try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await fixture();
  let edges = await geometry();
  assert.equal(edges.length, 4);
  assert.ok(edges.every((e) => !e.hits.length && !e.backwards && e.d.includes(' C ')));
  check('screenshot-style offset chain has direct, forward curves without false avoidance');
  await page.screenshot({ path: `${outputDir}/chain-light.png` });
  const originalPositions = await page.evaluate(() => window.__store.getState().nodes.map((n) => n.position));
  for (const zoom of [0.3, 1, 0.55]) {
    await page.evaluate((zoom) => window.__rf.setViewport({ x: 70, y: 100, zoom }, { duration: 0 }), zoom);
    await page.waitForTimeout(450);
    assert.ok((await geometry()).every((e) => !e.hits.length));
  }
  assert.deepEqual(await page.evaluate(() => window.__store.getState().nodes.map((n) => n.position)), originalPositions);
  check('compact, map and working zoom preserve positions and clear connections');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: `${outputDir}/chain-dark.png` });
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  edges = await geometry();
  await page.mouse.click(edges[1].midpoint.x, edges[1].midpoint.y);
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.react-flow__edge.selected').count());
  assert.ok(await page.getByRole('button', { name: '删除线条', exact: false }).count());
  check('edge selection and midpoint action remain available');
  await fixture(true);
  edges = await geometry();
  assert.equal(edges.length, 1);
  assert.ok(edges[0].d.includes(' Q ') && !edges[0].hits.length);
  await page.screenshot({ path: `${outputDir}/detour.png` });
  check('actual intervening card gets a rounded collision-free detour');
  await page.evaluate(() => window.__store.setState((s) => ({ nodes: s.nodes.map((n) => n.id === 'blocker'
    ? { ...n, position: { x: 1500, y: 500 } } : n) })));
  await page.waitForTimeout(300);
  edges = await geometry();
  assert.ok(edges[0].d.includes(' C ') && !edges[0].hits.length);
  check('moving an obstacle restores the direct route');
  await page.setViewportSize({ width: 640, height: 900 });
  await fixture();
  await page.evaluate(() => window.__rf.fitView({ padding: 0.2, duration: 0 }));
  await page.waitForTimeout(450);
  assert.ok((await geometry()).every((e) => !e.hits.length));
  await page.screenshot({ path: `${outputDir}/chain-narrow.png` });
  check('narrow canvas retains clear routes');
  assert.deepEqual(errors, []);
} finally {
  if (!checks.length) {
    console.log(await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1500), store: !!window.__store,
      hydrated: window.__store?.persist.hasHydrated(), rf: !!window.__rf, ui: !!window.__ui })));
    await page.screenshot({ path: `${outputDir}/startup.png` });
  }
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
