// Exercise real generation state transitions with intercepted API responses
// and a simulated local runtime. No real model calls or user storage.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/failed-question-input';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const checks = [], errors = [], sends = [];
const catalog = { default: 'api-test', models: [
  { id: 'api-test', name: 'Test model', provider: 'Test API', vision: false },
  { id: 'codex/codex/fixture', name: 'Test agent model', provider: '__agent__', vision: false },
] };
let pendingStream;
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname === '/api/models') return route.fulfill({ json: catalog });
  if (url.pathname === '/api/stream') {
    sends.push(request.postDataJSON());
    pendingStream = route;
    return;
  }
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
    return route.fulfill({ json: { response: '', models: [], providers: [], sessions: [], topics: [], items: [], hits: [] } });
  }
  return route.continue();
});
await context.addInitScript(() => {
  for (const [key, value] of Object.entries({ seeded: 'yes', tutorialDone: '1', lighting: 'light', lang: 'zh', canvasDetail: 'full' })) {
    localStorage.setItem(`thoughtdag.${key}`, value);
  }
});
const nodeId = 'failed-input';
const card = (id = nodeId) => page.locator(`.react-flow__node[data-id="${id}"]`);
const canvasInput = (id = nodeId) => card(id).locator('[data-canvas-question-editor]');
const panel = page.locator('[data-focus-panel]');
const panelInput = () => panel.locator('[data-conversation-question] textarea');
const data = () => page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data, nodeId);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const pass = name => { checks.push(name); console.log('PASS', name); };
const openPanel = async () => {
  await page.evaluate(id => window.__ui.getState().setPanelOpen(true, id), nodeId);
  await panel.waitFor();
  await settle();
};
const waitFailed = async () => {
  await page.waitForFunction(id => {
    const data = window.__store.getState().nodes.find(n => n.id === id).data;
    return data.generationFailed && !data.isLoading;
  }, nodeId);
  await canvasInput().waitFor();
  await panelInput().waitFor();
  assert.equal(await card().getByRole('button', { name: /^(重试|Retry)$/ }).count(), 0);
  assert.equal(await panel.getByRole('button', { name: /^(重试|Retry)$/ }).count(), 0);
  assert.equal(await card().locator('[data-ask-submit]').count(), 1);
  assert.equal(await panel.locator('[data-question-send]').count(), 1);
};
const sendApi = async action => {
  const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/stream');
  await action();
  await request;
  await settle();
  assert.ok(pendingStream);
  assert.equal(await canvasInput().count(), 0, 'Generation hides the composer');
  assert.equal(await panelInput().count(), 0);
};
const finishApi = async (kind, text = '') => {
  const route = pendingStream;
  pendingStream = undefined;
  if (kind === 'error') await route.fulfill({ status: 503, json: { error: 'Fixture service unavailable' } });
  else {
    const events = text ? [{ text }] : [];
    if (kind === 'partial') events.push({ error: 'Fixture interrupted stream' });
    await route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
  }
};

try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__ui && window.__rf);
  await page.evaluate(async ({ nodeId, catalog }) => {
    (await import('/src/lib/use-models.ts')).setModelsCache(catalog);
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false);
    ui.setReleaseNotesOpen(false);
    ui.setCanvasDetail('full');
    ui.setSelectedModel('api-test');
    ui.setWebSearchEnabled(false);
    const base = { question: '', response: '', responses: [], responseIndex: -1,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      detailLevel: 'full', tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [],
      excludedAttachmentIds: [], includedAttachmentIds: [], executionKind: 'api' };
    const nodes = [nodeId, 'other-input'].map((id, index) => ({
      id, type: 'thought', dragHandle: '.drag-handle', width: 520,
      position: { x: index * 610, y: 0 }, data: { ...base },
    }));
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  }, { nodeId, catalog });
  await canvasInput().waitFor();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rf.setViewport({ x: 70, y: 150, zoom: 1 }, { duration: 0 }));
  await openPanel();
  const question = '看不懂这是什么意思';
  await canvasInput().fill(question);
  await sendApi(() => canvasInput().press('Enter'));
  await canvasInput('other-input').fill('继续编辑其他问题');
  await finishApi('error');
  await waitFailed();
  assert.equal(await canvasInput().inputValue(), question);
  assert.equal(await panelInput().inputValue(), question);
  assert.equal(await canvasInput('other-input').evaluate(el => el === document.activeElement), true);
  pass('An API failure restores both question inputs with Send only, without stealing another input focus');

  await canvasInput().fill('画布修改后的问题');
  assert.equal(await panelInput().inputValue(), '画布修改后的问题');
  await panelInput().fill('');
  assert.equal(await canvasInput().inputValue(), '');
  assert.equal(await card().locator('[data-ask-submit]').isDisabled(), true);
  assert.equal(await panel.locator('[data-question-send]').isDisabled(), true);
  await panelInput().press('Escape');
  assert.equal(await panel.count(), 1);
  await panel.locator('[data-node-details-close]').click();
  await openPanel();
  assert.equal(await panelInput().inputValue(), '');
  await panelInput().fill(question);
  await panelInput().evaluate(el => {
    for (const key of ['Enter', 'Escape']) el.dispatchEvent(new KeyboardEvent('keydown', {
      key, ctrlKey: true, bubbles: true, cancelable: true, isComposing: true, keyCode: 229,
    }));
  });
  await panelInput().press('End');
  await panelInput().press('Shift+Enter');
  assert.equal(await canvasInput().inputValue(), `${question}\n`);
  await page.mouse.click(900, 850);
  assert.equal(await canvasInput().inputValue(), `${question}\n`);
  assert.equal(sends.length, 1);
  pass('Shared empty drafts, close/reopen, Escape, outside clicks, Shift+Enter and IME never submit');

  await panelInput().fill(question);
  await sendApi(() => panelInput().press('Enter'));
  assert.equal(sends.at(-1).messages.at(-1).content, question);
  await finishApi('empty');
  await waitFailed();
  assert.equal(await panelInput().inputValue(), question);
  assert.ok(!(await panel.innerText()).includes('重试'));
  pass('An unchanged question can be sent again; empty output returns to the same editable state');

  await canvasInput().fill('请用一个例子解释');
  await card().locator('[data-web-toggle]').click();
  assert.equal((await data()).webSearch, true);
  assert.equal(await page.evaluate(() => window.__ui.getState().webSearchEnabled), false);
  await sendApi(() => card().locator('[data-ask-submit]').click());
  assert.equal(sends.at(-1).messages.at(-1).content, '请用一个例子解释');
  assert.equal(sends.at(-1).webSearch, true);
  await finishApi('partial', '这里是已经生成的一部分。');
  await waitFailed();
  assert.equal((await data()).response, '这里是已经生成的一部分。');
  assert.ok((await panel.innerText()).includes('这里是已经生成的一部分。'));
  pass('Send uses the edited draft and node search settings while failed partial answers remain visible');
  await page.screenshot({ path: `${output}/light-zh-wide.png`, animations: 'disabled' });

  await sendApi(() => panel.locator('[data-question-send]').click());
  await finishApi('success', '例如，把一个复杂问题拆成几个小问题。');
  await page.waitForFunction(id => {
    const data = window.__store.getState().nodes.find(n => n.id === id).data;
    return !data.isLoading && !data.generationFailed;
  }, nodeId);
  assert.equal(await canvasInput().count(), 0);
  assert.equal(await panelInput().count(), 0);
  assert.equal((await data()).responses.includes('这里是已经生成的一部分。'), true);
  await card().locator('[data-edit-question]').click();
  await card().locator('[data-edit-submit]').click();
  assert.equal(sends.length, 4, 'An unchanged successful answer does not send again');
  pass('Success closes both composers, retains prior content, and preserves unchanged-edit behavior');

  await page.evaluate(async id => {
    window.__agentSends = [];
    window.desktopAgents = {
      canvasWorkspace: async () => 'D:/fixture/external',
      guardWrite: async () => true,
      writeMaterials: async () => ({ dir: null, written: [] }),
      onEvent: callback => { window.__agentEvent = callback; },
      run: async request => {
        window.__agentSends.push(request);
        const runId = `failure-${window.__agentSends.length}`;
        setTimeout(() => window.__agentEvent({ runId, event: { type: 'run_error', message: 'Fixture agent failed' } }), 30);
        return runId;
      },
    };
    window.__store.setState(state => ({ nodes: state.nodes.map(n => n.id === id ? { ...n,
      data: { ...n.data, executionKind: 'codex', model: 'codex/codex/fixture' },
    } : n) }));
    await window.__store.getState().editQuestion(id, '本地执行失败后继续输入');
  }, nodeId);
  await waitFailed();
  assert.equal(await panelInput().inputValue(), '本地执行失败后继续输入');
  await panelInput().fill('修改后再次发送给本地执行器');
  await panel.locator('[data-question-send]').click();
  await waitFailed();
  assert.equal(await page.evaluate(() => window.__agentSends.length), 2);
  assert.equal(await page.evaluate(() => window.__agentSends.at(-1).prompt), '修改后再次发送给本地执行器');
  assert.ok((await data()).responses.includes('例如，把一个复杂问题拆成几个小问题。'));
  pass('Local runtime failures use the same inputs and Send action while preserving successful history');

  await page.evaluate(async () => {
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('en');
    window.__store.getState().setSelectedNodeId(null);
  });
  await page.setViewportSize({ width: 1000, height: 800 });
  await panelInput().fill('Editable after failure');
  await page.evaluate(() => window.__rf.setViewport({ x: 45, y: 130, zoom: .72 }, { duration: 0 }));
  await settle();
  assert.equal(await canvasInput().inputValue(), 'Editable after failure');
  assert.equal(await panel.locator('[data-question-send]').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/dark-en-narrow.png`, animations: 'disabled' });
  pass('The editable failure state remains usable in dark/English, narrow and zoomed layouts');

  const viewerHash = await page.evaluate(async () => {
    const { nodes, edges } = window.__store.getState();
    const { buildViewerLink } = await import('/src/lib/viewer.ts');
    return new URL(await buildViewerLink(nodes, edges)).hash;
  });
  await page.goto(`${appUrl.origin}/?check=viewer${viewerHash}`, { waitUntil: 'networkidle' });
  await card().waitFor();
  await openPanel();
  assert.equal((await data()).generationFailed, true);
  assert.equal(await canvasInput().count(), 0);
  assert.equal(await panelInput().count(), 0);
  assert.equal(await card().locator('[data-ask-submit]').count(), 0);
  assert.equal(await panel.locator('[data-question-send]').count(), 0);
  assert.equal(sends.length, 4);
  pass('Shared read-only canvases retain failure status without exposing an input or send action');
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, animations: 'disabled' }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, sends: sends.length }, null, 2));
  await context.close();
  await browser.close();
}
