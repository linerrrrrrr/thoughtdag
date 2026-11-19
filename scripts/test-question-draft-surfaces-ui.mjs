// Unsent questions keep the same input state on the canvas and in node details.
// Fresh browser storage, intercepted network access, and stubbed explicit sends.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/question-draft-surfaces';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const checks = [], errors = [], writes = [];
const catalog = { default: 'api-test', models: [
  { id: 'api-test', name: 'Test model', provider: 'Test API', vision: false },
  { id: 'codex/codex/test-model', name: 'Test agent model', provider: '__agent__', vision: false },
] };
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname === '/api/models') return route.fulfill({ json: catalog });
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [], items: [], hits: [] } });
  }
  return route.continue();
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
  localStorage.setItem('thoughtdag.canvasDetail', 'full');
});
const nodeId = 'draft-api';
const card = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const canvasInput = (id = nodeId) => card(id).locator('[data-canvas-question-editor]');
const panel = page.locator('[data-focus-panel]');
const panelInput = () => panel.locator('[data-conversation-question] textarea');
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const pass = name => { checks.push(name); console.log('PASS', name); };
const focused = locator => locator.evaluate(element => element === document.activeElement);
const data = (id = nodeId) => page.evaluate(id => window.__store.getState().nodes.find(node => node.id === id).data, id);
const draft = (id = nodeId) => page.evaluate(id => window.__ui.getState().drafts[`question-edit:${id}`], id);
const openPanel = async (id = nodeId) => {
  await page.evaluate(id => window.__ui.getState().setPanelOpen(true, id), id);
  await panelInput().waitFor();
  await settle();
};
const blank = async () => { await page.mouse.click(850, 850); await settle(); };
const setViewport = async (zoom = 1) => {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 70, y: 130, zoom }, { duration: 0 }), zoom);
  await settle();
};

try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__ui && window.__rf);
  await page.evaluate(async catalog => {
    (await import('/src/lib/use-models.ts')).setModelsCache(catalog);
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false);
    ui.setReleaseNotesOpen(false);
    ui.setPanelOpen(false);
    ui.setCanvasDetail('full');
    ui.setSelectedModel('api-test');
    const base = { question: '', response: '', responses: [], responseIndex: -1,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      detailLevel: 'full', tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [],
      excludedAttachmentIds: [], includedAttachmentIds: [] };
    const nodes = [
      { id: 'draft-api', type: 'thought', dragHandle: '.drag-handle', width: 520, position: { x: 0, y: 0 },
        data: { ...base, executionKind: 'api' } },
      { id: 'draft-agent', type: 'thought', dragHandle: '.drag-handle', width: 520, position: { x: 0, y: 390 },
        data: { ...base, executionKind: 'codex' } },
    ];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__draftSurfaceSends = [];
    window.__store.setState({ editQuestion: (id, question) => {
      window.__draftSurfaceSends.push({ id, question });
      window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === id ? { ...node, data: {
        ...node.data, question, response: 'Fixture answer', responses: ['Fixture answer'], responseIndex: 0,
        isEditing: false, questionEditor: undefined,
      } } : node) }));
    } });
  }, catalog);
  await canvasInput().waitFor();
  await page.waitForTimeout(400);
  await setViewport();

  for (const id of [nodeId, 'draft-agent']) {
    for (const owner of ['canvas', 'panel', null]) {
      await page.evaluate(({ id, owner }) => {
        window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === id
          ? { ...node, data: { ...node.data, isEditing: owner !== null, questionEditor: owner ?? undefined } } : node) }));
        window.__ui.getState().setPanelOpen(true, id);
      }, { id, owner });
      await settle();
      assert.equal(await canvasInput(id).count(), 1, `${id}/${owner}: canvas must remain an input`);
      assert.equal(await panelInput().count(), 1, `${id}/${owner}: details must remain an input`);
      assert.equal(await card(id).locator('.conversation-user-message').count(), 0);
      assert.equal(await panel.locator('[data-conversation-user-message]').count(), 0);
      assert.equal(await card(id).locator('[data-node-execution-picker]').count(), 1);
      assert.equal(await panel.locator('[data-node-execution-picker]').count(), 1);
    }
  }
  pass('API and agent drafts render inputs in both surfaces for canvas, panel, and idle editor ownership');

  await page.evaluate(() => window.__ui.getState().setPanelOpen(false));
  await setViewport();
  await canvasInput().fill('画布中的未发送草稿');
  assert.equal(await focused(canvasInput()), true);
  await openPanel();
  assert.equal(await focused(canvasInput()), true, 'Opening details must not steal canvas editing focus');
  assert.equal(await panelInput().inputValue(), '画布中的未发送草稿');
  assert.equal((await data()).questionEditor, 'canvas');
  const canvasElement = await canvasInput().elementHandle();
  await panelInput().fill('面板修改，同步回画布');
  assert.equal(await canvasInput().inputValue(), '面板修改，同步回画布');
  assert.equal(await focused(panelInput()), true);
  assert.equal((await data()).questionEditor, 'panel');
  assert.equal(await canvasElement.evaluate(element => element.isConnected), true, 'Surface transfer must not replace the canvas input');
  await canvasInput().fill('画布再次修改');
  assert.equal(await panelInput().inputValue(), '画布再次修改');
  assert.equal((await data()).questionEditor, 'canvas');
  assert.equal(await focused(canvasInput()), true);
  await canvasInput().press('End');
  await canvasInput().press('Shift+Enter');
  assert.equal(await panelInput().inputValue(), '画布再次修改\n');
  await panelInput().press('End');
  await panelInput().press('Shift+Enter');
  assert.equal(await canvasInput().inputValue(), '画布再次修改\n\n');
  assert.equal(await page.evaluate(() => window.__draftSurfaceSends.length), 0);
  pass('Drafts synchronize in both directions while focus ownership follows the input being edited');

  await panelInput().fill('');
  await panelInput().press('Enter');
  assert.equal(await canvasInput().inputValue(), '');
  assert.equal(await draft(), '');
  await panel.locator('[data-node-details-close]').click();
  await openPanel();
  assert.equal(await panelInput().inputValue(), '');
  assert.equal(await canvasInput().inputValue(), '');
  await openPanel('draft-agent');
  await panelInput().fill('独立的第二节点草稿');
  await openPanel();
  assert.equal(await panelInput().inputValue(), '');
  assert.equal(await canvasInput('draft-agent').inputValue(), '独立的第二节点草稿');
  pass('Empty drafts survive close/reopen and switching nodes never mixes their contents');

  await panelInput().fill('退出仍保留');
  await panelInput().evaluate(element => {
    for (const key of ['Enter', 'Escape']) element.dispatchEvent(new KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true, isComposing: true, keyCode: 229,
    }));
  });
  assert.equal(await focused(panelInput()), true);
  assert.equal(await panel.count(), 1);
  assert.equal((await data()).question, '');
  await panelInput().press('Escape');
  await settle();
  assert.equal(await panel.count(), 1, 'First Escape only exits the focused input');
  assert.equal(await focused(panelInput()), false);
  assert.equal((await data()).isEditing, false);
  assert.equal(await draft(), '退出仍保留');
  assert.equal(await canvasInput().inputValue(), '退出仍保留');
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  await openPanel();
  assert.equal(await panelInput().inputValue(), '退出仍保留');
  await canvasInput().fill('点击外部保留');
  await blank();
  assert.equal((await data()).isEditing, false);
  assert.equal(await panelInput().inputValue(), '点击外部保留');
  assert.equal(await canvasInput().count(), 1);
  assert.equal(await page.evaluate(() => window.__draftSurfaceSends.length), 0);
  pass('IME, outside clicks, and layered Escape preserve unsent drafts and never submit');

  await panelInput().fill('凝练期间保留这个草稿');
  await page.evaluate(() => window.__ui.getState().setCondenseRun({
    status: 'building', current: 0, total: 1, streaming: '', originalIds: ['draft-api', 'draft-agent'], distillIds: [],
  }));
  await panel.locator('[data-question-send]').click();
  await panelInput().press('Control+Enter');
  assert.equal(await panelInput().inputValue(), '凝练期间保留这个草稿');
  assert.equal(await canvasInput().inputValue(), '凝练期间保留这个草稿');
  assert.equal(await draft(), '凝练期间保留这个草稿');
  await card(nodeId).locator('[data-ask-submit]').click();
  await canvasInput().press('Control+Enter');
  assert.equal(await panelInput().inputValue(), '凝练期间保留这个草稿');
  assert.equal(await canvasInput().inputValue(), '凝练期间保留这个草稿');
  assert.equal(await draft(), '凝练期间保留这个草稿');
  assert.equal((await data()).question, '');
  assert.equal(await page.evaluate(() => window.__draftSurfaceSends.length), 0);
  await page.evaluate(() => window.__ui.getState().setCondenseRun({
    status: 'idle', current: 0, total: 0, streaming: '', originalIds: [], distillIds: [],
  }));
  pass('Blocked sends during condense preserve the shared draft from both buttons and keyboard shortcuts');

  await page.evaluate(async () => {
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('zh');
  });
  await setViewport();
  await page.screenshot({ path: `${output}/light-zh-wide.png`, animations: 'disabled' });
  await page.evaluate(async () => {
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('en');
  });
  await page.setViewportSize({ width: 1000, height: 800 });
  await setViewport(.72);
  await page.screenshot({ path: `${output}/dark-en-narrow.png`, animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await canvasInput().count(), 1);
  assert.equal(await panelInput().count(), 1);
  const panelSend = panel.locator('[data-question-send]');
  assert.equal(await panelSend.isVisible(), true);
  pass('Both composer surfaces remain available in light/Chinese and dark/English narrow layouts');

  await page.setViewportSize({ width: 1680, height: 1000 });
  await setViewport();
  await panelInput().fill('只明确发送一次');
  await panelInput().press('Enter');
  await settle();
  assert.deepEqual(await page.evaluate(() => window.__draftSurfaceSends), [{ id: nodeId, question: '只明确发送一次' }]);
  assert.equal(await canvasInput().count(), 0);
  assert.equal(await panelInput().count(), 0);
  assert.equal(await panel.locator('[data-conversation-user-message]').innerText(), '只明确发送一次');
  assert.equal(await card(nodeId).locator('.conversation-user-message').innerText(), '只明确发送一次');
  assert.equal(await panel.locator('[data-node-execution-picker]').count(), 0);
  await openPanel('draft-agent');
  await canvasInput('draft-agent').fill('从画布发送一次');
  await canvasInput('draft-agent').press('Enter');
  await settle();
  assert.deepEqual(await page.evaluate(() => window.__draftSurfaceSends), [
    { id: nodeId, question: '只明确发送一次' }, { id: 'draft-agent', question: '从画布发送一次' },
  ]);
  assert.equal(await canvasInput('draft-agent').count(), 0);
  assert.equal(await panelInput().count(), 0);
  assert.equal(await draft('draft-agent'), undefined);
  pass('Enter in either question input submits once and both surfaces show the saved question');

  await panel.locator('[data-edit-question]').click();
  await panelInput().fill('修订后的问题');
  await panelInput().press('Enter');
  await panelInput().waitFor({ state: 'detached' });
  assert.equal((await data('draft-agent')).question, '修订后的问题');
  await card(nodeId).locator('[data-edit-question]').click();
  await canvasInput().fill('在画布修订问题');
  await canvasInput().press('Enter');
  await canvasInput().waitFor({ state: 'detached' });
  assert.equal((await data()).question, '在画布修订问题');
  assert.equal(await page.evaluate(() => window.__draftSurfaceSends.length), 4);
  pass('Enter submits a revised question once from either surface');
  assert.deepEqual(errors, [], 'No page errors');
  assert.deepEqual(writes, [], 'No real API writes');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, animations: 'disabled' }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  await context.close();
  await browser.close();
}
