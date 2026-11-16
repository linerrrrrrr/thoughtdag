// Screen UI density must not change React Flow's pointer coordinate space.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173');
const output = 'local-tests/ui-scale';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN', deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(url.pathname);
    return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  }
  return url.origin === appUrl.origin ? route.continue() : route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
});
const near = (actual, expected, label, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected}, received ${actual}`);
const item = name => page.locator(`[data-${name}]`);
const settle = () => page.waitForTimeout(220);
const bounds = locator => locator.boundingBox();
const position = id => page.evaluate(id => window.__store.getState().nodes.find(node => node.id === id).position, id);

try {
  await page.goto(appUrl.href);
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(async () => {
    window.__importScaleModule = path => import([...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    const nodes = ['scale-a', 'scale-b'].map((id, index) => ({ id, type: 'thought', width: 380, height: 280,
      dragHandle: '.drag-handle', position: { x: 160 + index * 450, y: 230 }, data: {
        displayName: `比例测试 ${id}`, question: `研究问题 ${id}`, response: `回答 ${id}`,
        responses: [`回答 ${id}`], responseIndex: 0, isCollapsed: false, isEditing: false,
        isLoading: false, tokenCount: 10, highlights: [], attachments: [],
      } }));
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 });
  });
  await settle();

  const flowGeometry = await page.locator('.react-flow').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight };
  });
  near(flowGeometry.width, 1440, 'canvas fills viewport width');
  near(flowGeometry.height, 1000, 'canvas fills viewport height');
  near(flowGeometry.width, flowGeometry.clientWidth, 'canvas pointer width stays unscaled');
  near(flowGeometry.height, flowGeometry.clientHeight, 'canvas pointer height stays unscaled');
  const rail = await bounds(page.locator('.react-flow__controls'));
  const button = await bounds(page.locator('.react-flow__controls-zoomin'));
  near(button.width, 24, '32px control renders at 75%');
  near(button.height, 24, '32px control height renders at 75%');
  near(rail.x, 12, '16px canvas inset renders at 75%');
  near(1000 - rail.y - rail.height, 12, 'bottom inset renders at 75%');
  const header = await bounds(item('canvas-header'));
  near(header.x, 12, 'header left inset');
  near(header.y, 12, 'header top inset');
  await item('toolbar-more').click();
  const menu = await bounds(item('toolbar-more-panel'));
  near(menu.width, 240, '320px tool card renders at 75%');
  near(menu.y - header.y - header.height, 12, 'tool card gap renders at 75%');
  await page.screenshot({ path: `${output}/wide-tools.png` });
  await page.keyboard.press('Escape');
  console.log('PASS 75% control, inset, and tool-card dimensions; full-size canvas coordinate root');

  await page.evaluate(() => window.__ui.getState().setMaterialsOverviewOpen(true));
  const modal = page.locator('[role="dialog"][aria-modal="true"]');
  await modal.waitFor();
  const modalBox = await bounds(modal);
  near(modalBox.width, 480, '640px body-portal modal renders at 75%');
  near(modalBox.x + modalBox.width / 2, 720, 'portal remains horizontally centered');
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  console.log('PASS body-portal modal has the same density');

  for (const zoom of [1, 0.5]) {
    await page.evaluate(zoom => window.__rf.setViewport({ x: 0, y: 0, zoom }), zoom);
    await settle();
    const node = page.locator('.react-flow__node[data-id="scale-a"]');
    const handle = node.locator('.drag-handle').first();
    const box = await bounds(handle);
    // The center of the status header is a drag surface, away from its actions.
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // React Flow's activation threshold deliberately consumes the first motion.
    await page.mouse.move(from.x + 10, from.y + 10);
    await page.waitForTimeout(40);
    const before = await position('scale-a');
    await page.mouse.move(from.x + 100, from.y + 55, { steps: 12 });
    await page.mouse.up();
    await settle();
    const after = await position('scale-a');
    near(after.x - before.x, 90 / zoom, `node drag horizontal delta at zoom ${zoom}`, 2);
    near(after.y - before.y, 45 / zoom, `node drag vertical delta at zoom ${zoom}`, 2);
    const control = await bounds(page.locator('.react-flow__controls-zoomin'));
    near(control.width, 24, `control remains screen-sized at canvas zoom ${zoom}`);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => {
    window.__ui.getState().setPanelOpen(false);
    window.__store.getState().setSelectedNodeIds([]);
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 });
  });
  await settle();
  const drop = { x: 820, y: 720 };
  const expected = await page.evaluate(point => window.__rf.screenToFlowPosition(point), drop);
  const previousIds = await page.evaluate(() => window.__store.getState().nodes.map(node => node.id));
  await page.mouse.dblclick(drop.x, drop.y);
  await page.waitForFunction(ids => window.__store.getState().nodes.some(node => !ids.includes(node.id)), previousIds);
  const created = await page.evaluate(ids => window.__store.getState().nodes.find(node => !ids.includes(node.id)), previousIds);
  near(created.position.x + 200, expected.x, 'double-click draft horizontal anchor follows pointer');
  near(created.position.y + 60, expected.y, 'double-click draft vertical anchor follows pointer');
  console.log('PASS canvas drag at two zoom levels and double-click draft placement');

  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds([]));
  const minimap = page.locator('.react-flow__minimap');
  const restingMap = await bounds(minimap);
  near(restingMap.width, 150, '200px minimap width renders at 75%');
  near(restingMap.height, 105, '140px minimap height renders at 75%');
  await minimap.hover();
  await settle();
  // Creating a draft can still be finishing its camera transition. Measure
  // the minimap gesture only after that independent animation has settled.
  await page.waitForFunction(() => {
    const value = JSON.stringify(window.__rf.getViewport());
    const previous = window.__scaleViewportSample;
    if (!previous || previous.value !== value) {
      window.__scaleViewportSample = { value, since: performance.now() };
      return false;
    }
    return performance.now() - previous.since >= 200;
  });
  const mapBox = await bounds(minimap);
  const beforeMap = await page.evaluate(() => window.__rf.getViewport());
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width / 2 + 18, mapBox.y + mapBox.height / 2 + 12, { steps: 8 });
  await page.mouse.up();
  await settle();
  const afterMap = await page.evaluate(() => window.__rf.getViewport());
  assert.ok(Math.abs(afterMap.x - beforeMap.x) > 1 && Math.abs(afterMap.y - beforeMap.y) > 1,
    'minimap remains draggable in both axes');
  near(afterMap.zoom, beforeMap.zoom, 'minimap pan preserves canvas zoom', 0.001);
  await page.mouse.move(700, 800);
  console.log('PASS minimap pointer drag updates the viewport');

  for (const theme of ['light', 'dark']) {
    for (const lang of ['zh', 'en']) {
      await page.evaluate(async ({ theme, lang }) => {
        (await window.__importScaleModule('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme);
        (await window.__importScaleModule('/src/i18n/index.ts')).useI18n.getState().setLang(lang);
      }, { theme, lang });
      for (const width of [1440, 760, 520, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await settle();
        const [left, right, currentHeader] = await Promise.all([
          bounds(item('project-switcher')), bounds(item('top-toolbar')), bounds(item('canvas-header')),
        ]);
        const detail = `${theme}/${lang}/${width}`;
        near(left.y, right.y, `${detail}: toolbars stay on one row`);
        near(left.height, right.height, `${detail}: toolbar heights match`);
        assert.ok(left.x + left.width <= right.x, `${detail}: no toolbar overlap`);
        assert.ok(right.x + right.width <= currentHeader.x + currentHeader.width + 1, `${detail}: fits header`);
        assert.ok(currentHeader.x >= 0 && currentHeader.x + currentHeader.width <= width + 1, `${detail}: header fits viewport`);
        if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/${theme}-${lang}-${width}.png` });
      }
    }
  }
  console.log('PASS 20 theme/language/viewport combinations without toolbar overlap');
  assert.deepEqual(errors, [], 'no page runtime errors');
  assert.deepEqual(writes, [], 'no API writes');
} finally {
  await browser.close();
}
