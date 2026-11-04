// Canvas editing and resize regression. Uses a fresh browser context and no LLM calls.
// Run against Vite; APP_URL and CHROME_PATH can override the local defaults.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const candidates = process.platform === 'win32'
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
const executablePath = process.env.CHROME_PATH ?? candidates.find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/canvas-editing';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
const checks = [];
const writes = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
await context.route('**/api/**', async route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});

const originalQuestion = '如何在画布中编辑问题与回答，并独立调整节点的宽度和高度？';
const originalResponse = `# 画布编辑\n\n${'正文用于验证完整答案始终可以从画布打开并编辑。调整宽度应改变文字换行，调整高度应控制内容的可见范围。'.repeat(12)}\n\n完整回答末尾标记。`;
const summary = '摘要用于快速浏览；编辑入口仍应打开完整回答。';
const node = () => page.locator('.react-flow__node[data-id="canvas-edit"]');
const panel = () => page.locator('[data-focus-panel]');
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const screenshot = name => page.screenshot({ path: `${outputDir}/${name}.png` });
const currentNode = () => page.evaluate(() => window.__store.getState().nodes.find(n => n.id === 'canvas-edit'));
const closePanel = () => page.evaluate(() => window.__ui.getState().setPanelOpen(false));
const setViewport = async zoom => {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 100, y: 100, zoom }, { duration: 0 }), zoom);
  await page.waitForFunction(zoom => {
    const viewport = document.querySelector('.react-flow__viewport');
    return viewport && Math.abs(new DOMMatrix(getComputedStyle(viewport).transform).a - zoom) < 0.001;
  }, zoom);
};
const drag = async (selector, dx, dy) => {
  const handle = node().locator(selector);
  await handle.waitFor({ state: 'visible' });
  const box = await handle.boundingBox();
  assert.ok(box, `Missing resize control ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
};
const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 3, `${message}: ${actual} vs ${expected}`);

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await page.evaluate(({ question, response, summary }) => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__store.getState().setNodes([{ id: 'canvas-edit', type: 'thought', position: { x: 0, y: 0 }, selected: true, data: {
      question, response, responses: [response], responseIndex: 0, summaries: [summary],
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 420, highlights: [], highlightMode: 'tag', attachments: [],
      excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false,
    } }]);
    window.__store.getState().setEdges([]);
    window.__store.getState().setSelectedNodeId('canvas-edit');
    window.__ui.getState().setPanelOpen(true, 'canvas-edit');
  }, { question: originalQuestion, response: originalResponse, summary });
  await node().waitFor({ state: 'visible' });
  await setViewport(1);
  await panel().waitFor({ state: 'visible' });

  const toolbarStyle = await page.locator('[data-top-toolbar]').evaluate(el => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, opacity: s.opacity };
  });
  assert.equal(toolbarStyle.opacity, '1');
  assert.match(toolbarStyle.background, /^rgb\(/, 'Toolbar background has no transparency');
  assert.equal(await panel().locator('[data-response-expand]').count(), 0);
  await node().locator('[data-node-name]').click({ button: 'right' });
  assert.equal(await page.getByText('阅读视图', { exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__store.getState().setSelectedNodeId('canvas-edit');
    window.__ui.getState().setPanelOpen(true, 'canvas-edit');
  });
  await panel().waitFor({ state: 'visible' });
  check('toolbar is opaque and both redundant reading-view entries are absent');

  const fullToggle = node().locator('[data-toggle-full-response]');
  assert.equal(await fullToggle.getAttribute('aria-expanded'), 'false');
  await fullToggle.click();
  assert.equal(await fullToggle.getAttribute('aria-expanded'), 'true');
  assert.match(await node().textContent(), /完整回答末尾标记/);
  await fullToggle.click();
  assert.equal(await fullToggle.getAttribute('aria-expanded'), 'false');
  assert.equal((await currentNode()).data.response, originalResponse);
  check('summary expands to the full response locally without changing stored content');

  await node().locator('[data-edit-response]').click();
  const canvasResponse = node().locator('[data-canvas-response-editor]');
  await canvasResponse.waitFor({ state: 'visible' });
  assert.equal(await canvasResponse.inputValue(), originalResponse);
  await page.waitForTimeout(180);
  assert.ok(await canvasResponse.evaluate(el => el === document.activeElement));
  assert.equal(await panel().locator('textarea[rows="10"]').count(), 0);
  const editedResponse = `${originalResponse}\n\n画布保存后的回答。`;
  await canvasResponse.fill(editedResponse);
  await panel().locator('[data-edit-response]').click();
  const movedResponse = panel().locator('textarea[rows="10"]');
  await movedResponse.waitFor({ state: 'visible' });
  assert.equal(await movedResponse.inputValue(), editedResponse);
  assert.equal(await canvasResponse.count(), 0);
  await node().locator('[data-edit-response]').click();
  await canvasResponse.waitFor({ state: 'visible' });
  assert.equal(await canvasResponse.inputValue(), editedResponse);
  assert.equal(await movedResponse.count(), 0);
  check('unsaved response draft survives switching from canvas to panel and back');
  await screenshot('canvas-response-edit');
  await node().getByRole('button', { name: '保存', exact: true }).click();
  await canvasResponse.waitFor({ state: 'detached' });
  assert.equal((await currentNode()).data.response, editedResponse);
  assert.match(await panel().textContent(), /画布保存后的回答/);
  check('canvas answer editor keeps focus while the panel is open and saves the full answer to both surfaces');

  await node().locator('[data-edit-response]').click();
  await canvasResponse.fill('');
  await panel().locator('[data-edit-response]').click();
  await movedResponse.waitFor({ state: 'visible' });
  assert.equal(await movedResponse.inputValue(), '', 'An intentionally emptied draft stays empty in the panel');
  await node().locator('[data-edit-response]').click();
  await canvasResponse.waitFor({ state: 'visible' });
  assert.equal(await canvasResponse.inputValue(), '', 'An empty draft stays empty when returning to the canvas');
  await node().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await currentNode()).data.response, editedResponse);
  check('empty response drafts survive both editor handoffs and cancelling retains the saved answer');

  await node().locator('[data-edit-question]').click();
  const canvasQuestion = node().locator('[data-canvas-question-editor]');
  await canvasQuestion.waitFor({ state: 'visible' });
  await page.waitForTimeout(180);
  assert.ok(await canvasQuestion.evaluate(el => el === document.activeElement));
  await canvasQuestion.press('End');
  await canvasQuestion.press('Enter');
  await canvasQuestion.pressSequentially('Additional line');
  assert.match(await canvasQuestion.inputValue(), /\nAdditional line$/);
  assert.equal((await currentNode()).data.question, originalQuestion);
  assert.equal((await currentNode()).data.isLoading, false);
  assert.equal(await panel().locator('[data-edit-submit]').count(), 0);
  const revisedQuestion = await canvasQuestion.inputValue();
  await panel().locator('.question-md').dblclick();
  await panel().locator('[data-edit-cancel]').waitFor({ state: 'visible' });
  assert.equal(await panel().locator('textarea').first().inputValue(), revisedQuestion);
  assert.equal(await canvasQuestion.count(), 0);
  await node().locator('[data-edit-question]').click();
  await canvasQuestion.waitFor({ state: 'visible' });
  assert.equal(await canvasQuestion.inputValue(), revisedQuestion);
  assert.equal(await panel().locator('[data-edit-submit]').count(), 0);
  check('unsaved question draft survives switching between canvas and panel');
  await node().locator('[data-edit-cancel]').click();
  assert.equal((await currentNode()).data.question, originalQuestion);
  check('canvas question editing stays focused; Enter adds a line and cancel leaves the question unchanged');

  await panel().locator('[data-edit-response]').click();
  const panelResponse = panel().locator('textarea[rows="10"]');
  await panelResponse.waitFor({ state: 'visible' });
  assert.equal(await panelResponse.inputValue(), editedResponse);
  assert.equal(await canvasResponse.count(), 0);
  const panelEditedResponse = `${editedResponse}\n\n侧栏保存后的回答。`;
  await panelResponse.fill(panelEditedResponse);
  await panel().getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await currentNode()).data.response, panelEditedResponse);
  await panel().locator('.question-md').dblclick();
  const panelQuestion = panel().locator('textarea').filter({ hasNot: page.locator('[data-canvas-question-editor]') }).first();
  await panel().locator('[data-edit-cancel]').waitFor({ state: 'visible' });
  assert.equal(await canvasQuestion.count(), 0);
  assert.equal(await panelQuestion.inputValue(), originalQuestion);
  await panel().locator('[data-edit-cancel]').click();
  check('panel answer and question editors remain independent and never create duplicate canvas editors');

  await node().locator('[data-canvas-rename-button]').click();
  const rename = node().locator('[data-canvas-rename]');
  await rename.fill('可编辑画布节点');
  await rename.press('Enter');
  assert.equal((await currentNode()).data.displayName, '可编辑画布节点');
  assert.match(await node().locator('[data-node-name]').textContent(), /可编辑画布节点/);
  check('canvas title can be renamed and saved');

  await closePanel();
  // Restore the summary only as a fixture so resize tests start from a compact card.
  await page.evaluate(summary => window.__store.setState(s => ({ nodes: s.nodes.map(n => n.id === 'canvas-edit' ? { ...n, data: { ...n.data, summaries: [summary] } } : n) })), summary);
  await setViewport(1);
  await node().locator('[data-toggle-full-response]').waitFor({ state: 'visible' });
  const initialBox = await node().boundingBox();
  const bottomGripBox = await node().locator('.thought-resize-bottom').boundingBox();
  assert.ok(bottomGripBox.x + bottomGripBox.width / 2 > initialBox.x + initialBox.width * 0.65, 'Bottom resize grip stays clear of the central connection handle');
  await drag('.thought-resize-side', 100, 0);
  const horizontal = await currentNode();
  closeTo(horizontal.width, initialBox.width + 100, 'Side grip changes width');
  assert.equal(horizontal.height, undefined, 'Side grip preserves automatic height until explicitly resized');
  const horizontalBox = await node().boundingBox();
  await drag('.thought-resize-bottom', 0, 120);
  const bottomResized = await currentNode();
  closeTo(bottomResized.width, horizontal.width, 'Bottom grip preserves width');
  closeTo(bottomResized.height, horizontalBox.height + 120, 'Bottom grip changes height');
  await drag('.thought-resize-side', -30, 0);
  const vertical = await currentNode();
  closeTo(vertical.width, bottomResized.width - 30, 'Side grip can also narrow a node');
  closeTo(vertical.height, bottomResized.height, 'Side grip preserves an explicitly resized height');
  await drag('.thought-resize-corner', 70, 80);
  const diagonal = await currentNode();
  closeTo(diagonal.width, vertical.width + 70, 'Corner grip changes width');
  closeTo(diagonal.height, vertical.height + 80, 'Corner grip changes height independently');
  await screenshot('resized-canvas');
  check('side, bottom, and corner grips resize independent dimensions without locking the aspect ratio');

  await page.evaluate(() => window.__store.getState().undo());
  const undone = await currentNode();
  closeTo(undone.width, vertical.width, 'Undo restores previous width');
  closeTo(undone.height, vertical.height, 'Undo restores previous height');
  await page.evaluate(() => window.__store.getState().redo());
  const redone = await currentNode();
  closeTo(redone.width, diagonal.width, 'Redo restores width');
  closeTo(redone.height, diagonal.height, 'Redo restores height');
  check('one undo and redo restore exactly one resize gesture');

  await setViewport(0.6);
  await node().locator('[data-thought-natural-height]').waitFor({ state: 'visible' });
  const compactBox = await node().boundingBox();
  assert.ok(compactBox.height / 0.6 < diagonal.height - 100, 'Compact view does not reserve the expanded height');
  closeTo((await currentNode()).height, diagonal.height, 'Compact view retains the saved height');
  await screenshot('compact-canvas');
  await setViewport(1);
  await node().locator('[data-thought-resized]').waitFor({ state: 'visible' });
  closeTo((await node().boundingBox()).height, diagonal.height, 'Zooming in restores the saved height');
  await page.evaluate(() => window.__store.getState().toggleCollapse('canvas-edit'));
  await node().locator('[data-thought-natural-height]').waitFor({ state: 'visible' });
  assert.ok((await node().boundingBox()).height < diagonal.height - 100, 'Collapsed view shrinks naturally');
  await page.evaluate(() => window.__store.getState().toggleCollapse('canvas-edit'));
  await node().locator('[data-thought-resized]').waitFor({ state: 'visible' });
  closeTo((await node().boundingBox()).height, diagonal.height, 'Expanding restores the saved height');
  check('semantic zoom and collapse use natural height while preserving the expanded dimensions');

  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await setViewport(1);
  const restored = await currentNode();
  closeTo(restored.width, diagonal.width, 'Reload preserves width');
  closeTo(restored.height, diagonal.height, 'Reload preserves height');
  assert.equal(restored.data.response, panelEditedResponse);
  assert.equal(restored.data.question, originalQuestion);
  assert.equal(restored.data.displayName, '可编辑画布节点');
  await screenshot('restored-canvas');
  check('dimensions, edited answer, and custom title survive IndexedDB persistence and reload');

  await page.evaluate(() => window.__store.getState().setSelectedNodeId('canvas-edit'));
  await drag('.thought-resize-side', 360 - restored.width, 0);
  await drag('.thought-resize-bottom', 240 - restored.height, 0);
  // The bottom grip moves vertically; the horizontal attempt must leave the height alone.
  closeTo((await currentNode()).height, restored.height, 'Bottom grip ignores horizontal movement');
  await drag('.thought-resize-bottom', 0, 240 - restored.height);
  const minimalBox = await node().boundingBox();
  closeTo(minimalBox.width, 360, 'Minimum width is respected');
  closeTo(minimalBox.height, 240, 'Minimum height is respected');
  await node().locator('[data-toggle-full-response]').click();
  await node().locator('[data-edit-response]').click();
  await canvasResponse.waitFor({ state: 'visible' });
  const bodyOverflow = await node().locator('[data-thought-body]').evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }));
  assert.equal(bodyOverflow.overflowY, 'auto');
  assert.ok(bodyOverflow.scrollHeight > bodyOverflow.height, 'Small node scrolls its content instead of growing');
  await canvasResponse.fill(`${panelEditedResponse}\n\n紧凑节点内保存。`);
  await node().getByRole('button', { name: '保存', exact: true }).scrollIntoViewIfNeeded();
  await screenshot('minimum-size-edit');
  await node().getByRole('button', { name: '保存', exact: true }).click();
  assert.match((await currentNode()).data.response, /紧凑节点内保存/);
  closeTo((await node().boundingBox()).height, 240, 'Saving leaves the chosen height intact');
  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await screenshot('minimum-size-dark');
  check('360 by 240 nodes scroll full answers and editors, keep Save reachable, and retain their dimensions');
  assert.deepEqual(writes, [], 'No LLM or other API writes are triggered');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ appUrl, checks, errors, writes }, null, 2));
  console.log(`CANVAS EDITING UI PASS (${checks.length} checks)`);
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ appUrl, checks, errors, writes, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
