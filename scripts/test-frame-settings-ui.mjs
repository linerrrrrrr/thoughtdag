// Frame editing and selection boundaries in an isolated local browser context.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5187';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/frame-settings';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.routeWebSocket('**', socket => socket.close());
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
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} != ${expected}`);
const readNodes = () => page.evaluate(() => window.__store.getState().nodes);
const readEdges = () => page.evaluate(() => window.__store.getState().edges);
const selected = () => page.evaluate(() => [...window.__store.getState().selectedNodeIds].sort());
const node = id => page.locator(`.react-flow__node[data-id="frame-test-${id}"]`);
const field = (name, kind) => page.locator(`${kind ? `[data-selection-section="${kind}"] ` : ''}[data-node-format-field="${name}"]`);
const expandInspector = async () => {
  await page.locator('[data-selection-properties]').waitFor();
  const reopen = page.locator('[data-node-format-reopen]');
  if (await reopen.count()) await reopen.click();
  await page.locator('[data-node-format-panel]').waitFor();
};
const geometry = nodes => nodes.map(({ id, position, width, height }) => ({ id, position, width, height }));
const screenshot = name => page.screenshot({ path: `${outputDir}/${name}.png` });
const select = async ids => {
  const changed = await page.evaluate(ids => {
    const state = window.__store.getState();
    const next = ids.map(id => `frame-test-${id}`);
    const changed = [...state.selectedNodeIds].sort().join('\n') !== [...next].sort().join('\n');
    state.setSelectedNodeIds(next);
    return changed;
  }, ids);
  if (changed && ids.length) await page.locator('[data-node-format-close]').waitFor();
  if (ids.length) await expandInspector();
};
const fixture = async (ids = [], extraFrame = false) => {
  await page.mouse.click(1160, 950);
  await page.evaluate(({ ids, extraFrame }) => {
    const data = label => ({ question: label, response: '', responses: [''], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 25, highlights: [], highlightMode: 'tag', attachments: [],
      excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: false, isBranch: false });
    const card = (id, x, y, group) => ({ id: `frame-test-${id}`, type: 'thought', position: { x, y }, width: 360, height: 180,
      dragHandle: '.drag-handle', data: { ...data(`研究材料 ${id.toUpperCase()}`), stepKind: 'note', canvasGroupId: group } });
    const frame = (id, x, y, width, height, carry) => ({ id: `frame-test-${id}`, type: 'thought', position: { x, y }, width, height,
      zIndex: -1, dragHandle: '.drag-handle', data: { ...data(id === 'f1' ? '研究分区' : '交叉分区'), stepKind: 'frame', frameCarry: carry, frameColor: 'violet' } });
    const nodes = [frame('f1', 60, 160, 1000, 660, true),
      ...(extraFrame ? [frame('f2', 80, 180, 1020, 680, false)] : []),
      card('a', 120, 260, 'frame-test-group'), card('b', 600, 260, 'frame-test-group'),
      card('c', 120, 540), card('d', 850, 540)]
      .map(n => ({ ...n, selected: ids.includes(n.id) }));
    const edges = [
      { id: 'frame-test-internal', source: 'frame-test-a', target: 'frame-test-b', type: 'thought', data: { isCrossLink: true } },
      { id: 'frame-test-boundary', source: 'frame-test-b', target: 'frame-test-d', type: 'thought', data: { isCrossLink: true } },
    ];
    window.__store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0, selectedNodeIds: ids, selectedNodeId: ids.length === 1 ? ids[0] : null });
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__canvasEditing?.getState().reset();
    window.__rf.setViewport({ x: 20, y: 30, zoom: 0.75 }, { duration: 0 });
  }, { ids: ids.map(id => `frame-test-${id}`), extraFrame });
  await page.waitForFunction(() => window.__store.getState().nodes.every(n => n.measured?.width && n.measured?.height));
  await page.waitForTimeout(550);
  await page.evaluate(() => window.__rf.setViewport({ x: 20, y: 30, zoom: 0.75 }, { duration: 0 }));
  await page.waitForTimeout(120);
  // These fixtures exercise inspector controls after an explicit expansion.
  if (ids.length) await expandInspector();
};
const enclose = async id => {
  const b = await node(id).boundingBox();
  assert.ok(b);
  return { x1: b.x - 12, y1: b.y - 12, x2: b.x + b.width + 12, y2: b.y + b.height + 12 };
};
const marquee = async (box, modifiers = []) => {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 12 });
  await page.mouse.up();
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  await page.waitForTimeout(120);
};
const commit = async (name, value, kind) => { await field(name, kind).fill(String(value)); await field(name, kind).press('Enter'); await page.waitForTimeout(100); };
const blur = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const dragFrame = async (id, dx = 66, dy = 39) => {
  const b = await node(id).locator('.drag-handle').first().boundingBox();
  assert.ok(b);
  await page.mouse.move(b.x + 110, b.y + 14);
  await page.mouse.down();
  await page.mouse.move(b.x + 110 + dx, b.y + 14 + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
};
const panelFits = async () => {
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-selection-properties]')?.getBoundingClientRect();
    const header = document.querySelector('[data-canvas-header]')?.getBoundingClientRect();
    return panel && (!header || panel.top >= header.bottom + 4)
      && panel.left >= 0 && panel.right <= innerWidth + 1 && panel.bottom <= innerHeight + 1;
  });
  const b = await page.locator('[data-selection-properties]').boundingBox();
  const h = await page.locator('[data-canvas-header]').boundingBox();
  const v = page.viewportSize();
  assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= v.width + 1 && b.y + b.height <= v.height + 1);
  assert.ok(!h || b.y >= h.y + h.height + 4, 'Frame inspector avoids wrapped canvas header');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
};

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__store.getState().setFrameProperties);

  if (process.env.FORMAT_ONLY !== '1') {
  await fixture();
  const c = await enclose('c');
  await marquee(c);
  assert.deepEqual(await selected(), ['frame-test-c'], 'Marquee can start on empty space inside a frame');
  const a = await enclose('a'), b = await enclose('b');
  await marquee(a, ['Control']);
  assert.deepEqual(await selected(), ['frame-test-a', 'frame-test-c'], 'Ctrl marquee adds exactly the enclosed node despite obsolete group metadata');
  await marquee(b, ['Control']);
  assert.deepEqual(await selected(), ['frame-test-a', 'frame-test-b', 'frame-test-c'], 'A second marquee can explicitly include the remaining member');
  assert.ok((await readEdges()).every(edge => !edge.selected), 'Internal marquee selects no edges');
  await node('f1').locator('.drag-handle').first().click({ position: { x: 100, y: 14 } });
  assert.deepEqual(await selected(), ['frame-test-f1'], 'Title selects only the frame');
  await expandInspector();
  await page.locator('[data-frame-name]').waitFor();
  assert.equal(await page.locator('[data-node-format-content]').count(), 0, 'Frame-only panel has no node content generation section');
  assert.equal(await page.locator('[data-frame-select-contents]').count(), 1);
  check('frame background allows full/additive marquee while title selects only the frame and exposes frame settings');
  }

  await fixture(['f1']);

  const title = page.locator('[data-frame-name]');
  await title.fill('未提交分区名');
  await title.press('Escape');
  assert.equal((await readNodes())[0].data.question, '研究分区');
  assert.deepEqual(await selected(), ['frame-test-f1']);
  await title.fill('输入法候选');
  await title.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  assert.equal((await readNodes())[0].data.question, '研究分区');
  await title.press('Escape');
  await title.fill('宏观研究分区');
  await title.press('Enter');
  assert.equal((await readNodes())[0].data.question, '宏观研究分区');
  await title.fill(''); await title.press('Enter');
  assert.equal((await readNodes())[0].data.question, '', 'A cleared frame title is a valid committed value');
  await title.fill('宏观研究分区'); await title.press('Enter');
  await page.locator('[data-frame-color="sky"]').click();
  assert.equal((await readNodes())[0].data.frameColor, 'sky');
  await blur();
  await page.keyboard.press('Control+z');
  assert.equal((await readNodes())[0].data.frameColor, 'violet', 'One undo restores the previous frame color');
  await page.keyboard.press('Control+y');
  assert.equal((await readNodes())[0].data.frameColor, 'sky');
  check('frame naming supports Escape/IME and color changes are independently undoable');

  await fixture(['f1']);
  const count = await page.locator('[data-frame-content-count]').innerText();
  assert.ok(count.includes('3') && !count.includes('组合'), `Count identifies contained nodes without grouping: ${count}`);
  await page.locator('[data-frame-select-contents]').click();
  assert.deepEqual(await selected(), ['frame-test-a', 'frame-test-b', 'frame-test-c']);
  await select(['f1']);
  await page.locator('[data-frame-select-all]').click();
  assert.deepEqual(await selected(), ['frame-test-a', 'frame-test-b', 'frame-test-c', 'frame-test-f1']);
  assert.ok(!(await selected()).includes('frame-test-d'), 'A node whose center is inside but edge crosses the frame is excluded');
  check('content count and explicit content selection share full containment and ignore obsolete group metadata');

  await fixture(['f1']);
  await commit('width', 500);
  await page.locator('[data-frame-select-contents]').click();
  assert.deepEqual(await selected(), ['frame-test-a', 'frame-test-c'], 'A narrower region includes only contained nodes despite obsolete group metadata');
  assert.equal((await readNodes()).find(n => n.id === 'frame-test-a').data.canvasGroupId, 'frame-test-group');
  assert.equal((await readNodes()).find(n => n.id === 'frame-test-b').data.canvasGroupId, 'frame-test-group');
  check('region content selection follows geometry and leaves obsolete metadata inert');

  await fixture(['f1']);
  const beforeFrameDrag = await readNodes();
  await dragFrame('f1');
  const afterFrameDrag = await readNodes();
  const dx = afterFrameDrag[0].position.x - beforeFrameDrag[0].position.x;
  const dy = afterFrameDrag[0].position.y - beforeFrameDrag[0].position.y;
  assert.ok(dx > 40 && dy > 20);
  for (const id of ['a', 'b', 'c']) {
    const old = beforeFrameDrag.find(n => n.id === `frame-test-${id}`), next = afterFrameDrag.find(n => n.id === old.id);
    near(next.position.x - old.position.x, dx, 'Carried x'); near(next.position.y - old.position.y, dy, 'Carried y');
  }
  assert.deepEqual(afterFrameDrag.find(n => n.id === 'frame-test-d').position, beforeFrameDrag.find(n => n.id === 'frame-test-d').position);
  await page.locator('[data-frame-carry]').uncheck();
  const beforeUnlinked = await readNodes();
  await dragFrame('f1');
  assert.deepEqual(geometry((await readNodes()).slice(1)), geometry(beforeUnlinked.slice(1)), 'Unlinked dragging changes only the frame');
  check('linked and unlinked frame dragging use full containment and never pull boundary-crossing nodes');

  await fixture(['f1', 'f2'], true);
  assert.ok(await page.locator('[data-frame-carry]').evaluate(input => input.indeterminate));
  await page.locator('[data-frame-carry]').check();
  const beforeOverlap = await readNodes();
  await dragFrame('f1');
  const afterOverlap = await readNodes();
  const overlapDx = afterOverlap[0].position.x - beforeOverlap[0].position.x;
  for (const id of ['f2', 'a', 'b', 'c']) {
    const old = beforeOverlap.find(n => n.id === `frame-test-${id}`), next = afterOverlap.find(n => n.id === old.id);
    near(next.position.x - old.position.x, overlapDx, 'Shared contents translate once');
  }
  check('overlapping selected frames deduplicate carried members during real pointer movement');

  await fixture(['f1']);
  const beforeFit = await readNodes();
  await page.locator('[data-frame-fit]').click();
  const fit = await readNodes();
  assert.deepEqual(geometry(fit.slice(1)), geometry(beforeFit.slice(1)), 'Fitting changes no member geometry');
  assert.ok(fit[0].width < beforeFit[0].width && fit[0].height < beforeFit[0].height, 'Frame tightens around current complete members');
  for (const n of fit.filter(n => ['frame-test-a', 'frame-test-b', 'frame-test-c'].includes(n.id))) {
    assert.ok(fit[0].position.x <= n.position.x && fit[0].position.y <= n.position.y);
    assert.ok(fit[0].position.x + fit[0].width >= n.position.x + n.width);
    assert.ok(fit[0].position.y + fit[0].height >= n.position.y + n.height);
  }
  await blur(); await page.keyboard.press('Control+z');
  assert.deepEqual(geometry(await readNodes()), geometry(beforeFit), 'Fit is one undoable operation');
  await commit('width', 1150);
  assert.deepEqual(geometry((await readNodes()).slice(1)), geometry(beforeFit.slice(1)), 'Changing frame size leaves child geometry alone');
  check('fit-to-content and numeric dimensions change only frame boundaries and support undo');

  await fixture(['f1', 'c']);
  assert.equal(await page.locator('[data-format-scope]').count(), 0, 'Type sections do not hide one another behind a scope switch');
  assert.equal(await page.locator('[data-selection-section="nodes"]').count(), 1);
  assert.equal(await page.locator('[data-selection-section="frames"]').count(), 1);
  assert.equal(await field('x', 'nodes').count(), 1, 'A single node retains its own explicitly scoped coordinates');
  assert.equal(await field('x', 'frames').count(), 1, 'A single frame retains its own explicitly scoped coordinates');
  await commit('width', 460, 'nodes');
  let mixed = await readNodes();
  assert.equal(mixed.find(n => n.id === 'frame-test-c').width, 460);
  assert.equal(mixed[0].width, 1000);
  await commit('width', 1100, 'frames');
  mixed = await readNodes();
  assert.equal(mixed[0].width, 1100);
  assert.equal(mixed.find(n => n.id === 'frame-test-c').width, 460);
  assert.deepEqual(await selected(), ['frame-test-c', 'frame-test-f1']);
  await screenshot('desktop-mixed');
  check('mixed selections show both type sections and edit only the stated node or frame scope');

  await fixture(['f1', 'f2'], true);
  assert.equal(await title.count(), 0, 'Multiple frame names are not unified');
  assert.equal(await field('x').count(), 0);
  assert.ok(await page.locator('[data-frame-carry]').evaluate(input => input.indeterminate));
  await page.locator('[data-frame-color="amber"]').click();
  await page.locator('[data-frame-carry]').check();
  await commit('width', 1250);
  const batch = await readNodes();
  assert.ok(batch.slice(0, 2).every(n => n.data.frameColor === 'amber' && n.data.frameCarry === true && n.width === 1250));
  assert.equal(batch[0].data.question, '研究分区'); assert.equal(batch[1].data.question, '交叉分区');
  await screenshot('desktop-multiple');
  check('multiple frames share color, carry and dimensions with mixed states but retain separate names and positions');

  await fixture(['f1']);
  const beforeCopy = await readNodes();
  await page.locator('[data-frame-copy="only"]').click();
  let copied = await readNodes();
  assert.equal(copied.length, beforeCopy.length + 1);
  assert.equal(copied.filter(n => n.data.stepKind === 'frame').length, 2);
  assert.equal((await readEdges()).length, 2);
  await fixture(['f1']);
  const sourceIds = new Set((await readNodes()).map(n => n.id));
  await page.locator('[data-frame-copy="contents"]').click();
  copied = await readNodes();
  const newNodes = copied.filter(n => !sourceIds.has(n.id));
  assert.equal(newNodes.length, 4, 'Copy partition includes one frame and its three complete content nodes');
  assert.equal(newNodes.filter(n => n.data.stepKind === 'frame').length, 1);
  assert.ok(newNodes.every(n => !n.data.canvasGroupId && !n.data.previousCanvasGroupId), 'Copies do not inherit obsolete group metadata');
  const newIds = new Set(newNodes.map(n => n.id));
  const newEdges = (await readEdges()).filter(e => newIds.has(e.source) || newIds.has(e.target));
  assert.equal(newEdges.length, 1, 'Only the internal edge is copied');
  assert.ok(newEdges.every(e => newIds.has(e.source) && newIds.has(e.target)));
  check('copy-frame and copy-with-content have distinct scopes and copy only internal edges without obsolete group metadata');

  await fixture(['f1', 'c']);
  const exported = await page.evaluate(async () => (await import('/src/lib/export.ts')).selectionMarkdown(['frame-test-f1', 'frame-test-c', 'frame-test-c']));
  assert.ok(exported.includes('研究材料 C'));
  assert.ok(!exported.includes('研究分区'), 'Frame titles never masquerade as answers in Markdown export');
  assert.equal(exported.split('研究材料 C').length - 1, 1, 'Repeated selected IDs are exported once');
  check('Markdown export uses explicit content nodes and excludes frame metadata and duplicate IDs');

  const mixedBeforeDelete = await readNodes();
  await page.locator('[data-selection-delete-nodes]').click();
  await page.getByRole('alertdialog').getByRole('button').last().click();
  assert.ok((await readNodes()).some(node => node.id === 'frame-test-f1'), 'Node actions never delete the selected frame');
  assert.ok(!(await readNodes()).some(node => node.id === 'frame-test-c'));
  assert.equal((await readNodes()).length, mixedBeforeDelete.length - 1);
  await blur(); await page.keyboard.press('Control+z');
  assert.deepEqual(geometry(await readNodes()), geometry(mixedBeforeDelete), 'Scoped node deletion is one undo step');
  await select(['f1', 'c']);
  await page.locator('[data-frame-delete]').click();
  await page.getByRole('alertdialog').getByRole('button').last().click();
  assert.ok((await readNodes()).some(node => node.id === 'frame-test-c'), 'Frame actions never delete selected contents');
  assert.ok(!(await readNodes()).some(node => node.id === 'frame-test-f1'));
  check('node and frame deletion retain independent explicit scopes inside a mixed selection');

  await fixture(['f1']);
  const beforeDelete = await readNodes(), originalEdges = await readEdges();
  await page.locator('[data-frame-delete]').click();
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  await page.keyboard.press('Enter');
  assert.equal((await readNodes()).length, beforeDelete.length, 'Danger confirmation defaults to cancel');
  await page.locator('[data-frame-delete]').click();
  await dialog.getByRole('button').last().click();
  assert.deepEqual(geometry(await readNodes()), geometry(beforeDelete.slice(1)));
  assert.deepEqual(await readEdges(), originalEdges);
  await blur(); await page.keyboard.press('Control+z');
  assert.deepEqual(geometry(await readNodes()), geometry(beforeDelete));
  await select(['f1']); await blur(); await page.keyboard.press('Delete');
  await dialog.waitFor();
  assert.ok((await dialog.innerText()).includes('保留'), 'Keyboard deletion clearly retains frame contents');
  await dialog.getByRole('button').last().click();
  assert.deepEqual(geometry(await readNodes()), geometry(beforeDelete.slice(1)));
  assert.deepEqual(await readEdges(), originalEdges);
  check('deleting a frame keeps its contents and edges; confirmation and undo remain safe');

  await fixture(['f1']);
  await title.fill('持久化分区'); await title.press('Enter');
  await page.locator('[data-frame-color="green"]').click();
  await page.locator('[data-frame-carry]').uncheck();
  await page.locator('[data-node-format-lock]').check();
  await commit('width', 1100);
  const saved = (await readNodes())[0];
  await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  const restored = (await readNodes()).find(n => n.id === saved.id);
  const persistedFrame = n => ({ title: n.data.question, color: n.data.frameColor, carry: n.data.frameCarry,
    lock: n.data.lockAspectRatio, position: n.position, width: n.width, height: n.height });
  assert.deepEqual(persistedFrame(restored), persistedFrame(saved));
  check('frame name, color, movement mode, dimensions and ratio lock persist across reload');

  await fixture(['f1']);
  await panelFits(); await screenshot('desktop-single');
  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await screenshot('dark-single');
  await page.locator('[data-toolbar-more]').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.keyboard.press('Escape');
  await select([]); await select(['f1']);
  await panelFits(); await screenshot('english-single');
  await page.locator('[data-toolbar-more]').click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.keyboard.press('Escape');
  await select([]); await select(['f1']);
  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light'));
  await page.setViewportSize({ width: 390, height: 844 });
  await panelFits(); await screenshot('mobile-single');
  await page.locator('[data-frame-delete]').scrollIntoViewIfNeeded();
  let deletionBox = await page.locator('[data-frame-delete]').boundingBox();
  let panelBox = await page.locator('[data-selection-properties]').boundingBox();
  assert.ok(deletionBox.y + deletionBox.height <= panelBox.y + panelBox.height);
  await screenshot('mobile-actions');
  await page.setViewportSize({ width: 800, height: 500 });
  await panelFits();
  await page.locator('[data-frame-copy="contents"]').scrollIntoViewIfNeeded();
  deletionBox = await page.locator('[data-frame-copy="contents"]').boundingBox();
  panelBox = await page.locator('[data-selection-properties]').boundingBox();
  assert.ok(deletionBox.y >= panelBox.y && deletionBox.y + deletionBox.height <= panelBox.y + panelBox.height);
  await screenshot('short-actions');
  check('frame inspector remains usable across themes, languages, mobile and short viewport with all actions reachable');
  assert.deepEqual(errors, [], 'No runtime errors');
  assert.deepEqual(writes, [], 'No model calls or external writes');
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  console.log(`All ${checks.length} frame settings UI checks passed.`);
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ checks, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
