// Both reading surfaces use the same answer actions. Clipboard outcomes are isolated from the OS.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { openSettingsSection } from './fixtures/canvas-model-picker.mjs';

const app = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const output = 'local-tests/response-actions';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, locale: 'zh-CN', reducedMotion: 'reduce' });
await context.routeWebSocket(/.*/, socket => socket.close());
const writes = [];
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], items: [] } });
});
await context.addInitScript(origin => {
  if (window.top !== window || location.origin !== origin) return;
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  window.clipboardFixture = { mode: 'ok' };
  Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text) {
    const fixture = window.clipboardFixture;
    if (fixture.mode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
    if (fixture.mode === 'pending') await new Promise(resolve => { fixture.finish = resolve; });
    fixture.written = text;
  } } });
}, new URL(app).origin);

const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
context.on('weberror', error => errors.push(error.error().message));
const node = page.locator('.react-flow__node[data-id="answers"]');
const card = node.locator('.conversation-actions');
const panel = page.locator('.focus-response-actions');
const question = '有哪些**备选方案**？';
const answers = [Array.from({ length: 24 }, (_, i) => `第 ${i + 1} 段。滚动长回答时仍可操作节点底栏。`).join('\n\n'), '第二版回答', '第三版回答'];
const mode = value => page.evaluate(value => { window.clipboardFixture.mode = value; }, value);
try {
  await page.goto(app, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui, undefined, { timeout: 60000 });
  await page.evaluate(({ answers, question }) => {
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setPanelWidth(380);
    const nodes = [{ id: 'answers', type: 'thought', dragHandle: '.drag-handle', width: 380, height: 400,
      position: { x: 0, y: 0 }, data: { question, response: answers[0], responses: answers,
        responseIndex: 0, generatedAts: answers.map(() => '2026-11-20T02:00:00Z'),
        detailLevel: 'full', isCollapsed: false, isLoading: false, tokenCount: 10, highlights: [],
        highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit' } }];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  }, { answers, question });
  await card.waitFor();
  // Let the initial fit of the new fixture finish before measuring screen coordinates.
  await page.waitForTimeout(550);
  await page.evaluate(() => window.__rf.setViewport({ x: 100, y: 180, zoom: .9 }, { duration: 0 }));

  const bubble = node.locator('.conversation-user-message');
  const editQuestion = node.getByRole('button', { name: '编辑问题', exact: true });
  const copyQuestion = node.getByRole('button', { name: '复制问题', exact: true });
  const [bubbleBox, editBox, copyBox] = await Promise.all([bubble, editQuestion, copyQuestion].map(el => el.boundingBox()));
  assert.ok(editBox && copyBox && bubbleBox);
  assert.ok(editBox.y >= bubbleBox.y + bubbleBox.height - 1 && Math.abs(editBox.y - copyBox.y) < 1,
    'Question actions share a row below the bubble');
  assert.ok(copyBox.x >= editBox.x + editBox.width - 1 && Math.abs(copyBox.x + copyBox.width - bubbleBox.x - bubbleBox.width) <= 12,
    'Edit and copy sit together at the right edge of the question');
  const dividerBox = await node.locator('[data-conversation-divider]').boundingBox();
  assert.ok(copyBox.y + copyBox.height <= dividerBox.y + 1, 'The full question action row fits above the divider');
  assert.doesNotMatch(await copyQuestion.locator('..').innerText(), /\d{1,2}:\d{2}/);
  await node.screenshot({ path: `${output}/node-question-actions.png` });
  await copyQuestion.click();
  assert.equal(await page.evaluate(() => window.clipboardFixture.written), question, 'Copy preserves the question Markdown');
  await editQuestion.click();
  assert.equal(await node.locator('[data-canvas-question-editor]').inputValue(), question);
  await node.locator('[data-edit-cancel]').click();
  console.log('PASS The question bubble has right-aligned edit and copy actions without a timestamp');

  const copy = card.getByRole('button', { name: '复制回答' });
  const pager = card.getByRole('group', { name: '回答版本' });
  const scroll = node.locator('[data-conversation-split-answer]');
  const lastLine = scroll.locator('[data-conversation-answer] p').last();
  await lastLine.waitFor({ state: 'attached' });
  assert.equal(await card.evaluate(el => !!el.closest('[data-conversation-split-answer]')), false, 'Answer actions belong outside the scrolling answer');
  const fixed = await card.boundingBox();
  const assertFooter = async () => {
    const rect = await card.boundingBox();
    assert.ok(Math.abs(rect.y - fixed.y) < 1, `Footer moved from ${fixed.y} to ${rect.y} while scrolling`);
    assert.ok(await card.getByRole('button').evaluateAll(buttons => buttons.every(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })), 'Every footer action is directly clickable without scrolling the answer');
  };
  await assertFooter();
  await scroll.hover();
  await page.mouse.wheel(0, 180);
  await page.waitForFunction(() => document.querySelector('[data-conversation-split-answer]').scrollTop > 0);
  await assertFooter();
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  assert.ok(await scroll.evaluate(el => el.scrollTop > 0 && el.scrollTop + el.clientHeight < el.scrollHeight));
  await assertFooter();
  const readingPosition = await scroll.evaluate(el => el.scrollTop);
  await copy.click();
  assert.equal(await page.evaluate(() => window.clipboardFixture.written), answers[0]);
  assert.equal(await scroll.evaluate(el => el.scrollTop), readingPosition, 'Copy preserves the reading position');
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await assertFooter();
  const lastLineBounds = () => lastLine.evaluate(p => {
    const range = document.createRange();
    range.selectNodeContents(p);
    const line = Array.from(range.getClientRects()).at(-1);
    const pane = p.closest('[data-conversation-split-answer]');
    const rect = pane.getBoundingClientRect();
    return { top: line.top, bottom: line.bottom, paneTop: rect.top, paneBottom: rect.bottom,
      scrollTop: pane.scrollTop, height: pane.clientHeight, content: pane.scrollHeight };
  });
  const end = await lastLineBounds();
  await node.screenshot({ path: `${output}/node-fixed-footer.png` });
  assert.ok(end.top >= end.paneTop - 1 && end.bottom <= end.paneBottom + 1 && end.paneBottom <= fixed.y + 1, JSON.stringify({ end, footer: fixed }));
  console.log('PASS The node footer is reachable at the beginning, middle and end of a long answer');
  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['answers'], { width: 360, height: 240 }));
  await page.waitForFunction(() => document.querySelector('.conversation-node')?.offsetHeight === 240);
  const compact = await node.evaluate(el => {
    const area = el.querySelector('[data-conversation-split-answer]');
    const footer = el.querySelector('[data-node-response-footer]');
    return { answer: area.clientHeight, cardBottom: el.getBoundingClientRect().bottom, footerBottom: footer.getBoundingClientRect().bottom };
  });
  assert.ok(compact.answer > 0 && compact.footerBottom <= compact.cardBottom, JSON.stringify(compact));
  const compactQuestion = node.locator('[data-conversation-split-question]');
  await compactQuestion.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const clickVisibleQuestionAction = async button => {
    const point = await button.evaluate(el => {
      const target = el.getBoundingClientRect();
      const pane = el.closest('[data-conversation-split-question]').getBoundingClientRect();
      const x = (target.left + target.right) / 2;
      const y = (Math.max(target.top, pane.top) + Math.min(target.bottom, pane.bottom)) / 2;
      return el.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    });
    assert.ok(point, 'Scrolling to the end of the compact question exposes a clickable button');
    await page.mouse.click(point.x, point.y);
  };
  await node.screenshot({ path: `${output}/node-compact-question-actions.png` });
  await clickVisibleQuestionAction(copyQuestion);
  assert.equal(await page.evaluate(() => window.clipboardFixture.written), question);
  await clickVisibleQuestionAction(editQuestion);
  assert.equal(await node.locator('[data-canvas-question-editor]').inputValue(), question);
  await node.locator('[data-canvas-question-editor]').press('Escape');
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const compactEnd = await lastLineBounds();
  assert.ok(compactEnd.top >= compactEnd.paneTop - 1 && compactEnd.bottom <= compactEnd.paneBottom + 1, JSON.stringify(compactEnd));
  await mode('denied');
  await copy.click();
  const smallManual = card.getByRole('textbox');
  await smallManual.waitFor();
  const fallbackVisible = await smallManual.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  });
  assert.ok(fallbackVisible, 'Manual copy stays reachable on a minimum-size node');
  await node.screenshot({ path: `${output}/node-compact-manual-copy.png` });
  await smallManual.press('Escape');
  await mode('ok');
  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['answers'], { width: 380, height: 400 }));
  await pager.getByRole('button', { name: '上一个回答版本' }).click();
  assert.equal(await pager.innerText(), 'v3/3');
  await pager.getByRole('button', { name: '下一个回答版本' }).click();
  assert.equal(await pager.innerText(), 'v1/3');
  assert.equal(await pager.getByRole('button').count(), 2, 'Delete is outside the navigation group');
  const targets = await pager.getByRole('button').evaluateAll(buttons => buttons.map(b => [b.offsetWidth, b.offsetHeight]));
  assert.ok(targets.every(([w, h]) => w >= 32 && h >= 32));
  await copy.scrollIntoViewIfNeeded();
  assert.equal(await copy.innerText(), '', 'The response copy button shows only its icon');
  const before = await copy.boundingBox();
  await copy.click();
  await card.getByRole('status').getByText('已复制').waitFor();
  assert.equal(await copy.innerText(), '', 'Copy success feedback stays icon-only');
  assert.equal(await page.evaluate(() => window.clipboardFixture.written), answers[0]);
  assert.equal((await copy.boundingBox()).width, before.width);
  await card.screenshot({ path: `${output}/canvas-copied.png` });
  assert.equal(await page.locator('[data-toaster]').getByText('已复制到剪贴板').count(), 0);
  await card.getByRole('status').getByText('已复制').waitFor({ state: 'detached' });
  console.log('PASS Canvas version wraparound, larger targets and stable inline copy feedback');

  await mode('pending');
  await copy.click();
  await pager.getByRole('button', { name: '下一个回答版本' }).click();
  await page.evaluate(() => window.clipboardFixture.finish());
  assert.equal(await card.getByRole('status').textContent(), '', 'A late completion belongs only to its original answer');
  await node.locator('[data-node-details]').click();
  await panel.waitFor();
  await openSettingsSection(page, 'general');
  const settings = page.locator('[data-settings-panel]');
  await settings.locator('[data-appearance-lighting]').getByRole('button', { name: '暗', exact: true }).click();
  await page.keyboard.press('Escape');
  await node.screenshot({ path: `${output}/node-question-actions-dark.png` });
  await openSettingsSection(page, 'general');
  await settings.locator('[data-menu-language]').getByRole('button', { name: 'English' }).click();
  await page.keyboard.press('Escape');
  const englishPager = card.getByRole('group', { name: 'Response versions' });
  await mode('denied');
  const readerCopy = panel.getByRole('button', { name: 'Copy response' });
  await readerCopy.click();
  const manual = panel.getByRole('textbox', { name: 'Copy the selected response manually' });
  assert.equal(await manual.inputValue(), answers[1]);
  assert.ok(await manual.evaluate(el => el.readOnly && document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length));
  assert.equal(await panel.getByRole('status').textContent(), '');
  await panel.screenshot({ path: `${output}/reader-manual-copy-dark.png` });
  await manual.press('Escape');
  await manual.waitFor({ state: 'detached' });
  assert.ok(await readerCopy.evaluate(el => el === document.activeElement));
  await mode('ok');
  await readerCopy.click();
  await panel.getByRole('status').getByText('Copied').waitFor();
  assert.equal(await page.evaluate(() => window.clipboardFixture.written), answers[1]);
  await panel.getByRole('button', { name: 'Next response version' }).click();
  assert.equal(await englishPager.innerText(), 'v3/3');
  assert.equal(await panel.getByRole('status').textContent(), '');
  assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  console.log('PASS A denied copy selects the current answer, Escape restores focus and stale writes cannot mark a new version');

  const hash = await page.evaluate(async () => {
    const { buildViewerLink } = await import('/src/lib/viewer.ts');
    return new URL(await buildViewerLink(window.__store.getState().nodes, [])).hash;
  });
  await panel.getByRole('button', { name: 'Delete response version' }).click();
  assert.equal(await englishPager.innerText(), 'v2/2');
  const viewer = await context.newPage();
  await viewer.goto(new URL(hash, app).href);
  const shared = viewer.locator('.conversation-actions');
  const sharedNode = viewer.locator('.react-flow__node[data-id="answers"]');
  await sharedNode.getByRole('button', { name: 'Copy question', exact: true }).click();
  assert.equal(await viewer.evaluate(() => window.clipboardFixture.written), question);
  assert.equal(await sharedNode.locator('[data-edit-question]').count(), 0);
  await shared.getByRole('button', { name: 'Next response version' }).click();
  assert.equal(await shared.getByRole('group').innerText(), 'v1/3');
  assert.equal(await shared.getByRole('button', { name: 'Delete response version' }).count(), 0);
  await shared.getByRole('button', { name: 'Copy response' }).click();
  await shared.getByRole('status').getByText('Copied').waitFor();
  assert.equal(await viewer.evaluate(() => window.clipboardFixture.written), answers[0]);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  console.log('PASS The shared viewer can browse and copy versions, and only the editable canvas can delete');
} finally {
  await browser.close();
}
