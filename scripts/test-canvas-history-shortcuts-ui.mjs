// Canvas history must remain reachable from selection tools without taking text undo.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5176';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/canvas-history-shortcuts';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
await context.routeWebSocket('**', socket => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const ids = ['history-a', 'history-b', 'history-c'];
const positions = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position }) => ({ id, position })));
const selected = () => page.evaluate(() => ({ ids: [...window.__store.getState().selectedNodeIds].sort(), nodes: window.__store.getState().nodes.filter(node => node.selected).map(node => node.id).sort() }));
const expectPositions = async (expected, label) => {
  await page.waitForFunction(expected => JSON.stringify(window.__store.getState().nodes.map(({ id, position }) => ({ id, position }))) === JSON.stringify(expected), expected);
  assert.deepEqual(await positions(), expected, label);
};
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const expandInspector = async () => {
  await page.evaluate(() => window.__canvasEditing.getState().requestProperties());
  await page.locator('[data-selection-properties]').waitFor();
  const reopen = page.locator('[data-node-format-reopen]');
  if (await reopen.isVisible()) await reopen.click();
  await page.locator('[data-node-format-panel]').waitFor();
};
const openAlign = async () => {
  await expandInspector();
  await page.locator('[data-selection-align]').click();
  await page.getByRole('menu', { name: '对齐', exact: true }).waitFor();
};
const align = async action => {
  await openAlign();
  await page.locator('[data-arrange-reference="selection"]').click();
  await page.locator(`[data-arrange-action="${action}"]`).click();
  await frame();
  assert.equal(await page.locator('[data-selection-align]').evaluate(node => node === document.activeElement), true, 'Alignment restores focus to its inspector trigger');
};
const historyKey = async key => { await page.keyboard.press(key); await frame(); };
const fixture = async ({ marquee = false, connection = false } = {}) => {
  await page.keyboard.press('Escape');
  await page.evaluate(({ ids, marquee, connection }) => {
    const nodes = ids.map((id, index) => ({
      id, type: 'thought', position: { x: 100 + index * 550, y: 160 + index * 340 }, width: 480, height: 250,
      selected: !marquee && !connection,
      data: { question: `研究节点 ${index + 1}`, displayName: `研究节点 ${index + 1}`, response: 'A complete answer.', responses: ['A complete answer.'], responseIndex: 0,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, isRoot: false, isBranch: false,
        highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 10, roleMode: 'inherit' },
    }));
    const edges = connection ? [{ id: 'history-edge', source: ids[0], target: ids[1], type: 'smoothstep', selected: true, data: { route: 'curve' } }] : [];
    window.__store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0,
      selectedNodeIds: marquee || connection ? [] : ids, selectedNodeId: null });
    window.__canvasEditing.getState().setSelectionRegion(null);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__rf.setViewport({ x: 40, y: 80, zoom: 0.5 }, { duration: 0 });
  }, { ids, marquee, connection });
  await page.waitForFunction(() => window.__store.getState().nodes.every(node => node.measured?.width && node.measured?.height));
  // The initial node-count effect may center newly inserted nodes once.
  await page.waitForTimeout(350);
  await page.evaluate(() => window.__rf.setViewport({ x: 40, y: 80, zoom: 0.5 }, { duration: 0 }));
  await frame();
  if (marquee) {
    const boxes = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
    }));
    const start = { x: Math.min(...boxes.map(box => box.x)) - 20, y: Math.min(...boxes.map(box => box.y)) - 20 };
    const end = { x: Math.max(...boxes.map(box => box.right)) + 20, y: Math.max(...boxes.map(box => box.bottom)) + 20 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 14 }); await page.mouse.up();
    await page.waitForFunction(ids => JSON.stringify([...window.__store.getState().selectedNodeIds].sort()) === JSON.stringify(ids), ids);
  }
  if (connection) {
    await page.evaluate(() => window.__canvasEditing.getState().requestProperties());
    await page.locator('[data-connection-properties]').waitFor();
  } else await expandInspector();
};

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__canvasEditing);

  await fixture({ marquee: true });
  const original = await positions();
  const originalSelection = await selected();
  assert.deepEqual(originalSelection, { ids, nodes: ids }, 'A real marquee selects all fixture nodes');
  await align('left');
  const left = await positions();
  assert.notDeepEqual(left, original);
  await historyKey('Control+z');
  await expectPositions(original, 'Ctrl+Z immediately reverses alignment while its trigger retains focus');
  assert.deepEqual(await selected(), originalSelection, 'Undo preserves the active marquee selection');
  await historyKey('Control+Shift+z');
  await expectPositions(left, 'Ctrl+Shift+Z restores alignment');
  await historyKey('Control+z');
  await historyKey('Control+y');
  await expectPositions(left, 'Ctrl+Y restores alignment');
  assert.deepEqual(await selected(), originalSelection);
  check('real marquee alignment supports immediate undo and both redo shortcuts without changing selection');

  await align('top');
  const top = await positions();
  assert.notDeepEqual(top, left);
  await historyKey('Control+z'); await expectPositions(left, 'One undo reverses only the second alignment');
  await historyKey('Control+z'); await expectPositions(original, 'The next undo reverses the first alignment');
  await historyKey('Control+Shift+z'); await expectPositions(left, 'One redo restores the first alignment');
  await historyKey('Control+y'); await expectPositions(top, 'The next redo restores the second alignment');
  assert.deepEqual(await selected(), originalSelection);
  check('consecutive alignments remain separate undo and redo steps');

  await openAlign();
  assert.equal(await page.getByRole('menu', { name: '对齐', exact: true }).evaluate(menu => menu.contains(document.activeElement)), true);
  await historyKey('Control+z'); await expectPositions(left, 'A focused portal menu forwards undo');
  await historyKey('Control+Shift+z'); await expectPositions(top, 'A focused portal menu forwards redo');
  await page.keyboard.press('Escape');
  check('history shortcuts remain available inside a portal menu');

  const width = page.locator('[data-node-format-field="width"]');
  const originalWidthText = await width.inputValue();
  const beforeTyping = await page.evaluate(() => ({ historyIndex: window.__store.getState().historyIndex,
    geometry: window.__store.getState().nodes.map(({ id, position, width, height }) => ({ id, position, width, height })) }));
  await width.focus();
  await width.selectText();
  await page.keyboard.type('555');
  await historyKey('Control+z');
  assert.equal(await width.inputValue(), originalWidthText, 'Native text undo restores the width text');
  assert.deepEqual(await page.evaluate(() => ({ historyIndex: window.__store.getState().historyIndex,
    geometry: window.__store.getState().nodes.map(({ id, position, width, height }) => ({ id, position, width, height })) })), beforeTyping,
  'Text undo preserves canvas geometry and its history cursor');
  assert.deepEqual(await positions(), top, 'Text-field undo does not move the canvas');
  await page.keyboard.press('Escape');
  await page.locator('[data-selection-align]').focus();
  const beforeProtectedKeys = await positions();
  await historyKey('Delete');
  await historyKey('ArrowRight');
  await historyKey('Control+a');
  assert.deepEqual(await positions(), beforeProtectedKeys, 'Inspector-local keys do not move or delete nodes');
  assert.deepEqual(await selected(), originalSelection, 'Inspector-local keys do not change the canvas selection');
  check('text fields retain their undo and inspector controls protect unrelated canvas keys');

  const lock = page.locator('[data-node-format-lock]');
  const beforeLock = await page.evaluate(() => window.__store.getState().nodes.map(({ id, position, width, height }) => ({ id, position, width, height })));
  await lock.click();
  assert.equal(await lock.isChecked(), true, 'The checkbox immediately locks the selected node ratios');
  assert.equal(await lock.evaluate(input => input === document.activeElement), true);
  await historyKey('Control+z');
  assert.equal(await lock.isChecked(), false, 'A focused checkbox forwards undo of its own canvas setting');
  await historyKey('Control+y');
  assert.equal(await lock.isChecked(), true, 'A focused checkbox forwards redo of its own canvas setting');
  assert.deepEqual(await page.evaluate(() => window.__store.getState().nodes.map(({ id, position, width, height }) => ({ id, position, width, height }))), beforeLock,
    'Locking, undoing and redoing preserve node geometry');
  assert.deepEqual(await selected(), originalSelection, 'Checkbox history preserves the selected nodes');
  await historyKey('Control+z');
  await page.locator('[data-selection-align]').focus();
  check('checkbox settings support immediate canvas undo and redo while keeping geometry and selection');

  for (const mode of ['composing', 'consumed']) {
    await page.locator('[data-selection-align]').focus();
    await page.evaluate(mode => {
      const button = document.activeElement;
      const intercept = event => {
        if (event.key.toLowerCase() !== 'z') return;
        if (mode === 'composing') Object.defineProperty(event, 'isComposing', { value: true });
        else event.preventDefault();
        button.removeEventListener('keydown', intercept, true);
      };
      button.addEventListener('keydown', intercept, true);
    }, mode);
    await historyKey('Control+z');
    assert.deepEqual(await positions(), top, `${mode} keydown does not undo the canvas`);
  }
  check('composition and already-consumed history keys do not undo the canvas');

  await page.evaluate(async () => {
    const { confirmDialog } = await import('/src/lib/ui-store.ts');
    void confirmDialog({ title: '快捷键验证', message: '验证确认框打开时画布历史保持不变。' });
  });
  await page.getByRole('alertdialog').waitFor();
  await historyKey('Control+z');
  assert.deepEqual(await positions(), top, 'Confirmation dialogs suspend canvas history shortcuts');
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').waitFor({ state: 'detached' });
  check('confirmation dialogs keep ownership of the keyboard');

  await fixture();
  const beforePanels = await positions();
  await align('right');
  const afterPanels = await positions();
  await page.evaluate(id => window.__ui.getState().setPanelOpen(true, id), ids[0]);
  await page.locator('[data-focus-panel]').waitFor();
  await page.locator('[data-node-details-close]').focus();
  await historyKey('Control+z'); await expectPositions(beforePanels, 'A reading-panel button forwards canvas undo');
  await historyKey('Control+Shift+z'); await expectPositions(afterPanels, 'A reading-panel button forwards canvas redo');
  await page.locator('[data-node-details-close]').click();
  check('reading-panel buttons retain canvas undo and redo');

  await page.locator('[data-layout-entry]').click();
  await page.locator('[data-canvas-layout-panel]').waitFor();
  await page.locator('[data-layout-preview]').focus();
  await historyKey('Control+z'); await expectPositions(beforePanels, 'A layout-panel button forwards canvas undo');
  await historyKey('Control+y'); await expectPositions(afterPanels, 'A layout-panel button forwards canvas redo');
  const layoutRadio = page.locator('[data-layout-scope] input[type="radio"]').first();
  await layoutRadio.focus();
  assert.equal(await layoutRadio.evaluate(input => input === document.activeElement), true);
  await historyKey('Control+z'); await expectPositions(beforePanels, 'A focused layout radio forwards canvas undo');
  await historyKey('Control+Shift+z'); await expectPositions(afterPanels, 'A focused layout radio forwards canvas redo');
  await page.locator('[data-layout-cancel]').click();
  check('layout-panel buttons and radios retain canvas undo and redo without applying their draft');

  await fixture({ connection: true });
  const originalEdges = await page.evaluate(() => window.__store.getState().edges);
  const routeButton = page.locator('[data-connection-route="orthogonal"]');
  await routeButton.click();
  const changedEdges = await page.evaluate(() => window.__store.getState().edges);
  assert.notDeepEqual(changedEdges, originalEdges, 'The route button immediately changes the selected edge');
  assert.equal(await routeButton.evaluate(button => button === document.activeElement), true);
  await historyKey('Control+z');
  assert.deepEqual(await page.evaluate(() => window.__store.getState().edges), originalEdges, 'Connection buttons forward undo through both panel boundaries');
  await historyKey('Control+Shift+z');
  assert.deepEqual(await page.evaluate(() => window.__store.getState().edges), changedEdges, 'Connection buttons forward redo through both panel boundaries');
  assert.equal(await page.evaluate(() => window.__store.getState().edges[0].selected), true, 'Connection selection survives history navigation');
  check('connection-property buttons forward undo and redo through nested keyboard boundaries');

  assert.deepEqual(errors, [], 'No runtime errors');
  assert.deepEqual(writes, [], 'No external writes or model requests');
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
