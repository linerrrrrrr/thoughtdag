// Exercise browser auto-scroll and canvas panning in an isolated document session.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const source = await createSuperdocFixture('PAN');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } }));
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const scroll = () => page.locator('[data-superdoc-scroll="pan-att"] .superdoc__sub-document');
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1, `${message}: ${actual} vs ${expected}`);

function pdfFixture() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, stream] of ['BT /F1 18 Tf 42 720 Td (Document pan fixture.) Tj ET', 'BT /F1 18 Tf 42 720 Td (Second page.) Tj ET'].entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${index * 2 + 5} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let raw = '%PDF-1.4\n'; const offsets = [];
  for (const [index, value] of objects.entries()) { offsets.push(Buffer.byteLength(raw)); raw += `${index + 1} 0 obj\n${value}\nendobj\n`; }
  const xref = Buffer.byteLength(raw);
  raw += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(raw).toString('base64');
}

async function setCanvas(zoom) {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 80, y: 40, zoom }, { duration: 0 }), zoom);
  await settle();
  await page.waitForTimeout(700);
  await scroll().evaluate(element => { element.scrollTop = 120; });
  await settle();
}

async function documentPoint() {
  const point = await page.locator('.docx-view-host').evaluate(element => {
    const box = element.getBoundingClientRect();
    const left = Math.max(box.left, 0), right = Math.min(box.right, innerWidth);
    const top = Math.max(box.top, 0), bottom = Math.min(box.bottom, innerHeight);
    const x = left + (right - left) * .6, y = top + (bottom - top) * .5;
    const hit = document.elementFromPoint(x, y);
    return { x, y, inDocument: !!hit?.closest('.docx-engine') };
  });
  assert.ok(point.inDocument, `Pointer must hit the document: ${JSON.stringify(point)}`);
  return point;
}

async function middleDrag(at, dx, dy) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'middle' });
  await page.waitForTimeout(150);
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
  await page.waitForTimeout(400);
  await page.mouse.up({ button: 'middle' });
  await settle();
}

async function stopAutoScroll() {
  await page.keyboard.press('Escape');
  await settle();
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(base64 => {
    const nodes = [{ id: 'pan-node', type: 'thought', position: { x: 100, y: 100 }, width: 740, height: 900, dragHandle: '.drag-handle',
      data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0, highlights: [], highlightMode: 'off', detailLevel: 'full', isLoading: false, isCollapsed: false,
        attachments: [{ id: 'pan-att', name: 'pan.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: base64.length, content: base64, extractedText: 'Pan fixture' }] } }];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState(); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('full');
  }, source.buffer.toString('base64'));
  await page.locator('[data-superdoc-ready="true"] .docx-engine').waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-superdoc-scroll="pan-att"] .superdoc__sub-document');
    return element && element.scrollHeight > element.clientHeight + 200;
  });
  await page.waitForTimeout(600);

  for (const zoom of [.65, 1, 1.5]) {
    await setCanvas(zoom);
    const at = await documentPoint(), before = await viewport(), beforeScroll = await scroll().evaluate(element => element.scrollTop);
    const beforeNode = await page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'pan-node').position);
    await middleDrag(at, 120, 70);
    const after = await viewport();
    assert.deepEqual(after, before, `Document auto-scroll must not pan the canvas at ${zoom}`);
    assert.ok(await scroll().evaluate(element => element.scrollTop) > beforeScroll + 10, `Document must auto-scroll at ${zoom}`);
    assert.deepEqual(await page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'pan-node').position), beforeNode);
    assert.equal(await page.locator('[data-superdoc-editor="pan-att"]').getAttribute('data-superdoc-dirty'), 'false');
    await stopAutoScroll();
    console.log(`PASS middle drag auto-scrolls the document without panning the canvas at ${zoom} zoom`);
  }

  await setCanvas(1);
  const at = await documentPoint(), before = await viewport(), beforeScroll = await scroll().evaluate(element => element.scrollTop);
  await page.mouse.move(at.x, at.y); await page.mouse.click(at.x, at.y, { button: 'middle' });
  await page.mouse.move(at.x + 60, at.y + 90, { steps: 8 }); await page.waitForTimeout(500);
  assert.deepEqual(await viewport(), before, 'A middle click must not move the canvas');
  assert.ok(await scroll().evaluate(element => element.scrollTop) > beforeScroll + 10, 'A middle click must enable native auto-scroll');
  await stopAutoScroll();
  console.log('PASS middle click also enables document auto-scroll without moving the canvas');

  await scroll().evaluate(element => { element.scrollTop = 0; });
  await page.mouse.move(at.x, at.y); await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('[data-superdoc-scroll="pan-att"] .superdoc__sub-document').scrollTop > 20);
  assert.deepEqual(await viewport(), before, 'Ordinary wheel scrolling must not move the canvas');
  console.log('PASS ordinary wheel scrolling still reads the document');

  await setCanvas(1);
  await scroll().evaluate(element => { element.scrollTop = 0; });
  const textRange = await page.evaluate(() => {
    const root = document.querySelector('[data-superdoc-scroll="pan-att"]');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const phrase = 'editable opening paragraph.';
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const offset = text.textContent.indexOf(phrase);
      if (offset < 0) continue;
      const range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + phrase.length);
      const bounds = range.getBoundingClientRect();
      if (bounds.width < 2 || bounds.top < 0 || bounds.bottom > innerHeight) continue;
      const start = range.cloneRange(), end = range.cloneRange(); start.collapse(true); end.collapse(false);
      const a = start.getBoundingClientRect(), b = end.getBoundingClientRect();
      return { phrase, start: { x: a.x + .2, y: a.y + a.height / 2 }, end: { x: b.x - .2, y: b.y + b.height / 2 } };
    }
    return null;
  });
  assert.ok(textRange, 'Visible editable text must be available');
  await page.mouse.move(textRange.start.x, textRange.start.y); await page.mouse.down();
  await page.mouse.move(textRange.end.x, textRange.end.y, { steps: 16 }); await page.mouse.up();
  const selection = () => page.evaluate(() => document.querySelector('[data-superdoc-scroll="pan-att"]').__docxSession.instance.ui.selection.getSnapshot().quotedText);
  const selectedText = await selection();
  assert.ok(selectedText.startsWith('editable') && selectedText.length > 8, 'Left dragging still selects document text');
  await middleDrag(await documentPoint(), 80, 40);
  await stopAutoScroll();
  assert.equal(await selection(), selectedText, 'Middle auto-scroll must preserve the document selection');
  assert.equal(await page.locator('[data-superdoc-editor="pan-att"]').getAttribute('data-superdoc-dirty'), 'false');
  console.log('PASS document text selection survives middle-button auto-scroll');

  await page.evaluate(base64 => {
    const nodes = [{ id: 'pdf-pan-node', type: 'thought', position: { x: 100, y: 100 }, width: 650, height: 700, dragHandle: '.drag-handle',
      data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0, highlights: [], highlightMode: 'off', detailLevel: 'full',
        attachments: [{ id: 'pdf-pan-att', name: 'pan.pdf', type: 'application/pdf', size: base64.length, content: base64, numPages: 2, extractedText: 'PDF pan fixture' }] } }];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__rf.setViewport({ x: 80, y: 40, zoom: 1 }, { duration: 0 });
  }, pdfFixture());
  await page.locator('[data-pdf-document="pdf-pan-att"] [data-page="2"]').waitFor();
  const pdfBody = page.locator('.react-flow__node[data-id="pdf-pan-node"] [data-content-body]');
  await pdfBody.evaluate(element => { element.scrollTop = 120; });
  await settle();
  const pdfPoint = await page.locator('[data-pdf-document="pdf-pan-att"]').evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.left + Math.min(box.width * .6, 350), y = Math.min(box.top + 180, innerHeight - 100);
    return { x, y, inDocument: !!document.elementFromPoint(x, y)?.closest('[data-pdf-document="pdf-pan-att"]') };
  });
  assert.ok(pdfPoint.inDocument, `Pointer must hit the PDF: ${JSON.stringify(pdfPoint)}`);
  const beforePdf = await viewport(), beforePdfScroll = await pdfBody.evaluate(element => element.scrollTop);
  await middleDrag(pdfPoint, 90, 55);
  const afterPdf = await viewport();
  assert.deepEqual(afterPdf, beforePdf, 'PDF auto-scroll must not pan the canvas');
  assert.ok(await pdfBody.evaluate(element => element.scrollTop) > beforePdfScroll + 10, 'PDF must auto-scroll');
  await stopAutoScroll();
  console.log('PASS middle dragging auto-scrolls the PDF without panning the canvas');

  const beforeCanvas = await viewport();
  await middleDrag({ x: 1350, y: 800 }, 100, 60);
  const afterCanvas = await viewport();
  near(afterCanvas.x - beforeCanvas.x, 100, 'Canvas horizontal pan');
  near(afterCanvas.y - beforeCanvas.y, 60, 'Canvas vertical pan');
  near(afterCanvas.zoom, beforeCanvas.zoom, 'Canvas zoom during pan');
  console.log('PASS middle dragging on empty canvas still pans it');

  assert.deepEqual(errors, [], 'No uncaught browser errors');
} finally {
  await page.mouse.up({ button: 'middle' }).catch(() => {});
  await browser.close();
}
