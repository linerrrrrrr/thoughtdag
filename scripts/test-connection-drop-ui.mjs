// Exercise wire creation against rendered ports, without touching user storage or model APIs.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5176';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/connection-drop';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 2600, height: 1600 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  writes.push(route.request().url());
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const fixture = async (zoom, theme, paper) => {
  await page.evaluate(async ({ theme, paper }) => {
    const { useAppearance } = await import('/src/lib/appearance.ts');
    useAppearance.getState().setLighting(theme);
    useAppearance.getState().setPaper(paper);
    window.__canvasEditing.getState().reset();
    const node = { id: 'source', type: 'thought', position: { x: 0, y: 0 }, width: 420, height: 320,
      dragHandle: '.drag-handle', data: {
        question: '继续分析这项研究', response: '从这个节点拖线，在预期位置松开。', responses: ['已有回答'], responseIndex: 0,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 30,
        highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', isRoot: true, isBranch: false, layoutDirection: 'vertical',
      } };
    window.__store.setState({ nodes: [node], edges: [], history: [{ nodes: [node], edges: [] }], historyIndex: 0,
      selectedNodeIds: [], selectedNodeId: null, staleIds: [], staleFps: {}, staleVerdicts: {} });
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.setState({ drafts: {} });
  }, { theme, paper });
  // Let initial-canvas framing finish before fixing the camera for a gesture.
  await page.waitForTimeout(650);
  await page.evaluate(zoom => window.__rf.setViewport({ x: 1200 - 210 * zoom, y: 700 - 160 * zoom, zoom }, { duration: 0 }), zoom);
  await page.waitForTimeout(100);
};
const geometry = () => page.evaluate(() => {
  const state = window.__store.getState(), target = state.nodes.find(node => node.id !== 'source');
  const edge = window.__rf.getEdges()[0];
  const path = document.querySelector('.react-flow__edge-path');
  const handle = target && edge && document.querySelector(`.react-flow__node[data-id="${target.id}"] [data-handleid="${edge.targetHandle}"]`);
  if (!path || !handle) return null;
  const point = path.getPointAtLength(path.getTotalLength());
  const end = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
  const box = handle.getBoundingClientRect();
  const side = edge.targetHandle.replace('in-', '');
  return { end: { x: end.x, y: end.y }, port: {
    x: side === 'left' ? box.x : side === 'right' ? box.right : box.x + box.width / 2,
    y: side === 'top' ? box.y : side === 'bottom' ? box.bottom : box.y + box.height / 2 },
    side: edge.targetHandle, position: target.position, nodeId: target.id, data: state.edges[0].data,
    historyIndex: state.historyIndex, editing: target.data.isEditing, response: target.data.response };
});
const near = (actual, expected, label) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1.5,
  `${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__canvasEditing);
  for (const zoom of [1, 0.65, 1.3]) {
    for (const direction of ['down', 'right', 'up', 'left', 'diagonal']) {
      const theme = zoom === 0.65 ? 'dark' : 'light';
      await fixture(zoom, theme, zoom === 1.3 ? 'grid' : 'plain');
      const side = { down: 'bottom', right: 'right', up: 'top', left: 'left', diagonal: 'bottom' }[direction];
      const port = page.locator(`.react-flow__node[data-id="source"] [data-connection-role="source"][data-connection-side="${side}"]`);
      await page.locator('.react-flow__node[data-id="source"]').hover();
      const box = await port.boundingBox();
      const sideY = box.y + box.height / 2;
      const end = { down: { x: 1200, y: 1033 }, right: { x: 1843, y: sideY + 13 },
        up: { x: 1200, y: 353 }, left: { x: 703, y: sideY - 11 }, diagonal: { x: 1823, y: 1033 } }[direction];
      const viewport = await page.evaluate(() => window.__rf.getViewport());
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 18 });
      await page.mouse.up();
      await page.waitForFunction(() => window.__store.getState().nodes.length === 2
        && window.__store.getState().nodes.every(node => node.measured?.width && node.measured?.height));
      await page.waitForTimeout(650);
      const actual = await geometry();
      assert.ok(actual, 'The new continuation and its input port must render');
      near(actual.end, end, `${direction} ${zoom}: wire endpoint`);
      near(actual.port, end, `${direction} ${zoom}: input port`);
      assert.deepEqual(await page.evaluate(() => window.__rf.getViewport()), viewport, 'Wire creation keeps the camera and zoom unchanged');
      assert.equal(actual.editing, true);
      assert.equal(actual.response, '');
      assert.ok(!actual.data?.isCrossLink, 'An empty-canvas drop remains a continuation');
      if (direction !== 'diagonal') assert.equal(actual.side, { down: 'in-top', right: 'in-left', up: 'in-bottom', left: 'in-right' }[direction]);
      if (direction === 'diagonal') await page.screenshot({ path: `${output}/${theme}-${zoom}.png` });
      await page.evaluate(() => window.__store.getState().undo());
      assert.deepEqual(await page.evaluate(() => ({ nodes: window.__store.getState().nodes.map(node => node.id), edges: window.__store.getState().edges.length })),
        { nodes: ['source'], edges: 0 }, 'One undo removes both the node and its edge');
      await page.evaluate(() => window.__store.getState().redo());
      const restored = await page.evaluate(id => window.__store.getState().nodes.find(node => node.id === id)?.position, actual.nodeId);
      assert.deepEqual(restored, actual.position, 'Redo restores the measured placement');
      checks.push(`${direction} at ${zoom} in ${theme}`);
      console.log(`PASS ${checks.at(-1)}`);
    }
  }
  assert.deepEqual(errors, [], 'No browser errors');
  assert.deepEqual(writes, [], 'Dragging never sends a question or makes an API write');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  console.error(await geometry().catch(() => null));
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  await browser.close();
}
