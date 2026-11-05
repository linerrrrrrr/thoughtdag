// The highlighter is an explicit, persistent tool. All data and API calls here are isolated fixtures.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, locale: 'zh-CN', reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.canvasDetail', 'full');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const output = 'local-tests/highlighter';
await mkdir(output, { recursive: true });
const check = name => { checks.push(name); console.log('PASS', name); };
const card = page.locator('.react-flow__node[data-id="highlight-answer"]');
const panel = page.locator('[data-focus-panel]');
const reader = page.locator('[data-material-reader]');
const toggle = surface => surface.locator('[data-highlighter-toggle]');
const marks = id => page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data.highlights, id);
const count = async id => (await marks(id)).length;
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const clearSelection = () => page.evaluate(() => window.getSelection()?.removeAllRanges());
// Select rendered text across any nested inline markup, then release within its owning surface.
async function selectText(surface, text) {
  await surface.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    const whole = nodes.map(node => node.textContent).join('');
    const start = whole.indexOf(text);
    if (start < 0) throw new Error(`Missing selection text: ${text}`);
    const locate = (offset, startPoint = false) => {
      for (const node of nodes) {
        if (offset < node.textContent.length || (!startPoint && offset === node.textContent.length)) return [node, offset];
        offset -= node.textContent.length;
      }
      throw new Error('Selection endpoint is outside fixture');
    };
    const range = document.createRange();
    range.setStart(...locate(start, true)); range.setEnd(...locate(start + text.length));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const target = range.endContainer.parentElement;
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  }, text);
  await settle();
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('full');
    const response = 'Alpha evidence matters. 第一段用于连续划选。\n\nBeta finding stays visible. 第二段保留阅读节奏。\n\n```js\nconst codeOnly = 42;\n```';
    const base = { responses: [response, `${response}\n\nVersion two.`], response, responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 45, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [],
      includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, detailLevel: 'full' };
    const nodes = [
      { id: 'highlight-answer', type: 'thought', position: { x: 100, y: 135 }, width: 560,
        data: { ...base, displayName: '荧光笔交互验收', question: '如何保留阅读中的重点？' } },
      { id: 'highlight-material', type: 'thought', position: { x: 950, y: 150 },
        data: { ...base, response: '', responses: [], question: 'Material passage one.\n\nMaterial passage two.', stepKind: 'note' } },
      { id: 'highlight-rail', type: 'thought', position: { x: 950, y: 600 },
        data: { ...base, response: 'Rail answer to mark.', responses: ['Rail answer to mark.'], question: 'A reading question', isRoot: false } },
    ];
    const edges = [{ id: 'material-rail', source: 'highlight-material', target: 'highlight-rail' }];
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
  });
  await card.waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  const answer = card.locator('[data-conversation-answer]');
  await toggle(card).waitFor();
  assert.equal(await toggle(card).getAttribute('aria-pressed'), 'false');
  await selectText(answer, 'Alpha evidence matters.');
  assert.equal(await count('highlight-answer'), 0);
  assert.equal(await card.getByRole('button', { name: '高亮', exact: true }).count(), 0);
  assert.equal(await card.getByRole('button', { name: '探索', exact: true }).count(), 1);
  check('ordinary selection retains Explore and has no legacy highlight action');

  await toggle(card).click();
  assert.equal(await toggle(card).getAttribute('aria-pressed'), 'true');
  assert.equal(await card.getByRole('button', { name: '探索', exact: true }).count(), 0);
  const drag = await answer.evaluate(element => {
    const text = element.querySelector('p').firstChild;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 'Alpha evidence matters.'.length);
    const rect = range.getBoundingClientRect();
    return { x1: rect.left, x2: rect.right, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(drag.x1 + 0.2, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.x2, drag.y, { steps: 12 });
  await page.mouse.up();
  await settle();
  assert.deepEqual((await marks('highlight-answer')).map(h => h.text), ['Alpha evidence matters.']);
  assert.equal(await toggle(card).getAttribute('aria-pressed'), 'true');
  await selectText(answer, 'Beta finding stays visible.');
  assert.equal(await count('highlight-answer'), 2);
  assert.equal(await answer.locator('mark.highlight-mark').count(), 2);
  await selectText(answer, 'Alpha evidence matters.');
  assert.equal(await count('highlight-answer'), 2);
  await selectText(answer, 'const codeOnly = 42;');
  assert.equal(await count('highlight-answer'), 2);
  check('enabled tool marks consecutive passages, stays active, and skips duplicates and fenced code');

  await clearSelection();
  await card.evaluate(element => {
    const start = element.querySelector('[data-conversation-question]').lastChild;
    const end = element.querySelector('[data-conversation-answer] p').firstChild;
    const range = document.createRange();
    range.setStart(start, 0); range.setEnd(end, 1);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    end.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await settle();
  assert.equal(await count('highlight-answer'), 2);
  await clearSelection();
  await page.screenshot({ path: `${output}/node-light-zh.png` });
  await page.keyboard.press('Escape');
  assert.equal(await toggle(card).getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => window.__store.getState().undo());
  assert.equal(await count('highlight-answer'), 1);
  check('cross-boundary selections do not write; Escape exits the tool and highlights remain undoable');

  await toggle(card).click();
  await card.locator('[data-edit-response]').click();
  await card.locator('[data-canvas-response-editor]').waitFor();
  await page.keyboard.press('Escape');
  await toggle(card).waitFor();
  assert.equal(await toggle(card).getAttribute('aria-pressed'), 'false');
  await toggle(card).click();
  await page.evaluate(() => window.__store.getState().navigateVersion('highlight-answer', 'next'));
  await settle();
  assert.equal(await toggle(card).getAttribute('aria-pressed'), 'false');
  check('editing and switching answer versions exit the highlighter');

  await card.locator('[data-node-details]').click();
  await panel.waitFor();
  await page.evaluate(async () => {
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('en');
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    window.__ui.setState({ panelWidth: 380 });
  });
  await toggle(panel).click();
  const panelAnswer = panel.locator('.focus-assistant-message');
  await selectText(panelAnswer, '第二段保留阅读节奏。');
  assert.ok((await marks('highlight-answer')).some(h => h.text === '第二段保留阅读节奏。'));
  assert.equal(await toggle(panel).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${output}/panel-dark-en.png` });
  await page.keyboard.press('Escape');
  assert.equal(await toggle(panel).getAttribute('aria-pressed'), 'false');
  assert.equal(await panel.count(), 1, 'Escape exits the tool before closing the reading panel');
  assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  check('narrow dark English details share the tool and Escape preserves the panel');

  await page.evaluate(async () => {
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setReaderMode('full');
    window.__ui.getState().setReaderNodeId('highlight-material', { threadId: 'highlight-rail' });
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('zh');
  });
  await reader.waitFor();
  const materialToggle = toggle(reader).first();
  await materialToggle.click();
  const material = reader.locator('[data-reader-highlight-surface]');
  await selectText(material, 'Material passage one.');
  assert.equal(await count('highlight-material'), 1);
  assert.equal(await material.locator('mark.highlight-mark').count(), 1);
  const rail = reader.locator('[data-turn-answer="highlight-rail"]');
  await rail.waitFor();
  await reader.locator('[data-reader-rail] [data-highlighter-toggle]').click();
  await selectText(rail, 'Rail answer to mark.');
  assert.equal(await count('highlight-rail'), 1);
  assert.equal(await count('highlight-material'), 1);
  assert.equal(await reader.locator('[data-reader-askbar]').count(), 0);
  assert.equal(await reader.locator('[data-reader-highlight]').count(), 0);
  await page.screenshot({ path: `${output}/material-light-zh.png` });
  await page.keyboard.press('Escape');
  assert.equal(await reader.locator('[data-reader-rail] [data-highlighter-toggle]').getAttribute('aria-pressed'), 'false');
  assert.equal(await reader.count(), 1);
  check('material and rail highlights write to their own nodes; Escape leaves the reader open');

  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  console.log(`PASS ${checks.length} highlighter checks; screenshots in ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
