// Real reading-surface regressions, with isolated canvas and network fixtures.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.canvasDetail', 'full');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

async function fixture(id, response) {
  await page.evaluate(({ id, response }) => {
    const data = { question: 'Question', response, responses: [response], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 45, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [],
      includedAttachmentIds: [], roleMode: 'inherit', detailLevel: 'full' };
    const nodes = [{ id, type: 'thought', position: { x: 100, y: 100 }, width: 560, data }];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges: [] }], historyIndex: 0 });
  }, { id, response });
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  const card = page.locator(`.react-flow__node[data-id="${id}"]`);
  const pen = card.locator('[data-highlighter-toggle]');
  await pen.waitFor({ state: 'visible' });
  if (await pen.getAttribute('aria-pressed') === 'true') await pen.click();
  await pen.click();
  const answer = card.locator('[data-conversation-answer]');
  await answer.waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await card.locator('[data-highlighter-toggle]').getAttribute('aria-pressed'), 'true', `${id}: pen enabled`);
  return { card, answer };
}

async function selectText(surface, text) {
  await surface.evaluate((element, selectedText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    const whole = nodes.map(item => item.textContent).join('');
    const start = whole.indexOf(selectedText);
    if (start < 0) throw new Error(`Missing text: ${selectedText}; got ${whole}`);
    const locate = (offset, startPoint = false) => {
      for (const item of nodes) {
        if (offset < item.textContent.length || (!startPoint && offset === item.textContent.length)) return [item, offset];
        offset -= item.textContent.length;
      }
      throw new Error('Invalid selection');
    };
    const range = document.createRange();
    range.setStart(...locate(start, true)); range.setEnd(...locate(start + selectedText.length));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    range.endContainer.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  }, text);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function selectBetween(surface, first, last) {
  const selected = await surface.evaluate((element, { first, last }) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    const start = nodes.find(item => item.textContent.includes(first));
    const end = nodes.find(item => item.textContent.includes(last));
    if (!start || !end) throw new Error('Missing range boundary');
    const range = document.createRange();
    range.setStart(start, start.textContent.indexOf(first));
    range.setEnd(end, end.textContent.indexOf(last) + last.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    end.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    return text;
  }, { first, last });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return selected;
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('full');
  });
  const cases = [
    { id: 'plain', response: '普通文字能够正常划选。', text: '文字能够' },
    { id: 'bold', response: 'Before **important words** after.', text: 'important' },
    { id: 'cross-bold', response: 'Before **important words** after.', text: 'Before important words after' },
    { id: 'link', response: 'Before [linked phrase](https://example.com) after.', text: 'linked', link: true },
    { id: 'cross-link', response: 'Before [linked phrase](https://example.com) after.', text: 'Before linked phrase after', link: true },
    { id: 'entity', response: 'Before A &amp; B after.', text: 'A & B' },
    { id: 'named-entity', response: 'Before A &copy; B after.', text: 'A © B', fallback: true },
    { id: 'escaped-text', response: 'Before A \\* B after.', text: 'A * B', fallback: true },
    { id: 'raw-html', response: 'Before <em>raw text</em> after.', text: 'Before raw text after', fallback: true },
    { id: 'inline-code', response: 'Before `inline code` after.', text: 'inline' },
    { id: 'list', response: '- First item\n- Second item', text: 'First item\nSecond item' },
  ];
  for (const test of cases) {
    const { answer } = await fixture('shared', test.response);
    const before = await answer.textContent();
    await selectText(answer, test.text);
    const expectedText = test.text.replace(/\s+/g, ' ').trim();
    const result = await page.evaluate(async ({ id, source }) => {
      const node = window.__store.getState().nodes.find(item => item.id === id);
      const { highlightFoundIn, pruneHighlights } = await import('/src/lib/highlight-match.ts');
      const { referenceBlockContent } = await import('/src/store/context-builder.ts');
      return { highlights: node.data.highlights, found: highlightFoundIn(source, node.data.highlights[0]?.text ?? ''),
        retained: pruneHighlights(node.data.highlights, source).length,
        context: referenceBlockContent({ source: node, edge: { id: 'ref', source: id, target: 'target' } }) };
    }, { id: 'shared', source: test.response });
    assert.deepEqual(result.highlights.map(item => item.text), [expectedText], `${test.id}: selection saved`);
    const visible = (await answer.locator('mark.highlight-mark').allTextContents()).join('');
    assert.equal(visible.replace(/\s+/g, ''), expectedText.replace(/\s+/g, ''), `${test.id}: selection visible`);
    assert.equal(await answer.textContent(), before, `${test.id}: original rendered text preserved`);
    assert.equal(result.found, true, `${test.id}: source match`);
    assert.equal(result.retained, 1, `${test.id}: retained after editing`);
    assert.match(result.context, /\[Important\].*\[\/Important\]/s, `${test.id}: tagged for downstream context`);
    if (test.fallback) assert.ok(result.context.includes(`[Important] ${expectedText} [/Important]`), `${test.id}: exact passage reaches context`);
    if (test.link) assert.equal(await answer.locator('a').getAttribute('href'), 'https://example.com');
  }
  console.log(`PASS ${cases.length} formatted text cases preserve rendering, saved marks and downstream tagging`);

  for (const test of [
    { id: 'table', response: '| First cell | Second cell |\n| --- | --- |\n| A | B |', first: 'First cell', last: 'Second cell', visible: 'FirstcellSecondcell' },
    { id: 'cross-code', response: 'Before text\n\n```js\nconst answer = 42;\n```\n\nAfter text', first: 'Before text', last: 'After text', visible: 'BeforetextAftertext' },
  ]) {
    const { answer } = await fixture('shared', test.response);
    const before = await answer.textContent();
    const selected = await selectBetween(answer, test.first, test.last);
    const result = await page.evaluate(async ({ id, source }) => {
      const node = window.__store.getState().nodes.find(item => item.id === id);
      const { highlightFoundIn } = await import('/src/lib/highlight-match.ts');
      return { saved: node.data.highlights.map(item => item.text), found: highlightFoundIn(source, node.data.highlights[0]?.text ?? '') };
    }, { id: 'shared', source: test.response });
    assert.deepEqual(result.saved, [selected]);
    assert.equal(result.found, true, `${test.id}: source match`);
    assert.equal((await answer.locator('mark.highlight-mark').allTextContents()).join('').replace(/\s+/g, ''), test.visible);
    assert.equal(await answer.locator('pre mark.highlight-mark').count(), 0);
    assert.equal(await answer.textContent(), before, `${test.id}: original rendering preserved`);
  }
  console.log('PASS cross-cell and cross-code selections preserve table and code rendering');

  const { card, answer } = await fixture('mouse-link', 'Before [linked phrase](https://example.com) after.');
  await page.waitForTimeout(300);
  assert.equal(await answer.locator('a').evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  const drag = await answer.locator('a').evaluate(element => {
    const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 6);
    const rect = range.getBoundingClientRect(); return { x1: rect.left + 1, x2: rect.right - 1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(drag.x1, drag.y); await page.mouse.down();
  await page.mouse.move(drag.x2, drag.y, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction(() => window.__store.getState().nodes.find(node => node.id === 'mouse-link').data.highlights.length === 1);
  assert.equal(await answer.locator('a mark.highlight-mark').textContent(), 'linked');
  assert.equal(await card.locator('[data-highlighter-toggle]').getAttribute('aria-pressed'), 'true');
  await mkdir('local-tests/highlighter', { recursive: true });
  await page.screenshot({ path: 'local-tests/highlighter/markdown-link.png' });
  await card.locator('[data-highlighter-toggle]').click();
  assert.notEqual(await answer.locator('a').evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log('PASS mouse drag starts inside a link and normal link interaction returns when the pen closes');
} finally {
  await browser.close();
}
