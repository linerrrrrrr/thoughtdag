// Object selection and geometry inspector regression; isolated fixtures, no model calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5186';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/node-format';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
// Keep concurrent development edits from replacing a store during a gesture.
await context.routeWebSocket(/.*/, socket => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const closeTo = (a, b, message) => assert.ok(Math.abs(a - b) < 1, `${message}: ${a} != ${b}`);
const readNodes = () => page.evaluate(() => window.__store.getState().nodes);
const selected = () => page.evaluate(() => [...window.__store.getState().selectedNodeIds].sort());
const assertSelectionSync = async expected => {
  assert.deepEqual(await selected(), expected);
  assert.deepEqual(await page.locator('.react-flow__node.selected').evaluateAll(nodes => nodes.map(n => n.dataset.id).sort()), expected, 'Rendered selection agrees with app selection');
  assert.deepEqual(await page.evaluate(() => window.__rf.getNodes().filter(n => n.selected).map(n => n.id).sort()), expected, 'Flow selection agrees with app selection');
};
const node = id => page.locator(`.react-flow__node[data-id="format-${id}"]`);
const field = name => page.locator(`[data-node-format-field="${name}"]`);
const expandInspector = async () => {
  await page.locator('[data-selection-properties]').waitFor();
  const reopen = page.locator('[data-node-format-reopen]');
  if (await reopen.count()) await reopen.click();
  await page.locator('[data-node-format-panel]').waitFor();
};
const select = async ids => {
  const changed = await page.evaluate(ids => {
    const state = window.__store.getState();
    const next = ids.map(id => `format-${id}`);
    const changed = [...state.selectedNodeIds].sort().join('\n') !== [...next].sort().join('\n');
    state.setSelectedNodeIds(next);
    return changed;
  }, ids);
  if (changed && ids.length) await page.locator('[data-node-format-close]').waitFor();
};
const geometry = nodes => nodes.map(({ id, width, height, position, data }) => ({ id, width, height, position, lock: !!data.lockAspectRatio }));
const screenshot = name => page.screenshot({ path: `${outputDir}/${name}.png` });
const fixture = async (ids = []) => {
  // Clear React Flow's gesture state as a real selection change would.
  await page.mouse.click(1150, 950);
  await page.evaluate(ids => {
    const data = label => ({
      question: `用于验证对象选择与格式的研究问题。${label}`, displayName: label,
      response: '尺寸与位置可以独立设置；选择只影响画布对象，不改变上下文连接。',
      responses: ['尺寸与位置可以独立设置；选择只影响画布对象，不改变上下文连接。'], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 20, highlights: [], highlightMode: 'tag', attachments: [],
      excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: false, isBranch: false,
    });
    const nodes = [
      { id: 'format-a', type: 'thought', position: { x: 100, y: 180 }, width: 400, height: 260, data: data('研究问题') },
      { id: 'format-b', type: 'thought', position: { x: 620, y: 180 }, width: 480, height: 300, data: data('分析材料') },
      { id: 'format-c', type: 'thought', position: { x: 100, y: 600 }, width: 440, height: 280, data: data('结论摘要') },
    ].map(n => ({ ...n, selected: ids.includes(n.id) }));
    window.__store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0, selectedNodeIds: ids, selectedNodeId: ids.length === 1 ? ids[0] : null });
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__rf.setViewport({ x: 30, y: 30, zoom: 1 }, { duration: 0 });
  }, ids.map(id => `format-${id}`));
  await page.waitForFunction(() => window.__store.getState().nodes.every(n => n.measured?.width && n.measured?.height));
  // Let the initial empty-project camera settle before placing a deterministic viewport.
  await page.waitForTimeout(550);
  await page.evaluate(() => window.__rf.setViewport({ x: 30, y: 30, zoom: 1 }, { duration: 0 }));
  await page.waitForTimeout(120);
};
// Use actual hit testing: a selected card may be covered by the multi-selection
// surface, whose modifier and click handling is part of the behavior under test.
const clickAt = async (locator, position, modifiers = []) => {
  const bounds = await locator.boundingBox(); assert.ok(bounds);
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  try { await page.mouse.click(bounds.x + position.x, bounds.y + position.y); }
  finally { for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier); }
};
const clickNode = (id, modifiers = []) => clickAt(node(id).locator('.drag-handle').first(), { x: 100, y: 18 }, modifiers);
const marquee = async (box, modifiers = []) => {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 12 });
  await page.mouse.up();
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  await page.waitForTimeout(100);
};
const enclose = async id => {
  const b = await node(id).boundingBox();
  assert.ok(b);
  return { x1: b.x - 14, y1: b.y - 14, x2: b.x + b.width + 14, y2: b.y + b.height + 14 };
};
const commit = async (name, value) => { await expandInspector(); await field(name).fill(String(value)); await field(name).press('Enter'); await page.waitForTimeout(100); };
const blur = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const assertPanelFits = async () => {
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-selection-properties]')?.getBoundingClientRect();
    return box && box.x >= 0 && box.y >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
  });
  const b = await page.locator('[data-selection-properties]').boundingBox();
  const v = page.viewportSize();
  assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= v.width + 1 && b.y + b.height <= v.height + 1, 'Inspector remains within viewport');
  const header = await page.locator('[data-canvas-header]').boundingBox();
  assert.ok(!header || b.y >= header.y + header.height + 4, 'Inspector leaves the wrapped canvas header unobstructed');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal page overflow');
};

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__store.getState().setSelectionGeometry);
  if (process.env.FORMAT_ONLY !== '1') {
  await fixture();
  const a = await enclose('a');
  await marquee({ ...a, x2: a.x1 + 230 });
  assert.deepEqual(await selected(), [], 'A partially covered node is not selected');
  await page.keyboard.press('Escape');
  await marquee(a);
  assert.deepEqual(await selected(), ['format-a']);
  check('marquee requires full node coverage');

  await page.evaluate(() => window.__store.setState({ edges: [{ id: 'format-edge', source: 'format-a', target: 'format-b', type: 'thought', selected: true, data: {} }] }));
  await marquee(await enclose('a'));
  const assertNodeOnlySelection = async () => {
    assert.ok(await page.evaluate(() => window.__store.getState().edges.every(edge => !edge.selected) && window.__rf.getEdges().every(edge => !edge.selected)));
    assert.equal(await page.locator('.react-flow__edge.selected').count(), 0);
    assert.equal(await page.locator('[data-edge-inspector]').count(), 0);
  };
  await assertNodeOnlySelection();
  const edgePath = page.locator('.react-flow__edge .react-flow__edge-path').first();
  const edgePoint = await edgePath.evaluate(path => {
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await page.locator('[data-edge-inspector]').waitFor();
  assert.ok(await page.evaluate(() => window.__store.getState().edges.some(edge => edge.selected)), 'Direct edge clicks still select a wire');
  await marquee(await enclose('a'), ['Control']);
  await assertNodeOnlySelection();
  await marquee(await enclose('b'), ['Control']);
  assert.deepEqual(await selected(), ['format-a', 'format-b']);
  await assertNodeOnlySelection();
  check('plain and additive marquees select nodes only, while direct edge clicks still open the edge editor');
  await fixture(['a']);

  await clickAt(node('b').locator('.markdown-body').first(), { x: 20, y: 15 }, ['Control']);
  assert.deepEqual(await selected(), ['format-a', 'format-b'], 'Ctrl-click works in the node body as well as its header');
  await clickAt(node('b').locator('.markdown-body').first(), { x: 20, y: 15 }, ['Control']);
  assert.deepEqual(await selected(), ['format-a'], 'Ctrl-click in body toggles an existing selection');
  check('node body and header share modifier selection semantics');

  await clickNode('b', ['Control']);
  assert.deepEqual(await selected(), ['format-a', 'format-b']);
  await clickNode('a', ['Control']);
  assert.deepEqual(await selected(), ['format-b']);
  await marquee(await enclose('c'), ['Control']);
  await assertSelectionSync(['format-b', 'format-c']);
  const beforeMultiDrag = await readNodes();
  const bHeader = await node('b').locator('.drag-handle').first().boundingBox();
  await page.mouse.move(bHeader.x + 100, bHeader.y + 18);
  await page.mouse.down();
  await page.mouse.move(bHeader.x + 130, bHeader.y + 38, { steps: 10 });
  await page.mouse.up();
  const afterMultiDrag = await readNodes();
  const dx = afterMultiDrag[1].position.x - beforeMultiDrag[1].position.x;
  const dy = afterMultiDrag[1].position.y - beforeMultiDrag[1].position.y;
  assert.ok(dx > 10 && dy > 5, 'Selected card moves after the drag threshold');
  closeTo(afterMultiDrag[2].position.x - beforeMultiDrag[2].position.x, dx, 'Other selected card moves equally');
  closeTo(afterMultiDrag[2].position.y - beforeMultiDrag[2].position.y, dy, 'Other selected card moves equally vertically');
  assert.deepEqual(afterMultiDrag[0].position, beforeMultiDrag[0].position, 'Unselected node stays fixed');
  await assertSelectionSync(['format-b', 'format-c']);
  await clickNode('a');
  assert.deepEqual(await selected(), ['format-a']);
  await clickNode('b', ['Shift']);
  assert.deepEqual(await selected(), ['format-a', 'format-b']);
  await clickNode('b', ['Shift']);
  assert.deepEqual(await selected(), ['format-a']);
  await marquee(await enclose('c'), ['Shift']);
  assert.deepEqual(await selected(), ['format-a', 'format-c']);
  await page.mouse.click(1120, 850);
  assert.deepEqual(await selected(), []);
  check('Ctrl/Shift clicks toggle, modified marquee adds, plain click replaces and blank click clears');

  await fixture();
  await page.keyboard.press('Control+a');
  assert.deepEqual(await selected(), ['format-a', 'format-b', 'format-c']);
  await page.locator('[data-selection-properties]').waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(), ['format-a', 'format-b', 'format-c'], 'Escape first closes properties without changing the selection');
  assert.equal(await page.locator('[data-selection-properties]').count(), 0);
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(), []);
  await blur();
  await page.keyboard.press('Tab');
  assert.deepEqual(await selected(), ['format-a']);
  await page.keyboard.press('Tab');
  assert.deepEqual(await selected(), ['format-b']);
  await page.keyboard.press('Shift+Tab');
  assert.deepEqual(await selected(), ['format-a']);
  await clickNode('a');
  await expandInspector();
  await field('width').focus();
  await field('width').press('Control+a');
  assert.deepEqual(await selected(), ['format-a'], 'Ctrl+A in an input does not select canvas objects');
  check('Ctrl+A, Escape and forward/backward Tab selection apply only at canvas focus');

  await fixture(['a', 'b']);
  await page.evaluate(() => window.__store.setState(state => ({ nodes: state.nodes.map((node, index) => index < 2
    ? { ...node, data: { ...node.data, canvasGroupId: 'legacy-format' } } : node) })));
  await select([]);
  await marquee(await enclose('a'));
  await assertSelectionSync(['format-a']);
  assert.equal(await page.locator('[data-select-whole-group], [data-selection-group]').count(), 0);
  await select(['a', 'b']);
  await assertSelectionSync(['format-a', 'format-b']);
  const groupedCard = await node('a').boundingBox(); assert.ok(groupedCard);
  await page.mouse.click(groupedCard.x + 100, groupedCard.y + 18);
  await assertSelectionSync(['format-a']);
  await commit('width', 450);
  assert.equal((await readNodes())[0].width, 450);
  assert.equal((await readNodes())[1].width, 480, 'Editing a selected member never changes its unselected sibling');
  await select([]);
  const ga = await enclose('a'), gb = await enclose('b');
  await marquee({ x1: ga.x1, y1: ga.y1, x2: gb.x2, y2: Math.max(ga.y2, gb.y2) });
  await assertSelectionSync(['format-a', 'format-b']);
  check('legacy group metadata is inert during single selection, ordinary multi-selection and independent editing');
  }

  await fixture(['a']);
  await page.locator('[data-node-format-panel]').waitFor();
  assert.equal(await page.locator('[data-node-format-close]').getAttribute('aria-expanded'), 'true');
  assert.ok(await field('width').isVisible(), 'A new selection starts with the object inspector expanded');
  assert.equal(await page.locator('[data-node-format-height-mode], [data-node-format-auto-height], [data-node-format-auto-height-hint]').count(), 0);
  check('object inspector is expanded by default with geometry controls immediately available');
  assert.equal(await field('width').inputValue(), '400');
  assert.equal(await field('height').inputValue(), '260');
  assert.equal(await field('x').inputValue(), '100');
  assert.equal(await field('y').inputValue(), '180');
  const original = geometry(await readNodes());
  await field('width').fill('560');
  await field('width').press('Tab');
  assert.deepEqual(geometry(await readNodes()), original, 'Moving within geometry region does not commit');
  await field('height').fill('340');
  await field('height').press('Escape');
  assert.deepEqual(geometry(await readNodes()), original, 'Escape cancels pending fields');
  assert.deepEqual(await selected(), ['format-a'], 'Escape from field does not clear selection');
  check('geometry draft is an edit boundary: internal Tab retains draft and Escape cancels only it');

  await field('width').fill('560');
  await field('height').fill('340');
  await field('height').press('Enter');
  closeTo((await readNodes())[0].width, 560, 'Committed width');
  closeTo((await readNodes())[0].height, 340, 'Committed height');
  await blur();
  await page.keyboard.press('Control+z');
  assert.deepEqual(geometry(await readNodes()), original, 'One undo restores the whole geometry edit');
  await page.keyboard.press('Control+y');
  closeTo((await readNodes())[0].height, 340, 'Redo restores geometry');
  await commit('x', -40);
  await commit('y', 210);
  assert.deepEqual((await readNodes())[0].position, { x: -40, y: 210 });
  check('single geometry supports width, height, signed coordinates and atomic undo/redo');

  await fixture(['a']);
  await expandInspector();
  await field('width').fill('700');
  await field('width').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  assert.equal((await readNodes())[0].width, 400, 'IME Enter does not commit');
  await field('width').press('Escape');
  await field('width').fill('-1');
  await field('width').press('Enter');
  assert.equal((await readNodes())[0].width, 400, 'Invalid width cannot change geometry');
  await field('width').press('Escape');
  await field('width').fill('');
  await field('width').press('Enter');
  assert.equal((await readNodes())[0].width, 400, 'An empty value is not zero');
  await field('width').press('Escape');
  check('IME confirmation, invalid values and empty dimensions never commit accidental geometry');

  await field('width').fill('700');
  await page.locator('[data-selection-section="nodes"] h3').first().click();
  assert.equal((await readNodes())[0].width, 400, 'Leaving the geometry boundary keeps a draft without applying it');
  assert.equal(await field('width').inputValue(), '700');
  await page.locator('[data-selection-properties-close]').click();
  assert.deepEqual(await selected(), ['format-a'], 'Closing properties keeps the selection');
  assert.equal(await page.locator('[data-selection-properties]').count(), 0);
  await clickNode('a'); await expandInspector();
  assert.equal(await field('width').inputValue(), '700', 'Reopening the same selection restores its geometry draft');
  await field('width').fill('');
  await page.locator('[data-selection-properties-close]').click();
  await clickNode('a'); await expandInspector();
  assert.equal(await field('width').inputValue(), '', 'An empty geometry draft is distinct from an absent draft');
  assert.equal((await readNodes())[0].width, 400);
  await page.keyboard.press('Escape');
  assert.equal(await field('width').inputValue(), '400');
  assert.deepEqual(await selected(), ['format-a']);
  check('outside focus and closing preserve unapplied geometry drafts, including empty input; Escape cancels without closing');

  await fixture(['a', 'b']);
  await expandInspector();
  assert.equal(await field('width').inputValue(), '');
  assert.equal(await field('height').inputValue(), '');
  assert.equal(await field('x').count(), 0);
  assert.equal(await field('y').count(), 0);
  assert.equal(await field('width').getAttribute('placeholder'), '400~480');
  assert.equal(await field('height').getAttribute('placeholder'), '260~300');
  const beforeMulti = await readNodes();
  await commit('width', 600);
  const afterMulti = await readNodes();
  assert.equal(afterMulti[0].width, 600);
  assert.equal(afterMulti[1].width, 600);
  assert.equal(afterMulti[0].height, beforeMulti[0].height);
  assert.equal(afterMulti[1].height, beforeMulti[1].height);
  assert.deepEqual(afterMulti.map(n => n.position), beforeMulti.map(n => n.position));
  assert.equal(afterMulti[2].width, beforeMulti[2].width);
  check('multi-selection shows size ranges, edits selected dimensions uniformly and never unifies coordinates');

  await fixture(['a', 'b']);
  await expandInspector();
  const beforeRatio = await readNodes();
  await page.locator('[data-node-format-lock]').check();
  assert.ok((await readNodes()).slice(0, 2).every(n => n.data.lockAspectRatio));
  await field('width').fill('640');
  assert.equal(await field('height').getAttribute('placeholder'), '400~416', 'Locked heights update while typing a width');
  assert.deepEqual((await readNodes()).slice(0, 2).map(node => node.width), [400, 480], 'Typing remains a cancellable draft');
  await field('width').press('Enter');
  const locked = await readNodes();
  locked.slice(0, 2).forEach((n, i) => closeTo(n.width / n.height, beforeRatio[i].width / beforeRatio[i].height, 'Each original ratio is retained'));
  assert.ok(locked[0].height !== locked[1].height, 'Different ratios are not flattened');
  await field('height').fill('520');
  assert.equal(await field('width').getAttribute('placeholder'), '800~832', 'Locked widths update while typing a height');
  await field('height').press('Enter');
  const heightDriven = (await readNodes()).slice(0, 2);
  assert.deepEqual(heightDriven.map(node => node.height), [520, 520]);
  assert.deepEqual(heightDriven.map(node => node.width), [800, 832]);
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual(geometry(await readNodes()), geometry(locked), 'Both dimensions undo together');
  await select(['a']);
  await expandInspector();
  await page.locator('[data-node-format-lock]').uncheck();
  await select(['a', 'b']);
  await expandInspector();
  assert.ok(await page.locator('[data-node-format-lock]').evaluate(el => el.indeterminate), 'Mixed lock values are represented');
  check('typing either locked dimension synchronizes the other range and preserves each selected object’s ratio');

  await fixture(['a']);
  await expandInspector();
  await page.locator('[data-node-format-lock]').check();
  const beforeTyping = geometry(await readNodes());
  await field('width').fill('600');
  assert.equal(await field('height').inputValue(), '390');
  await field('height').fill('520');
  assert.equal(await field('width').inputValue(), '800', 'The most recently typed axis drives the paired value');
  await field('height').press('Escape');
  assert.equal(await field('width').inputValue(), '400');
  assert.equal(await field('height').inputValue(), '260');
  assert.deepEqual(geometry(await readNodes()), beforeTyping, 'Escape cancels both dimensions');
  await field('height').fill('390');
  assert.equal(await field('width').inputValue(), '600');
  await field('height').press('Enter');
  assert.equal((await readNodes())[0].width, 600);
  assert.equal((await readNodes())[0].height, 390);
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual(geometry(await readNodes()), beforeTyping);
  check('single-node paired fields synchronize immediately in both directions and cancel or undo together');
  const beforeResize = (await readNodes())[0];
  const corner = await node('a').locator('.thought-resize-corner').boundingBox();
  assert.ok(corner);
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + 94, corner.y + 37, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const afterResize = (await readNodes())[0];
  assert.ok(afterResize.width > beforeResize.width + 30);
  closeTo(afterResize.width / afterResize.height, beforeResize.width / beforeResize.height, 'Manual corner resize obeys ratio lock');
  const side = await node('a').locator('.thought-resize-side').boundingBox();
  assert.ok(side);
  await page.mouse.move(side.x + side.width / 2, side.y + side.height / 2);
  await page.mouse.down();
  await page.mouse.move(side.x + 62, side.y + side.height / 2, { steps: 10 });
  await page.mouse.up();
  const afterSideResize = (await readNodes())[0];
  assert.ok(afterSideResize.width > afterResize.width + 20, 'Side resize changes width');
  assert.ok(afterSideResize.height > afterResize.height + 10, `Locked side resize also changes height: ${JSON.stringify({before:geometry([afterResize]),after:geometry([afterSideResize])})}`);
  closeTo(afterSideResize.width / afterSideResize.height, beforeResize.width / beforeResize.height, 'Manual side resize obeys ratio lock');
  const saved = geometry(await readNodes());
  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  assert.deepEqual(geometry(await readNodes()), saved);
  check('corner and side resize honor aspect lock and geometry persists across reload');

  await fixture(['a']);
  await expandInspector();
  await page.evaluate(() => window.__rf.setViewport({ x: 70, y: 70, zoom: 0.45 }, { duration: 0 }));
  await page.waitForTimeout(300);
  assert.equal(await field('width').inputValue(), '400');
  assert.equal(await field('height').inputValue(), '260');
  await commit('width', 550);
  assert.equal((await readNodes())[0].width, 550);
  assert.equal((await readNodes())[0].height, 260);
  check('format values use logical canvas units even when semantic zoom changes the preview');

  await fixture(['a']);
  await expandInspector();
  await assertPanelFits();
  assert.equal(await page.locator('[data-node-format-content]').evaluate(element => element.tagName), 'DIV', 'Content actions have no collapse toggle');
  assert.ok(await page.locator('[data-node-format-panel]').getByRole('button', { name: '合并摘要', exact: true }).isVisible(), 'Content actions are visible in the expanded inspector');
  await page.locator('[data-node-format-panel]').getByRole('button', { name: '探索', exact: true }).click();
  const exploreDraft = page.locator('[data-node-format-panel] input:not([data-node-format-field]):not([type="checkbox"])');
  await exploreDraft.fill('保留这份探索草稿，不调用模型');
  await page.locator('[data-node-format-close]').click();
  await page.locator('[data-node-format-reopen]').click();
  await page.locator('[data-node-format-panel]').getByRole('button', { name: '探索', exact: true }).click();
  assert.equal(await exploreDraft.inputValue(), '保留这份探索草稿，不调用模型');
  await exploreDraft.press('Escape');
  assert.equal(await exploreDraft.count(), 0);
  assert.deepEqual(await selected(), ['format-a']);
  check('content input draft survives panel collapse and Escape cancels only the pending action without generation');
  await page.locator('[data-node-format-close]').click();
  assert.deepEqual(await selected(), ['format-a']);
  assert.equal(await field('width').isVisible(), false);
  await page.locator('[data-node-format-reopen]').click();
  assert.equal(await field('width').inputValue(), '400');
  check('collapsing and reopening the inspector preserves selection and saved geometry');
  await screenshot('desktop-single');
  await page.locator('[data-node-format-close]').click();
  await select(['a', 'b']);
  assert.ok(await field('width').isVisible(), 'Changing the selected objects expands the inspector again');
  assert.equal(await page.locator('[data-node-format-close]').getAttribute('aria-expanded'), 'true');
  await assertPanelFits();
  await screenshot('desktop-multi');
  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await screenshot('dark-multi');
  await page.locator('[data-toolbar-more]').click();
  await page.locator('[data-menu-language]').getByRole('button', { name: 'English', exact: true }).click();
  await page.keyboard.press('Escape');
  await select([]); await select(['a', 'b']);
  await page.locator('[data-node-format-panel]').waitFor();
  await assertPanelFits();
  await screenshot('english-multi');
  await screenshot('english-content');
  await page.locator('[data-toolbar-more]').click();
  await page.locator('[data-menu-language]').getByRole('button', { name: '中文', exact: true }).click();
  await page.keyboard.press('Escape');
  await select([]); await select(['a', 'b']);
  await page.locator('[data-node-format-panel]').waitFor();
  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light'));
  await page.setViewportSize({ width: 390, height: 844 });
  await assertPanelFits();
  await screenshot('mobile-multi');
  await page.locator('[data-selection-align]').click();
  const menu = await page.getByRole('menu', { name: '对齐', exact: true }).boundingBox();
  assert.ok(menu && menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= 390 && menu.y + menu.height <= 844);
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(), ['format-a', 'format-b'], 'Closing a child menu does not clear selection');
  await page.setViewportSize({ width: 800, height: 500 });
  await assertPanelFits();
  await screenshot('short-viewport');
  const footerAction = page.locator('[data-node-format-panel] footer button').last();
  await footerAction.scrollIntoViewIfNeeded();
  const footerBox = await footerAction.boundingBox();
  const panelBox = await page.locator('[data-selection-properties]').boundingBox();
  assert.ok(footerBox && footerBox.y >= panelBox.y && footerBox.y + footerBox.height <= panelBox.y + panelBox.height, 'Short viewport scroll reveals complete footer controls');
  await screenshot('short-scrolled');
  await page.locator('[data-selection-align]').click();
  const shortAlign = await page.getByRole('menu', { name: '对齐', exact: true }).boundingBox();
  assert.ok(shortAlign && shortAlign.height >= 180 && shortAlign.y >= 0 && shortAlign.y + shortAlign.height <= 500, 'Short viewport alignment menu has usable room');
  const lastAlign = page.locator('[data-arrange-action]').last();
  await lastAlign.scrollIntoViewIfNeeded();
  assert.ok(await lastAlign.isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-selection-group]').count(), 0);
  await page.locator('[data-create-selection-frame]').click();
  assert.equal((await readNodes()).filter(n => n.data.stepKind === 'frame').length, 1, 'Direct partition creation is reachable in a short viewport');
  check('desktop, narrow and short viewports, both themes and languages keep the panel and menus accessible');
  assert.deepEqual(errors, [], 'No runtime errors');
  assert.deepEqual(writes, [], 'No external writes or model calls');
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  console.log(`All ${checks.length} object-format UI checks passed.`);
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
