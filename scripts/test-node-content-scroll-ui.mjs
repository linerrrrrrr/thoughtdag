// Scroll long content in real canvas cards and keep its controls on screen.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';

const url = process.env.APP_URL ?? 'http://127.0.0.1:5193';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/__thoughtdag_storage**', route => route.abort());
await context.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], items: [] } }));
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const card = page.locator('.react-flow__node[data-id="scroll-test"]');
const prose = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n');
const pdf = await PDFDocument.create();
for (const line of ['First page', 'Last page']) pdf.addPage().drawText(line);
const docx = await createSuperdocFixture('SCROLL');

async function seed(stepKind, data, { paradigm = false, height = 260 } = {}) {
  await page.evaluate(({ stepKind, data, paradigm, height }) => {
    const projects = window.__projects.getState();
    window.__projects.setState({ projects: projects.projects.map(project => project.id === projects.activeId
      ? { ...project, kind: paradigm ? 'paradigm' : 'chat' } : project) });
    const nodes = [{ id: 'scroll-test', type: 'thought', position: { x: 200, y: 160 }, width: 500, ...(height == null ? {} : { height }),
      dragHandle: '.drag-handle', data: { stepKind, detailLevel: 'full', displayName: 'Scroll fixture',
        response: '', responses: [], question: '', responseIndex: 0, tokenCount: 20,
        highlights: [], highlightMode: 'off', attachments: [], ...data } }];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  }, { stepKind, data, paradigm, height });
  await card.locator(paradigm ? '[data-node-paradigm]' : `.material-${stepKind}`).waitFor();
}

async function checkScroll(label, content, fixed) {
  await content.waitFor();
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await settle();
  // Walk from the actual content. A second overflowing ancestor would put
  // part of the card chrome behind another, competing scrollbar.
  const scroller = await content.evaluateHandle(start => {
    const owners = [];
    const dimensions = [];
    for (let el = start; el && !el.classList.contains('react-flow__node'); el = el.parentElement) {
      dimensions.push([el.tagName, el.className, el.clientHeight, el.scrollHeight, getComputedStyle(el).overflowY]);
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 2) owners.push(el);
    }
    if (owners.length !== 1) throw new Error(`Expected one vertical scroll owner: ${JSON.stringify(dimensions)}`);
    return owners[0];
  });
  await scroller.evaluate(el => { el.scrollTop = 0; });
  const chrome = await Promise.all(fixed.map(async locator => {
    const rect = await locator.boundingBox();
    assert.ok(rect && rect.height > 0, `${label}: missing fixed element`);
    assert.equal(await locator.evaluate((el, owner) => owner.contains(el), scroller), false, `${label}: fixed element inside scrollbar`);
    const bounds = await card.boundingBox();
    assert.ok(rect.y >= bounds.y - 1 && rect.y + rect.height <= bounds.y + bounds.height + 1,
      `${label}: fixed element outside card ${JSON.stringify({ rect, bounds })}`);
    return rect;
  }));
  const area = await scroller.boundingBox();
  assert.ok(area && area.height > 5, `${label}: reading area collapsed`);
  const bounds = await card.boundingBox();
  assert.ok(area.y >= bounds.y - 1 && area.y + area.height <= bounds.y + bounds.height + 1, `${label}: reading area outside card`);
  for (const rect of chrome) {
    assert.ok(rect.y + rect.height <= area.y + 1 || area.y + area.height <= rect.y + 1,
      `${label}: fixed element overlaps the reading area`);
  }
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(el => el.scrollTop > 0, scroller);
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await settle();
  const remaining = await scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
  assert.ok(remaining < 2, `${label}: failed to reach the end (${remaining})`);
  for (const [i, locator] of fixed.entries()) {
    const rect = await locator.boundingBox();
    assert.ok(rect && Math.abs(rect.y - chrome[i].y) < 1 && Math.abs(rect.height - chrome[i].height) < 1,
      `${label}: fixed element moved from ${chrome[i].y} to ${rect?.y}`);
  }
  await scroller.dispose();
  console.log('PASS', label);
}

const material = () => [card.locator('.material-header'), card.locator('[data-node-name]')];
const file = () => [...material(), card.locator('[data-file-header]')];
const attachment = (name, type, content) => ({ id: name, name, type, content, size: content.length });
async function checkNaturalHeight(cap) {
  const dimensions = await card.evaluate(root => ({
    content: root.querySelector('.material-content').offsetHeight,
    card: root.offsetHeight,
    header: root.querySelector('.material-header').offsetHeight,
    savedHeight: window.__store.getState().nodes[0].height,
  }));
  assert.equal(dimensions.savedHeight, undefined);
  assert.ok(Math.abs(dimensions.content - cap) <= 1 && Math.abs(dimensions.card - dimensions.header - cap) <= 2,
    `Natural card must stay within its ${cap}px reading budget: ${JSON.stringify(dimensions)}`);
}
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__projects?.getState().activeId);
  await page.evaluate(() => {
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false);
  });
  await seed('note', { question: prose, recallSource: { runner: 'local', kind: 'memory', title: 'Source', file: 'source.md', turn: 1 } });
  // The first mounted node triggers the application's initial animated fit.
  await page.waitForFunction(() => window.__store.getState().nodes[0]?.measured?.height);
  await page.waitForTimeout(600);
  await checkScroll('Note and citation source', card.locator('.markdown-body p').first(), [...material(), card.locator('[data-recall-source]')]);
  await seed('note', { question: prose }, { height: 120 });
  await card.locator('[data-note-edit]').click();
  const noteEditor = card.locator('[data-note-editor]');
  await checkScroll('Note editor at minimum height', noteEditor.locator('textarea'),
    [...material(), noteEditor.getByRole('button', { name: '保存' }), noteEditor.getByRole('button', { name: '取消' })]);
  await noteEditor.getByRole('button', { name: '取消' }).click();

  await seed('link', { question: prose, linkTitle: 'Snapshot title', linkUrl: 'https://example.org', linkFetchedAt: '2026-11-01' });
  await checkScroll('Link title and capture date', card.locator('[data-content-body]'),
    [...material(), card.getByText('Snapshot title', { exact: true }), card.getByText(/2026-11-01/)]);

  await seed('file', { attachments: [attachment('Fixture.txt', 'text/plain', prose)] });
  await checkScroll('Plain text', card.locator('[data-file-text-preview]'), file());
  const pair = ['First.txt', 'Second.txt'].map(name => attachment(name, 'text/plain', prose));
  await seed('file', { attachments: pair }, { height: 180 });
  for (const item of pair) {
    await checkScroll(`Multiple attachments: ${item.name}`, card.locator(`[data-file-text-preview="${item.id}"]`),
      [...material(), ...pair.map(header => card.locator(`[data-file-header="${header.id}"]`))]);
  }

  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 800;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await seed('file', { attachments: [{ ...attachment('Fixture.png', 'image/png', image), extractedText: prose }] });
  await checkScroll('Image and extraction action', card.locator('img'), [...file(), card.locator('[data-extract-toggle]')]);
  await card.locator('[data-extract-toggle]').click();
  const extraction = card.locator('[data-extraction-editor]');
  await checkScroll('Extraction editor actions', extraction.locator('textarea'), [...file(), extraction.getByRole('button', { name: '保存' })]);
  await extraction.getByRole('button', { name: '取消' }).click();

  await seed('file', { attachments: [attachment('Legacy.docx', 'text/plain', prose)] });
  await checkScroll('Legacy DOCX', card.locator('[data-document-rich-body]'), file());

  const pdfFile = attachment('Fixture.pdf', 'application/pdf', Buffer.from(await pdf.save()).toString('base64'));
  await seed('file', { attachments: [pdfFile] }, { height: 120 });
  await checkScroll('PDF pages, modes and save action', card.locator('[data-pdf-page]').first(),
    [...file(), card.locator('.pdf-document-toolbar'), card.locator('[data-pdf-save]')]);

  await seed('file', { attachments: [attachment('Fixture.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx.buffer.toString('base64'))] },
    { height: 420 });
  await card.locator('[data-superdoc-ready="true"]').waitFor();
  await checkScroll('Native DOCX', card.locator('[data-superdoc-scroll] .superdoc__sub-document'), [...file(), card.locator('[data-superdoc-export]')]);

  for (const kind of ['prompt', 'human']) {
    await seed(kind, { question: 'Step title', instruction: prose }, { paradigm: true, height: 185 });
    const controls = [card.locator('.drag-handle'), card.locator('input[type=text]')];
    if (kind === 'prompt') controls.push(card.getByRole('button', { pressed: false }).last());
    await checkScroll(`Paradigm ${kind} step`, card.locator('textarea'), controls);
  }
  await seed('note', { question: prose }, { height: null });
  await checkScroll('Automatic note height', card.locator('.markdown-body p').first(), material());
  await checkNaturalHeight(400);
  await seed('file', { attachments: [pdfFile] }, { height: null });
  await checkScroll('Automatic PDF height', card.locator('[data-pdf-page]').first(), [...file(), card.locator('.pdf-document-toolbar')]);
  await checkNaturalHeight(520);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
