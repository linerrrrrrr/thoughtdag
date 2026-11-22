// Pointer hit targets and real text selection in isolated document fixtures.
// Start Vite with THOUGHTDAG_DISK_STORAGE=0; disk requests are always blocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5207';
const output = 'local-tests/document-cursor';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let index = 0; index < 2; index++) {
  const sheet = pdf.addPage([612, 792]);
  sheet.drawText('Original PDF paragraph for native selection.', { x: 42, y: 720, size: 18, font });
}
const source = Buffer.from(await pdf.save()).toString('base64');
const fixture = { id: 'pdf-cursor', type: 'thought', dragHandle: '.drag-handle', position: { x: 140, y: 90 }, width: 570, height: 760,
  data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0,
    highlights: [], highlightMode: 'off', detailLevel: 'full', attachments: [{ id: 'pdf-cursor-att', name: 'Cursor fixture.pdf',
      type: 'application/pdf', size: source.length, content: source, extractedText: 'Original source text.', numPages: 2 }] } };
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const checks = [], measurements = [], errors = [], writes = [];
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/__thoughtdag_storage**', route => route.fulfill({ status: 404, body: '' }));
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
let page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const canvasNode = () => page.locator('.react-flow__node[data-id="pdf-cursor"]');
const canvasBody = () => canvasNode().locator('[data-content-body]');
const check = name => { checks.push(name); console.log('PASS', name); };
const geometry = () => page.evaluate(() => ({ viewport: window.__rf.getViewport(),
  positions: window.__store.getState().nodes.map(({ id, position }) => ({ id, ...position })) }));
async function point(locator, fx = .5, fy = .5) {
  const box = await locator.boundingBox(); assert.ok(box, 'Target is rendered');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}
async function cursorAt(at, expected, label, selector) {
  await page.mouse.move(at.x, at.y); await settle();
  const hit = await page.evaluate(({ x, y, selector }) => {
    const element = document.elementFromPoint(x, y);
    return { cursor: element && getComputedStyle(element).cursor, tag: element?.tagName,
      className: element?.getAttribute('class'), matches: !!element?.closest(selector) };
  }, { ...at, selector });
  measurements.push({ label, ...at, ...hit });
  assert.ok(hit.matches, `${label} hit wrong target: ${JSON.stringify(hit)}`);
  assert.equal(hit.cursor, expected, `${label}: ${JSON.stringify(hit)}`);
}
async function readingSurface(root, body, label) {
  await body.evaluate(element => { element.scrollTop = 0; }); await settle();
  const sheet = root.locator('[data-pdf-page]').first();
  const span = sheet.locator('.tdag-textlayer span').first();
  await span.waitFor();
  const box = await sheet.boundingBox(); assert.ok(box);
  // This gutter lies outside the page/text layer and reproduces the reported cursor leak.
  await cursorAt({ x: box.x - 5, y: box.y + 100 }, 'default', `${label}: page gutter`, '.pdf-document-pages');
  await cursorAt(await point(sheet, .8, .25), 'default', `${label}: blank paper`, '.tdag-textlayer');
  await cursorAt(await point(root.locator('.pdf-document-toolbar'), .97), 'default', `${label}: toolbar space`, '.pdf-document-toolbar');
  await cursorAt(await point(root.locator('[data-pdf-mode="read"]')), 'pointer', `${label}: read button`, 'button');
  await cursorAt(await point(span), 'text', `${label}: text`, '.tdag-textlayer span');
  const before = await geometry();
  const textBox = await span.boundingBox(); assert.ok(textBox);
  await page.mouse.move(textBox.x + 2, textBox.y + textBox.height / 2); await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width - 2, textBox.y + textBox.height / 2, { steps: 12 });
  // The reader's ask bar takes focus after mouseup and carries the selected quote.
  assert.match(await page.evaluate(() => window.getSelection()?.toString() ?? ''), /Original PDF/);
  await page.mouse.up();
  if (await body.getAttribute('data-reader-body') !== null) {
    const ask = page.locator('[data-reader-askbar]');
    await ask.waitFor();
    assert.match(await ask.textContent(), /Original PDF/);
    await ask.locator('textarea').press('Escape');
  }
  assert.deepEqual(await geometry(), before, `${label}: selection must not move the graph`);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  // Scroll to the second label so the real inter-page gap is in the viewport.
  await root.locator('.pdf-document-page-label').nth(1).scrollIntoViewIfNeeded(); await settle();
  const next = await root.locator('.pdf-document-page-label').nth(1).boundingBox(); assert.ok(next);
  await cursorAt({ x: next.x + next.width / 2, y: next.y - 6 }, 'default', `${label}: inter-page gap`, '.pdf-document-pages');
  await cursorAt(await point(root.locator('.pdf-document-page-label').nth(1)), 'default', `${label}: page label`, '.pdf-document-page-label');
  await body.evaluate(element => { element.scrollTop = 0; }); await settle();
  const scrollerBox = await body.boundingBox(); assert.ok(scrollerBox);
  await cursorAt({ x: scrollerBox.x + scrollerBox.width - 2, y: scrollerBox.y + 140 }, 'default', `${label}: scroll gutter`, '[data-content-body], [data-reader-body]');
  check(`${label}: precise cursors and real PDF selection`);
}
try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(node => {
    const nodes = [node]; window.__store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0, selectedNodeId: null, selectedNodeIds: [] });
    const ui = window.__ui.getState(); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('full');
  }, fixture);
  await canvasNode().locator('.tdag-textlayer span').first().waitFor();
  await page.waitForTimeout(400);
  for (const theme of ['light', 'dark']) for (const zoom of [1, .65]) {
    await page.evaluate(async ({ theme, zoom }) => {
      (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme);
      window.__rf.setViewport({ x: 50, y: 20, zoom }, { duration: 0 });
    }, { theme, zoom }); await settle();
    await readingSurface(canvasNode().locator('[data-pdf-document]'), canvasBody(), `canvas/${theme}/${zoom}`);
    await page.screenshot({ path: `${output}/canvas-${theme}-${zoom}.png` });
  }
  await page.evaluate(() => window.__ui.getState().setReaderNodeId('pdf-cursor', { attachmentId: 'pdf-cursor-att' }));
  const readerBody = page.locator('[data-reader-body]'), reader = readerBody.locator('[data-pdf-document]');
  await reader.locator('.tdag-textlayer span').first().waitFor();
  for (const [width, theme] of [[1500, 'light'], [900, 'dark']]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.evaluate(async theme => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme), theme);
    await settle();
    await readingSurface(reader, readerBody, `reader/${theme}/${width}`);
    await page.locator('[data-reader-clip-toggle]').click();
    await cursorAt(await point(reader.locator('[data-pdf-region-layer]').first(), .4, .3), 'crosshair', 'PDF region clipping', '[data-pdf-region-layer]');
    await page.locator('[data-reader-clip-toggle]').click();
    await reader.locator('[data-pdf-region-layer]').first().waitFor({ state: 'detached' });
    await settle();
    await page.screenshot({ path: `${output}/reader-${theme}-${width}.png` });
  }
  check('PDF clipping retains crosshair in wide and narrow readers');
  // A fresh page keeps material fixtures independent of the reader's camera restoration.
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__ui.getState().setReaderNodeId(null);
    window.__ui.setState({ tutorialOpen: false, releaseNotesOpen: false, panelOpen: false });
    const image = document.createElement('canvas'); image.width = 400; image.height = 100;
    const drawing = image.getContext('2d'); drawing.fillStyle = '#b5c9d9'; drawing.fillRect(0, 0, 400, 100);
    const attachments = [
      { id: 'image-cursor-att', name: 'Fixture.png', type: 'image/png', size: 100, content: image.toDataURL().split(',')[1] },
      { id: 'text-cursor-att', name: 'Fixture.txt', type: 'text/plain', size: 80, content: 'Plain material preview remains selectable with the text cursor.' },
    ];
    const nodes = attachments.map((attachment, index) => ({ id: `material-cursor-${index}`, type: 'thought', dragHandle: '.drag-handle',
      position: { x: 100 + index * 540, y: 130 }, width: 440, height: 400,
      data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0,
        highlights: [], highlightMode: 'off', detailLevel: 'full', attachments: [attachment] } }));
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
  });
  const imageNode = page.locator('.react-flow__node[data-id="material-cursor-0"]');
  const textNode = page.locator('.react-flow__node[data-id="material-cursor-1"]');
  await imageNode.locator('img').waitFor();
  // Wait for the initial canvas fit before measuring exact hit coordinates.
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  await settle();
  await cursorAt(await point(imageNode.locator('img'), .5, .2), 'default', 'Image material', 'img');
  await cursorAt(await point(imageNode.locator('[data-content-body]'), .5, .9), 'default', 'Image material unused space', '[data-content-body]');
  await cursorAt(await point(textNode.locator('[data-file-text-preview]')), 'text', 'Plain text material', '[data-file-text-preview]');
  await cursorAt(await point(textNode.locator('[data-content-body]'), .5, .9), 'default', 'Plain text material unused space', '[data-content-body]');
  await page.screenshot({ path: `${output}/image-and-text.png` });
  check('Image and plain text materials reserve text cursors for the readable preview');
  assert.deepEqual(errors, [], 'No browser errors'); assert.deepEqual(writes, [], 'No API writes');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, measurements, errors, writes }, null, 2));
  await browser.close();
}
