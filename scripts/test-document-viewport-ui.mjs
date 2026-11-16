// Isolated document fixtures exercise canvas panning at the viewport edge.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5180';
const storageCheck = await fetch(new URL('/__thoughtdag_storage', appUrl), { headers: { 'x-thoughtdag-storage': '1' } });
if (storageCheck.headers.get('content-type')?.includes('application/json')) {
  const service = await storageCheck.json();
  assert.notEqual(service.service, 'thoughtdag-local-storage', 'Start the test server with THOUGHTDAG_DISK_STORAGE=0.');
}
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [], consoleErrors = [], writes = [];
await mkdir('local-tests/document-viewport', { recursive: true });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/__thoughtdag_storage', route => route.fulfill({ status: 404, body: '' }));
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  performance.setResourceTimingBufferSize(5000);
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

function pdfFixture() {
  const stream = 'BT /F1 18 Tf 42 720 Td (Viewport PDF fixture.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let raw = '%PDF-1.4\n'; const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(raw)); raw += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(raw);
  raw += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(raw).toString('base64');
}

const docx = await createSuperdocFixture('VIEWPORT');
const baseData = { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0,
  tokenCount: 0, highlights: [], highlightMode: 'off', detailLevel: 'full', isLoading: false, isCollapsed: false };
const nodes = [
  { id: 'viewport-pdf', type: 'thought', position: { x: 100, y: 80 }, width: 570, height: 720, dragHandle: '.drag-handle',
    data: { ...baseData, attachments: [{ id: 'viewport-pdf-att', name: '边缘.pdf', type: 'application/pdf', content: pdfFixture(), size: 800 }] } },
  { id: 'viewport-docx', type: 'thought', position: { x: 800, y: 80 }, width: 570, height: 720, dragHandle: '.drag-handle',
    data: { ...baseData, attachments: [{ id: 'viewport-docx-att', name: '边缘.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: docx.buffer.toString('base64'), size: docx.buffer.length }] } },
];

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(nodes => {
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState(); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('full');
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
  }, nodes);
  await page.locator('[data-pdf-document="viewport-pdf-att"] .tdag-textlayer span').first().waitFor();
  await page.locator('[data-superdoc-editor="viewport-docx-att"][data-superdoc-ready="true"]').waitFor();
  await page.waitForTimeout(900);
  await page.evaluate(async () => {
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
    const cacheUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => /\/src\/lib\/pdf-document-cache\.ts(?:\?|$)/.test(name));
    if (!cacheUrl) throw new Error('The mounted PDF cache module URL is unavailable.');
    window.__pdfCache = await import(cacheUrl);
    const attachment = window.__store.getState().nodes.find(node => node.id === 'viewport-pdf').data.attachments[0];
    window.__pdfKey = window.__pdfCache.pdfDocumentKey(window.__projects.getState().activeId, 'viewport-pdf', attachment.id);
    window.__pdfAttachment = attachment;
    window.__pdfResource = window.__pdfCache.peekPdfDocument(window.__pdfKey, attachment);
    if (!window.__pdfResource) throw new Error(`No active PDF resource for ${window.__pdfKey}`);
    window.__pdfDocument = window.__pdfResource.document;
    window.__docxSession = document.querySelector('[data-superdoc-scroll="viewport-docx-att"]').__docxSession;
    window.__docxInstance = window.__docxSession.instance;
    const host = window.__docxSession.owner;
    const rect = host.getBoundingClientRect.bind(host);
    window.__hostRectReads = 0;
    host.getBoundingClientRect = () => { window.__hostRectReads++; return rect(); };
  });
  await page.waitForFunction(() => window.__pdfResource.pages.has(1));
  await page.evaluate(() => { window.__pdfPageSnapshot = window.__pdfResource.pages.get(1); });
  const pdfBody = page.locator('.react-flow__node[data-id="viewport-pdf"] [data-content-body]');
  const pdfScroll = await pdfBody.evaluate(element => { element.scrollTop = 120; return element.scrollTop; });
  assert.ok(pdfScroll > 20, 'The PDF fixture must have a scrollable reading position.');
  await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__hostRectReads = 0; });
  for (let step = 0; step < 16; step++) {
    await page.evaluate(step => window.__rf.setViewport({ x: -step * 8, y: 0, zoom: 1 }, { duration: 0 }), step);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(150);
  const reads = await page.evaluate(() => window.__hostRectReads);
  console.log('DOCX host geometry reads during translation:', reads);

  for (let step = 0; step < 8; step++) {
    await page.evaluate(step => window.__rf.setViewport({ x: step % 2 ? -660 : -680, y: 0, zoom: 1 }, { duration: 0 }), step);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.__rf.setViewport({ x: -650, y: 0, zoom: 1 }, { duration: 0 }));
  await page.locator('[data-pdf-document="viewport-pdf-att"] .tdag-textlayer span').first().waitFor();
  const pdfIdentity = await page.evaluate(() => {
    const resource = window.__pdfCache.peekPdfDocument(window.__pdfKey, window.__pdfAttachment);
    return { document: resource?.document === window.__pdfDocument, page: resource?.pages.get(1) === window.__pdfPageSnapshot };
  });
  console.log('PDF identities after edge crossings:', pdfIdentity);
  assert.ok(pdfIdentity.document && pdfIdentity.page, 'Returning to the edge must reuse the parsed PDF and rendered page.');
  await page.waitForFunction(expected => Math.abs(document.querySelector('.react-flow__node[data-id="viewport-pdf"] [data-content-body]')?.scrollTop - expected) < 2, pdfScroll);
  assert.ok(reads <= 2, `A translation should not repeatedly remeasure the DOCX host (${reads} reads).`);
  assert.equal(await page.evaluate(() => window.__docxSession.instance === window.__docxInstance), true);

  const beforeDrag = await page.evaluate(() => window.__rf.getViewport());
  await page.mouse.move(1350, 400); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(1150, 400, { steps: 20 }); await page.mouse.up({ button: 'middle' });
  const afterDrag = await page.evaluate(() => window.__rf.getViewport());
  assert.ok(afterDrag.x < beforeDrag.x - 150, 'A real middle-button drag must pan the canvas.');
  await page.mouse.move(1150, 400); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(1350, 400, { steps: 20 }); await page.mouse.up({ button: 'middle' });
  await page.locator('[data-pdf-document="viewport-pdf-att"] .tdag-textlayer span').first().waitFor();
  assert.equal(await page.evaluate(() => window.__pdfCache.peekPdfDocument(window.__pdfKey, window.__pdfAttachment)?.document === window.__pdfDocument), true);

  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  await page.locator('[data-superdoc-scroll="viewport-docx-att"]').click({ position: { x: 180, y: 120 } });
  await page.evaluate(() => window.__docxSession.instance.focus({ preventScroll: true }));
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('EDGE-DRAFT ');
  await page.waitForFunction(() => window.__docxSession.dirty && window.__docxSession.element.innerText.includes('EDGE-DRAFT'));
  for (let step = 0; step < 6; step++) {
    await page.evaluate(step => window.__rf.setViewport({ x: step % 2 ? 680 : 720, y: 0, zoom: 1 }, { duration: 0 }), step);
    await page.waitForTimeout(100);
  }
  await page.locator('[data-superdoc-editor="viewport-docx-att"][data-superdoc-ready="true"]').waitFor();
  await page.evaluate(() => window.__rf.setViewport({ x: 500, y: 0, zoom: 1 }, { duration: 0 }));
  await page.waitForFunction(() => window.__docxSession.element.innerText.includes('EDGE-DRAFT'), null, { timeout: 8000 });
  const draftState = await page.evaluate(() => ({ sameInstance: window.__docxSession.instance === window.__docxInstance,
    dirty: window.__docxSession.dirty, hasText: window.__docxSession.element.innerText.includes('EDGE-DRAFT'),
    connected: window.__docxSession.element.isConnected, hosts: window.__docxSession.hosts.size,
    current: document.querySelector('[data-superdoc-scroll="viewport-docx-att"]')?.__docxSession === window.__docxSession }));
  console.log('DOCX draft after edge crossings:', draftState);
  assert.ok(draftState.sameInstance && draftState.dirty && draftState.hasText && draftState.current,
    'DOCX draft and undo session survive edge crossings.');
  await page.screenshot({ path: 'local-tests/document-viewport/partially-visible.png' });

  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  await pdfBody.evaluate(element => { element.scrollTop = 0; });
  await page.locator('[data-pdf-document="viewport-pdf-att"] [data-pdf-mode="highlight"]').click();
  const span = page.locator('[data-pdf-document="viewport-pdf-att"] [data-page="1"] .tdag-textlayer span').first();
  const box = await span.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction(() => (window.__store.getState().nodes.find(node => node.id === 'viewport-pdf').data.attachments[0].pdfAnnotations ?? []).length === 1);
  console.log('PASS real canvas dragging, PDF scroll and highlighting, and the unsaved DOCX draft survive edge crossings');

  const limits = await page.evaluate(async () => {
    const entries = [];
    for (let index = 0; index < 5; index++) {
      const key = window.__pdfCache.pdfDocumentKey('cache-fixture', `node-${index}`, 'fixture');
      const resource = window.__pdfCache.acquirePdfDocument(key, window.__pdfAttachment);
      await resource.promise;
      window.__pdfCache.releasePdfDocument(resource);
      entries.push({ key, resource });
    }
    const last = entries.at(-1).resource;
    for (let index = 1; index <= 4; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1200;
      window.__pdfCache.cachePdfPage(last, index, { width: 600, pixelRatio: 2, scale: 1, ratio: 1,
        hasText: true, canvas, textLayer: document.createElement('div') });
    }
    return {
      oldestEvicted: !window.__pdfCache.peekPdfDocument(entries[0].key, window.__pdfAttachment),
      recentRetained: entries.slice(1).every(entry => window.__pdfCache.peekPdfDocument(entry.key, window.__pdfAttachment)),
      activeRetained: window.__pdfCache.peekPdfDocument(window.__pdfKey, window.__pdfAttachment)?.document === window.__pdfDocument,
      pagePixels: [...last.pages.values()].reduce((sum, page) => sum + page.canvas.width * page.canvas.height, 0),
      oldestPageEvicted: !last.pages.has(1),
    };
  });
  assert.ok(limits.oldestEvicted && limits.recentRetained && limits.activeRetained && limits.oldestPageEvicted && limits.pagePixels <= 4_000_000,
    `PDF cache must bound idle documents and page pixels without evicting an active document: ${JSON.stringify(limits)}`);
  console.log('PASS idle documents and cached page pixels are bounded');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log('PASS document views survive viewport-edge panning without unnecessary reload or geometry work');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Console errors:', consoleErrors);
  console.error('Page text:', await page.locator('body').innerText().catch(() => '<unavailable>'));
  throw error;
} finally {
  await browser.close();
}
