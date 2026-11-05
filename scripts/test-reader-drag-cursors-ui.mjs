// Isolated image-reader and floating-window pointer regression; no API writes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/reader-drag-cursors';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' });
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const check = name => { checks.push(name); console.log('PASS', name); };
const pan = page.locator('[data-image-pan]');
const cursor = locator => locator.evaluate(element => getComputedStyle(element).cursor);
const expectPanCursor = expected => page.waitForFunction(expected => {
  const element = document.querySelector('[data-image-pan]');
  return element && getComputedStyle(element).cursor === expected;
}, expected);
const imageFixture = async height => page.evaluate(height => {
  const canvas = document.createElement('canvas');
  canvas.width = 820; canvas.height = height;
  const drawing = canvas.getContext('2d');
  drawing.fillStyle = '#d9e7f0'; drawing.fillRect(0, 0, canvas.width, height);
  drawing.fillStyle = '#24526e'; drawing.font = '30px sans-serif'; drawing.fillText('Image panning fixture', 40, 70);
  window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === 'image-cursor'
    ? { ...node, data: { ...node.data, attachments: [{ id: 'image-one', name: 'fixture.png', type: 'image/png',
      size: 100, content: canvas.toDataURL('image/png').split(',')[1] }] } } : node) }));
}, height);
const point = async (locator, fx = .5, fy = .5) => {
  const box = await locator.boundingBox(); assert.ok(box);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
};
const move = async (start, dx, dy, button = 'left') => {
  await page.mouse.move(start.x, start.y); await page.mouse.down({ button });
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
};
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5178', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    const node = { id: 'image-cursor', type: 'thought', position: { x: 100, y: 100 }, dragHandle: '.drag-handle',
      data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, isLoading: false,
        isCollapsed: false, isEditing: false, tokenCount: 0, highlights: [], attachments: [], roleMode: 'inherit' } };
    window.__store.setState({ nodes: [node], edges: [], selectedNodeId: null, selectedNodeIds: [] });
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false);
    ui.setReaderMode('full');
  });
  await imageFixture(120);
  await page.evaluate(() => window.__ui.getState().setReaderNodeId('image-cursor'));
  await expectPanCursor('default');
  check('fitted image with no overflow uses the default cursor');
  await page.locator('[data-image-zoom] [data-zoom-in]').click();
  await page.locator('[data-image-zoom] [data-zoom-in]').click();
  await expectPanCursor('grab');
  await move(await point(pan, .65, .6), -100, 0);
  assert.equal(await cursor(pan), 'grabbing');
  assert.ok(await pan.evaluate(element => element.scrollLeft) > 80);
  await page.mouse.up();
  await expectPanCursor('grab');
  check('zoomed image supports real horizontal drag and grabbing feedback');
  await page.locator('[data-image-zoom] [data-zoom-fit]').click();
  await expectPanCursor('default');
  await imageFixture(1400);
  await expectPanCursor('grab');
  await move(await point(pan, .5, .25), 0, -100);
  assert.equal(await cursor(pan), 'grabbing');
  assert.ok(await pan.evaluate(element => element.parentElement.parentElement.scrollTop) > 80);
  await page.mouse.up();
  check('image load and intrinsic height changes enable vertical drag');
  await page.locator('[data-reader-clip-toggle]').click();
  await expectPanCursor('default');
  assert.equal(await cursor(page.locator('[data-clip-overlay]')), 'crosshair');
  await page.locator('[data-reader-clip-toggle]').click();
  await expectPanCursor('grab');
  check('clipping owns its crosshair and disables image panning');
  await imageFixture(400);
  await expectPanCursor('default');
  await page.setViewportSize({ width: 1600, height: 500 });
  await expectPanCursor('grab');
  await page.setViewportSize({ width: 1600, height: 1100 });
  await expectPanCursor('default');
  check('viewport resizing updates overflow availability in both directions');
  await page.screenshot({ path: `${output}/reader-fitted.png` });
  await page.evaluate(() => {
    window.__ui.getState().setReaderNodeId(null);
    window.__ui.getState().setCondenseDialogOpen(true);
  });
  const dialog = page.locator('[data-condense-dialog]');
  const handle = dialog.locator('[data-condense-drag-handle]');
  const close = handle.locator('button');
  await handle.waitFor();
  assert.equal(await cursor(handle), 'grab');
  assert.equal(await cursor(close), 'pointer');
  const original = await dialog.boundingBox();
  await move(await point(close), -70, -35);
  await page.mouse.up();
  assert.deepEqual(await dialog.boundingBox(), original);
  check('close control uses pointer and cannot start a window drag');
  await move(await point(handle, .3), 80, -30, 'right');
  await page.mouse.up({ button: 'right' });
  assert.deepEqual(await dialog.boundingBox(), original);
  check('right mouse button does not drag the floating window');
  await move(await point(handle, .3), 80, -30);
  assert.equal(await cursor(handle), 'grabbing');
  await page.waitForFunction(original => {
    const rect = document.querySelector('[data-condense-dialog]').getBoundingClientRect();
    return Math.abs(rect.x - original.x - 80) < 2 && Math.abs(rect.y - original.y + 30) < 2;
  }, original);
  const moved = await dialog.boundingBox();
  assert.ok(Math.abs(moved.x - original.x - 80) < 2);
  assert.ok(Math.abs(moved.y - original.y + 30) < 2);
  await page.mouse.up();
  assert.equal(await cursor(handle), 'grab');
  check('left drag moves the window and resets the cursor on release');
  await page.screenshot({ path: `${output}/condense-moved.png` });
  await close.click();
  await dialog.waitFor({ state: 'hidden' });
  check('close button still explicitly closes the window');
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally { await browser.close(); }
