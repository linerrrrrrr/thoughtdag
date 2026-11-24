// Real canvas source lists in isolated browser storage. All API writes are blocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { screenFont } from './fixtures/screen-font.mjs';
import { openSettingsSection } from './fixtures/canvas-model-picker.mjs';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1740, height: 1040 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/__thoughtdag_storage') return route.fulfill({ status: 404, body: '' });
  if (url.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      writes.push(url.pathname);
      return route.abort();
    }
    return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  }
  return url.origin === new URL(appUrl).origin ? route.continue() : route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.connectionLayout', JSON.stringify({ enabled: true, layout: 'sidebar', showAttachments: true }));
});
const directory = 'local-tests/node-input-region';
await mkdir(directory, { recursive: true });
const region = id => page.locator(`[data-node-input-region="${id}"]`);
const row = (id, kind, source) => region(id).locator(`[data-input-source-kind="${kind}"][data-input-source-id="${source}"]`);
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .15, `${label}: ${actual} vs ${expected}`);
async function setLayout(layout) {
  await page.evaluate(async layout => {
    const resource = [...performance.getEntriesByType('resource')].reverse().find(r => new URL(r.name).pathname === '/src/lib/connection-layout-preferences.ts');
    const { useConnectionLayoutPreferences } = await import(resource?.name ?? '/src/lib/connection-layout-preferences.ts');
    useConnectionLayoutPreferences.getState().setSettings({ layout });
  }, layout);
  await page.locator(`[data-connection-layout="${layout}"] > [data-node-input-region="a"]`).waitFor({ state: 'attached' });
}
async function setZoom(zoom) {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 250, y: 85, zoom }, { duration: 0 }), zoom);
  await page.waitForFunction(zoom => {
    const viewport = getComputedStyle(document.querySelector('.react-flow__viewport'));
    const canvas = getComputedStyle(document.querySelector('.react-flow'));
    return Math.abs(new DOMMatrix(viewport.transform).a - zoom) < .001 &&
      Math.abs(parseFloat(canvas.getPropertyValue('--tdag-zoom')) - zoom) < .001;
  }, zoom);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function checkInputScale(zoom) {
  await setZoom(zoom);
  const intake = region('a');
  const node = page.locator('.react-flow__node[data-id="a"]');
  const surfaces = await node.evaluate(root => ['.input-source-name', '.conversation-answer', '[data-connection-role="target"]'].map(
    selector => root.querySelector(selector)?.closest('[data-type-surface]')?.getAttribute('data-type-surface')));
  assert.deepEqual(surfaces, ['node-input', 'conversation', 'canvas-geometry'], 'dock, body and port use their own scale boundaries');
  const body = await screenFont(node.locator('.conversation-answer'));
  for (const [selector, size] of [
    ['.node-input-heading > span', 14], ['.input-source-name', 14],
    ['.input-source-heading', 12], ['.input-source-origin', 12], ['.node-input-total', 12],
  ]) {
    near(await screenFont(intake.locator(selector).first()), body * size / 16, selector + ' at zoom ' + zoom);
  }
  near((await intake.locator('.input-source-action').first().boundingBox()).height, body * 2, 'Source action hit area');
  return intake.evaluate((el, zoom) => {
    const root = el.closest('[data-connection-layout]');
    const card = root.getBoundingClientRect(), box = el.getBoundingClientRect();
    const port = root.querySelector('[data-connection-role="target"]').getBoundingClientRect();
    return [card.width, card.height, box.width, box.left - card.left, box.top - card.top,
      port.x + port.width / 2 - card.left, port.y + port.height / 2 - card.top].map(value => value / zoom);
  }, zoom);
}
try {
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(async () => {
    const { upstreamParts, recordParts } = await import('/src/store/context-builder.ts');
    const attachment = (id, name, type, content) => ({ id, name, type, content, size: content.length });
    const card = (id, x, y, displayName, attachments = []) => ({
      id, type: 'thought', position: { x, y }, width: 440, height: 340, dragHandle: '.drag-handle',
      data: { displayName, question: displayName, response: '访谈显示，多数人停在首次导入。', responses: ['访谈显示，多数人停在首次导入。'],
        responseIndex: 0, isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        highlights: [], attachments, tokenCount: 20, layoutDirection: 'horizontal', detailLevel: 'full' },
    });
    const pdf = { ...attachment('pdf','用户访谈.pdf','application/pdf',''), extractedText: '三位用户停在首次导入。', numPages: 1 };
    const local = attachment('local','现场观察.txt','text/plain','本轮记录：按钮不够醒目。');
    const inherited = attachment('inherited','调研补充.txt','text/plain','优先观察导入流程。');
    const nodes = [card('parent', 20, 0, '研究问题', [inherited]), card('file', 20, 470, '用户访谈', [pdf]),
      card('a', 690, 0, '提炼用户痛点', [local]), card('b', 690, 470, '拟定访谈提纲')];
    nodes[2].data.response = Array.from({ length: 40 }, (_, i) => `访谈记录第 ${i + 1} 段。`).join('\n\n');
    nodes[2].data.responses = [nodes[2].data.response];
    nodes[1].data.stepKind = 'file';
    const edge = (source, target) => ({ id: source + '-' + target, source, target, type: 'smoothstep', data: {} });
    const edges = [edge('parent','a'), edge('file','a'), edge('file','b')];
    for (const target of nodes.slice(2)) target.data.lastContextParts = recordParts(upstreamParts(target.id, nodes, edges));
    window.__canvasEditing.getState().reset();
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0, selectedNodeId: null, selectedNodeIds: [] });
  });
  // The canvas fits the first mounted node before culling offscreen cards.
  await page.locator('.react-flow__node[data-id="parent"]').waitFor();
  await page.waitForTimeout(550);
  await setZoom(.95);
  await region('a').waitFor();
  await region('a').locator('[data-context-sources-trigger="a"]').click();
  const portal = page.locator('[data-context-sources-popover="a"]');
  await portal.waitFor();
  assert.deepEqual(await portal.evaluate(el => [el.dataset.typeSurface, el.parentElement?.dataset.typeSurface]), ['portal', 'screen']);
  const portalTitle = portal.locator('.node-context-sources-heading > span');
  const screenTitleSize = await screenFont(portalTitle);
  await setZoom(2);
  near(await screenFont(portalTitle), screenTitleSize, 'dock inspector title stays in screen coordinates');
  await page.keyboard.press('Escape');
  await portal.waitFor({ state: 'detached' });
  await setZoom(.95);
  const shared = row('a', 'material', 'file');
  const inherited = row('a', 'inherited', 'parent');
  const local = row('a', 'local', 'a');
  assert.equal(await row('a','conversation','parent').count(), 1);
  assert.equal(await row('a','conversation','parent').locator('.input-source-icon .lucide-message-circle-question-mark').count(), 1);
  for (const source of [shared, local, inherited]) {
    assert.equal(await source.locator('.input-source-icon .lucide-file-text').count(), 1);
  }
  assert.equal(await region('a').locator('[data-input-source-kind="conversation"]').count(), 1);
  assert.match(await shared.innerText(), /用户访谈.pdf[\s\S]*画布文件/);
  assert.match(await inherited.innerText(), /调研补充.txt[\s\S]*继承自 研究问题[\s\S]*已纳入/);
  assert.match(await local.innerText(), /现场观察.txt[\s\S]*本节点附件/);
  assert.equal(await region('a').locator('[data-input-file-changed]').count(), 0);
  await shared.locator('.input-source-open').hover();
  await page.locator('[data-context-edge-active="true"]').waitFor();
  assert.equal(await page.locator('[data-context-sources-popover]').count(), 0);
  const ids = () => page.evaluate(() => window.__store.getState().edges.map(e => e.id).sort());
  await inherited.locator('.input-source-action').click();
  assert.match(await inherited.innerText(), /未纳入/);
  assert.deepEqual(await ids(), ['file-a','file-b','parent-a']);
  await inherited.locator('.input-source-action').click();
  assert.match(await inherited.innerText(), /已纳入/);
  await local.locator('.input-source-open').click();
  await page.waitForFunction(() => window.__ui.getState().readerNodeId === 'a' && window.__ui.getState().readerAttachmentId === 'local');
  await page.evaluate(() => window.__ui.getState().setReaderNodeId(null));
  await shared.locator('.input-source-action').click();
  assert.equal(await shared.count(), 0);
  assert.equal(await row('b','material','file').count(), 1);
  assert.deepEqual(await ids(), ['file-b','parent-a']);
  assert.ok(await page.evaluate(() => window.__store.getState().nodes.some(node => node.id === 'file')));
  await page.evaluate(() => window.__store.getState().undo());
  await shared.waitFor();
  const answers = () => page.evaluate(() => window.__store.getState().nodes.filter(n => ['a','b'].includes(n.id)).map(n=>n.data.response));
  const before = await answers();
  await page.evaluate(() => window.__store.getState().setAttachmentData('file', 'pdf', { editedText: '补充访谈表明，五位用户未能找到下一步入口。' }));
  await shared.locator('[data-input-file-changed]').waitFor();
  assert.equal(await row('b','material','file').locator('[data-input-file-changed]').count(), 1);
  assert.deepEqual(await answers(), before);
  await page.screenshot({ path: directory + '/shared-file-updated.png' });
  await local.locator('.input-source-action').click();
  assert.equal(await local.count(), 0);
  assert.equal(await inherited.count(), 1);
  assert.deepEqual(await ids(), ['file-a','file-b','parent-a']);
  const graphSnapshot = () => page.evaluate(() => {
    const state = window.__store.getState();
    return JSON.stringify({ nodes: state.nodes.map(n => ({ id: n.id, width: n.width, height: n.height, position: n.position, data: n.data })),
      edges: state.edges, history: state.history, historyIndex: state.historyIndex });
  });
  const graphBeforeLayouts = await graphSnapshot();
  for (const layout of ['sidebar', 'top', 'dock']) {
    await setLayout(layout);
    const geometry = await region('a').evaluate(el => {
      const root = el.closest('[data-connection-layout]'), body = root.querySelector('.conversation-node-content');
      const rb = root.getBoundingClientRect(), ib = el.getBoundingClientRect(), bb = body.getBoundingClientRect();
      return { outside: ib.left < rb.left - 1 || ib.right > rb.right + 1 || ib.bottom > rb.bottom + 1,
        bodyOutside: bb.left < rb.left - 1 || bb.right > rb.right + 1 || bb.bottom > rb.bottom + 1,
        overlap: Math.min(ib.right, bb.right) - Math.max(ib.left, bb.left) > 1 && Math.min(ib.bottom, bb.bottom) - Math.max(ib.top, bb.top) > 1,
        inputs: root.querySelectorAll('[data-connection-role="target"]').length,
        outputs: root.querySelectorAll('[data-connection-role="source"]').length };
    });
    assert.deepEqual(geometry, { outside: false, bodyOutside: false, overlap: false, inputs: 1, outputs: 1 }, layout);
    const reading = await region('a').evaluate(el => {
      const card = el.closest('[data-connection-layout]');
      const content = card.querySelector('.conversation-node-content');
      const answer = content.querySelector('[data-conversation-split-answer]');
      const header = content.querySelector('[data-node-details-header]');
      const footer = content.querySelector('[data-node-response-footer]');
      const top = header.getBoundingClientRect().top;
      const bottom = footer.getBoundingClientRect().bottom;
      answer.scrollTop = answer.scrollHeight;
      content.scrollTop = 100;
      return {
        answerScrolls: answer.clientHeight > 0 && answer.scrollTop > 0,
        shellOffset: content.scrollTop,
        headerFixed: header.getBoundingClientRect().top === top,
        footerFixed: footer.getBoundingClientRect().bottom === bottom && bottom <= card.getBoundingClientRect().bottom + 1,
      };
    });
    assert.deepEqual(reading, { answerScrolls: true, shellOffset: 0, headerFixed: true, footerFixed: true }, layout);
    assert.equal(await graphSnapshot(), graphBeforeLayouts, 'view preference must not rewrite graph or undo history');
    const footprint = await checkInputScale(.95);
    const enlarged = await checkInputScale(2);
    enlarged.forEach((value, i) => near(value, footprint[i], layout + ' canvas geometry'));
    await setZoom(.95);
    await page.mouse.move(1700, 1000);
    await page.screenshot({ path: directory + '/' + layout + '-light.png' });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: directory + '/dock-dark.png' });
  await openSettingsSection(page, 'nodes');
  const settings = page.locator('[data-settings-panel] [data-connection-layout-settings]');
  await settings.scrollIntoViewIfNeeded();
  assert.equal(await settings.locator('[data-connection-layout-choice="dock"]').isChecked(), true);
  await settings.locator('[data-connection-layout-choice="top"]').check();
  await page.locator('[data-connection-layout="top"]').first().waitFor();
  await settings.screenshot({ path: directory + '/settings-dark.png' });
  await settings.locator('[data-connection-layout-choice="dock"]').check();
  await page.keyboard.press('Escape');
  assert.equal(await graphSnapshot(), graphBeforeLayouts);
  await page.evaluate(async () => {
    const { useCanvasTypographyPreferences } = await import('/src/lib/canvas-typography-preferences.ts');
    useCanvasTypographyPreferences.getState().setSettings({ bodySize: 20, bodyExponent: .5, summaryExponent: .5 });
    const { setNodeDetail } = await import('/src/lib/node-detail.ts');
    setNodeDetail('b', 'summary');
    setNodeDetail('parent', 'compact');
    const { useI18n } = await import('/src/i18n/index.ts');
    useI18n.getState().setLang('en');
  });
  for (const zoom of [.16, .5, 2]) {
    await checkInputScale(zoom);
    near(await screenFont(page.locator('.react-flow__node[data-id="a"] .conversation-answer')),
      20 * Math.sqrt(Math.min(1, zoom)), 'Customized body at ' + zoom);
    for (const [id, floor] of [['b', .32], ['parent', .22]]) {
      const ratio = .75 * Math.min(1, zoom / floor);
      await page.locator(`[data-node-input-region="${id}"][data-input-compact]`).waitFor();
      near(await screenFont(region(id).locator('.node-input-heading > span').first()), 14 * ratio, id + ' overview intake heading');
      near(await screenFont(region(id).locator('.node-input-total')), 12 * ratio, id + ' overview count');
      assert.ok(await region(id).evaluate(el => el.scrollWidth <= el.clientWidth + 1), id + ' overview fits its intake at ' + zoom);
    }
  }
  const stemOffset = await region('parent').evaluate(el => {
    const root = el.closest('[data-connection-layout="dock"]');
    const port = root.querySelector('[data-connection-role="target"]').getBoundingClientRect();
    const stem = root.querySelector('.node-input-stem').getBoundingClientRect();
    return stem.top + stem.height / 2 - (port.top + port.height / 2);
  });
  assert.ok(Math.abs(stemOffset) <= 2, 'Compact dock connector aligns with its input port at 200%: ' + stemOffset);
  await setZoom(.22);
  for (const layout of ['sidebar', 'top', 'dock']) {
    await setLayout(layout);
    const overflow = await region('parent').evaluate(el => ({
      x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight,
    }));
    assert.ok(overflow.x <= 1 && overflow.y <= 1, layout + ' compact overflow: ' + JSON.stringify(overflow));
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log('PASS input sources and actions, three fixed layouts, preserved graph, full and overview typography, zoom and dock geometry');
} catch (error) {
  await page.screenshot({ path: directory + '/failure.png' }).catch(()=>{});
  throw error;
} finally {
  await browser.close();
}
