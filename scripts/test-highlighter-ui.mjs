// The highlighter is an explicit, persistent tool. All data and API calls here are isolated fixtures.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { initNodePickerFixture } from './fixtures/node-picker.mjs';

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
await page.route('**/__thoughtdag_storage**', route => route.fulfill({ status: 404 }));
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(initNodePickerFixture);
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.canvasDetail', 'full');
});
const output = 'local-tests/highlighter';
await mkdir(output, { recursive: true });
const check = name => { checks.push(name); console.log('PASS', name); };
const card = page.locator('.react-flow__node[data-id="highlight-answer"]');
const panel = page.locator('[data-focus-panel]');
const reader = page.locator('[data-material-reader]');
const toggle = surface => surface.locator('[data-highlighter-toggle]');
const highlightSection = surface => surface.locator('[data-node-highlights]');
const disclosure = surface => highlightSection(surface).locator('[data-highlight-disclosure]');
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
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated(),
    undefined, { timeout: 60000 });
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('full');
    const response = 'Alpha evidence matters. 第一段用于连续划选。\n\nBeta finding stays visible. 第二段保留阅读节奏。\n\n```js\nconst codeOnly = 42;\n```';
    const instruction = { id: 'followup', kind: 'user', sourceType: 'userMessage', status: 'completed',
      text: '请补充 **回归验证**。', startedAt: 1 };
    const base = { responses: [response, `${response}\n\nVersion two.`], response, responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 45, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [],
      includedAttachmentIds: [], roleMode: 'inherit', detailLevel: 'full' };
    const nodes = [
      { id: 'highlight-answer', type: 'thought', position: { x: 100, y: 135 }, width: 560,
        data: { ...base, displayName: '荧光笔交互验收', question: '如何保留阅读中的重点？请核对 **Version two**。\n\n' + instruction.text,
          agentActivities: [[instruction], [instruction]] } },
      { id: 'highlight-material', type: 'thought', position: { x: 950, y: 150 },
        data: { ...base, response: '', responses: [], question: 'Material passage one.\n\nMaterial passage two.', stepKind: 'note' } },
      { id: 'highlight-rail', type: 'thought', position: { x: 950, y: 600 },
        data: { ...base, response: 'Rail answer to mark.', responses: ['Rail answer to mark.'], question: 'A reading question'} },
    ];
    const edges = [{ id: 'material-rail', source: 'highlight-material', target: 'highlight-rail' }];
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
  });
  await card.waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  const answer = card.locator('[data-conversation-answer]');
  await toggle(card).waitFor();
  assert.equal(await highlightSection(card).count(), 1);
  assert.equal(await highlightSection(card).locator('[data-highlighter-toggle]').count(), 1);
  assert.equal(await card.locator('.conversation-actions [data-highlighter-toggle]').count(), 0);
  assert.equal(await disclosure(card).getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle(card).evaluate(element => element.closest('[data-highlight-disclosure]') === null), true,
    'The highlighter is an independent action, not nested inside the disclosure button');
  const beforeEmptyDisclosure = await page.evaluate(() => ({
    highlights: window.__store.getState().nodes.find(node => node.id === 'highlight-answer').data.highlights,
    historyIndex: window.__store.getState().historyIndex,
  }));
  await disclosure(card).click();
  assert.equal(await disclosure(card).getAttribute('aria-expanded'), 'true');
  assert.equal(await highlightSection(card).locator('[data-highlight-list]').isVisible(), true);
  assert.deepEqual(await highlightSection(card).locator('.node-highlight-modes button').allTextContents(),
    ['仅供阅读', '标注重点', '仅传高亮']);
  assert.equal(await highlightSection(card).locator('p').count(), 0, 'The empty teaching prompt is removed');
  await disclosure(card).click();
  assert.equal(await highlightSection(card).locator('[data-highlight-list]').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => ({
    highlights: window.__store.getState().nodes.find(node => node.id === 'highlight-answer').data.highlights,
    historyIndex: window.__store.getState().historyIndex,
  })), beforeEmptyDisclosure);
  check('a dedicated collapsed highlights section owns the pen even when empty and disclosure never writes data');
  assert.equal(await toggle(card).getAttribute('aria-pressed'), 'false');
  await selectText(answer, 'Alpha evidence matters.');
  assert.equal(await count('highlight-answer'), 0);
  assert.equal(await answer.getByRole('button', { name: '高亮', exact: true }).count(), 0);
  assert.equal(await card.getByRole('button', { name: '探索', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), 'Alpha evidence matters.');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.length), 3);
  check('ordinary selection stays available for copying without exploration actions or new nodes');

  // Selection opens its inspector after a delay; let that outer layer mount
  // before activating the pen whose Escape behavior this fixture exercises.
  await page.locator('[data-selection-properties]').waitFor();
  await disclosure(card).click();
  await highlightSection(card).getByRole('button', { name: '仅供阅读', exact: true }).click();
  await disclosure(card).click();
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

  const beforeFold = await marks('highlight-answer');
  await disclosure(card).click();
  assert.equal(await disclosure(card).getAttribute('aria-expanded'), 'true');
  for (const mark of beforeFold) {
    assert.equal(await highlightSection(card).locator('[data-highlight-list]').getByText(mark.text, { exact: true }).count(), 1);
    assert.equal(await card.getByText(mark.text, { exact: true }).count(), 2,
      'The passage appears once in the highlight list and once in the answer, without a duplicate chip');
  }
  for (const [label, mode] of [['标注重点', 'tag'], ['仅传高亮', 'filter'], ['仅供阅读', 'off']]) {
    const button = highlightSection(card).getByRole('button', { name: label, exact: true });
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await highlightSection(card).locator('.node-highlight-modes [aria-pressed="true"]').count(), 1);
    assert.equal(await page.evaluate(() => window.__store.getState().nodes.find(n => n.id === 'highlight-answer').data.highlightMode), mode);
    assert.deepEqual(await marks('highlight-answer'), beforeFold);
    assert.equal(await answer.locator('mark.highlight-mark').count(), 2);
  }
  await page.evaluate(() => window.__store.getState().undo());
  await settle();
  assert.equal(await highlightSection(card).getByRole('button', { name: '仅传高亮', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => window.__store.getState().redo());
  await settle();
  assert.equal(await highlightSection(card).getByRole('button', { name: '仅供阅读', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${output}/reading-only-node-light-zh.png` });
  check('all three modes preserve visible marks, reading-only is selectable before marking, and mode changes are undoable');
  await disclosure(card).click();
  assert.equal(await toggle(card).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await marks('highlight-answer'), beforeFold);
  assert.equal(await highlightSection(card).locator('[data-highlight-list]').isVisible(), false);
  check('collapsing saved highlights preserves the active pen and stored passages without duplicate chips');

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
  // Undo the mode choices before the last saved passage.
  for (let step = 0; step < 3; step++) await page.evaluate(() => window.__store.getState().undo());
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

  const question = card.locator('.conversation-user-message');
  const sharedText = 'Version two';
  const visibleMarks = surface => surface.locator('mark.highlight-mark').allTextContents();
  const countBeforeQuestion = await count('highlight-answer');
  await toggle(card).click();
  const questionDrag = await question.locator('strong').evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return { start: rect.left + 0.2, end: rect.right - 0.2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.move(questionDrag.start, questionDrag.y);
  await page.mouse.down();
  await page.mouse.move(questionDrag.end, questionDrag.y, { steps: 12 });
  await page.mouse.up();
  await settle();
  assert.deepEqual(await visibleMarks(question), [sharedText], 'A mouse drag marks the formatted instruction text');
  assert.ok(!(await visibleMarks(answer)).includes(sharedText));
  await selectText(question, sharedText);
  assert.equal(await count('highlight-answer'), countBeforeQuestion + 1);
  const activity = card.locator('[data-agent-activity]');
  const supplementary = activity.locator('.activity-user-message');
  await activity.locator('[data-activity-user-summary]').waitFor();
  await selectText(supplementary, '回归验证');
  await activity.locator('[data-activity-history]').click();
  assert.deepEqual(await visibleMarks(supplementary), ['回归验证']);
  await selectText(supplementary, '请补充');
  await activity.locator('[data-activity-history]').click();
  assert.deepEqual(await visibleMarks(supplementary), ['请补充', '回归验证']);
  assert.equal(await count('highlight-answer'), countBeforeQuestion + 3);
  await toggle(card).click();
  check('canvas marks the user question with a mouse and preserves supplementary instruction marks across history disclosure');

  await card.locator('[data-node-details]').click();
  await panel.waitFor();
  await page.evaluate(async () => {
    (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('en');
    (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    window.__ui.setState({ panelWidth: 380 });
  });
  const panelAnswer = panel.locator('.focus-assistant-message');
  assert.equal(await highlightSection(panel).count(), 1);
  assert.equal(await highlightSection(panel).locator('[data-highlighter-toggle]').count(), 1);
  assert.equal(await panel.locator('.focus-response-actions [data-highlighter-toggle], .conversation-actions [data-highlighter-toggle]').count(), 0);
  assert.equal(await disclosure(panel).getAttribute('aria-expanded'), 'false');
  await selectText(panelAnswer, '第二段保留阅读节奏。');
  assert.equal(await panel.getByRole('button', { name: 'Explore', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '第二段保留阅读节奏。');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.length), 3);
  await toggle(panel).click();
  const panelQuestion = panel.locator('[data-conversation-user-message]');
  assert.deepEqual(await visibleMarks(panelQuestion), [sharedText]);
  assert.deepEqual(await visibleMarks(panel.locator('.activity-user-message')), ['请补充', '回归验证']);
  await selectText(panelQuestion, '阅读中的重点');
  await selectText(panelAnswer, sharedText);
  await selectText(panelAnswer, sharedText);
  assert.deepEqual(await visibleMarks(question), ['阅读中的重点', sharedText]);
  assert.ok((await visibleMarks(answer)).includes(sharedText));
  assert.equal(await count('highlight-answer'), countBeforeQuestion + 5);
  check('panel question marks sync to the card and identical question and answer passages are marked independently');
  await selectText(panelAnswer, '第二段保留阅读节奏。');
  assert.ok((await marks('highlight-answer')).some(h => h.text === '第二段保留阅读节奏。'));
  assert.equal(await toggle(panel).getAttribute('aria-pressed'), 'true');
  const panelMarks = await marks('highlight-answer');
  await disclosure(panel).click();
  assert.equal(await highlightSection(panel).locator('[data-highlight-list]').isVisible(), true);
  assert.deepEqual(await highlightSection(panel).locator('.node-highlight-modes button').allTextContents(),
    ['Reading only', 'Tag important', 'Highlights only']);
  assert.equal(await highlightSection(panel).getByRole('button', { name: 'Reading only', exact: true }).getAttribute('aria-pressed'), 'true');
  await highlightSection(panel).getByRole('button', { name: 'Tag important', exact: true }).click();
  await highlightSection(panel).getByRole('button', { name: 'Reading only', exact: true }).click();
  assert.deepEqual(await marks('highlight-answer'), panelMarks);
  assert.deepEqual(await visibleMarks(panelAnswer), await visibleMarks(answer));
  assert.equal(await highlightSection(panel).evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  await page.screenshot({ path: `${output}/reading-only-panel-dark-en.png` });
  await disclosure(panel).click();
  assert.equal(await toggle(panel).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await marks('highlight-answer'), panelMarks);
  await page.screenshot({ path: `${output}/panel-dark-en.png` });
  await page.keyboard.press('Escape');
  assert.equal(await toggle(panel).getAttribute('aria-pressed'), 'false');
  assert.equal(await panel.count(), 1, 'Escape exits the tool before closing the reading panel');
  assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  check('narrow dark English details share the tool and Escape preserves the panel');

  const instruction = panelMarks.find(mark => mark.source === 'question' && mark.text === '回归验证');
  await card.locator(`[data-overview-ruler-mark="ruler/text//${instruction.id}/0"]`).press('Enter');
  assert.equal(await panel.locator('.activity-user-message').evaluate(element => {
    const highlight = CSS.highlights.get('ruler-destination');
    return highlight && [...highlight].some(range => element.contains(range.startContainer));
  }), true, 'The ruler jumps to the supplementary instruction in the open panel');
  await page.evaluate(() => window.__store.getState().navigateVersion('highlight-answer', 'prev'));
  await settle();
  assert.ok((await visibleMarks(panelQuestion)).includes(sharedText));
  assert.ok(!(await marks('highlight-answer')).some(mark => !mark.source && mark.text === sharedText));
  check('the ruler locates the instruction, and switching answer versions preserves matching question marks');

  await page.evaluate(async () => {
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setReaderMode('full');
    window.__ui.getState().setReaderNodeId('highlight-material', { threadId: 'highlight-rail' });
    (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('zh');
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
  const railQuestion = reader.locator('[data-turn-question="highlight-rail"]');
  await selectText(railQuestion, 'reading question');
  assert.deepEqual(await visibleMarks(railQuestion), ['reading question']);
  assert.deepEqual(await visibleMarks(rail), ['Rail answer to mark.']);
  assert.equal(await count('highlight-rail'), 2);
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
  if (errors.length) console.error('Browser errors:', errors);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
