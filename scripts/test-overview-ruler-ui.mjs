// Exercise saved text and PDF highlights through the real canvas and its SVG edges.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { documentBrowser } from './fixtures/original-file-browser.mjs';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const output = 'local-tests/overview-ruler';
await mkdir(output, { recursive: true });
const { context, close } = await documentBrowser(appUrl, {
  executablePath, viewport: { width: 1780, height: 1120 }, locale: 'zh-CN', reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(60000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { providers: [], models: [], topics: [], sessions: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const card = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const marks = id => card(id).locator('[data-overview-ruler] [data-overview-ruler-mark]');
const mark = (id, handle) => marks(id).and(page.locator(`[data-overview-ruler-mark="${handle}"]`));
const ready = () => page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated(),
  undefined, { timeout: 60000 });
const camera = async zoom => {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 45, y: 45, zoom }, { duration: 0 }), zoom);
};
const graph = () => page.evaluate(() => ({
  ids: window.__store.getState().nodes.map(node => node.id),
  edges: window.__rf.getEdges().map(({ id, source, target, sourceHandle }) => ({ id, source, target, sourceHandle })),
}));

async function drag(source, destination) {
  const box = await source.boundingBox();
  assert.ok(box, 'The rendered highlight handle has a hit area');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 20 });
  await page.mouse.up();
}

async function waitForWire(source, handle, target) {
  const result = await page.waitForFunction(({ source, handle, target }) =>
    window.__rf.getEdges().find(edge => edge.source === source && edge.sourceHandle === handle
      && (!target || edge.target === target)), { source, handle, target });
  const { id, target: targetId } = await result.jsonValue();
  await result.dispose();
  return { id, target: targetId };
}

async function assertWireAtMark(edgeId, sourceId, handle) {
  const endpoint = ({ edgeId, sourceId, handle, inspect }) => {
    const path = document.querySelector(`.react-flow__edge[data-id="${edgeId}"] .react-flow__edge-path`);
    const node = document.querySelector(`.react-flow__node[data-id="${sourceId}"]`);
    const mark = node?.querySelector(`[data-overview-ruler-mark="${handle}"]`);
    if (!path || !mark || !path.getScreenCTM()) return false;
    const p = path.getPointAtLength(0).matrixTransform(path.getScreenCTM());
    const box = mark.getBoundingClientRect();
    if (inspect) return { wire: [p.x, p.y], mark: box.toJSON(), path: path.getAttribute('d'),
      markers: [...node.querySelectorAll('[data-overview-ruler-mark]')].map(el => [
        el.dataset.handleid, el.getBoundingClientRect().toJSON(), el.style.left,
      ]),
      liveHandles: window.__rf.getInternalNode(sourceId)?.internals.handleBounds?.source,
      edge: window.__rf.getEdges().find(edge => edge.id === edgeId) };
    return p.x >= box.left - 2 && p.x <= box.right + 2 && Math.abs(p.y - (box.top + box.height / 2)) < 3;
  };
  const args = { edgeId, sourceId, handle };
  try { await page.waitForFunction(endpoint, args); }
  catch (error) {
    console.error(args, JSON.stringify(await page.evaluate(endpoint, { ...args, inspect: true })));
    throw error;
  }
}

const firstLine = '调查发现，沿河路段的积水消退较慢。';
const lastLine = '下次暴雨后，应优先复查沿河路段。';
const pdf = await PDFDocument.create();
pdf.addPage([420, 560]).drawText('Trace this PDF passage.', { x: 30, y: 480, size: 16 });
pdf.addPage([420, 560]).drawText('A second document page.', { x: 30, y: 480, size: 16 });
const content = Buffer.from(await pdf.save()).toString('base64');

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.evaluate(({ firstLine, lastLine, content }) => {
    const middle = Array.from({ length: 24 }, (_, i) =>
      `观测点 ${i + 1} 记录了降雨结束后的路面水深。`);
    const text = [firstLine, ...middle, lastLine].join('\n\n');
    const make = (id, x, y, width, height, data) => ({
      id, type: 'thought', position: { x, y }, width, height, dragHandle: '.drag-handle',
      data: { question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0,
        highlights: [], highlightMode: 'off', detailLevel: 'full', attachments: [], ...data },
    });
    const nodes = [
      make('note', 100, 70, 480, 300, { stepKind: 'note', displayName: '沿河路段调查笔记', question: text }),
      make('file', 100, 460, 480, 470, { stepKind: 'file', attachments: [
        { id: 'original', type: 'application/pdf', name: '现场观测记录.pdf', size: content.length,
          content, extractedText: 'Trace this PDF passage.', numPages: 2 },
      ] }),
      make('target', 850, 150, 470, 360, { displayName: '复查计划', question: '哪些路段需要优先复查？',
        response: '下次暴雨后，先复查沿河路段，再比较各观测点的积水消退时间。',
        responses: ['下次暴雨后，先复查沿河路段，再比较各观测点的积水消退时间。'] }),
    ];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setPanelOpen(false); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false);
    ui.setCanvasDetail('full'); ui.setReaderMode('full');
  }, { firstLine, lastLine, content });
  const span = card('file').locator('[data-page="1"] .tdag-textlayer span').first();
  await span.waitFor();
  await camera(1);
  assert.equal(await marks('note').count(), 0);
  assert.equal(await marks('file').count(), 0);

  await page.evaluate(() => window.__ui.getState().setReaderNodeId('note'));
  const reader = page.locator('[data-material-reader]');
  await reader.locator('[data-highlighter-toggle]').first().click();
  // Highlight in reverse reading order to distinguish source positions from creation order.
  const highlights = [];
  for (const passage of [lastLine, firstLine]) {
    const textNode = reader.locator('[data-reader-highlight-content] p').filter({ hasText: passage });
    await textNode.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    const saved = await page.waitForFunction(text =>
      window.__store.getState().nodes.find(node => node.id === 'note').data.highlights.find(mark => mark.text === text), passage);
    highlights.push((await saved.jsonValue()).id);
    await saved.dispose();
  }
  await page.evaluate(() => window.__ui.getState().setReaderNodeId(null));
  await reader.waitFor({ state: 'detached' });
  const noteMarks = await marks('note').evaluateAll(elements => elements.map(el => ({
    handle: el.dataset.overviewRulerMark, y: el.getBoundingClientRect().top,
  })).sort((a, b) => a.y - b.y));
  assert.equal(noteMarks.length, 2);
  assert.deepEqual(await card('note').locator('[data-content-body] mark.highlight-mark').allTextContents(), [firstLine, lastLine]);
  assert.ok(noteMarks[1].y - noteMarks[0].y > 24, 'Beginning and end of the document are distinguishable');
  const [early, late] = noteMarks.map(item => item.handle);
  const earlyHighlight = highlights[1];
  const target = await card('target').boundingBox();
  const destination = { x: target.x + target.width / 2, y: target.y + target.height * 0.4 };
  const wires = [];
  for (const handle of [early, late]) {
    await drag(mark('note', handle), destination);
    const wire = await waitForWire('note', handle, 'target');
    await assertWireAtMark(wire.id, 'note', handle);
    wires.push(wire);
  }
  assert.notEqual(wires[0].id, wires[1].id);
  assert.equal(await reader.count(), 0, 'Dragging to a node must not open the material reader');
  console.log('PASS two highlights link independently to the same target');

  await card('file').locator('[data-pdf-mode="highlight"]').click();
  const textBox = await span.boundingBox();
  await page.mouse.move(textBox.x + 1, textBox.y + textBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width - 1, textBox.y + textBox.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__store.getState().nodes.find(node => node.id === 'file')
    .data.attachments[0].pdfAnnotations?.some(annotation => annotation.text.includes('PDF passage')));
  const pdfMark = marks('file').first();
  const pdfHandle = await pdfMark.getAttribute('data-overview-ruler-mark');
  const beforeDrop = await graph();
  await drag(pdfMark, { x: 1070, y: 780 });
  const pdfWire = await waitForWire('file', pdfHandle);
  assert.ok(!(beforeDrop.ids.includes(pdfWire.target)));
  assert.equal((await graph()).ids.length, beforeDrop.ids.length + 1);
  assert.equal(await reader.count(), 0, 'Dragging to empty canvas must not navigate to the PDF');
  await assertWireAtMark(pdfWire.id, 'file', pdfHandle);
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual((await graph()).ids, beforeDrop.ids);
  await page.evaluate(() => window.__store.getState().redo());
  await assertWireAtMark(pdfWire.id, 'file', pdfHandle);
  console.log('PASS native PDF highlight extends to a new question in one undo step');

  const markPositionInCard = () => pdfMark.evaluate(mark => {
    const box = mark.closest('.react-flow__node').getBoundingClientRect();
    const tick = mark.getBoundingClientRect();
    return (tick.y + tick.height / 2 - box.y) / box.height;
  });
  const beforeScroll = await markPositionInCard();
  const body = card('file').locator('[data-content-body]').first();
  const scrolled = await body.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop; });
  assert.ok(scrolled > 50);
  assert.ok(Math.abs((await markPositionInCard()) - beforeScroll) < 0.005);
  await camera(0.78);
  await assertWireAtMark(pdfWire.id, 'file', pdfHandle);
  await assertWireAtMark(wires[0].id, 'note', early);
  console.log('PASS document scrolling and canvas zoom keep wires attached');

  await page.setViewportSize({ width: 680, height: 720 });
  const detailAndLighting = (detail, lighting) => page.evaluate(async ({ detail, lighting }) => {
    const { setNodeDetail } = await import('/src/lib/node-detail.ts');
    const { useAppearance } = await import('/src/lib/appearance.ts');
    setNodeDetail(window.__store.getState().nodes.map(node => node.id), detail);
    useAppearance.getState().setLighting(lighting);
    window.__ui.getState().setPanelOpen(false);
  }, { detail, lighting });
  await detailAndLighting('compact', 'dark');
  await camera(0.4);
  await card('note').locator('[data-node-overview-surface="compact"]').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  for (const [wire, id, handle] of [[wires[0], 'note', early], [wires[1], 'note', late], [pdfWire, 'file', pdfHandle]]) {
    await assertWireAtMark(wire.id, id, handle);
  }
  const compactMark = mark('note', late);
  const hit = await compactMark.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hits = (x, y) => element.contains(document.elementFromPoint(x, y));
    const offsets = Array.from({ length: 51 }, (_, i) => i - 25);
    return { width: rect.width, height: rect.height, centerReceivesPointer: hits(x, y),
      hitWidth: offsets.filter(dx => hits(x + dx, y)).length, hitHeight: offsets.filter(dy => hits(x, y + dy)).length };
  });
  assert.equal(hit.centerReceivesPointer, true, 'The compact mark must not be covered by an edge or card');
  console.log('Compact mark in screen pixels at 40%', hit);
  assert.ok(hit.hitWidth >= 11 && hit.hitHeight >= 11,
    'Highlight ports should retain a 12 by 12 screen-pixel hit area, allowing one pixel for rounding');
  await page.evaluate(() => {
    const state = window.__ui.getState();
    state.toasts.forEach(toast => state.dismissToast(toast.id));
    window.__store.getState().setSelectedNodeIds([]);
  });
  await page.mouse.move(345, 640);
  await page.screenshot({ path: `${output}/overview-ruler-compact.png` });
  const beforeCompactDrop = await graph();
  await drag(compactMark, { x: 358, y: 535 });
  const newNode = await page.waitForFunction(ids => window.__store.getState().nodes.find(node => !ids.includes(node.id))?.id,
    beforeCompactDrop.ids);
  const compactWire = await waitForWire('note', late, await newNode.jsonValue());
  await newNode.dispose();
  await assertWireAtMark(compactWire.id, 'note', late);
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual((await graph()).ids, beforeCompactDrop.ids);
  await page.setViewportSize({ width: 1780, height: 1120 });
  await detailAndLighting('full', 'light');
  await camera(1);
  await assertWireAtMark(wires[1].id, 'note', late);
  console.log('PASS narrow dark canvas keeps compact highlight ports attached and draggable at 40% zoom');

  await page.evaluate(async () => { await (await import('/src/lib/persistence.ts')).flushPendingWrites(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await camera(1);
  for (const [wire, id, handle] of [[wires[0], 'note', early], [wires[1], 'note', late], [pdfWire, 'file', pdfHandle]]) {
    await assertWireAtMark(wire.id, id, handle);
  }
  console.log('PASS reopening the canvas restores highlight wires');

  await page.evaluate(id => window.__store.getState().removeHighlight('note', id), earlyHighlight);
  await mark('note', early).waitFor({ state: 'detached' });
  await page.waitForFunction(id => {
    const edge = window.__rf.getEdges().find(edge => edge.id === id);
    return edge?.sourceHandle?.startsWith('out-') && document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
  }, wires[0].id);
  await assertWireAtMark(wires[1].id, 'note', late);
  await page.evaluate(() => window.__store.getState().undo());
  await assertWireAtMark(wires[0].id, 'note', early);
  console.log('PASS removing a highlight preserves the edge and undo restores its original endpoint');
  await span.waitFor();
  await card('file').locator('[data-pdf-annotation]').first().waitFor();
  await page.screenshot({ path: `${output}/overview-ruler.png` });

  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} catch (error) {
  console.error({ graph: await graph().catch(() => null), errors, writes });
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await close();
}
