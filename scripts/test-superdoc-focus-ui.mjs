// Exercise the native DOCX caret with real pointer and keyboard events.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';

const sources = await Promise.all(['FOCUS-A', 'FOCUS-B'].map(createSuperdocFixture));
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

const engine = index => page.locator(`[data-superdoc-scroll="focus-att-${index}"]`);
async function expectCaret(index, visibility, message) {
  await page.waitForFunction(({ index, visibility }) => {
    const element = document.querySelector(`[data-superdoc-scroll="focus-att-${index}"] [data-v2-local-selection-caret="true"]`);
    const style = element && getComputedStyle(element);
    const visible = !!style && style.display !== 'none' && style.visibility === 'visible';
    return visibility === 'visible' ? visible : !visible;
  }, { index, visibility }, { timeout: 5000 }).catch(() => { throw new Error(message ?? `Document ${index} caret should be ${visibility}.`); });
}
const snapshot = index => page.evaluate(index => {
  const session = document.querySelector(`[data-superdoc-scroll="focus-att-${index}"]`).__docxSession;
  return {
    focused: session.element.matches(':focus-within'),
    selection: session.instance.ui.selection.getSnapshot(),
    text: session.element.innerText,
    version: session.instance.ui.document.getVersion(),
    dirty: session.dirty,
    revision: session.revision,
  };
}, index);
async function emptyCanvasPoint() {
  return page.evaluate(() => {
    const isPane = (x, y) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane');
    for (let y = 320; y < innerHeight - 150; y += 80) {
      for (let x = innerWidth - 180; x > 120; x -= 80) {
        if (isPane(x, y) && isPane(x + 100, y) && isPane(x, y + 70) && isPane(x + 100, y + 70)) return { x, y };
      }
    }
    const hits = {};
    for (let y = 200; y < innerHeight - 100; y += 150) for (let x = 100; x < innerWidth - 100; x += 150) {
      const hit = document.elementFromPoint(x, y);
      const label = `${hit?.tagName}.${String(hit?.className).slice(0, 80)}`;
      hits[label] = (hits[label] ?? 0) + 1;
    }
    throw new Error(`No empty canvas area is available for the pointer gesture: ${JSON.stringify(hits)}`);
  });
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5198', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(buffers => {
    const nodes = buffers.map((content, index) => ({
      id: `focus-node-${index + 1}`, type: 'thought', position: { x: 100 + index * 800, y: 100 },
      width: 740, height: 900, dragHandle: '.drag-handle',
      data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0,
        tokenCount: 0, highlights: [], highlightMode: 'off', detailLevel: 'full', isLoading: false, isCollapsed: false,
        attachments: [{ id: `focus-att-${index + 1}`, name: `focus-${index + 1}.docx`,
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: content.length, content, extractedText: `FOCUS-${index + 1}` }] },
    }));
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('full');
  }, sources.map(source => source.buffer.toString('base64')));
  await page.locator('[data-superdoc-editor][data-superdoc-ready="true"]').nth(1).waitFor({ timeout: 45000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__rf.setViewport({ x: 80, y: 30, zoom: 0.85 }, { duration: 0 });
    window.__focusSessions = [1, 2].map(index => document.querySelector(`[data-superdoc-scroll="focus-att-${index}"]`).__docxSession);
    window.__focusInstances = window.__focusSessions.map(session => session.instance);
  });

  await engine(1).getByText('FOCUS-A original document', { exact: true }).first().click();
  await page.locator('[data-docx-toolbar]').waitFor();
  await page.locator('.react-flow__node[data-id="focus-node-1"] .material-header .material-label').click();
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 1, 'Clicking within the same node must keep the toolbar.');
  await engine(1).getByText('FOCUS-A original document', { exact: true }).first().click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('UNSAVED ');
  await page.waitForFunction(() => {
    const session = window.__focusSessions[0];
    const segment = session.instance.ui.selection.getSnapshot().target?.segments?.[0];
    return session.dirty && session.element.innerText.includes('UNSAVED') && segment?.range.start === 8;
  });
  const before = await snapshot(1);
  assert.equal(before.focused, true);
  await expectCaret(1, 'visible', 'The active document must show its insertion caret.');
  assert.ok(before.text.includes('UNSAVED'));
  await page.locator('[data-docx-toolbar]').waitFor();

  const click = await emptyCanvasPoint();
  await page.mouse.click(click.x, click.y);
  const afterClick = await snapshot(1);
  assert.equal(afterClick.focused, false, 'Clicking empty canvas must move focus out of the document.');
  await expectCaret(1, 'hidden', 'A document that lost focus must not show an insertion caret.');
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0, 'Clicking outside the document node must close its toolbar.');
  assert.deepEqual(afterClick.selection.target, before.selection.target, 'Clicking the canvas must preserve the document selection.');
  assert.equal(afterClick.version, before.version);
  assert.ok(afterClick.text.includes('UNSAVED'));
  assert.equal(afterClick.dirty, true);
  assert.equal(afterClick.revision, before.revision, 'Leaving the editor must not save its draft.');

  await engine(1).getByText('editable opening paragraph.', { exact: false }).first().click();
  await expectCaret(1, 'visible', 'Returning to the document must restore the caret.');
  await page.locator('[data-docx-toolbar]').waitFor();
  const beforeMarquee = await snapshot(1);
  const marquee = await emptyCanvasPoint();
  await page.mouse.move(marquee.x, marquee.y); await page.mouse.down();
  await page.mouse.move(marquee.x + 100, marquee.y + 70, { steps: 10 }); await page.mouse.up();
  const afterMarquee = await snapshot(1);
  assert.equal(afterMarquee.focused, false);
  await expectCaret(1, 'hidden', 'Drawing a canvas selection must hide the document caret.');
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0, 'Canvas marquee must close the toolbar.');
  assert.deepEqual(afterMarquee.selection.target, beforeMarquee.selection.target);
  assert.equal(afterMarquee.version, before.version);

  await engine(1).getByText('editable opening paragraph.', { exact: false }).first().click();
  await expectCaret(1, 'visible');
  const phrase = 'UNSAVED';
  await page.keyboard.press('Control+Home');
  for (let index = 0; index < phrase.length; index++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForFunction(phrase => window.__focusSessions[0].instance.ui.selection.getSnapshot().quotedText === phrase, phrase);
  const drag = await emptyCanvasPoint();
  await page.mouse.move(drag.x, drag.y); await page.mouse.down();
  await page.mouse.move(drag.x + 100, drag.y + 70, { steps: 10 }); await page.mouse.up();
  const afterDrag = await snapshot(1);
  assert.equal(afterDrag.focused, false);
  await expectCaret(1, 'hidden');
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0);
  assert.equal(afterDrag.selection.quotedText, phrase, 'Canvas marquee must preserve the selected document text.');
  assert.equal(afterDrag.version, before.version);
  assert.ok(afterDrag.text.includes('UNSAVED'));
  assert.equal(afterDrag.dirty, true);

  await page.evaluate(() => window.__focusSessions[0].instance.focus({ preventScroll: true, restoreSelection: true }));
  await page.locator('[data-docx-toolbar]').waitFor();
  await page.locator('[data-docx-command="bold"]').click();
  await page.waitForFunction(() => window.__focusSessions[0].element.matches(':focus-within'));
  assert.equal((await snapshot(1)).selection.quotedText, phrase, 'Toolbar actions must restore the retained selection.');
  await page.keyboard.press('ArrowRight');
  await expectCaret(1, 'visible');
  await page.locator('[data-docx-insert-table]').click();
  await page.locator('[data-docx-command-panel="table"] input').first().focus();
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 1, 'The insertion panel belongs to the toolbar boundary.');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-docx-command-panel]').count(), 0, 'Escape first closes the insertion panel.');
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 1);

  await page.locator('.react-flow__node[data-id="focus-node-2"] .material-header .material-label').click();
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0, 'Clicking another node must close the previous toolbar.');
  assert.equal(await page.evaluate(() => window.__store.getState().selectedNodeId), 'focus-node-2', 'The outside click must still select its target.');

  await engine(2).getByText('FOCUS-B original document', { exact: true }).first().click();
  await expectCaret(1, 'hidden', 'Only the focused document may show a caret.');
  await expectCaret(2, 'visible');
  assert.equal(await page.locator('[data-docx-toolbar] .native-document-toolbar-name').textContent(), 'focus-2.docx');
  await engine(1).getByText('UNSAVED', { exact: false }).first().click();
  assert.equal(await page.locator('[data-docx-toolbar] .native-document-toolbar-name').textContent(), 'focus-1.docx');
  await engine(2).getByText('FOCUS-B original document', { exact: true }).first().click();
  assert.equal(await page.locator('[data-docx-toolbar] .native-document-toolbar-name').textContent(), 'focus-2.docx', 'Switching documents must immediately activate the new toolbar.');
  await page.locator('[data-docx-font]').focus();
  assert.equal((await snapshot(2)).focused, false);
  await expectCaret(2, 'hidden', 'Keyboard focus in the toolbar is outside the document.');
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 1, 'The toolbar remains usable as part of the editing boundary.');

  await page.locator('[data-layout-entry]').click();
  await page.locator('[data-canvas-layout-panel]').waitFor();
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0);
  await engine(2).getByText('FOCUS-B original document', { exact: true }).first().click();
  await page.locator('[data-docx-toolbar]').waitFor();
  await page.locator('#canvas-layout-title').click();
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0, 'A separate non-modal work panel must not shield outside clicks.');
  assert.equal(await page.locator('[data-canvas-layout-panel]').count(), 1);

  await page.evaluate(() => {
    const ui = window.__ui.getState();
    ui.setReaderMode('dock');
    ui.setReaderNodeId('focus-node-1', { attachmentId: 'focus-att-1' });
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-superdoc-editor="focus-att-1"]').length === 2);
  await engine(1).getByText('UNSAVED', { exact: false }).first().click();
  await expectCaret(1, 'visible');
  const readerClick = await emptyCanvasPoint();
  await page.mouse.click(readerClick.x, readerClick.y);
  await expectCaret(1, 'hidden', 'The same focus rule applies in the docked reader.');
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0, 'Canvas clicks close the docked document toolbar.');
  assert.equal(await page.locator('[data-material-reader]').count(), 1, 'Canvas clicks must leave the reader open.');
  assert.equal((await snapshot(1)).dirty, true);
  await page.locator('[data-reader-expand]').click();
  await page.locator('[data-material-reader] [role="dialog"][aria-modal="true"]').waitFor();
  await engine(1).getByText('UNSAVED', { exact: false }).first().click();
  await page.locator('[data-docx-toolbar]').waitFor();
  await page.locator('[data-reader-material-picker] button').first().click();
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0, 'Outside clicks in the expanded reader close its toolbar.');
  assert.equal(await page.locator('[data-material-reader] [role="dialog"][aria-modal="true"]').count(), 1);
  assert.ok(await page.locator('[data-reader-material-picker] button').count() > 1, 'The outside click must still open the material picker.');
  assert.equal(await page.evaluate(() => window.__focusSessions.every((session, index) => session.instance === window.__focusInstances[index])), true);
  assert.deepEqual(writes, [], 'Focus changes must not invoke write APIs.');
  assert.deepEqual(errors, [], 'The browser must not report uncaught errors.');
  console.log('PASS DOCX caret and toolbar follow canvas clicks, marquee, document switches and reader focus; drafts and selections remain intact.');
} finally {
  await context.close();
  await browser.close();
}
