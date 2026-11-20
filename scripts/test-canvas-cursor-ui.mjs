// Pointer promises are checked at the actual hit target, then exercised with real mouse gestures.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const output = 'local-tests/canvas-cursor';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
await context.routeWebSocket(/.*/, socket => socket.close());
const checks = [], failures = [], errors = [], writes = [];
await context.route('**/__thoughtdag_storage**', route => route.fulfill({ status: 404, body: '' }));
await context.route('**/api/**', route => {
  const request = route.request(), url = new URL(request.url());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`);
  if (url.pathname === '/api/models') return route.fulfill({ json: {
    models: [{ id: 'test/cursor', name: 'Local fixture', provider: 'test', vision: false }], default: 'test/cursor',
  } });
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [], items: [], hits: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror', error => errors.push(error.message));
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const positions = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position }) => ({ id, ...position })));
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);

async function probe(label, run) {
  try { await run(); checks.push(label); console.log(`PASS ${label}`); }
  catch (error) {
    failures.push({ label, error: String(error) });
    console.error(`FAIL ${label}: ${error}`);
    await page.screenshot({ path: `${output}/failure-${failures.length}.png` }).catch(() => {});
  } finally {
    await page.mouse.up();
    await page.mouse.up({ button: 'middle' });
    await page.keyboard.up('Space');
  }
}

async function fixture({ zoom = 1, theme = 'light', detail = 'full', disabled = false } = {}) {
  await page.keyboard.press('Escape');
  await page.mouse.move(1500, 1000);
  await page.evaluate(async ({ zoom, theme, detail, disabled }) => {
    document.activeElement?.blur();
    window.getSelection()?.removeAllRanges();
    const data = (question, extra = {}) => ({ question,
      response: 'Readable answer text remains selectable while the header moves the card. [Reference](https://example.com/reference)',
      responses: ['Readable answer text remains selectable while the header moves the card. [Reference](https://example.com/reference)'], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 24, roleMode: 'inherit',
      detailLevel: detail, ...extra });
    const nodes = [
      { id: 'frame', position: { x: 80, y: 100 }, width: 1200, height: 780,
        data: data('材料与引用', { stepKind: 'frame', frameCarry: true }) },
      { id: 'note', position: { x: 130, y: 190 }, width: 440, height: 310,
        data: data('# 我的收藏夹体检\n\nSelectable material text keeps its reading behavior.\n\n[Reference](https://example.com/reference)', { stepKind: 'note', response: '', responses: [], responseIndex: -1 }) },
      { id: 'thought', position: { x: 680, y: 190 }, width: 440, height: 450,
        data: data('How should this material be used?', { displayName: '整理结果', displaySummary: '阅读正文和拖动卡片使用不同区域。' }) },
    ].map(item => ({ ...item, type: 'thought', dragHandle: '.drag-handle', draggable: !disabled, selected: false }));
    const edges = [{ id: 'note-thought', source: 'note', target: 'thought', type: 'smoothstep',
      sourceHandle: 'source-right', targetHandle: 'target-left', data: { route: 'curve' } }];
    window.__canvasEditing.getState().reset();
    window.__ui.setState({ panelOpen: false, panelNodeId: null, readerNodeId: null, tutorialOpen: false,
      releaseNotesOpen: false, drafts: {}, canvasDetail: detail,
      condenseRun: { status: 'idle', current: 0, total: 0, streaming: '', originalIds: [], distillIds: [] } });
    window.__store.setState({ nodes, edges, selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges }], historyIndex: 0 });
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme);
    window.__rf.setViewport({ x: zoom === 1 ? 40 : 120, y: zoom === 1 ? 20 : 100, zoom }, { duration: 0 });
  }, { zoom, theme, detail, disabled });
  await node('thought').waitFor();
  await page.waitForFunction(() => window.__store.getState().nodes.every(item => item.measured?.width && item.measured?.height));
  await page.waitForTimeout(250);
  // The one-time fit on first render must finish before screen coordinates are sampled.
  await page.evaluate(zoom => window.__rf.setViewport({ x: zoom === 1 ? 40 : 120, y: zoom === 1 ? 20 : 100, zoom }, { duration: 0 }), zoom);
  await settle();
}

async function point(locator, fx = .5, fy = .5) {
  const box = await locator.boundingBox();
  assert.ok(box, 'The interaction target is rendered');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function dragSurfacePoint(locator) {
  const center = await point(locator);
  // Hover reveals connection targets, which must be excluded before choosing
  // a gesture origin on a short overview header.
  await page.mouse.move(center.x, center.y);
  await settle();
  const target = await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    for (const fy of [.5, .25, .75, .1, .9]) for (const fx of [.5, .25, .75, .1, .9]) {
      const x = box.x + box.width * fx, y = box.y + box.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && element.contains(hit) && hit.closest('.drag-handle')
        && !hit.closest('.nodrag, button, input, textarea, a[href]')) return { x, y };
    }
    return null;
  });
  assert.ok(target, 'A non-interactive drag surface is available outside connection targets');
  return target;
}

async function cursorAt(at, expected, label, selector) {
  await page.mouse.move(at.x, at.y);
  await settle();
  const hit = await page.evaluate(({ x, y, selector }) => {
    const element = document.elementFromPoint(x, y);
    return { cursor: element && getComputedStyle(element).cursor, tag: element?.tagName,
      className: element?.getAttribute('class'), matches: !selector || !!element?.closest(selector) };
  }, { ...at, selector });
  assert.ok(hit.matches, `${label} hit the wrong target: ${JSON.stringify(hit)}`);
  assert.equal(hit.cursor, expected, `${label}: ${JSON.stringify(hit)}`);
}

async function drag(at, dx = 72, dy = 30, during) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
  await settle();
  if (during) await during({ x: at.x + dx, y: at.y + dy });
  await page.mouse.up();
  await settle();
}

function moved(before, after, ids, dx, dy, zoom) {
  for (const original of before) {
    const current = after.find(item => item.id === original.id);
    assert.ok(current, `Node ${original.id} still exists`);
    if (!ids.includes(original.id)) { assert.deepEqual(current, original); continue; }
    // React Flow consumes the first subthreshold movement while starting its drag.
    near(current.x - original.x, dx / zoom, 8 / zoom, `${original.id} horizontal drag`);
    near(current.y - original.y, dy / zoom, 5 / zoom, `${original.id} vertical drag`);
  }
}

async function dragNode(id, selector, ids, zoom, fx = .6, fy = .5) {
  const at = await point(node(id).locator(selector).first(), fx, fy);
  assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)
    ?.closest('.react-flow__handle, .react-flow__resize-control, button, input, textarea, a[href]'), at), false,
    `${id} drag gesture starts on the drag surface, outside ports and controls`);
  await cursorAt(at, 'grab', `${id} drag target`, '.drag-handle');
  const before = await positions();
  await drag(at, 72, 30, async current => {
    await cursorAt(current, 'grabbing', `${id} active drag`);
    assert.equal(await node(id).evaluate(element => element.classList.contains('dragging')), true);
  });
  moved(before, await positions(), ids, 72, 30, zoom);
  const released = await point(node(id).locator(selector).first(), fx, fy);
  // Selecting a frame exposes its border resizer. That new hit target may
  // own the pointer after release, but must not change the active move cursor.
  const resizeLine = selector === '[data-frame-border]' && await page.evaluate(({ x, y }) =>
    !!document.elementFromPoint(x, y)?.closest('.react-flow__resize-control.bottom'), released);
  await cursorAt(released, resizeLine ? 'ns-resize' : 'grab', `${id} released drag`);
}

async function selectText(id, selector, clear = true) {
  const target = node(id).locator(selector).first();
  const range = await target.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      if ((text.textContent?.length ?? 0) < 30) continue;
      const range = document.createRange();
      range.setStart(text, 1); range.setEnd(text, 2);
      const start = range.getBoundingClientRect();
      range.setStart(text, 23); range.setEnd(text, 24);
      const end = range.getBoundingClientRect();
      return { start: { x: start.x, y: start.y + start.height / 2 }, end: { x: end.x, y: end.y + end.height / 2 } };
    }
    return null;
  });
  assert.ok(range, 'Fixture has enough text to exercise selection');
  await cursorAt(range.start, 'text', `${id} readable text`);
  const before = await positions(), camera = await viewport();
  await drag(range.start, range.end.x - range.start.x, range.end.y - range.start.y);
  assert.ok((await page.evaluate(() => window.getSelection()?.toString() ?? '')).length >= 8, `${id} text is actually selected`);
  assert.deepEqual(await positions(), before, `${id} text selection does not move nodes`);
  assert.deepEqual(await viewport(), camera, `${id} text selection does not pan the canvas`);
  if (clear) await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5201', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__canvasEditing);
  for (const theme of ['light', 'dark']) for (const zoom of [1, .65]) {
    const label = `${theme} at ${zoom} zoom`;
    await probe(`${label}: headers and frame border promise and perform dragging`, async () => {
      await fixture({ theme, zoom });
      await dragNode('thought', '[data-node-details-header]', ['thought'], zoom);
      await fixture({ theme, zoom });
      await dragNode('note', '.material-header', ['note'], zoom);
      await fixture({ theme, zoom });
      await dragNode('frame', '[data-frame-header]', ['frame', 'note', 'thought'], zoom, .45);
      await fixture({ theme, zoom });
      await dragNode('frame', '[data-frame-border]', ['frame', 'note', 'thought'], zoom, .5);
    });

    await probe(`${label}: body text, padding, links, buttons and canvas have distinct cursors`, async () => {
      await fixture({ theme, zoom });
      await selectText('thought', '.conversation-answer p');
      await fixture({ theme, zoom });
      await selectText('note', '[data-content-body] .markdown-body p');
      await fixture({ theme, zoom });
      await cursorAt(await point(node('thought').locator('[data-thought-body]'), .01, .1), 'default', 'Conversation body padding');
      await cursorAt(await point(node('note').locator('[data-content-body]').locator('..'), .01, .5), 'default', 'Material body padding');
      await cursorAt(await point(node('thought').locator('.conversation-answer a').first()), 'pointer', 'Reference link', 'a');
      await cursorAt(await point(node('thought').locator('[data-node-metadata-toggle]')), 'pointer', 'Metadata edit action', 'button');
      const frame = await node('frame').boundingBox();
      await cursorAt({ x: frame.x + frame.width - 25 * zoom, y: frame.y + frame.height * .7 }, 'crosshair', 'Frame interior', '.react-flow__pane');
      await cursorAt({ x: 1470, y: 900 }, 'crosshair', 'Empty canvas', '.react-flow__pane');
      await page.screenshot({ path: `${output}/${theme}-${zoom}.png` });
    });

    await probe(`${label}: Shift adds and removes nodes without extending a native text selection`, async () => {
      await fixture({ theme, zoom });
      const material = node('note').locator('[data-content-body] .markdown-body p').first();
      await material.click({ position: { x: 20, y: 8 } });
      await selectText('note', '[data-content-body] .markdown-body p', false);
      const before = await positions(), camera = await viewport();
      const at = await point(node('thought').locator('.conversation-answer p').first(), .15, .1);
      await page.keyboard.down('Shift');
      try {
        await page.mouse.click(at.x, at.y);
        await page.waitForFunction(() => window.__store.getState().selectedNodeIds.length === 2);
        assert.deepEqual(await page.evaluate(() => [...window.__store.getState().selectedNodeIds].sort()), ['note', 'thought']);
        assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ''), '', 'Adding a node clears the old text selection and creates no new one');
        await page.mouse.click(at.x, at.y);
        await page.waitForFunction(() => window.__store.getState().selectedNodeIds.length === 1);
        assert.deepEqual(await page.evaluate(() => window.__store.getState().selectedNodeIds), ['note']);
        assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ''), '');
      } finally { await page.keyboard.up('Shift'); }
      assert.deepEqual(await positions(), before);
      assert.deepEqual(await viewport(), camera);
      await page.screenshot({ path: `${output}/shift-selection-${theme}-${zoom}.png` });
    });

    await probe(`${label}: header button gestures never move their node`, async () => {
      for (const [id, selector] of [['thought', '[data-node-details]'], ['note', '[data-note-edit]'], ['frame', '[data-frame-carry-toggle]']]) {
        await fixture({ theme, zoom });
        const at = await point(node(id).locator(selector));
        await cursorAt(at, 'pointer', `${id} header button`, 'button');
        const before = await positions();
        await drag(at, -65, 14);
        assert.deepEqual(await positions(), before, `${id} button must not initiate node drag`);
      }
    });
  }

  await probe('Shift-click preserves action buttons and native selection in text inputs and editors', async () => {
    await fixture();
    await node('thought').locator('[data-edit-response]').click({ modifiers: ['Shift'] });
    const responseEditor = node('thought').locator('[data-canvas-response-editor]');
    const value = 'Editable text keeps its native selection behavior.';
    const selectInEditor = async editor => {
      await editor.scrollIntoViewIfNeeded();
      const at = await editor.evaluate(element => {
        const rect = element.getBoundingClientRect();
        for (const fy of [.1, .3, .5, .7, .9]) {
          const p = { x: rect.left + 12, y: rect.top + rect.height * fy };
          if (document.elementFromPoint(p.x, p.y) === element) return p;
        }
      });
      assert.ok(at, 'A visible part of the editor accepts text input');
      await cursorAt(at, 'text', 'Text editor', 'input, textarea');
      await editor.fill(value);
      await editor.evaluate(element => { element.focus(); element.setSelectionRange(0, 0); });
      await editor.click({ position: { x: 130, y: 20 }, modifiers: ['Shift'] });
      assert.ok(await editor.evaluate(element => element.selectionEnd - element.selectionStart > 5), 'Shift-click extends native editor selection');
      await page.keyboard.press('Shift+ArrowRight');
      assert.ok(await editor.evaluate(element => element.selectionEnd - element.selectionStart > 5), 'Shift keyboard selection remains native');
      assert.equal(await editor.inputValue(), value);
    };
    await selectInEditor(responseEditor);
    await fixture();
    await node('thought').locator('[data-node-metadata-toggle]').click({ modifiers: ['Shift'] });
    await selectInEditor(node('thought').locator('[data-node-title-input]'));
    await selectInEditor(node('thought').locator('[data-node-summary-input]'));
  });

  for (const detail of ['summary', 'compact']) await probe(`${detail}: overview drag targets retain the same promise`, async () => {
    await fixture({ detail, zoom: .65 });
    // The compact shell includes large connection targets near its edges.
    // Start on the rendered name so this exercises moving, not wiring.
    await dragNode('note', '.node-overview-name', ['note'], .65, .3, .5);
    await fixture({ detail, zoom: .65 });
    await dragNode('thought', '[data-node-details-header]', ['thought'], .65, .6, .5);
  });

  await probe('Compact material connection ports keep their crosshair inside the drag surface', async () => {
    await fixture({ detail: 'compact', zoom: .65 });
    await node('note').locator('.drag-handle').hover();
    const port = node('note').locator('[data-connection-role="source"][data-connection-side="bottom"]');
    await cursorAt(await point(port), 'crosshair', 'Compact material source port', '.react-flow__handle');
    await page.evaluate(() => window.__store.setState(state => ({
      nodes: state.nodes.map(node => node.id === 'note' ? { ...node, connectable: false } : node),
    })));
    await page.waitForFunction(() => document.querySelector('[data-id="note"] [data-connection-role="source"]')
      ?.classList.contains('tdag-port-disabled'));
    const disabled = await port.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { pointerEvents: getComputedStyle(el).pointerEvents, hitsPort: !!hit?.closest('.react-flow__handle') };
    });
    assert.deepEqual(disabled, { pointerEvents: 'none', hitsPort: false }, 'The unavailable port yields to the underlying canvas or card');
  });

  await probe('Clicking a selectable wire selects that edge under the pointer cursor', async () => {
    await fixture();
    const path = page.locator('.react-flow__edge[data-id="note-thought"] .react-flow__edge-interaction');
    const at = await path.evaluate(edge => {
      const p = edge.getPointAtLength(edge.getTotalLength() / 2).matrixTransform(edge.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    await cursorAt(at, 'pointer', 'Selectable wire', '.react-flow__edge');
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.__store.getState().edges.some(edge => edge.id === 'note-thought' && edge.selected));
  });

  await probe('Disabled history and minimum-zoom controls stop advertising active actions', async () => {
    await fixture();
    const undo = page.locator('.canvas-toolbar-history button').first();
    assert.ok(await undo.isDisabled(), 'The fixture has no change to undo');
    await cursorAt(await point(undo), 'not-allowed', 'Disabled history action', 'button:disabled');
    const out = page.locator('.react-flow__controls-zoomout');
    await cursorAt(await point(out), 'pointer', 'Enabled zoom out', 'button');
    await page.evaluate(() => window.__rf.zoomTo(.04, { duration: 0 }));
    await page.waitForFunction(() => document.querySelector('.react-flow__controls-zoomout')?.disabled);
    const at = await point(out);
    await page.mouse.move(at.x, at.y);
    const actual = await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)).cursor, at);
    assert.ok(['auto', 'default', 'not-allowed'].includes(actual), 'Disabled zoom out hit cursor: ' + actual);
    await page.mouse.click(at.x, at.y);
    assert.equal((await viewport()).zoom, .04);
  });

  await probe('Single-node width, height and corner resize handles keep their directional cursors', async () => {
    await fixture();
    await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['thought']));
    for (const [name, cursor] of [['width', 'ew-resize'], ['height', 'ns-resize'], ['both', 'nwse-resize']]) {
      const grip = node('thought').locator('[data-node-resize="' + name + '"]');
      await cursorAt(await point(grip), cursor, name + ' handle', '[data-node-resize]');
    }
  });

  await probe('Minimap dragging pans the camera and restores its open-hand cursor on release', async () => {
    await fixture();
    const minimap = page.locator('.react-flow__minimap-svg');
    await minimap.hover();
    const at = await point(minimap, .4, .55);
    const before = await viewport();
    await cursorAt(at, 'grab', 'Pannable minimap', '.react-flow__minimap-svg');
    await page.mouse.down();
    await cursorAt({ x: at.x + 18, y: at.y + 10 }, 'grabbing', 'Dragging minimap', '.react-flow__minimap-svg');
    const after = await viewport();
    assert.ok(Math.abs(after.x - before.x) > 2 && Math.abs(after.y - before.y) > 2, 'Minimap changed the real canvas viewport');
    const outside = { x: (await minimap.boundingBox()).x - 30, y: at.y };
    await page.mouse.move(outside.x, outside.y, { steps: 4 });
    await settle();
    assert.notDeepEqual(await viewport(), after, 'The camera keeps panning outside the minimap');
    await cursorAt(outside, 'grabbing', 'Continuing the same minimap drag outside its bounds');
    await page.mouse.up();
    await cursorAt(outside, 'crosshair', 'Canvas marquee restored on release', '.react-flow__pane');
    await cursorAt(await point(minimap, .4, .55), 'grab', 'Released minimap', '.react-flow__minimap-svg');
  });

  await probe('Material palette tools show the drag threshold and create only on a completed drop', async () => {
    const palette = page.locator('[data-content-palette]');
    const preview = page.locator('[data-palette-drag-preview]');
    const drop = { x: 1450, y: 820 };
    for (const [kind, label] of [['note', /^新建便笺/], ['file', /^新建文件节点/], ['frame', /^新建分区框/]]) {
      await fixture();
      const tool = palette.getByRole('button', { name: label });
      const center = await point(tool);
      const start = { x: Math.round(center.x), y: Math.round(center.y) };
      const original = await positions();
      await cursorAt(start, 'grab', kind + ' palette tool', 'button');
      await page.mouse.down();
      await cursorAt({ x: start.x + 6, y: start.y }, 'grab', kind + ' armed tool', 'button');
      assert.equal(await preview.count(), 0, 'A 6px move still belongs to the click');
      await page.mouse.move(start.x + 7, start.y);
      await preview.waitFor({ state: 'visible' });
      await cursorAt(drop, 'grabbing', kind + ' drag outside the toolbar', '.react-flow__pane');
      assert.deepEqual(await positions(), original, 'The preview alone leaves the graph untouched');
      await page.mouse.up();
      await preview.waitFor({ state: 'detached' });
      const created = await page.evaluate(ids => window.__store.getState().nodes.filter(node => !ids.includes(node.id))
        .map(node => node.data.stepKind), original.map(node => node.id));
      assert.deepEqual(created, [kind], 'One drop creates exactly one matching material');
      await cursorAt(start, 'grab', kind + ' tool after release', 'button');
    }
    // Use a native touch cancellation to end an actual pointer stream.
    await fixture();
    const start = await point(palette.getByRole('button', { name: /^新建便笺/ }));
    const original = await positions();
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 8, y: start.y }] });
      await preview.waitFor({ state: 'visible' });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await preview.waitFor({ state: 'detached' });
    } finally {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.detach();
    }
    await page.mouse.click(drop.x, drop.y);
    assert.deepEqual(await positions(), original, 'Cancellation and a subsequent click create nothing');
    await cursorAt(start, 'grab', 'Palette tool after cancellation', 'button');
  });

  await probe('Multi-selection owns dragging and resize cursors across the entire selected region', async () => {
    await fixture({ zoom: .65 });
    await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['note', 'thought']));
    await page.locator('[data-selection-move]').waitFor();
    const at = await point(page.locator('[data-selection-move]'), .5, .5);
    await cursorAt(at, 'grab', 'Multi-selection interior', '[data-selection-move]');
    const before = await positions();
    await drag(at, 48, 24, at => cursorAt(at, 'grabbing', 'Moving multi-selection'));
    moved(before, await positions(), ['note', 'thought'], 48, 24, .65);
    for (const [name, cursor] of [['width', 'ew-resize'], ['height', 'ns-resize'], ['both', 'nwse-resize']]) {
      await cursorAt(await point(page.locator('[data-selection-resize="' + name + '"]')), cursor, 'Multi-selection ' + name);
    }

    const pan = page.locator('.react-flow__controls-pan');
    await pan.click();
    try {
      const camera = await viewport(), selectedPositions = await positions();
      const gap = await point(page.locator('[data-selection-move]'));
      await drag(gap, 54, 32, current => cursorAt(current, 'grabbing', 'Panning over the selection'));
      const after = await viewport();
      near(after.x - camera.x, 54, 1, 'Selection pan x');
      near(after.y - camera.y, 32, 1, 'Selection pan y');
      assert.deepEqual(await positions(), selectedPositions);
      assert.deepEqual(await page.evaluate(() => [...window.__store.getState().selectedNodeIds].sort()), ['note', 'thought']);
    } finally {
      await pan.click();
    }
  });

  await probe('Disabled node dragging does not leave a grab cursor on headers or overviews', async () => {
    for (const detail of ['full', 'compact']) {
      await fixture({ disabled: true, detail });
      for (const id of ['thought', 'note', 'frame']) {
        const at = await dragSurfacePoint(node(id).locator('.drag-handle').first());
        await cursorAt(at, 'default', `${id} disabled header`);
        const before = await positions();
        await drag(at, 40, 20);
        assert.deepEqual(await positions(), before);
      }
    }
  });

  await probe('Layout preview suppresses dragging promises and mutations', async () => {
    await fixture();
    await page.evaluate(() => window.__canvasEditing.getState().setLayoutPreview(window.__store.getState().nodes));
    await settle();
    const at = await point(node('thought').locator('[data-node-details-header]'), .6, .5);
    await cursorAt(at, 'default', 'Layout preview header');
    const before = await positions();
    await drag(at, 40, 20);
    assert.deepEqual(await positions(), before);
  });

  await probe('Condense build disables node and multi-selection grab surfaces until it finishes', async () => {
    await fixture();
    await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['note', 'thought']));
    await page.locator('[data-selection-move]').waitFor();
    await page.evaluate(() => window.__ui.getState().setCondenseRun({ status: 'building', total: 1 }));
    await page.locator('[data-selection-move]').waitFor({ state: 'detached' });
    const before = await positions();
    const at = await point(node('thought').locator('[data-node-details-header]'), .6, .5);
    await cursorAt(at, 'default', 'Locked header during condense');
    await drag(at, 60, 24);
    assert.deepEqual(await positions(), before);
    await page.evaluate(() => {
      window.__ui.getState().setCondenseRun({ status: 'idle' });
      window.__store.getState().setSelectedNodeIds(['note', 'thought']);
    });
    await page.locator('[data-selection-move]').waitFor();
    await cursorAt(await point(page.locator('[data-selection-move]')), 'grab', 'Restored multi-selection');
  });

  await probe('Read-only viewer removes node grab cursors while its canvas really pans', async () => {
    await fixture();
    const payload = await page.evaluate(() => {
      const state = window.__store.getState();
      return { nodes: state.nodes, edges: state.edges };
    });
    const hash = deflateRawSync(Buffer.from(JSON.stringify(payload))).toString('base64url');
    // A changed query loads a fresh document without racing the app's hashchange reload.
    const viewerUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5201');
    viewerUrl.searchParams.set('cursor-viewer-test', '1');
    viewerUrl.hash = `view=${hash}`;
    await page.goto(viewerUrl.href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__rf && window.__store?.getState().nodes.some(item => item.id === 'thought'));
    await page.evaluate(() => {
      window.__ui.setState({ tutorialOpen: false, releaseNotesOpen: false, panelOpen: false });
      window.__rf.setViewport({ x: 40, y: 20, zoom: 1 }, { duration: 0 });
    });
    await settle();
    for (const id of ['thought', 'note', 'frame']) {
      const at = await point(node(id).locator('.drag-handle').first(), .6, .5);
      await cursorAt(at, 'default', `${id} viewer header`);
    }
    const before = await positions(), camera = await viewport();
    const at = { x: 1470, y: 900 };
    await cursorAt(at, 'grab', 'Read-only canvas pan', '.react-flow__pane');
    await drag(at, 48, 28, current => cursorAt(current, 'grabbing', 'Active viewer pan'));
    const after = await viewport();
    near(after.x - camera.x, 48, 1, 'Viewer pan x');
    near(after.y - camera.y, 28, 1, 'Viewer pan y');
    assert.deepEqual(await positions(), before, 'Viewer pans without changing graph geometry');
  });

  assert.deepEqual(writes, [], 'Pointer gestures never issue API writes');
  assert.deepEqual(errors, [], 'No browser errors');
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, failures, errors, writes }, null, 2));
  await browser.close();
}
assert.deepEqual(failures, [], `${failures.length} cursor/gesture regression checks failed; see ${output}/results.json`);
console.log(`PASS ${checks.length} canvas cursor/gesture scenarios`);
