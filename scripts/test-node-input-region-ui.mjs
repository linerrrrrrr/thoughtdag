// Real canvas source lists in isolated browser storage. All API writes are blocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

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
  await region('a').waitFor();
  await page.evaluate(() => window.__rf.setViewport({ x: 250, y: 85, zoom: .95 }, { duration: 0 }));
  const shared = row('a', 'material', 'file');
  const inherited = row('a', 'inherited', 'parent');
  const local = row('a', 'local', 'a');
  assert.equal(await row('a','conversation','parent').count(), 1);
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
    await page.evaluate(async layout => {
      const resource = [...performance.getEntriesByType('resource')].reverse().find(r => new URL(r.name).pathname === '/src/lib/connection-layout-preferences.ts');
      const { useConnectionLayoutPreferences } = await import(resource?.name ?? '/src/lib/connection-layout-preferences.ts');
      useConnectionLayoutPreferences.getState().setSettings({ layout });
    }, layout);
    await page.waitForTimeout(250);
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
    assert.equal(await graphSnapshot(), graphBeforeLayouts, 'view preference must not rewrite graph or undo history');
    await page.mouse.move(1700, 1000);
    await page.screenshot({ path: directory + '/' + layout + '-light.png' });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: directory + '/dock-dark.png' });
  await page.locator('[data-project-switcher] [data-model-picker-trigger]').click();
  await page.locator('[data-picker-view="settings"]').click();
  const settings = page.locator('[data-model-settings] [data-connection-layout-settings]');
  await settings.scrollIntoViewIfNeeded();
  assert.equal(await settings.locator('[data-connection-layout-choice="dock"]').isChecked(), true);
  await settings.locator('[data-connection-layout-choice="top"]').check();
  await page.locator('[data-connection-layout="top"]').first().waitFor();
  await settings.screenshot({ path: directory + '/settings-dark.png' });
  await settings.locator('[data-connection-layout-choice="dock"]').check();
  await page.keyboard.press('Escape');
  assert.equal(await graphSnapshot(), graphBeforeLayouts);
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log('PASS direct, local and inherited sources, isolated disconnection and undo, current file contribution, preserved answers, three fixed layouts and unchanged graph history');
} catch (error) {
  await page.screenshot({ path: directory + '/failure.png' }).catch(()=>{});
  throw error;
} finally {
  await browser.close();
}
