// Node and selection resize interactions, using isolated local fixtures only.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/node-resize';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
await context.routeWebSocket('**', socket => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = [], errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [], items: [], hits: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

const check = name => { checks.push(name); console.log('PASS', name); };
const node = id => page.locator(`.react-flow__node[data-id="resize-${id}"]`);
const handle = (id, direction) => node(id).locator(`[data-node-resize="${direction}"]`);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 2, `${message}: ${actual} versus ${expected}`);
const read = id => page.evaluate(id => window.__store.getState().nodes.find(item => item.id === `resize-${id}`), id);
const geometry = item => ({ width: item.width, height: item.height, position: item.position, keepOverviewHeight: item.data.keepOverviewHeight });
const screenSize = async target => target.evaluate(element => {
  const box = element.getBoundingClientRect();
  const mark = element.querySelector('.resize-grip').getBoundingClientRect();
  const css = getComputedStyle(element);
  return { hit: { width: box.width, height: box.height }, mark: { width: mark.width, height: mark.height },
    background: css.backgroundColor, color: css.color, border: css.borderWidth };
});
const checkScreenSize = (size, direction, label) => {
  assert.ok(Math.abs(size.hit.width - 32) < .5 && Math.abs(size.hit.height - 32) < .5,
    `${label} keeps a 32px screen hit target: ${JSON.stringify(size.hit)}`);
  const length = direction === 'width' ? size.mark.height : size.mark.width;
  assert.ok(length >= 11.5 && length <= 16.5, `${label} keeps its visible mark between 12px and 16px: ${length}`);
  if (direction === 'both') assert.ok(Math.abs(size.mark.height - size.mark.width) < .5, `${label} keeps a square corner mark`);
  else {
    const thickness = direction === 'width' ? size.mark.width : size.mark.height;
    assert.ok(Math.abs(thickness - 2) < .3, `${label} keeps a readable 2px screen stroke: ${thickness}`);
  }
};
const doNotOverlap = (first, second, label) => assert.ok(
  first.x + first.width <= second.x + .5 || second.x + second.width <= first.x + .5
  || first.y + first.height <= second.y + .5 || second.y + second.height <= first.y + .5,
  `${label}: ${JSON.stringify({ first, second })}`);
const selection = () => page.evaluate(() => [...window.__store.getState().selectedNodeIds].sort());
const select = async ids => {
  await page.evaluate(ids => window.__store.getState().setSelectedNodeIds(ids.map(id => `resize-${id}`)), ids);
  await settle();
};
const expandFormat = async () => {
  await page.locator('[data-node-format-panel]').waitFor();
  const reopen = page.locator('[data-node-format-reopen]');
  if (await reopen.isVisible()) await reopen.click();
};
const setZoom = async zoom => {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 20, y: 20, zoom }, { duration: 0 }), zoom);
  await settle();
};
const frameNode = async (id, zoom) => {
  await page.evaluate(({ id, zoom }) => {
    const item = window.__store.getState().nodes.find(item => item.id === `resize-${id}`);
    window.__rf.setViewport({ x: 40 - item.position.x * zoom, y: 180 - item.position.y * zoom, zoom }, { duration: 0 });
  }, { id, zoom });
  await settle();
};
const startDrag = async (target, dx, dy) => {
  await target.hover();
  const box = await target.boundingBox();
  assert.ok(box, 'Resize control is visible');
  const origin = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const node = element.closest('.react-flow__node');
    return { ownsHit: hit === element || element.contains(hit), hit: hit?.outerHTML.slice(0, 400),
      button: box.toJSON(), node: node?.getBoundingClientRect().toJSON(), viewport: window.__rf.getViewport() };
  });
  assert.equal(origin.ownsHit, true, `The resize control owns its actual pointer origin: ${JSON.stringify(origin)}`);
  await target.evaluate(element => element.addEventListener('pointerdown', event => { element.__testPointerId = event.pointerId; }, { once: true }));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await settle();
  assert.equal(await target.getAttribute('data-resize-active'), 'true', `The real pointerdown starts the resize gesture: ${JSON.stringify(origin)}`);
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await settle();
};
const drag = async (target, dx, dy) => {
  await startDrag(target, dx, dy);
  await page.mouse.up();
  await settle();
};
const screenshot = async name => { await page.mouse.move(10, 110); await settle(); await page.screenshot({ path: `${output}/${name}.png` }); };
const appearance = mode => page.evaluate(async mode => (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting(mode), mode);
const seed = async () => {
  await page.evaluate(() => {
    // Keep the general resize gestures below the separately tested content
    // height ceiling; short conversations now intentionally stop growing.
    const response = Array.from({ length: 12 }, () => '拖动边缘进行快速调整，在对象格式中输入精确数值。自动高度跟随内容，固定高度保留阅读窗口。').join('\n\n');
    const data = (name, material = false) => ({
      question: material ? '材料节点与对话节点共享尺寸控件，保持不同的内容身份。\n\n调整宽度只改变换行；手动调整高度后，正文在卡片内部滚动。' : '节点的宽度与高度应该怎样协调？',
      response: material ? '' : response,
      responses: material ? [''] : [response],
      responseIndex: 0, displayName: name, detailLevel: 'full', ...(material ? { stepKind: 'note' } : {}),
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 60, highlights: [], highlightMode: 'tag', attachments: [],
      excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: false, isBranch: false,
    });
    const nodes = [
      { id: 'resize-a', type: 'thought', dragHandle: '.drag-handle', position: { x: 80, y: 180 }, width: 420, selected: true, data: data('对话节点') },
      { id: 'resize-b', type: 'thought', dragHandle: '.drag-handle', position: { x: 650, y: 180 }, width: 380, selected: false, data: data('材料节点', true) },
      { id: 'resize-c', type: 'thought', dragHandle: '.drag-handle', position: { x: 80, y: 690 }, width: 400, height: 260, selected: false, data: data('连接目标') },
    ];
    window.__store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0, selectedNodeIds: ['resize-a'], selectedNodeId: 'resize-a' });
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__ui.getState().setCanvasDetail('full');
  });
  await page.waitForFunction(() => window.__store.getState().nodes.every(item => item.measured?.width && item.measured?.height));
  await page.waitForTimeout(550);
  await setZoom(1);
};

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5293', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await page.evaluate(() => {
    window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path)?.name ?? path);
  });
  await seed();
  for (const id of ['a', 'b']) {
    await select([id]);
    for (const direction of ['width', 'height', 'both']) {
      assert.equal(await handle(id, direction).count(), 1);
      assert.ok(await handle(id, direction).getAttribute('aria-label'), 'Every resize action is named');
      assert.equal(await handle(id, direction).isVisible(), true);
    }
    const before = await read(id);
    await drag(handle(id, 'width'), 40, 0);
    near((await read(id)).width, before.width + 40, 'Width responds to dragging');
    assert.equal((await read(id)).height, undefined, 'Width-only resizing preserves automatic height');
  }
  check('Conversation and material cards share three named handles and preserve automatic height during width changes');

  await select(['a']);
  const autoBox = await node('a').boundingBox();
  await drag(handle('a', 'height'), 0, 70);
  const fixed = await read('a');
  near(fixed.height, autoBox.height + 70, 'Height begins from the visible edge');
  await drag(handle('a', 'width'), 30, 0);
  near((await read('a')).height, fixed.height, 'Width-only resizing preserves fixed height');
  const beforeCorner = await read('a');
  await drag(handle('a', 'both'), 0, 50);
  const afterCorner = await read('a');
  near(afterCorner.height, beforeCorner.height + 50, 'A vertical corner gesture changes height');
  near(afterCorner.width, beforeCorner.width, 'A vertical corner gesture preserves unlocked width');
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual(geometry(await read('a')), geometry(beforeCorner), 'One undo restores the whole drag');
  await page.evaluate(() => window.__store.getState().redo());
  assert.deepEqual(geometry(await read('a')), geometry(afterCorner), 'One redo restores the whole drag');
  check('Independent axes and vertical corner drags work; each gesture has one undo and redo');

  for (const cancellation of ['Escape', 'pointercancel']) {
    const before = await read('a');
    await startDrag(handle('a', 'both'), 45, 35);
    assert.notDeepEqual(geometry(await read('a')), geometry(before));
    if (cancellation === 'Escape') await page.keyboard.press('Escape');
    else await handle('a', 'both').evaluate(element => element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: element.__testPointerId, pointerType: 'mouse' })));
    await page.mouse.up();
    await settle();
    assert.deepEqual(geometry(await read('a')), geometry(before), `${cancellation} restores original geometry`);
    assert.deepEqual((await read('a')).data, before.data, `${cancellation} preserves content`);
    assert.deepEqual(await selection(), ['resize-a'], `${cancellation} preserves selection`);
  }
  const beforeKeys = await read('a');
  await handle('a', 'width').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  near((await read('a')).width, beforeKeys.width + 11, 'Keyboard adjusts by 1 and 10 units');
  near((await read('a')).height, beforeKeys.height, 'Width keyboard control preserves height');
  check('Escape and pointer cancellation restore the card; keyboard resizing uses fine and coarse steps');

  await expandFormat();
  await page.locator('[data-node-format-lock]').check();
  const locked = await read('a');
  await drag(handle('a', 'both'), 0, 60);
  const lockedAfter = await read('a');
  assert.ok(lockedAfter.height > locked.height + 40);
  assert.ok(Math.abs(lockedAfter.width / lockedAfter.height - locked.width / locked.height) < .001, 'Lock preserves the original ratio for a vertical gesture');
  await expandFormat();
  assert.equal(await page.locator('[data-node-format-height-mode], [data-node-format-auto-height]').count(), 0);
  const typedWidth = Math.round(lockedAfter.width * 1.1);
  await page.locator('[data-node-format-field="width"]').fill(String(typedWidth));
  near(Number(await page.locator('[data-node-format-field="height"]').inputValue()), typedWidth * lockedAfter.height / lockedAfter.width, 'Typing a width synchronizes height before applying');
  await page.locator('[data-node-format-field="width"]').press('Enter');
  near((await read('a')).width, typedWidth, 'Typed width applies');
  near((await read('a')).height, typedWidth * lockedAfter.height / lockedAfter.width, 'The matching height applies with width');
  assert.equal((await read('a')).data.response, lockedAfter.data.response);
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual(geometry(await read('a')), geometry(lockedAfter), 'Paired dimensions form one undoable action');
  assert.equal((await read('a')).data.lockAspectRatio, true);
  await page.evaluate(() => window.__store.getState().redo());
  check('Ratio locking follows vertical gestures and typed dimensions stay synchronized');

  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['resize-a'], { width: 600, height: 300, lockAspectRatio: false }));
  await expandFormat();
  await page.locator('[data-node-format-field="width"]').fill('800');
  await page.locator('[data-node-format-lock]').check();
  near((await read('a')).width, 800, 'Lock applies the pending width');
  near((await read('a')).height, 300, 'Lock adopts the newly edited shape');
  assert.equal((await read('a')).data.lockAspectRatio, true);
  await page.evaluate(() => window.__store.getState().undo());
  near((await read('a')).width, 600, 'One undo restores the width before the combined edit');
  near((await read('a')).height, 300, 'One undo preserves the original height');
  assert.equal(!!(await read('a')).data.lockAspectRatio, false);
  check('Applying a pending dimension and locking its new ratio is one undoable edit');

  const beforeMetadata = await read('a');
  await node('a').locator('[data-node-metadata-toggle]').click();
  const metadataTitle = node('a').locator('[data-node-title-input]');
  const metadataSummary = node('a').locator('[data-node-summary-input]');
  await metadataTitle.fill('调整宽度时保留名称草稿');
  await metadataSummary.fill('名称与摘要展开时，临时自然高度不应覆盖已保存的固定高度。');
  assert.equal(await handle('a', 'width').isVisible(), true);
  assert.equal(await handle('a', 'height').isVisible(), false);
  assert.equal(await handle('a', 'both').isVisible(), false);
  assert.ok((await node('a').boundingBox()).height > beforeMetadata.height, 'The metadata editor temporarily uses its natural height');
  await drag(handle('a', 'width'), 40, 0);
  near((await read('a')).width, beforeMetadata.width + 40, 'Metadata editing still allows width adjustments');
  near((await read('a')).height, beforeMetadata.height, 'Width adjustments preserve the saved fixed height');
  assert.equal(await metadataTitle.inputValue(), '调整宽度时保留名称草稿');
  assert.equal(await metadataSummary.inputValue(), '名称与摘要展开时，临时自然高度不应覆盖已保存的固定高度。');
  assert.equal((await read('a')).data.displayName, beforeMetadata.data.displayName, 'Resizing does not submit metadata drafts');
  await node('a').locator('[data-node-metadata-toggle]').click();
  await settle();
  near((await node('a').boundingBox()).height, beforeMetadata.height, 'Closing metadata restores the visible fixed height');
  assert.equal(await handle('a', 'height').isVisible(), true);
  assert.equal(await handle('a', 'both').isVisible(), true);
  await expandFormat();
  await page.locator('[data-node-format-lock]').check();
  await node('a').locator('[data-node-metadata-toggle]').click();
  assert.equal(await metadataTitle.inputValue(), '调整宽度时保留名称草稿', 'Reopening restores the retained metadata draft');
  for (const direction of ['width', 'height', 'both']) assert.equal(await handle('a', direction).isVisible(), false, 'Locked cards pause all resizing while metadata uses natural height');
  await node('a').locator('[data-node-metadata-cancel]').click();
  await settle();
  near((await node('a').boundingBox()).height, beforeMetadata.height, 'Cancel restores the fixed card size');
  assert.equal((await read('a')).data.displayName, beforeMetadata.data.displayName);
  check('Metadata drafts survive width changes; temporary natural height never replaces fixed dimensions, and locked resizing pauses');

  await seed();
  await select(['a', 'b']);
  await page.locator('[data-selection-resizer]').waitFor();
  assert.equal(await page.locator('[data-selection-resize] .resize-grip').count(), 3, 'Multi-selection reuses the shared grip visuals');
  for (const id of ['a', 'b']) for (const direction of ['width', 'height', 'both']) assert.equal(await handle(id, direction).isVisible(), false, 'Multi-selection has one active resize boundary');
  const beforeGroup = await Promise.all(['a', 'b'].map(read));
  await drag(page.locator('[data-selection-resize="width"]'), 35, 0);
  for (let index = 0; index < beforeGroup.length; index++) {
    const after = await read(['a', 'b'][index]);
    near(after.width, beforeGroup[index].width + 35, 'Group handles change each selected width');
    assert.deepEqual(after.position, beforeGroup[index].position, 'Group sizing preserves node positions');
    assert.equal(after.height, undefined, 'Group width changes preserve automatic height');
  }
  await appearance('dark');
  await screenshot('dark-multiselection');
  check('Multi-selection uses one shared boundary and changes sizes without moving the nodes');

  await seed();
  const source = node('a').locator('[data-connection-role="source"][data-connection-side="bottom"]');
  await node('a').hover();
  const sourceBox = await source.boundingBox();
  assert.ok(sourceBox);
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + 70, sourceBox.y + 90, { steps: 8 });
  await settle();
  for (const direction of ['width', 'height', 'both']) assert.equal(await handle('a', direction).isVisible(), false, 'Connection gestures hide size controls');
  const sourceNodeBox = await node('a').boundingBox();
  await page.mouse.move(sourceNodeBox.x + 80, sourceNodeBox.y + 24);
  await page.mouse.up();
  await settle();
  await select(['a']);
  await startDrag(handle('a', 'width'), 35, 0);
  const resizingPorts = await node('a').evaluate(element => ({
    active: element.querySelector('[data-node-resizing]')?.getAttribute('data-node-resizing'),
    ports: [...element.querySelectorAll('.tdag-auto-handle')].map(port => ({ role: port.dataset.connectionRole, side: port.dataset.connectionSide, pointerEvents: getComputedStyle(port).pointerEvents })),
  }));
  assert.equal(resizingPorts.active, 'width', 'The width gesture is active');
  assert.equal(resizingPorts.ports.every(port => port.pointerEvents === 'none'), true, `Connection ports cannot intercept a resize gesture: ${JSON.stringify(resizingPorts)}`);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  check('Connection and sizing gestures expose only their relevant controls');

  const zooms = [.25, .6, 1, 1.5, 2];
  await page.evaluate(() => {
    window.__store.getState().setSelectionGeometry(['resize-a', 'resize-b'], { width: 600, height: 360, lockAspectRatio: false });
    window.__store.setState(state => ({ nodes: state.nodes.map(item => item.id === 'resize-a' ? { ...item, position: { x: 80, y: 100 } }
      : item.id === 'resize-b' ? { ...item, position: { x: 800, y: 180 } } : item) }));
  });
  await settle();
  for (const theme of ['dark', 'light']) {
    await appearance(theme);
    for (const zoom of zooms) {
      await setZoom(zoom);
      const styles = [];
      for (const id of ['a', 'b']) {
        await select([id]);
        await frameNode(id, zoom);
        const directions = [];
        for (const direction of ['width', 'height', 'both']) {
          assert.equal(await handle(id, direction).isVisible(), true, `${id} ${direction} fits at ${zoom} zoom`);
          const size = await screenSize(handle(id, direction));
          checkScreenSize(size, direction, `${theme} ${id} ${direction} at ${zoom}`);
          directions.push(size);
        }
        styles.push(directions);
      }
      for (let index = 0; index < styles[0].length; index++) {
        const thought = styles[0][index], material = styles[1][index];
        assert.deepEqual([thought.background, thought.color, thought.border], [material.background, material.color, material.border],
          'Conversation and material resize controls share one visual recipe');
        near(thought.mark.width, material.mark.width, 'Both node kinds share the same screen mark width');
        near(thought.mark.height, material.mark.height, 'Both node kinds share the same screen mark height');
      }
      await select(['a', 'b']);
      for (const [index, direction] of ['width', 'height', 'both'].entries()) {
        const grouped = await screenSize(page.locator(`[data-selection-resize="${direction}"]`));
        checkScreenSize(grouped, direction, `${theme} selection ${direction} at ${zoom}`);
        near(grouped.mark.width, styles[0][index].mark.width, 'Single and multi-selection share the same visible width');
        near(grouped.mark.height, styles[0][index].mark.height, 'Single and multi-selection share the same visible height');
      }
      await select(['a']);
      await frameNode('a', zoom);
      await screenshot(`${theme}-${Math.round(zoom * 100)}-percent`);
    }
  }
  check('25%, 60%, 100%, 150% and 200% zoom keep bounded screen marks and 32px hit targets in both themes and selection modes');

  await select(['a']);
  for (const zoom of zooms) {
    await page.evaluate(() => window.__store.getState().setSelectionGeometry(['resize-a'], { width: 600, height: 360, lockAspectRatio: false }));
    await frameNode('a', zoom);
    const before = await read('a');
    await drag(handle('a', 'width'), 24, 0);
    const afterWidth = await read('a');
    near(afterWidth.width, before.width + 24 / zoom, `Width drag uses canvas units at ${zoom}`);
    near(afterWidth.height, before.height, `Width drag preserves height at ${zoom}`);
    await drag(handle('a', 'height'), 0, 20);
    const afterHeight = await read('a');
    near(afterHeight.height, afterWidth.height + 20 / zoom, `Height drag uses canvas units at ${zoom}`);
    near(afterHeight.width, afterWidth.width, `Height drag preserves width at ${zoom}`);
    assert.deepEqual(afterHeight.position, before.position, 'Resizing does not move the card');
    await page.evaluate(() => window.__store.getState().undo());
    assert.deepEqual(geometry(await read('a')), geometry(afterWidth), `One undo reverses the height drag at ${zoom}`);
    await page.evaluate(() => window.__store.getState().undo());
    assert.deepEqual(geometry(await read('a')), geometry(before), `One undo reverses the width drag at ${zoom}`);
  }
  check('Actual width and height drags use screen distance divided by zoom and remain independently undoable from 25% to 200%');

  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['resize-a'], { width: 600, height: 360, lockAspectRatio: true }));
  await frameNode('a', .25);
  const beforeCrowdedDrag = await read('a');
  await startDrag(handle('a', 'width'), -40, 0);
  assert.equal(await handle('a', 'width').isVisible(), true, 'An active handle stays available when proportional resizing makes the card crowded');
  assert.equal(await handle('a', 'width').getAttribute('data-resize-active'), 'true');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  assert.deepEqual(geometry(await read('a')), geometry(beforeCrowdedDrag), 'Escape still restores a gesture that crosses the crowding threshold');
  check('Crossing a crowding threshold during an active drag preserves the gesture and its Escape restoration');

  await seed();
  await page.evaluate(() => {
    window.__store.getState().setSelectionGeometry(['resize-a', 'resize-b'], { width: 360, height: 240, lockAspectRatio: false });
  });
  for (const zoom of [.15, .04]) {
    await page.evaluate(zoom => window.__rf.setViewport({ x: 120, y: 240, zoom }, { duration: 0 }), zoom);
    await settle();
    for (const id of ['a', 'b']) {
      await select([id]);
      assert.equal(await handle(id, 'width').isVisible(), false, `Crowded ${id} width control yields at ${zoom}`);
      assert.equal(await handle(id, 'height').isVisible(), false, `Crowded ${id} height control yields at ${zoom}`);
      assert.equal(await handle(id, 'both').isVisible(), zoom === .15, 'The corner yields when its hit area would cover the connection ports');
      if (zoom === .15) checkScreenSize(await screenSize(handle(id, 'both')), 'both', `${id} corner at ${zoom}`);
      else {
        await node(id).hover();
        assert.equal(await node(id).locator('[data-connection-role="source"][data-connection-side="bottom"]').evaluate(element => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit === element || element.contains(hit);
        }), true, 'A tiny full-detail card keeps its bottom port directly reachable');
      }
    }
    await select(['a', 'b']);
    const corner = page.locator('[data-selection-resize="both"]');
    assert.equal(await corner.isVisible(), zoom === .15, 'A selection too short for its corner target yields to the properties panel');
    if (zoom === .15) checkScreenSize(await screenSize(corner), 'both', `selection corner at ${zoom}`);
    const cornerBox = await corner.boundingBox();
    for (const direction of ['width', 'height']) {
      const axis = page.locator(`[data-selection-resize="${direction}"]`);
      if (await axis.isVisible() && cornerBox) doNotOverlap(await axis.boundingBox(), cornerBox, `Selection ${direction} cannot overlap the corner at ${zoom}`);
      if (zoom === .04) assert.equal(await axis.isVisible(), false, 'A tiny selection hides crowded edge targets');
    }
    await screenshot(`crowded-${Math.round(zoom * 100)}-percent`);
  }
  check('15% full-detail cards retain a corner target; 4% cards yield crowded controls while preserving connection access');

  await seed();
  await select(['a']);
  const beforeAutomatic = geometry(await read('a'));
  await page.evaluate(() => {
    window.__ui.getState().setCanvasDetail('auto');
    window.__store.setState(state => ({ nodes: state.nodes.map(item => ({ ...item, data: { ...item.data, detailLevel: undefined } })) }));
  });
  for (const zoom of [.6, .25]) {
    await setZoom(zoom);
    assert.equal(await node('a').locator('[data-node-resize]').count(), 0, 'Automatic overview does not expose working-card size controls');
  }
  await setZoom(1);
  assert.equal(await node('a').locator('[data-node-resize]').count(), 3, 'Returning to working scale restores the same controls');
  assert.deepEqual(geometry(await read('a')), beforeAutomatic, 'Semantic zoom does not change stored geometry');
  check('Automatic summary and compact views still hide working-card controls and restore them without changing geometry');

  await seed();
  await setZoom(1);
  await select(['b']);
  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['resize-b'], { width: 380, height: 120 }));
  await settle();
  await node('b').hover();
  const rightPort = node('b').locator('[data-connection-role="source"][data-connection-side="right"]');
  const portBox = await rightPort.boundingBox();
  assert.ok(portBox);
  assert.equal(await handle('b', 'width').isVisible(), false, 'A 120px material yields its crowded width handle');
  assert.equal(await handle('b', 'both').isVisible(), true, 'A short material keeps corner resizing available');
  assert.equal(await rightPort.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || element.contains(hit);
  }), true, 'The right connection port remains directly clickable on a 120px material card');
  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['resize-b'], { height: 160 }));
  await settle();
  assert.equal(await handle('b', 'width').isVisible(), true, 'A 160px material has room for the width handle');
  const tallerPort = await rightPort.boundingBox();
  const widthGripBox = await handle('b', 'width').boundingBox();
  const cornerGripBox = await handle('b', 'both').boundingBox();
  doNotOverlap(widthGripBox, { x: tallerPort.x - 10, y: tallerPort.y - 10, width: tallerPort.width + 20, height: tallerPort.height + 20 },
    'The width target clears the complete side-port hit area');
  doNotOverlap(widthGripBox, cornerGripBox, 'The width target clears the corner target on a short material');
  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['resize-b'], { height: 120 }));
  await settle();
  const materialBody = node('b').locator('[data-content-body]');
  const shortCard = await node('b').boundingBox();
  const shortBody = await materialBody.boundingBox();
  assert.ok(shortCard && shortBody && shortBody.y + shortBody.height <= shortCard.y + shortCard.height + 1, 'A short material reading area stays inside its card');
  assert.ok(shortCard.y + shortCard.height - shortBody.y - shortBody.height >= 15, 'The short reading window leaves its bottom inset clear');
  assert.equal(await materialBody.evaluate(element => element.scrollHeight > element.clientHeight), true, 'Short materials keep their content scrollable');
  await appearance('dark');
  await screenshot('dark-material-120-height');
  const materialParagraph = materialBody.locator('.markdown-body p').first();
  await materialParagraph.scrollIntoViewIfNeeded();
  await materialParagraph.dblclick();
  const noteEditor = node('b').locator('[data-note-editor]');
  const editedNote = `${(await read('b')).data.question}\n\n${Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 段：短材料的标题、正文和编辑操作始终在内部滚动；调大高度后，卡片提供更大的阅读空间。`).join('\n\n')}`;
  await noteEditor.locator('textarea').fill(editedNote);
  const saveNote = noteEditor.getByRole('button', { name: '保存', exact: true });
  await saveNote.scrollIntoViewIfNeeded();
  assert.equal(await saveNote.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || element.contains(hit);
  }), true, 'The save action remains reachable inside a 120px material card');
  await saveNote.click();
  assert.equal((await read('b')).data.question, editedNote);
  near((await read('b')).height, 120, 'Editing content preserves fixed height');
  await expandFormat();
  await page.locator('[data-node-format-field="height"]').fill('360');
  await page.locator('[data-node-format-field="height"]').press('Enter');
  assert.equal((await read('b')).height, 360);
  await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="resize-b"]').getBoundingClientRect().height > 300);
  assert.ok((await node('b').boundingBox()).height > shortCard.height + 180, 'Typed height changes the rendered card, not just its stored value');
  assert.equal((await read('b')).data.question, editedNote, 'Changing height preserves the complete edited material');
  await screenshot('dark-material-resized-height');
  check('Short materials contain and scroll their content, keep Save reachable, and visibly resize when height is entered');
  await select(['a']);
  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['resize-a'], { width: 420, height: 360 }));
  await expandFormat();
  await screenshot('dark-format-dimensions');
  await appearance('light');
  await select(['a']);
  await page.setViewportSize({ width: 900, height: 760 });
  await page.evaluate(() => window.__store.getState().setSelectionGeometry(['resize-a'], { width: 380, height: 360 }));
  await expandFormat();
  await screenshot('light-380-node-narrow-window');
  await page.evaluate(async () => (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('en'));
  await screenshot('light-380-node-english');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  check('380px cards and a narrow English window retain usable controls');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], 'Geometry editing never calls model APIs');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  await context.close();
  await browser.close();
}
