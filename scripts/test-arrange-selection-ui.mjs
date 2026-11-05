// Arrangement and partition regression using an isolated browser context.
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
const outputDir = 'local-tests/arrange-selection-v2';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.routeWebSocket('**', socket => socket.close());
page.setDefaultTimeout(15000);
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
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1, `${message}: ${a} != ${b}`);
const readNodes = () => page.evaluate(() => window.__store.getState().nodes);
const positions = (nodes) => nodes.map(({ id, position }) => ({ id, position }));
const size = (node) => ({ w: node.measured?.width ?? node.width, h: node.measured?.height ?? node.height });
const select = (ids) => page.evaluate((ids) => window.__store.getState().setSelectedNodeIds(ids), ids);
const expandFormat = async () => {
  const reopen = page.locator('[data-node-format-reopen]');
  if (await reopen.isVisible()) await reopen.click();
};
const pointerClickHandle = async (node, modifiers = []) => {
  const box = await node.locator('.drag-handle').first().boundingBox();
  assert.ok(box);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
};
const closeMenus = async () => { await page.keyboard.press('Escape'); };
const fixture = async (ids = ['arrange-a', 'arrange-b', 'arrange-c']) => {
  await closeMenus();
  await page.evaluate((ids) => {
    const data = (label) => ({
      stepKind: 'note', question: `这是用于验证排列操作的示例节点。${label}`, displayName: label,
      response: '', responses: [''], responseIndex: 0, isCollapsed: false,
      isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 20,
      highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      roleMode: 'inherit', isRoot: false, isBranch: false,
    });
    const nodes = [
      { id: 'arrange-a', type: 'thought', position: { x: 80, y: 240 }, width: 360, height: 220, data: data('示例 A · 研究问题') },
      { id: 'arrange-b', type: 'thought', position: { x: 680, y: 580 }, width: 420, height: 260, data: data('示例 B · 分析材料') },
      { id: 'arrange-c', type: 'thought', position: { x: 1300, y: 1000 }, width: 500, height: 300, data: data('示例 C · 结论摘要') },
    ].map((node) => ({ ...node, selected: ids.includes(node.id) }));
    const store = window.__store;
    store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0, selectedNodeIds: ids, selectedNodeId: ids.length === 1 ? ids[0] : null });
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
  }, ids);
  await page.waitForTimeout(550);
  await page.evaluate(() => window.__rf.setViewport({ x: 70, y: 100, zoom: 0.6 }, { duration: 0 }));
  await page.waitForFunction(() => window.__store.getState().nodes.every((node) => node.measured?.width && node.measured?.height));
};
const arrangeMenu = async () => {
  await expandFormat();
  await page.locator('[data-selection-align]').click();
  await page.getByRole('menu', { name: '对齐', exact: true }).waitFor();
};
const action = async (name, reference = 'selection') => {
  await arrangeMenu();
  await page.locator(`[data-arrange-reference="${reference}"]`).click();
  await page.locator(`[data-arrange-action="${name}"]`).click();
  assert.equal(await page.evaluate(() => window.__ui.getState().confirmRequest), null, 'Arrangement executes without confirmation');
  await page.waitForTimeout(100);
};
const menuWithinViewport = async (label) => {
  const box = await page.getByRole('menu', { name: label, exact: true }).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, 'Menu remains entirely inside the viewport');
};

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__store.getState().arrangeSelection);
  await fixture();
  await expandFormat();
  for (const selector of ['[data-selection-align]']) {
    const trigger = page.locator(selector);
    await trigger.hover();
    await page.waitForTimeout(450);
    assert.equal(await page.getByRole('tooltip').count(), 0, 'Spatial buttons do not show hover annotations');
  }
  const entryBox = await page.locator('[data-selection-align]').boundingBox();
  const inspectorBox = await page.locator('[data-node-format-panel]').boundingBox();
  assert.ok(entryBox && inspectorBox && inspectorBox.x > page.viewportSize().width / 2 && inspectorBox.y < 200, 'Inspector is at upper right');
  await select(['arrange-a']);
  await expandFormat();
  assert.equal(await page.locator('[data-selection-align]').count(), 1, 'Single objects retain viewport alignment in the format panel');
  await select([]);
  assert.equal(await page.locator('[data-selection-align]').count(), 0, 'No object tools appear without a selection');
  await select(['arrange-a', 'arrange-b', 'arrange-c']);
  await expandFormat();
  await page.locator('[data-create-selection-frame]').waitFor();
  const frameEntryBox = await page.locator('[data-create-selection-frame]').boundingBox();
  assert.ok(frameEntryBox && frameEntryBox.x > entryBox.x && Math.abs(frameEntryBox.y - entryBox.y) < 2, 'Alignment and direct partition creation are adjacent');
  assert.equal(await page.locator('[data-selection-group], [data-group-action], [data-select-whole-group]').count(), 0, 'No grouping controls remain');
  await arrangeMenu();
  assert.equal(await page.locator('[data-group-action]').count(), 0, 'Alignment menu contains no grouping actions');
  assert.equal(await page.locator('[data-create-selection-frame]').count(), 1);
  await closeMenus();
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const beforeRemovedShortcuts = await page.evaluate(() => ({ nodes: window.__store.getState().nodes, edges: window.__store.getState().edges, history: window.__store.getState().historyIndex }));
  for (const shortcut of ['Control+g', 'Control+Shift+g', 'Control+Alt+g']) {
    await page.keyboard.press(shortcut);
    assert.deepEqual(await page.evaluate(() => ({ nodes: window.__store.getState().nodes, edges: window.__store.getState().edges, history: window.__store.getState().historyIndex })), beforeRemovedShortcuts, `${shortcut} never changes the canvas`);
  }
  check('grouping controls and shortcuts are absent while alignment and direct partition creation remain available');
  for (const command of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
    await fixture();
    const before = await readNodes();
    await action(command);
    const after = await readNodes();
    const coordinate = (node) => command === 'left' ? node.position.x : command === 'center' ? node.position.x + size(node).w / 2
      : command === 'right' ? node.position.x + size(node).w : command === 'top' ? node.position.y
      : command === 'middle' ? node.position.y + size(node).h / 2 : node.position.y + size(node).h;
    after.forEach((node) => near(coordinate(node), coordinate(after[0]), command));
    const untouchedAxis = ['left', 'center', 'right'].includes(command) ? 'y' : 'x';
    after.forEach((node, index) => near(node.position[untouchedAxis], before[index].position[untouchedAxis], 'Other axis remains fixed'));
  }
  check('all six alignment commands use actual unequal node dimensions');

  for (const [command, axis, dim] of [['distribute-horizontal', 'x', 'w'], ['distribute-vertical', 'y', 'h']]) {
    await fixture();
    const before = await readNodes();
    await action(command);
    const after = (await readNodes()).sort((a, b) => a.position[axis] - b.position[axis]);
    const gaps = after.slice(1).map((node, index) => node.position[axis] - after[index].position[axis] - size(after[index])[dim]);
    near(gaps[0], gaps[1], 'Equal edge gaps');
    near(after[0].position[axis], before[0].position[axis], 'First item stays fixed');
    near(after[2].position[axis], before[2].position[axis], 'Last item stays fixed');
  }
  check('horizontal and vertical distribution preserve outer edges and equalize gaps');

  await fixture();
  const original = positions(await readNodes());
  await action('left');
  assert.notDeepEqual(positions(await readNodes()), original, 'Click immediately applies the arrangement');
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual(positions(await readNodes()), original, 'Immediate arrangement remains undoable');
  await action('center', 'viewport');
  const viewportCenter = await page.evaluate(() => {
    const viewport = window.__rf.getViewport();
    return (document.querySelector('.react-flow').clientWidth / 2 - viewport.x) / viewport.zoom;
  });
  (await readNodes()).forEach((node) => near(node.position.x + size(node).w / 2, viewportCenter, 'Visible canvas center'));
  check('arrangement runs immediately without confirmation, remains undoable and converts the viewport through canvas zoom');

  await fixture(['arrange-a', 'arrange-b']);
  await arrangeMenu();
  await page.locator('[data-arrange-reference="selection"]').click();
  assert.ok(await page.locator('[data-arrange-action="distribute-horizontal"]').isDisabled());
  await page.locator('[data-arrange-reference="viewport"]').click();
  assert.equal(await page.locator('[data-arrange-action="distribute-horizontal"]').isDisabled(), false);
  await page.keyboard.press('End');
  assert.ok(await page.getByRole('menu', { name: '对齐', exact: true }).evaluate((menu) => menu.contains(document.activeElement)));
  await closeMenus();
  assert.ok(await page.locator('[data-selection-align]').evaluate((node) => node === document.activeElement));
  check('distribution disabled states and keyboard focus follow selection and reference');

  await select([]);
  const a = page.locator('.react-flow__node[data-id="arrange-a"]');
  await a.locator('.drag-handle').first().click();
  const selection = await page.evaluate(() => window.__store.getState().selectedNodeIds);
  assert.deepEqual([...selection].sort(), ['arrange-a']);
  const c = page.locator('.react-flow__node[data-id="arrange-c"]');
  await pointerClickHandle(c, ['Control']);
  assert.equal(await page.evaluate(() => window.__store.getState().selectedNodeIds.length), 2, 'Ctrl-click adds only the clicked node');
  await pointerClickHandle(c, ['Control']);
  assert.deepEqual([...(await page.evaluate(() => window.__store.getState().selectedNodeIds))].sort(), ['arrange-a']);
  await pointerClickHandle(a, ['Control']);
  assert.equal(await page.locator('[data-selection-align]').count(), 0, 'Ctrl-deselecting the final node hides the arrangement entry');
  await a.locator('.drag-handle').first().click();
  const beforeDrag = await readNodes();
  const handle = await a.locator('.drag-handle').first().boundingBox();
  assert.ok(handle);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + handle.height / 2 + 65, { steps: 12 });
  await page.mouse.up();
  const afterDrag = await readNodes();
  const delta = (index, axis) => afterDrag[index].position[axis] - beforeDrag[index].position[axis];
  assert.ok(Math.abs(delta(0, 'x')) > 20);
  assert.deepEqual(afterDrag[1].position, beforeDrag[1].position, 'The unselected member remains fixed');
  assert.deepEqual(afterDrag[2].position, beforeDrag[2].position);
  check('click selects one node and a real pointer drag moves only that node');

  await select(['arrange-a', 'arrange-b']);
  assert.deepEqual([...(await page.evaluate(() => window.__store.getState().selectedNodeIds))].sort(), ['arrange-a', 'arrange-b']);
  const wholeBefore = await readNodes();
  const wholeHandle = await a.locator('.drag-handle').first().boundingBox();
  assert.ok(wholeHandle);
  await page.mouse.move(wholeHandle.x + wholeHandle.width / 2, wholeHandle.y + wholeHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(wholeHandle.x + wholeHandle.width / 2 + 55, wholeHandle.y + wholeHandle.height / 2 + 20, { steps: 10 });
  await page.mouse.up();
  const wholeAfter = await readNodes();
  const wholeDelta = (index, axis) => wholeAfter[index].position[axis] - wholeBefore[index].position[axis];
  assert.ok(Math.abs(wholeDelta(0, 'x')) > 20);
  for (const axis of ['x', 'y']) near(wholeDelta(0, axis), wholeDelta(1, axis), 'Multi-selection moves every selected node equally');
  assert.deepEqual(wholeAfter[2].position, wholeBefore[2].position);
  check('ordinary multi-selection supports collective dragging');

  await select([]);
  const boxA = await a.boundingBox();
  const boxB = await page.locator('.react-flow__node[data-id="arrange-b"]').boundingBox();
  assert.ok(boxA && boxB);
  const selectionBox = {
    left: Math.min(boxA.x, boxB.x) - 12, top: Math.min(boxA.y, boxB.y) - 12,
    right: Math.max(boxA.x + boxA.width, boxB.x + boxB.width) + 12,
    bottom: Math.max(boxA.y + boxA.height, boxB.y + boxB.height) + 12,
  };
  await page.mouse.move(selectionBox.left, selectionBox.top);
  await page.mouse.down();
  await page.mouse.move(selectionBox.right, selectionBox.bottom, { steps: 10 });
  await page.mouse.up();
  assert.deepEqual([...(await page.evaluate(() => window.__store.getState().selectedNodeIds))].sort(), ['arrange-a', 'arrange-b']);
  const selectionRect = page.locator('[data-selection-move]');
  await selectionRect.waitFor();
  const dragBox = await a.locator('.drag-handle').first().boundingBox();
  assert.ok(dragBox);
  const beforeSelectionDrag = await readNodes();
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 70, dragBox.y + dragBox.height / 2 - 40, { steps: 10 });
  await page.mouse.up();
  const afterSelectionDrag = await readNodes();
  const selectionDelta = (index, axis) => afterSelectionDrag[index].position[axis] - beforeSelectionDrag[index].position[axis];
  assert.ok(Math.abs(selectionDelta(0, 'x')) > 20);
  near(selectionDelta(0, 'x'), selectionDelta(1, 'x'), 'Dragging a selected card moves selected nodes equally on x');
  near(selectionDelta(0, 'y'), selectionDelta(1, 'y'), 'Dragging a selected card moves selected nodes equally on y');
  assert.deepEqual(afterSelectionDrag[2].position, beforeSelectionDrag[2].position);
  check('marquee selection and dragging through the selection surface preserve relative positions');

  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  const positionsBeforeReload = positions(await readNodes());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  assert.deepEqual(positions(await readNodes()), positionsBeforeReload);
  check('ordinary node geometry survives reload');

  await fixture(['arrange-a', 'arrange-b']);
  const frameSource = await readNodes();
  const edgesBeforeFrame = await page.evaluate(() => window.__store.getState().edges);
  await expandFormat();
  await page.locator('[data-create-selection-frame]').click();
  await page.waitForFunction(() => window.__store.getState().nodes.some(node => node.data.stepKind === 'frame'));
  let framed = await readNodes();
  const frameId = framed.find(node => node.data.stepKind === 'frame').id;
  let frame = framed.find(node => node.id === frameId);
  assert.equal(frame.data.frameCarry, true);
  assert.deepEqual(positions(framed.filter(node => node.id !== frameId)), positions(frameSource));
  assert.deepEqual(await page.evaluate(() => window.__store.getState().edges), edgesBeforeFrame);
  for (const node of framed.filter(node => ['arrange-a', 'arrange-b'].includes(node.id))) {
    assert.ok(frame.position.x < node.position.x && frame.position.y < node.position.y, 'Frame has leading padding');
    assert.ok(frame.position.x + frame.width > node.position.x + size(node).w, 'Frame has trailing padding');
    assert.ok(frame.position.y + frame.height > node.position.y + size(node).h, 'Frame has bottom padding');
  }
  await page.evaluate(() => window.__store.getState().undo());
  assert.ok(!(await readNodes()).some(node => node.id === frameId));
  await page.evaluate(() => window.__store.getState().redo());
  await page.waitForFunction(frameId => window.__store.getState().nodes.some(node => node.id === frameId), frameId);
  const frameNode = page.locator(`.react-flow__node[data-id="${frameId}"]`);
  const frameTitle = frameNode.locator('input');
  await frameTitle.fill('研究分区');
  await frameTitle.press('Enter');
  // Let the app's new-node arrival animation settle before driving a drag.
  await page.waitForTimeout(650);
  await page.evaluate(() => window.__rf.setViewport({ x: 90, y: 80, zoom: 0.65 }, { duration: 0 }));
  await page.waitForTimeout(300);
  const beforeFrameDrag = await readNodes();
  const frameHandle = await frameNode.locator('.drag-handle').first().boundingBox();
  assert.ok(frameHandle);
  await page.mouse.move(frameHandle.x + 85, frameHandle.y + frameHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(frameHandle.x + 165, frameHandle.y + frameHandle.height / 2 + 55, { steps: 10 });
  await page.mouse.up();
  const afterFrameDrag = await readNodes();
  const frameDelta = axis => afterFrameDrag.find(node => node.id === frameId).position[axis] - beforeFrameDrag.find(node => node.id === frameId).position[axis];
  assert.ok(Math.abs(frameDelta('x')) > 20, 'Dragging the title moves the frame');
  for (const id of ['arrange-a', 'arrange-b']) {
    for (const axis of ['x', 'y']) near(afterFrameDrag.find(node => node.id === id).position[axis] - beforeFrameDrag.find(node => node.id === id).position[axis], frameDelta(axis), 'Frame carries its contained nodes equally');
  }
  assert.deepEqual(afterFrameDrag.find(node => node.id === 'arrange-c').position, beforeFrameDrag.find(node => node.id === 'arrange-c').position);
  await page.waitForFunction(() => ['arrange-a', 'arrange-b'].every(id => {
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`);
    return node && Number(getComputedStyle(node).opacity) >= 0.9;
  }));
  const memberOpacities = await page.locator('.react-flow__node[data-id="arrange-a"], .react-flow__node[data-id="arrange-b"]').evaluateAll(nodes => nodes.map(node => Number(getComputedStyle(node).opacity)));
  assert.ok(memberOpacities.every(opacity => opacity >= 0.9), 'Selecting a partition keeps its contents readable');
  await page.screenshot({ path: `${outputDir}/partition.png` });
  check('direct creation makes a padded named partition without changing nodes or edges; undo and dragging preserve it');
  await select([frameId, 'arrange-c']);
  const beforeFrameAlign = await readNodes();
  await action('right');
  const afterFrameAlign = await readNodes();
  const alignFrameDx = afterFrameAlign.find(node => node.id === frameId).position.x - beforeFrameAlign.find(node => node.id === frameId).position.x;
  assert.ok(Math.abs(alignFrameDx) > 20);
  for (const id of ['arrange-a', 'arrange-b']) near(afterFrameAlign.find(node => node.id === id).position.x - beforeFrameAlign.find(node => node.id === id).position.x, alignFrameDx, 'Frame alignment carries the same rigid members as dragging');
  check('alignment and dragging use the same partition members and preserve relative positions');

  await select([frameId, 'arrange-a', 'arrange-b']);
  await expandFormat();
  assert.ok(await page.locator('[data-create-selection-frame]').isDisabled(), 'A selection containing a partition cannot create another partition');
  await arrangeMenu();
  assert.equal(await page.locator('[data-arrange-chain]').isDisabled(), false, 'A selected partition and its contents remain eligible for automatic layout');
  const beforeRegionLayout = await readNodes();
  await page.locator('[data-arrange-chain]').click();
  await page.waitForFunction(() => !window.__canvasEditing.getState().layoutBusy);
  const afterRegionLayout = await readNodes();
  assert.deepEqual(afterRegionLayout.find(n => n.id === 'arrange-c').position, beforeRegionLayout.find(n => n.id === 'arrange-c').position);
  const laidOutFrame = afterRegionLayout.find(n => n.id === frameId);
  for (const id of ['arrange-a', 'arrange-b']) {
    const member = afterRegionLayout.find(n => n.id === id);
    assert.ok(member.position.x >= laidOutFrame.position.x && member.position.y >= laidOutFrame.position.y);
    assert.ok(member.position.x + size(member).w <= laidOutFrame.position.x + size(laidOutFrame).w + 1);
    assert.ok(member.position.y + size(member).h <= laidOutFrame.position.y + size(laidOutFrame).h + 1);
  }
  check('automatic layout arranges partition contents and preserves their containment and outside nodes');
  await page.evaluate(() => {
    window.__originalBatchMerge = window.__store.getState().batchMergeSummarize;
    window.__store.setState({ batchMergeSummarize: ids => { window.__capturedBatchIds = ids; } });
  });
  await expandFormat();
  await page.getByRole('button', { name: '合并摘要', exact: true }).click();
  await page.locator('[data-selection-toolbar]').getByRole('button', { name: '提问', exact: true }).click();
  assert.deepEqual([...(await page.evaluate(() => window.__capturedBatchIds))].sort(), ['arrange-a', 'arrange-b']);
  await page.evaluate(() => window.__store.setState({ batchMergeSummarize: window.__originalBatchMerge }));
  check('partition frames are excluded from new partition creation and batch content sources');
  const beforeFrameOnly = await page.evaluate(() => ({ ids: window.__store.getState().nodes.map(node => node.id), edges: window.__store.getState().edges }));
  await page.evaluate(async frameId => {
    const store = window.__store.getState();
    await store.exploreFrom([frameId], 'A frame itself must not become a context source.');
    await store.batchMergeSummarize([frameId], false);
    await store.weaveHighlights([frameId]);
  }, frameId);
  assert.deepEqual(await page.evaluate(() => ({ ids: window.__store.getState().nodes.map(node => node.id), edges: window.__store.getState().edges })), beforeFrameOnly);
  check('frame-only content actions are inert and do not create model requests or context edges');

  await page.evaluate(frameId => {
    window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === 'arrange-a' ? { ...node, position: { x: 80, y: 240 } }
      : node.id === 'arrange-b' ? { ...node, position: { x: 680, y: 580 } }
      : node.id === frameId ? { ...node, position: { x: 40, y: 200 }, width: 500, height: 300, measured: { width: 500, height: 300 } } : node) }));
    window.__store.getState().setSelectedNodeIds([frameId]);
    window.__rf.setViewport({ x: 90, y: 80, zoom: 0.65 }, { duration: 0 });
  }, frameId);
  await page.waitForTimeout(250);
  const beforePartialDrag = await readNodes();
  const partialHandle = await frameNode.locator('.drag-handle').first().boundingBox();
  assert.ok(partialHandle);
  await page.mouse.move(partialHandle.x + 85, partialHandle.y + partialHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(partialHandle.x + 155, partialHandle.y + partialHandle.height / 2 + 35, { steps: 10 });
  await page.mouse.up();
  const afterPartialDrag = await readNodes();
  assert.deepEqual(afterPartialDrag.find(node => node.id === 'arrange-b').position, beforePartialDrag.find(node => node.id === 'arrange-b').position, 'The outside node remains fixed');
  for (const axis of ['x', 'y']) near(
    afterPartialDrag.find(node => node.id === 'arrange-a').position[axis] - beforePartialDrag.find(node => node.id === 'arrange-a').position[axis],
    afterPartialDrag.find(node => node.id === frameId).position[axis] - beforePartialDrag.find(node => node.id === frameId).position[axis],
    'The contained member moves with its partition');
  assert.notDeepEqual(afterPartialDrag.find(node => node.id === frameId).position, beforePartialDrag.find(node => node.id === frameId).position);
  check('moving a partition carries contained nodes and never pulls outside nodes');

  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  assert.equal((await readNodes()).find(node => node.id === frameId).data.question, '研究分区');
  check('named partitions survive reload');

  await fixture(['arrange-a', 'arrange-b']);
  await page.evaluate(() => {
    window.__store.setState(state => ({ nodes: state.nodes.map((node, index) => index < 2 ? { ...node, height: 280, measured: undefined, data: { ...node.data, stepKind: undefined, response: 'A complete independent answer.', responses: ['A complete independent answer.'] } } : node) }));
    window.__store.getState().setSelectedNodeIds([]);
    window.__rf.setViewport({ x: 70, y: 50, zoom: 1 }, { duration: 0 });
  });
  await page.waitForTimeout(300);
  await page.locator('.react-flow__node[data-id="arrange-a"] .drag-handle').first().click({ position: { x: 120, y: 28 } });
  await page.locator('.react-flow__node[data-id="arrange-a"] [data-node-details]').click();
  await page.locator('[data-focus-panel]').waitFor();
  assert.equal(await page.evaluate(() => window.__ui.getState().panelNodeId), 'arrange-a');
  assert.deepEqual([...(await page.evaluate(() => window.__store.getState().selectedNodeIds))].sort(), ['arrange-a']);
  await page.evaluate(() => window.__ui.getState().setPanelOpen(false));
  check('a selected thought opens its own reading panel without changing the selection');
  await select(['arrange-a', 'arrange-b']);
  await page.evaluate(() => window.__rf.setViewport({ x: 70, y: 50, zoom: 1 }, { duration: 0 }));
  const menuHandle = await page.locator('.react-flow__node[data-id="arrange-a"] .drag-handle').first().boundingBox();
  assert.ok(menuHandle);
  await page.mouse.click(menuHandle.x + 120, menuHandle.y + 28, { button: 'right' });
  await page.locator('[data-rename-node]').locator('..').getByRole('button', { name: '查看详情', exact: true }).click();
  await page.locator('[data-focus-panel]').waitFor();
  assert.deepEqual([...(await page.evaluate(() => window.__store.getState().selectedNodeIds))].sort(), ['arrange-a', 'arrange-b']);
  assert.equal(await page.evaluate(() => window.__ui.getState().panelNodeId), 'arrange-a');
  await page.locator('[data-node-details-close]').click();
  assert.deepEqual([...(await page.evaluate(() => window.__store.getState().selectedNodeIds))].sort(), ['arrange-a', 'arrange-b']);
  check('opening and closing one node from the context menu keeps the existing multi-selection');

  await fixture();
  assert.equal(await page.locator('.react-flow__node .node-selected').count(), 3, 'Every selected node exposes a visible selection outline');
  check('all three selected nodes show the established selection outline');
  await arrangeMenu();
  await page.locator('[data-arrange-reference="selection"]').click();
  await menuWithinViewport('对齐');
  await page.screenshot({ path: `${outputDir}/desktop-align.png` });
  await closeMenus();
  assert.equal(await page.locator('[data-selection-group], [data-group-action]').count(), 0);
  await page.locator('[data-toolbar-more]').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator('[data-appearance-lighting]').getByRole('button', { name: 'Dark', exact: true }).click();
  await closeMenus();
  await page.locator('[data-selection-align]').click();
  assert.equal(await page.getByRole('menuitem', { name: 'Align left', exact: true }).count(), 1);
  await menuWithinViewport('Align');
  await page.screenshot({ path: `${outputDir}/dark.png` });
  await closeMenus();
  await page.locator('[data-toolbar-more]').click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.locator('[data-appearance-lighting]').getByRole('button', { name: '亮', exact: true }).click();
  await closeMenus();
  await page.setViewportSize({ width: 390, height: 844 });
  await arrangeMenu();
  await menuWithinViewport('对齐');
  await page.screenshot({ path: `${outputDir}/mobile.png` });
  await closeMenus();
  assert.ok(await page.locator('[data-create-selection-frame]').isVisible());
  check('desktop, narrow viewport, dark theme and English menus remain accessible');
  await closeMenus();
  for (const width of [390, 800]) {
    await page.setViewportSize({ width, height: 844 });
    await fixture(['arrange-a', 'arrange-b']);
    await page.evaluate(() => {
      window.__store.setState(state => ({ nodes: state.nodes.map((node, index) => index < 2 ? { ...node, height: 280, measured: undefined, data: { ...node.data, stepKind: undefined, response: 'A complete independent answer.', responses: ['A complete independent answer.'] } } : node) }));
      window.__store.getState().setSelectedNodeIds([]);
      window.__rf.setViewport({ x: -60, y: 40, zoom: 1 }, { duration: 0 });
    });
    await page.waitForTimeout(300);
    await page.locator('.react-flow__node[data-id="arrange-a"] .drag-handle').first().click({ position: { x: 120, y: 28 } });
    await expandFormat();
    await page.locator('[data-node-format-close]').click();
    await page.locator('.react-flow__node[data-id="arrange-a"] [data-node-details]').click();
    const readingPanel = page.locator('[data-focus-panel]');
    await readingPanel.waitFor();
    await page.locator('[data-selection-toolbar]').waitFor();
    assert.equal(await page.locator('[data-selection-toolbar]').count(), 1, 'Reading and formatting remain available together');
    const panelBox = await readingPanel.boundingBox();
    assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= width, 'Reading panel remains in the viewport');
    assert.deepEqual([...(await page.evaluate(() => window.__store.getState().selectedNodeIds))].sort(), ['arrange-a']);
    if (width === 390) await page.screenshot({ path: `${outputDir}/reading-mobile.png` });
    await readingPanel.getByTitle('关闭面板', { exact: true }).click();
    await page.locator('[data-selection-toolbar]').waitFor();
    const closedNodes = await readNodes();
    assert.equal(closedNodes.length, 3);
    assert.deepEqual([...(await page.evaluate(() => window.__store.getState().selectedNodeIds))].sort(), ['arrange-a']);
    assert.equal(await page.evaluate(() => window.__store.getState().selectedNodeId), 'arrange-a');
    await page.locator('[data-node-format-reopen]').click();
    const toolbarBox = await page.locator('[data-selection-toolbar]').boundingBox();
    assert.ok(toolbarBox && toolbarBox.x >= 0 && toolbarBox.x + toolbarBox.width <= width, 'Restored selection toolbar remains in the viewport');
    assert.equal(await page.locator('[data-selection-align]').count(), 1);
    assert.equal(await page.locator('[data-selection-group]').count(), 0);
    assert.ok(await page.locator('[data-create-selection-frame]').isVisible());
    if (width === 390) await page.screenshot({ path: `${outputDir}/reading-closed-mobile.png` });
    check(`reading at ${width}px coexists with formatting and closing preserves the selection within the viewport`);
  }
  assert.deepEqual(errors, [], 'No runtime errors');
  assert.deepEqual(writes, [], 'No external write/model requests');
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  console.log(`All ${checks.length} arrangement UI checks passed.`);
} catch (error) {
  await page.screenshot({ path: `${outputDir}/failure.png` }).catch(() => {});
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
