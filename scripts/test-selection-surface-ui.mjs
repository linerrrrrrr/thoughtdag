// The multi-selection surface owns movement and corner resizing, at real canvas zoom.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/selection-surface';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
// Concurrent edits must not swap the store between pointerdown and pointerup.
await context.routeWebSocket(/.*/, socket => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], writes = [], checks = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} != ${expected}`);
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
// Run independent compatibility checks even when an earlier probe finds a regression.
async function probe(name, run) {
  try { await run(); check(name); }
  catch (error) {
    failures.push({ name, error: String(error) });
    console.error(`FAIL ${name}: ${error}`);
    await page.screenshot({ path: `${output}/probe-failure-${failures.length}.png` }).catch(() => {});
  } finally {
    await page.keyboard.up('Control'); await page.keyboard.up('Shift');
    await page.mouse.up({ button: 'middle' }); await page.mouse.up({ button: 'right' });
  }
}
const geometry = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position, width, height, data }) => ({ id, position, width, height, keepOverviewHeight: data.keepOverviewHeight })));
const wiring = () => page.evaluate(() => window.__store.getState().edges.map(({ selected: _selected, ...edge }) => edge));
const selection = () => page.evaluate(() => [...window.__store.getState().selectedNodeIds].sort());
const selected = async expected => {
  await page.waitForFunction(expected => JSON.stringify([...window.__store.getState().selectedNodeIds].sort()) === JSON.stringify(expected), [...expected].sort());
  assert.deepEqual(await selection(), [...expected].sort());
};
const undo = () => page.evaluate(() => window.__store.getState().undo());
const redo = () => page.evaluate(() => window.__store.getState().redo());
const selectPair = () => page.evaluate(() => window.__store.getState().setSelectedNodeIds(['a', 'b']));
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const viewport = () => page.evaluate(() => window.__rf.getViewport());

async function cardPoint(id) {
  const card = await node(id).boundingBox(); assert.ok(card);
  return { x: card.x + card.width * 0.7, y: card.y + card.height * 0.5 };
}

async function colorRegionAt(point) {
  assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-selection-move]'), point), true,
    'The tested pointer position is covered by the selection surface');
}

async function panPoint(point, button) {
  const before = await viewport();
  await page.mouse.move(point.x, point.y); await page.mouse.down({ button });
  await page.mouse.move(point.x + 48, point.y + 32, { steps: 12 }); await page.mouse.up({ button });
  await page.waitForTimeout(120);
  const after = await viewport();
  near(after.x, before.x + 48, `${button} pan x`); near(after.y, before.y + 32, `${button} pan y`);
  assert.equal(after.zoom, before.zoom);
}

async function fixture({ zoom = 1, preselect = false, locked = false, frames = false } = {}) {
  await page.keyboard.press('Escape');
  await page.evaluate(({ preselect, locked, frames }) => {
    const data = (id, extra = {}) => ({ question: `研究节点 ${id}`, displayName: `研究节点 ${id}`,
      response: 'A stable answer for pointer gesture tests.', responses: ['A stable answer for pointer gesture tests.'], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, isRoot: false, isBranch: false,
      highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 10, roleMode: 'inherit', ...extra });
    let nodes = [
      { id: 'a', position: { x: 140, y: 140 }, width: 400, height: 240, data: data('a', { canvasGroupId: 'group-ab', lockAspectRatio: locked }) },
      { id: 'b', position: { x: 140, y: 480 }, width: 440, height: 260, data: data('b', { canvasGroupId: 'group-ab' }) },
      { id: 'c', position: { x: 800, y: 180 }, width: 400, height: 240, data: data('c') },
      { id: 'd', position: { x: 800, y: 540 }, width: 400, height: 240, data: data('d') },
    ];
    let ids = preselect ? ['a', 'b'] : [];
    if (frames) {
      nodes = [
        { id: 'frame', position: { x: 100, y: 100 }, width: 1000, height: 900, data: data('frame', { stepKind: 'frame', frameCarry: true }) },
        { id: 'inside', position: { x: 160, y: 230 }, width: 400, height: 240, data: data('inside') },
        { id: 'inside-two', position: { x: 160, y: 570 }, width: 400, height: 240, data: data('inside-two') },
        { id: 'partial-in', position: { x: 640, y: 260 }, width: 400, height: 240, data: data('partial-in', { canvasGroupId: 'partial' }) },
        { id: 'partial-out', position: { x: 1260, y: 260 }, width: 400, height: 240, data: data('partial-out', { canvasGroupId: 'partial' }) },
      ];
      ids = ['frame', 'inside'];
    }
    nodes = nodes.map(item => ({ ...item, type: 'thought', selected: ids.includes(item.id) }));
    const edges = frames ? [] : [
      { id: 'ab', source: 'a', target: 'b' }, { id: 'cd', source: 'c', target: 'd' },
    ].map(edge => ({ ...edge, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top', data: { route: 'curve' } }));
    window.__canvasEditing.getState().setSelectionTarget('nodes');
    window.__canvasEditing.getState().setEdgeId(null);
    window.__canvasEditing.getState().setLayoutOpen(false);
    window.__store.setState({ nodes, edges, selectedNodeIds: ids, selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
    window.__ui.setState({ panelOpen: false, panelNodeId: null, tutorialOpen: false, releaseNotesOpen: false, autoRefreshPaused: true, drafts: {} });
  }, { preselect, locked, frames });
  await page.waitForTimeout(650);
  await page.evaluate(zoom => window.__rf.setViewport({ x: 80, y: zoom === 1 ? 20 : 110, zoom }, { duration: 0 }), zoom);
  await page.waitForFunction(() => window.__store.getState().nodes.every(item => item.measured?.width && item.measured?.height));
  await page.waitForTimeout(120);
  if (preselect || frames) await page.locator('[data-selection-move]').waitFor();
}

async function marqueePair() {
  const a = await node('a').boundingBox(), b = await node('b').boundingBox();
  assert.ok(a && b);
  const left = Math.min(a.x, b.x) - 12, top = Math.min(a.y, b.y) - 12;
  const right = Math.max(a.x + a.width, b.x + b.width) + 12, bottom = Math.max(a.y + a.height, b.y + b.height) + 12;
  await page.mouse.move(left, top); await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 12 }); await page.mouse.up();
  await selected(['a', 'b']);
  await page.locator('[data-selection-move]').waitFor();
}

async function dragPoint(point, dx, dy, cancel) {
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 12 });
  if (cancel === 'escape') await page.keyboard.press('Escape');
  if (cancel === 'pointer') await page.locator('[data-selection-move]').dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function gapPoint() {
  const a = await node('a').boundingBox(), b = await node('b').boundingBox();
  assert.ok(a && b && b.y > a.y + a.height, 'Fixture has a visible gap between selected cards');
  const point = { x: Math.min(a.x + a.width, b.x + b.width) - 25, y: (a.y + a.height + b.y) / 2 };
  assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-selection-move]'), point), true, 'The entire color region owns its gap');
  return point;
}

function assertMoved(before, after, ids, dx, dy) {
  for (const original of before) {
    const current = after.find(item => item.id === original.id);
    assert.ok(current);
    if (!ids.includes(original.id)) { assert.deepEqual(current, original); continue; }
    near(current.position.x, original.position.x + dx, `${original.id} x`);
    near(current.position.y, original.position.y + dy, `${original.id} y`);
    assert.equal(current.width, original.width, `${original.id} width`);
    assert.equal(current.height, original.height, `${original.id} height`);
  }
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5206', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__canvasEditing);
  for (const zoom of [0.25, 1]) {
    await fixture({ zoom });
    await marqueePair();
    const before = await geometry(), beforeWiring = await wiring();
    await dragPoint(await gapPoint(), 32, 24);
    const after = await geometry();
    assertMoved(before, after, ['a', 'b'], 32 / zoom, 24 / zoom);
    assert.deepEqual(await wiring(), beforeWiring);
    await selected(['a', 'b']);
    await undo(); assert.deepEqual(await geometry(), before);
    await redo(); assert.deepEqual(await geometry(), after);
    check(`a real marquee at ${zoom} zoom moves its full color region rigidly and undoes/redoes once`);
    await dragPoint(await gapPoint(), 24, -16, 'escape');
    assert.deepEqual(await geometry(), after); await selected(['a', 'b']);
    await dragPoint(await gapPoint(), -16, 20, 'pointer');
    assert.deepEqual(await geometry(), after); await selected(['a', 'b']);
    check(`Escape and pointer cancellation restore the entire moving selection at ${zoom} zoom`);
    await page.screenshot({ path: `${output}/group-move-${zoom}.png` });

    await fixture({ zoom, preselect: true });
    const programmedBefore = await geometry();
    const a = await node('a').boundingBox(); assert.ok(a);
    await dragPoint({ x: a.x + a.width * 0.7, y: a.y + a.height * 0.6 }, 20, 15);
    assertMoved(programmedBefore, await geometry(), ['a', 'b'], 20 / zoom, 15 / zoom);
    check(`a programmatic selection can move from over a card, not only the gaps, at ${zoom} zoom`);

    await fixture({ zoom, preselect: true });
    const cornerBefore = await geometry();
    await page.locator('[data-selection-resize="both"]').hover();
    const corner = await page.locator('[data-selection-resize="both"]').boundingBox(); assert.ok(corner);
    await dragPoint({ x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }, 40 * zoom, 60 * zoom);
    const cornerAfter = await geometry();
    for (const id of ['a', 'b']) {
      const original = cornerBefore.find(item => item.id === id), current = cornerAfter.find(item => item.id === id);
      near(current.width, original.width + 40, `${id} corner width`); near(current.height, original.height + 60, `${id} corner height`);
      assert.deepEqual(current.position, original.position);
    }
    for (const id of ['c', 'd']) assert.deepEqual(cornerAfter.find(item => item.id === id), cornerBefore.find(item => item.id === id));
    await undo(); assert.deepEqual(await geometry(), cornerBefore);
    await redo(); assert.deepEqual(await geometry(), cornerAfter);
    check(`releasing the corner commits both dimensions with one undo step at ${zoom} zoom`);

    await fixture({ zoom, preselect: true, locked: true });
    const mixedBefore = await geometry();
    await page.locator('[data-selection-resize="both"]').hover();
    const mixedCorner = await page.locator('[data-selection-resize="both"]').boundingBox(); assert.ok(mixedCorner);
    await dragPoint({ x: mixedCorner.x + mixedCorner.width / 2, y: mixedCorner.y + mixedCorner.height / 2 }, 2 * zoom, 60 * zoom);
    const mixedAfter = await geometry();
    const locked = mixedAfter.find(item => item.id === 'a'), free = mixedAfter.find(item => item.id === 'b');
    near(locked.width, 500, 'locked width follows the dominant height change'); near(locked.height, 300, 'locked height');
    near(free.width, 442, 'unlocked width'); near(free.height, 320, 'unlocked height');
    for (const original of mixedBefore) assert.deepEqual(mixedAfter.find(item => item.id === original.id).position, original.position);
    await undo(); assert.deepEqual(await geometry(), mixedBefore);
    check(`mixed aspect locks honor a height-dominant corner drag at ${zoom} zoom`);
  }

  await fixture({ zoom: 0.6, preselect: true });
  const memberBefore = await geometry();
  const memberPoint = await cardPoint('a'); await colorRegionAt(memberPoint);
  await page.mouse.click(memberPoint.x, memberPoint.y); await selected(['a']);
  assert.deepEqual(await geometry(), memberBefore, 'Drilling into a member must not move any object');
  assert.equal(await page.locator('[data-selection-move]').count(), 0);
  assert.equal(await page.locator('[data-select-whole-group], [data-selection-group]').count(), 0);
  await selectPair(); await selected(['a', 'b']);
  await page.locator('[data-selection-move]').waitFor();
  const gap = await gapPoint(); await page.mouse.click(gap.x, gap.y); await selected(['a', 'b']);
  assert.deepEqual(await geometry(), memberBefore, 'A click in the selection gap retains the selection without moving it');
  check('a plain click on a covered node selects it alone, and ordinary multi-selection restores the movable region');

  await fixture({ zoom: 0.6, preselect: true });
  await page.mouse.click(1080, 850); await selected([]);
  await selectPair(); await page.locator('[data-selection-move]').waitFor();
  await node('c').locator('.drag-handle').first().click({ position: { x: 80, y: 20 } });
  await selected(['c']);
  assert.equal(await page.locator('[data-selection-resizer]').count(), 0);
  check('outside pane and another node cancel the old multi-selection, while the new node still selects');

  await selectPair(); await page.locator('[data-selection-move]').waitFor();
  const line = await page.locator('.react-flow__edge[data-id="cd"] .react-flow__edge-path').evaluate(path => {
    const p = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()); return { x: p.x, y: p.y };
  });
  await page.mouse.click(line.x, line.y); await selected([]);
  await page.locator('[data-edge-inspector]').waitFor();
  check('clicking an outside line clears the node selection and opens that line editor');

  await probe('the toolbar overflow menu preserves selection for its contained selection actions', async () => {
    await page.evaluate(() => window.__canvasEditing.getState().setEdgeId(null));
    await selectPair(); await page.locator('[data-selection-move]').waitFor();
    await page.locator('[data-toolbar-more]').click();
    await selected(['a', 'b']); await page.locator('[data-toolbar-more-panel]').waitFor();
    await page.keyboard.press('Escape');
  });

  await fixture({ zoom: 0.6, preselect: true });
  await page.locator('[data-node-format-reopen]').click();
  await page.locator('[data-node-format-field="width"]').fill('520');
  await page.keyboard.press('Enter'); await selected(['a', 'b']);
  for (const current of (await geometry()).filter(item => ['a', 'b'].includes(item.id))) assert.equal(current.width, 520);
  await page.locator('[data-selection-align]').click();
  await page.getByRole('menu', { name: '对齐', exact: true }).waitFor();
  await page.locator('[data-arrange-reference="selection"]').click(); await selected(['a', 'b']);
  await page.keyboard.press('Escape'); await selected(['a', 'b']);
  check('the selection format editor and its portal menu stay inside the editing boundary');
  await page.locator('[data-selection-target="edges"]').click();
  assert.deepEqual(await page.evaluate(() => window.__store.getState().edges.filter(edge => edge.selected).map(edge => edge.id)), ['ab']);
  await page.locator('[data-selection-target="nodes"]').click(); await selected(['a', 'b']);
  check('switching the selection object type preserves the intended counterpart scope');
  await page.keyboard.down('Control');
  await node('c').locator('.drag-handle').first().click({ position: { x: 80, y: 20 } });
  await page.keyboard.up('Control'); await selected(['a', 'b', 'c']);
  await selectPair(); await selected(['a', 'b']);
  await page.keyboard.down('Shift');
  await node('d').locator('.drag-handle').first().click({ position: { x: 80, y: 20 } });
  await page.keyboard.up('Shift'); await selected(['a', 'b', 'd']);
  check('Ctrl and Shift still append outside nodes instead of dismissing the selection');

  for (const modifier of ['Control', 'Shift']) {
    await probe(`${modifier} toggles a node beneath the selected color region in both directions`, async () => {
      await fixture({ zoom: 0.6 });
      await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['a', 'b', 'd']));
      await page.locator('[data-selection-move]').waitFor();
      const point = await cardPoint('c'); await colorRegionAt(point);
      const before = await geometry();
      await page.keyboard.down(modifier); await page.mouse.click(point.x, point.y); await page.keyboard.up(modifier);
      await selected(['a', 'b', 'c', 'd']);
      await colorRegionAt(point);
      await page.keyboard.down(modifier); await page.mouse.click(point.x, point.y); await page.keyboard.up(modifier);
      await selected(['a', 'b', 'd']);
      assert.deepEqual(await geometry(), before);
      // Obsolete metadata cannot expand a modifier toggle to another node.
      const grouped = await cardPoint('a'); await colorRegionAt(grouped);
      await page.keyboard.down(modifier); await page.mouse.click(grouped.x, grouped.y); await page.keyboard.up(modifier);
      await selected(['b', 'd']);
      assert.deepEqual(await geometry(), before);
    });
  }

  let baselineContextMenu = false;
  await probe('without a multi-selection, a node right click opens its existing menu', async () => {
    await fixture({ zoom: 0.6 });
    const point = await cardPoint('a');
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.locator('[data-rename-node]').waitFor({ timeout: 2000 });
    baselineContextMenu = true;
    await page.keyboard.press('Escape');
  });
  await probe('a node right click beneath the selection surface keeps the existing node menu available', async () => {
    assert.equal(baselineContextMenu, true, 'The no-selection baseline must support this action');
    await fixture({ zoom: 0.6, preselect: true });
    const point = await cardPoint('a'); await colorRegionAt(point);
    const before = await geometry();
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.locator('[data-rename-node]').waitFor({ timeout: 2000 });
    assert.deepEqual(await geometry(), before);
    await page.keyboard.press('Escape');
  });

  for (const button of ['middle', 'right']) {
    let baselinePan = false;
    await probe(`without a multi-selection, ${button} dragging a card gap pans the viewport`, async () => {
      await fixture({ zoom: 0.6 });
      const a = await node('a').boundingBox(), b = await node('b').boundingBox(); assert.ok(a && b);
      const point = { x: a.x + a.width - 25, y: (a.y + a.height + b.y) / 2 };
      const before = await geometry();
      await panPoint(point, button);
      assert.deepEqual(await geometry(), before); baselinePan = true;
    });
    await probe(`${button} dragging the selected color region preserves viewport panning`, async () => {
      assert.equal(baselinePan, true, 'The no-selection baseline must support this action');
      await fixture({ zoom: 0.6, preselect: true });
      const before = await geometry();
      await panPoint(await gapPoint(), button);
      assert.deepEqual(await geometry(), before); await selected(['a', 'b']);
    });
  }
  await probe('a right-button pan starting over a selected card does not open its context menu', async () => {
    await fixture({ zoom: 0.6, preselect: true });
    const point = await cardPoint('a'); await colorRegionAt(point);
    const before = await geometry();
    await panPoint(point, 'right');
    assert.equal(await page.locator('[data-rename-node]').count(), 0);
    assert.deepEqual(await geometry(), before); await selected(['a', 'b']);
  });

  let baselineWheelDelta = null;
  for (const preselect of [false, true]) {
    await probe(`ordinary wheel panning ${preselect ? 'over the selected color region matches its baseline' : 'over a card gap establishes the existing baseline'}`, async () => {
      await fixture({ zoom: 0.6, preselect });
      await page.evaluate(() => window.__ui.getState().setWheelPans(true));
      const a = await node('a').boundingBox(), b = await node('b').boundingBox(); assert.ok(a && b);
      const point = { x: a.x + a.width - 25, y: (a.y + a.height + b.y) / 2 };
      if (preselect) await colorRegionAt(point);
      const before = await viewport(), beforeNodes = await geometry();
      await page.mouse.move(point.x, point.y); await page.mouse.wheel(30, 80); await page.waitForTimeout(250);
      const after = await viewport(), delta = { x: after.x - before.x, y: after.y - before.y };
      assert.equal(after.zoom, before.zoom); assert.deepEqual(await geometry(), beforeNodes);
      if (!preselect) {
        assert.ok(Math.abs(delta.y) > 1, 'The ordinary wheel pans in the baseline'); baselineWheelDelta = delta;
      } else {
        assert.ok(baselineWheelDelta, 'The no-selection baseline must support this action');
        near(delta.x, baselineWheelDelta.x, 'wheel pan x'); near(delta.y, baselineWheelDelta.y, 'wheel pan y');
        await selected(['a', 'b']);
      }
    });
  }

  for (const target of ['blank', 'node', 'toolbar', 'reading panel']) {
    await probe(target === 'toolbar' ? 'the toolbar overflow preserves selection while the reading panel remains open'
      : `with a reading panel open, an outside ${target} click cancels the old multi-selection`, async () => {
      await fixture({ zoom: 0.4, preselect: true });
      await page.evaluate(() => window.__ui.getState().setPanelOpen(true, 'c'));
      await page.locator('[data-focus-panel]').waitFor();
      await selected(['a', 'b']);
      if (target === 'blank') {
        await page.mouse.click(700, 850); await selected([]);
      } else if (target === 'node') {
        await node('c').locator('.drag-handle').first().click({ position: { x: 60, y: 12 } });
        await selected(['c']);
      } else if (target === 'toolbar') {
        await page.locator('[data-toolbar-more]').click();
        await selected(['a', 'b']); await page.locator('[data-toolbar-more-panel]').waitFor();
      } else {
        await page.locator('[data-reading-node-name]').click(); await selected([]);
      }
      assert.equal(await page.locator('[data-focus-panel]').count(), 1, 'The persistent reading panel stays available');
    });
  }

  await probe('modal confirmation, cancellation, backdrop dismissal and Escape protect the background selection', async () => {
    await fixture({ zoom: 0.4, preselect: true });
    const before = await geometry();
    for (const action of ['confirm', 'cancel', 'backdrop', 'escape']) {
      await page.evaluate(() => {
        window.__probeConfirmation = null;
        window.__ui.setState({ confirmRequest: { title: 'Selection boundary check', message: 'This isolated fixture has no side effects.',
          confirmLabel: 'Confirm probe', resolve: value => { window.__probeConfirmation = value; } } });
      });
      const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
      await selected(['a', 'b']);
      await dialog.getByRole('heading').click(); await selected(['a', 'b']);
      if (action === 'confirm') await dialog.getByRole('button', { name: 'Confirm probe', exact: true }).click();
      if (action === 'cancel') await dialog.getByRole('button', { name: '取消', exact: true }).click();
      if (action === 'backdrop') await page.mouse.click(700, 850);
      if (action === 'escape') await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.__probeConfirmation), action === 'confirm');
      await selected(['a', 'b']); assert.deepEqual(await geometry(), before);
    }
  });

  await fixture({ zoom: 0.5, frames: true });
  const frameBefore = await geometry();
  const surface = await page.locator('[data-selection-move]').boundingBox(); assert.ok(surface);
  await dragPoint({ x: surface.x + 30, y: surface.y + surface.height * 0.5 }, 30, 25);
  assertMoved(frameBefore, await geometry(), ['frame', 'inside', 'inside-two', 'partial-in'], 60, 50);
  await undo(); assert.deepEqual(await geometry(), frameBefore);
  check('a linked frame carries each contained node once and ignores obsolete group metadata across its boundary');
  await page.screenshot({ path: `${output}/frame-move.png` });

  assert.deepEqual(errors, [], 'No runtime errors'); assert.deepEqual(writes, [], 'No model or external write requests');
  assert.deepEqual(failures, [], 'All compatibility probes pass');
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, failures, errors, writes }, null, 2));
  console.log(`All ${checks.length} selection surface checks passed.`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, failures, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
