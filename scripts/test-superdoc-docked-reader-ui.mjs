// Focused regression: a docked reader must not take a native DOCX out of its canvas node.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';

const output = 'local-tests/superdoc/docked-reader';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const sources = await Promise.all(['ALPHA', 'BRAVO'].map(createSuperdocFixture));
const nodes = sources.map((source, index) => ({
  id: `dock-node-${index + 1}`, type: 'thought', position: { x: 40 + index * 610, y: 80 }, width: 580, height: 830, dragHandle: '.drag-handle',
  data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0,
    highlights: [], highlightMode: 'off', detailLevel: 'full', isLoading: false, isCollapsed: false,
    attachments: [{ id: `dock-att-${index + 1}`, name: `${index ? 'BRAVO' : 'ALPHA'}.docx`,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: source.buffer.length,
      content: source.buffer.toString('base64'), extractedText: `${index ? 'BRAVO' : 'ALPHA'} original document` }],
  },
}));
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const checks = [], errors = [], writes = [];
const check = message => { checks.push(message); console.log('PASS', message); };
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh'); localStorage.setItem('thoughtdag.lighting', 'light');
});
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5194', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(nodes => {
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('dock');
  }, nodes);
  for (let index = 1; index <= 2; index++) await page.locator(`[data-superdoc-editor="dock-att-${index}"][data-superdoc-ready="true"]`).waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__dockSessions = [1, 2].map(index => document.querySelector(`[data-superdoc-scroll="dock-att-${index}"]`).__docxSession);
    window.__dockInstances = window.__dockSessions.map(session => session.instance);
    window.__rf.setViewport({ x: 20, y: 0, zoom: 0.85 }, { duration: 0 });
  });
  await page.locator('[data-document-open="dock-att-1"]').click();
  await page.locator('[data-reader-docked] [data-superdoc-scroll="dock-att-1"]').waitFor();
  await page.evaluate(() => window.__rf.setViewport({ x: 20, y: 0, zoom: 0.85 }, { duration: 0 }));
  check('Explicitly opening document A docks the same native editor beside the canvas');

  const nodeB = page.locator('.react-flow__node[data-id="dock-node-2"]');
  await nodeB.locator('.material-header .material-label').click();
  await page.waitForFunction(() => window.__store.getState().selectedNodeId === 'dock-node-2');
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.__ui.getState().readerNodeId), 'dock-node-1');
  assert.equal(await page.locator('[data-reader-docked] [data-superdoc-scroll="dock-att-1"]').count(), 1);
  assert.equal(await nodeB.locator('[data-superdoc-scroll="dock-att-2"]').count(), 1);
  assert.equal(await page.locator('[data-reader-docked] [data-superdoc-scroll="dock-att-2"]').count(), 0);
  assert.ok(await page.evaluate(() => window.__dockSessions.every((session, index) => session.instance === window.__dockInstances[index])));
  check('Clicking document B node header selects B while A stays docked and B stays editable inside its node');

  await nodeB.locator('[data-superdoc-scroll]').click({ position: { x: 180, y: 160 } });
  await page.evaluate(() => window.__dockSessions[1].instance.focus({ preventScroll: true }));
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('CANVAS-EDIT ', { delay: 25 });
  await page.waitForFunction(() => window.__dockSessions[1].element.innerText.includes('CANVAS-EDIT'));
  assert.equal(await page.evaluate(() => window.__ui.getState().readerNodeId), 'dock-node-1');
  assert.equal(await nodeB.locator('[data-superdoc-scroll="dock-att-2"]').count(), 1);
  assert.ok(await page.evaluate(() => !window.__dockSessions[0].element.innerText.includes('CANVAS-EDIT')));
  await page.screenshot({ path: `${output}/canvas-edit-with-docked-reader.png` });
  check('Real keyboard input edits B in the canvas without moving either editor or changing A');

  await nodeB.locator('[data-document-open="dock-att-2"]').click();
  await page.locator('[data-reader-docked] [data-superdoc-scroll="dock-att-2"]').waitFor();
  assert.ok(await page.evaluate(() => window.__dockSessions[1].instance === window.__dockInstances[1]
    && window.__dockSessions[1].element.innerText.includes('CANVAS-EDIT')));
  check('B enters the reader only after its explicit open action, preserving the same edited instance');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors, writes }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: error.stack, checks, errors, writes }, null, 2));
  throw error;
} finally {
  await browser.close();
}
