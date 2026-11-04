// Wheel routing and manual detail regression. Isolated browser storage; no model calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/canvas-detail';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], writes = [], checks = [];
page.on('pageerror', (error) => errors.push(error.message));
await context.route('**/api/**', (route) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 0.001, `${message}: ${a} != ${b}`);
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const node = (id = 'detail-thought') => page.locator(`.react-flow__node[data-id="${id}"]`);
const detail = (id = 'detail-thought') => node(id).locator('[data-node-detail-level]').first().getAttribute('data-node-detail-level');
const setViewport = async (zoom = 1) => {
  await page.evaluate((zoom) => window.__rf.setViewport({ x: 100, y: 160, zoom }, { duration: 0 }), zoom);
  await page.waitForTimeout(100);
};
const panel = () => page.locator('[data-canvas-detail-panel]');
const openPanel = async () => {
  if (!(await panel().isVisible())) await page.locator('[data-canvas-detail-trigger]').click();
};
const globalDetail = async (value) => {
  await openPanel();
  await panel().locator(`[data-canvas-detail="${value}"]`).click();
  await page.waitForTimeout(100);
};
const assertCentered = async (before, message) => {
  const after = await viewport();
  const { width, height } = await page.locator('.react-flow').boundingBox();
  near((width / 2 - before.x) / before.zoom, (width / 2 - after.x) / after.zoom, `${message} center x`);
  near((height / 2 - before.y) / before.zoom, (height / 2 - after.y) / after.zoom, `${message} center y`);
  return after;
};
const wheel = async (locator, { modifier = 'Control', dy = 100, dx = 0, point } = {}) => {
  const box = await locator.boundingBox();
  assert.ok(box, 'Wheel target is visible');
  await page.mouse.move(box.x + (point?.x ?? Math.min(50, box.width / 2)), box.y + (point?.y ?? Math.min(40, box.height / 2)));
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.wheel(dx, dy);
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(200);
};

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5184', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  assert.equal(await page.evaluate(() => window.__ui.getState().wheelPans), true);
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    const response = Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 条分析：完整内容需要保留，缩放和显示设置不能修改模型上下文。`).join('\n\n');
    const data = (question, extra = {}) => ({ question, response, responses: [response], responseIndex: 0,
      summaries: ['保留内容与位置，分别控制缩放和信息详细程度。'],
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 400,
      highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      roleMode: 'inherit', isRoot: false, isBranch: false, ...extra });
    const nodes = [
      { id: 'detail-thought', type: 'thought', position: { x: 0, y: 0 }, data: data('如何独立调整缩放和信息详细程度？', { isRoot: true, displayName: '研究问题' }) },
      { id: 'detail-note', type: 'thought', position: { x: 650, y: 0 }, width: 440, data: data('# 材料笔记\n\n' + response, { stepKind: 'note', displayName: '分析材料' }) },
      { id: 'detail-file', type: 'thought', position: { x: 1250, y: 0 }, width: 440, data: data('', { stepKind: 'file', displayName: '数据文件', attachments: [{ id: 'text', name: 'sample.csv', size: 30, type: 'text/csv', content: 'month,value\n1,2', extractedText: 'month,value\n1,2' }] }) },
      { id: 'detail-link', type: 'thought', position: { x: 1800, y: 0 }, width: 440, data: data(response, { stepKind: 'link', displayName: '来源网页', linkUrl: 'https://example.com/source', linkTitle: '来源网页' }) },
    ];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: ['detail-thought'], selectedNodeId: 'detail-thought', history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__ui.getState().setPanelOpen(false);
  });
  await node().waitFor();
  const contentBefore = await page.evaluate(() => window.__store.getState().nodes.map(({ id, position, data }) => ({ id, position, question: data.question, response: data.response, responses: data.responses })));
  await setViewport();
  await page.mouse.move(1250, 700);
  const beforePan = await viewport();
  await page.mouse.wheel(60, 120);
  await page.waitForTimeout(200);
  const afterPan = await viewport();
  near(afterPan.zoom, beforePan.zoom, 'Ordinary wheel does not zoom');
  assert.ok(afterPan.x !== beforePan.x && afterPan.y !== beforePan.y);
  check('Fresh default pans with both wheel axes');

  await globalDetail('full');
  await page.keyboard.press('Escape');
  await setViewport();
  const body = node().locator('.markdown-body.nowheel').last();
  await wheel(body, { modifier: null });
  assert.ok(await body.evaluate((el) => el.scrollTop > 0), 'Plain wheel reads node text');
  near((await viewport()).zoom, 1, 'Plain text scroll preserves zoom');
  const textScroll = await body.evaluate((el) => el.scrollTop);
  const beforeText = await viewport();
  await wheel(body);
  assert.ok((await assertCentered(beforeText, 'Node text')).zoom < beforeText.zoom);
  assert.equal(await body.evaluate((el) => el.scrollTop), textScroll);
  near(await page.evaluate(() => window.visualViewport.scale), 1, 'Browser viewport does not zoom');
  check('Ctrl wheel over nowheel text zooms around canvas center without scrolling text');

  await setViewport();
  await node().locator('[data-edit-question]').click();
  const input = node().locator('textarea').first();
  await input.fill('尚未提交的输入草稿');
  const beforeInput = await viewport();
  await wheel(input);
  await assertCentered(beforeInput, 'Editor');
  assert.equal(await input.inputValue(), '尚未提交的输入草稿');
  assert.equal(await input.evaluate((el) => el === document.activeElement), true);
  await page.evaluate(() => window.__ui.getState().setCanvasDetail('compact'));
  await page.waitForTimeout(100);
  assert.equal(await detail(), 'full', 'Active editor is never replaced by compact display');
  await globalDetail('full');
  await page.keyboard.press('Escape');
  await node().locator('[data-edit-question]').click();
  assert.equal(await input.inputValue(), '尚未提交的输入草稿', 'Outside dismissal retains the draft');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Editor keeps focus and draft through zoom and detail changes');

  await globalDetail('full');
  await page.keyboard.press('Escape');
  for (const [target, point] of [[page.locator('.react-flow__pane'), { x: 900, y: 800 }], [page.locator('.react-flow__minimap'), undefined]]) {
    await setViewport();
    const before = await viewport();
    await wheel(target, { dy: -100, point });
    assert.ok((await assertCentered(before, 'Pane/minimap')).zoom > before.zoom);
  }
  await page.evaluate(() => window.__ui.getState().setWheelPans(false));
  await setViewport();
  const beforeOff = await viewport();
  await wheel(body);
  await assertCentered(beforeOff, 'Pan opt-out');
  check('Modified wheel stays centered on pane/minimap and with ordinary pan disabled');

  for (const deltaMode of [0, 1, 2]) {
    await setViewport();
    const before = await viewport();
    await body.dispatchEvent('wheel', { deltaY: deltaMode === 0 ? 30 : 1, deltaMode, ctrlKey: true, bubbles: true, cancelable: true });
    await page.waitForTimeout(80);
    assert.ok((await assertCentered(before, `deltaMode ${deltaMode}`)).zoom < before.zoom);
  }
  await setViewport(2);
  await page.locator('.react-flow').dispatchEvent('wheel', { deltaY: -1000, ctrlKey: true, bubbles: true, cancelable: true });
  near((await viewport()).zoom, 2, 'Maximum zoom');
  await setViewport(0.04);
  await page.locator('.react-flow').dispatchEvent('wheel', { deltaY: 1000, ctrlKey: true, bubbles: true, cancelable: true });
  near((await viewport()).zoom, 0.04, 'Minimum zoom');
  check('Pixel/line/page deltas work and zoom limits are respected');

  await setViewport(0.25);
  await globalDetail('auto');
  assert.equal(await detail(), 'compact');
  await globalDetail('summary');
  for (const id of ['detail-thought', 'detail-note', 'detail-file', 'detail-link']) assert.equal(await detail(id), 'summary');
  assert.equal(await node().locator('[data-node-preview]').count(), 1, 'Fixed summary includes preview at distant zoom');
  await globalDetail('full');
  for (const id of ['detail-thought', 'detail-note', 'detail-file', 'detail-link']) assert.equal(await detail(id), 'full');
  assert.ok((await node().textContent()).includes('第 20 条分析'), 'Full mode renders full answer, not its summary');
  check('Global detail overrides zoom for thought, note, file and link nodes');

  await panel().locator('[data-node-detail="summary"]').click();
  assert.equal(await detail(), 'summary');
  await globalDetail('compact');
  assert.equal(await detail(), 'summary');
  assert.equal(await detail('detail-note'), 'compact');
  await setViewport(1.2);
  assert.equal(await detail(), 'summary');
  await page.evaluate(() => window.__store.getState().undo());
  await page.waitForTimeout(100);
  assert.equal(await detail(), 'compact');
  await page.evaluate(() => window.__store.getState().redo());
  await page.waitForTimeout(100);
  assert.equal(await detail(), 'summary');
  check('Node lock wins over zoom/global changes and supports undo/redo');

  await panel().locator('[data-node-detail="auto"]').click();
  assert.equal(await detail(), 'compact');
  await globalDetail('auto');
  assert.equal(await detail(), 'full');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-canvas-detail-trigger]').evaluate((el) => document.activeElement === el), true);
  check('Unlock restores global/automatic detail; Escape returns focus');

  await setViewport(0.6);
  await node().click({ button: 'right', position: { x: 20, y: 20 } });
  const nodeControls = page.locator('[data-node-detail-controls="detail-thought"]');
  await nodeControls.locator('[data-node-detail="summary"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await detail(), 'summary');
  await node().locator('[data-node-details="detail-thought"]').click();
  await page.locator('[data-focus-panel]').waitFor();
  assert.equal(await detail(), 'summary', 'Reading preserves lock');
  await page.evaluate(() => window.__ui.getState().setPanelOpen(false));
  check('Right-click sets detail; the details action reads without changing the lock');

  await setViewport(0.35);
  await globalDetail('full');
  await page.screenshot({ path: `${output}/detail-light.png` });
  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await page.screenshot({ path: `${output}/detail-dark.png` });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(150);
  const bounds = await panel().boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 640 && bounds.y + bounds.height <= 900);
  await page.screenshot({ path: `${output}/detail-narrow.png` });
  check('Detail controls fit desktop and narrow viewports in both themes');

  assert.equal(await page.evaluate(() => window.__store.getState().nodes.find((n) => n.id === 'detail-thought').data.detailLevel), 'summary', 'Lock remains in live graph');
  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  const storedLock = await page.evaluate(async () => {
    const storage = window.__store.persist.getOptions();
    const saved = await storage.storage.getItem(storage.name);
    return saved.state.nodes.find((n) => n.id === 'detail-thought').data.detailLevel;
  });
  assert.equal(storedLock, 'summary', 'Lock is written with project data');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  assert.equal(await page.evaluate(() => window.__ui.getState().canvasDetail), 'full');
  assert.equal(await page.evaluate(() => window.__ui.getState().wheelPans), false, 'Explicit opt-out survives reload');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.find((n) => n.id === 'detail-thought').data.detailLevel), 'summary');
  check('Global detail, node locks, and explicit wheel preference persist across reload');
  assert.deepEqual(await page.evaluate(() => window.__store.getState().nodes.map(({ id, position, data }) => ({ id, position, question: data.question, response: data.response, responses: data.responses }))), contentBefore);
  check('Display and wheel actions preserve content, versions and canvas positions');

  await page.setViewportSize({ width: 1600, height: 1000 });
  await setViewport(0.6);
  await page.evaluate(() => {
    window.__ui.getState().setCanvasDetail('full');
    window.__store.setState((state) => ({ nodes: state.nodes.map((item) => item.id === 'detail-thought' ? { ...item, data: { ...item.data, detailLevel: undefined, isCollapsed: true } } : item) }));
  });
  assert.equal(await detail(), 'full');
  assert.ok((await node().textContent()).includes('第 20 条分析'), 'Explicit full detail overrides saved collapsed presentation');
  check('Full detail exposes the answer even for a previously collapsed card');

  await page.evaluate(() => {
    window.__projects.setState((state) => ({ projects: state.projects.map((project) => project.id === state.activeId ? { ...project, kind: 'paradigm' } : project) }));
    window.__store.setState((state) => ({ nodes: state.nodes.filter((item) => item.id === 'detail-thought').map((item) => ({ ...item, data: { ...item.data, stepKind: 'prompt', instruction: '保留范式指令，不因为显示设置而改写。' } })) }));
    window.__store.getState().setSelectedNodeId('detail-thought');
  });
  await node().locator('textarea').waitFor();
  await globalDetail('summary');
  assert.equal(await detail(), 'summary');
  await panel().locator('[data-node-detail="summary"]').click();
  await globalDetail('compact');
  assert.equal(await detail(), 'summary');
  await page.keyboard.press('Escape');
  await node().locator('[data-node-overview]').dblclick();
  const instruction = node().locator('textarea');
  await instruction.fill('调整后的范式指令');
  await wheel(instruction);
  assert.equal(await detail(), 'full', 'Focused paradigm editor stays open');
  assert.equal(await instruction.inputValue(), '调整后的范式指令');
  await page.mouse.click(900, 800);
  assert.equal(await detail(), 'summary', 'Ending the edit restores the locked presentation');
  check('Paradigm nodes share detail locks and keep focused editors usable');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  check('No browser errors or API mutations');
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, writes }, null, 2));
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Page state:', await page.evaluate(() => ({ store: !!window.__store, flow: !!window.__rf, ui: !!window.__ui, text: document.body.innerText.slice(0, 1000) })).catch(() => null));
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
