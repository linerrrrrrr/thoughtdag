import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5175');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(8000);
page.setDefaultNavigationTimeout(60000);
const errors = [], failures = [];
page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return url.origin !== appUrl.origin || url.pathname.startsWith('/api/') || url.pathname === '/__thoughtdag_storage'
    ? route.abort('blockedbyclient') : route.continue();
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

const id = 'size-stability';
const node = () => page.locator(`.react-flow__node[data-id="${id}"]`);
const settle = async () => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(180);
};
const seed = async ({ kind, width = 520, height, question = '请解释这个问题。', response = '这是一段完整回答。', extra = {}, mode = 'chat', legacyStyle } = {}) => {
  await page.evaluate(({ id, kind, width, height, question, response, extra, mode, legacyStyle }) => {
    const data = { question, response, responses: [response], responseIndex: 0, detailLevel: 'full',
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      tokenCount: 0, roleMode: 'inherit', ...extra };
    if (kind) data.stepKind = kind;
    const nodes = [{ id, type: 'thought', dragHandle: '.drag-handle',
      position: { x: 0, y: 0 }, width: legacyStyle ? undefined : width, height,
      ...(legacyStyle ? { style: legacyStyle } : {}), data }];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__projects.setState(state => ({ projects: state.projects.map(project => project.id === state.activeId ? { ...project, kind: mode } : project) }));
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('full');
  }, { id, kind, width, height, question, response, extra, mode, legacyStyle });
  await node().waitFor();
  await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 120, zoom: 1 }, { duration: 0 }));
  await settle();
};
const snapshot = async () => {
  await settle();
  return page.evaluate(id => {
    const state = window.__store.getState(), n = state.nodes.find(item => item.id === id);
    const wrapper = document.querySelector(`.react-flow__node[data-id="${id}"]`), root = wrapper?.firstElementChild;
    const w = wrapper.getBoundingClientRect(), r = root.getBoundingClientRect(), zoom = window.__rf.getZoom();
    return { width: n.width, height: n.height, x: n.position.x, y: n.position.y,
      wrapper: [w.width / zoom, w.height / zoom], card: [r.width / zoom, r.height / zoom], history: state.historyIndex };
  }, id);
};
const compare = (label, before, after) => {
  const problems = [];
  for (const key of ['width', 'height', 'x', 'y', 'history']) if (before[key] !== after[key]) problems.push(`${key}: ${before[key]} -> ${after[key]}`);
  for (const key of ['wrapper', 'card']) for (let i = 0; i < 2; i++) {
    if (Math.abs(before[key][i] - after[key][i]) > 1.5) problems.push(`${key}[${i}]: ${before[key][i]} -> ${after[key][i]}`);
  }
  if (problems.length) { failures.push(`${label}: ${problems.join(', ')}`); console.log('FAIL', failures.at(-1)); }
  else console.log('PASS', label);
};
const openAndClose = async (label, open, close = open) => {
  const before = await snapshot();
  await node().locator(open).first().click();
  compare(`${label} open`, before, await snapshot());
  await node().locator(close).first().click();
  compare(`${label} close`, before, await snapshot());
};

try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  try { await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui); }
  catch (error) {
    console.error('Startup state', await page.evaluate(() => ({ store: !!window.__store, hydrated: window.__store?.persist.hasHydrated(), rf: !!window.__rf, ui: !!window.__ui, body: document.body.innerText.slice(0, 300) })));
    throw error;
  }

  for (const height of [700, undefined, 240]) {
    await seed({ height, question: '问题。'.repeat(40), response: '回答的长正文。'.repeat(240) });
    await openAndClose(`metadata ${height ?? 'automatic'}`, '[data-node-metadata-toggle]', '[data-node-metadata-cancel]');
  }
  await seed();
  const accessibleBefore = await snapshot();
  await node().locator('[data-node-metadata-toggle]').evaluate(element => element.click());
  compare('metadata synthetic accessibility click open', accessibleBefore, await snapshot());
  await node().locator('[data-node-metadata-cancel]').evaluate(element => element.click());
  compare('metadata synthetic accessibility click close', accessibleBefore, await snapshot());
  await seed({ question: '问题。'.repeat(30), response: '回答。'.repeat(300) });
  const beforeWidthEdit = await snapshot();
  await node().locator('[data-node-metadata-toggle]').click();
  await page.evaluate(id => window.__store.getState().setSelectionGeometry([id], { width: 620 }), id);
  const duringWidthEdit = await snapshot();
  assert.equal(duringWidthEdit.width, 620);
  assert.ok(Math.abs(duringWidthEdit.card[1] - beforeWidthEdit.card[1]) < 1.5,
    'Changing width while metadata is open preserves the current editing height');
  await node().locator('[data-node-metadata-cancel]').click();
  assert.equal((await snapshot()).height, undefined, 'Width-only editing keeps automatic height');
  console.log('PASS automatic height stays stable during width editing');
  await seed({ width: 974.35, height: 1202, question: '问题。'.repeat(100), response: '回答的长正文。'.repeat(800) });
  await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 120, zoom: .45 }, { duration: 0 }));
  await openAndClose('metadata large card at 45% zoom', '[data-node-metadata-toggle]', '[data-node-metadata-cancel]');
  await seed({ legacyStyle: { width: '640px', height: '380px' }, response: '回答长正文。'.repeat(300) });
  const legacy = await snapshot();
  assert.deepEqual(legacy.wrapper, [640, 380]);
  assert.deepEqual(legacy.card, [640, 380], 'Legacy style dimensions match the visible card and selection boundary');
  await openAndClose('metadata legacy style dimensions', '[data-node-metadata-toggle]', '[data-node-metadata-cancel]');
  await page.evaluate(id => window.__store.getState().setSelectionGeometry([id], { width: 700, height: 420 }), id);
  const resizedLegacy = await snapshot();
  assert.deepEqual(resizedLegacy.wrapper, [700, 420]);
  assert.deepEqual(resizedLegacy.card, [700, 420]);
  await page.evaluate(() => window.__store.getState().undo());
  const restoredLegacy = await snapshot();
  compare('legacy dimensions undo', { ...legacy, history: restoredLegacy.history }, restoredLegacy);
  await page.evaluate(id => window.__store.getState().setSelectionGeometry([id], { autoHeight: true }), id);
  const legacyAuto = await page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id), id);
  assert.equal(legacyAuto.height, undefined);
  assert.equal(legacyAuto.style?.height, undefined, 'Restoring automatic height also clears legacy style height');
  console.log('PASS legacy style dimensions, resizing, undo and automatic height');
  await seed({ height: 240, question: '问题。'.repeat(40), response: '回答的长正文。'.repeat(240) });
  await page.evaluate(id => window.__store.getState().setSelectedNodeIds([id]), id);
  const smallBefore = await snapshot();
  await node().locator('[data-node-metadata-toggle]').click();
  const metadata = node().locator('[data-node-metadata-editor]');
  for (const selector of ['[data-node-title-input]', '[data-node-summary-input]', '[data-node-metadata-generate]', '[data-node-metadata-cancel]', '[data-node-metadata-save]']) {
    const control = metadata.locator(selector);
    await control.scrollIntoViewIfNeeded();
    assert.equal(await control.evaluate(element => {
      const r = element.getBoundingClientRect(), card = element.closest('.conversation-node').getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.top >= card.top - 1 && r.bottom <= card.bottom + 1 && !!hit && (hit === element || element.contains(hit));
    }), true, `Small card control remains reachable: ${selector}`);
  }
  await metadata.locator('[data-node-title-input]').fill('可恢复的草稿');
  await metadata.locator('[data-node-summary-input]').fill('摘要草稿');
  await node().locator('[data-node-metadata-toggle]').click();
  await node().locator('[data-node-metadata-toggle]').click();
  assert.equal(await metadata.locator('[data-node-title-input]').inputValue(), '可恢复的草稿');
  assert.equal(await metadata.locator('[data-node-summary-input]').inputValue(), '摘要草稿');
  await metadata.evaluate(element => { element.scrollTop = 0; });
  const scrollable = await metadata.evaluate(element => element.scrollHeight > element.clientHeight + 2);
  if (scrollable) {
    const zoom = await page.evaluate(() => window.__rf.getZoom());
    await metadata.hover();
    await page.mouse.wheel(0, 180);
    await page.waitForTimeout(100);
    assert.ok(await metadata.evaluate(element => element.scrollTop > 0), 'Metadata scrolls inside a short card');
    assert.equal(await page.evaluate(() => window.__rf.getZoom()), zoom, 'Editor scrolling does not zoom the canvas');
  }
  if (process.env.SIZE_STABILITY_SCREENSHOTS === '1') {
    await mkdir('local-tests/node-size-stability', { recursive: true });
    await page.screenshot({ path: 'local-tests/node-size-stability/short-metadata.png' });
  }
  await node().locator('[data-node-resize="height"]').focus();
  await page.keyboard.press('ArrowDown');
  await settle();
  assert.equal((await snapshot()).height, 241, 'Height can be adjusted while metadata is open');
  await node().locator('[data-node-metadata-cancel]').click();
  assert.equal((await snapshot()).height, 241, 'Closing the editor keeps the deliberate size change');
  assert.equal((await snapshot()).width, smallBefore.width);
  console.log('PASS small card editor remains usable and deliberate resizing survives close');
  for (const [label, open] of [['highlights', '[data-highlight-disclosure]'], ['reasoning', '[data-reasoning-toggle]'], ['activity', '[data-activity-history]']]) {
    const extra = label === 'highlights' ? { highlights: [{ id: 'h1', text: '重点内容 '.repeat(25), color: 'yellow' }] }
      : label === 'reasoning' ? { reasonings: ['推理内容 '.repeat(120)] }
      : { agentActivities: [[{ id: 'a1', kind: 'command', status: 'completed', title: '任务过程', command: 'test', output: '结果 '.repeat(100), startedAt: 1, endedAt: 2 }]] };
    await seed({ extra });
    await openAndClose(`${label} automatic`, open);
    await node().locator(open).click();
    await settle();
    await page.evaluate(id => window.__store.getState().setSelectionGeometry([id], { height: 1200 }), id);
    const expanded = await snapshot();
    await node().locator(open).click();
    compare(`${label} fixed after user resize`, expanded, await snapshot());
    await page.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
    await node().waitFor();
    const reloaded = await snapshot();
    compare(`${label} resized height after reload`, { ...expanded, history: reloaded.history }, reloaded);
  }
  for (const [label, selector] of [['question', '[data-edit-question]'], ['answer', '[data-edit-response]']]) {
    await seed();
    const before = await snapshot();
    await node().locator(selector).click();
    compare(`${label} automatic edit`, before, await snapshot());
    await page.keyboard.press('Escape');
    compare(`${label} automatic cancel`, before, await snapshot());
  }
  await seed({ kind: 'note', response: '', question: '短便笺。' });
  await openAndClose('note automatic edit', '[data-note-edit]', '[data-note-editor] button');
  const materialText = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}.`).join('\n\n');
  for (const kind of ['note', 'link', 'file']) {
    const extra = kind === 'file' ? { attachments: [
      { id: 'text-1', name: 'sample.txt', type: 'text/plain', size: materialText.length, content: materialText },
    ] } : kind === 'link' ? { linkTitle: 'Material preview' } : {};
    await seed({ kind, question: materialText, response: '', extra });
    const body = node().locator('[data-content-body]').first();
    const overflow = () => body.evaluate(element => element.scrollHeight - element.clientHeight);
    assert.ok(await overflow() > 2, `Default ${kind} preview has a bounded height`);
    await page.evaluate(id => window.__store.getState().setSelectedNodeIds([id]), id);
    await node().locator('[data-node-resize="height"]').dblclick();
    await settle();
    assert.ok(await overflow() <= 2, `Fitted ${kind} preview shows all rendered content`);
    if (kind === 'note') await openAndClose('fitted note edit', '[data-note-edit]', '[data-note-editor] button');
  }
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n7sAAAAASUVORK5CYII=';
  await seed({ kind: 'file', response: '', question: '', extra: { attachments: [
    { id: 'image-1', name: 'image.png', type: 'image/png', size: 68, content: png, extractedText: '识别文字', extractedBy: 'manual' },
  ] } });
  await openAndClose('image extraction automatic edit', '[data-extract-toggle]', '[data-extract-toggle]');
  // Switching the workflow step type changes its actual content. An automatic
  // card may follow that content, while an explicitly sized card stays fixed.
  await seed({ mode: 'paradigm', height: 400, extra: { stepKind: 'human', instruction: '步骤说明' } });
  const paradigmBefore = await snapshot();
  await node().locator('[data-node-paradigm] .drag-handle button').nth(1).click();
  compare('paradigm fixed kind switch', paradigmBefore, await snapshot());

  assert.deepEqual(errors, [], 'No browser exceptions');
  assert.deepEqual(failures, [], 'Temporary view states must preserve node geometry');
} finally {
  await browser.close();
}
