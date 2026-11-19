// Isolated browser acceptance; all model execution and external requests are blocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { initNodePickerFixture, installNodeAgentCatalog } from './fixtures/node-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5174');
const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to a Chromium browser.');
const out = 'local-tests/node-execution';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], writes = [], checks = [];
const catalog = { default: 'api-test', models: [
  { id: 'api-test', name: 'API test model', provider: 'Test API', vision: false },
  { id: 'codex/codex/test-model', name: 'Codex · test-model', provider: '__agent__', vision: false },
  { id: 'pi/local/legacy-model', name: 'Pi · legacy-model', provider: '__agent__', vision: false },
] };
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname === '/api/models') return route.fulfill({ json: catalog });
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(url.pathname);
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
await context.addInitScript(initNodePickerFixture);
const id = 'node-execution-fixture';
const card = () => page.locator(`.react-flow__node[data-id="${id}"]`);
const picker = () => card().locator('[data-node-execution-picker]');
const panel = page.locator('[data-model-picker-panel]');
const data = () => page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data, id);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const recheck = () => page.evaluate(async () => (await window.__importLive('/src/lib/use-models.ts')).recheckAgents());
const pass = label => { checks.push(label); console.log('PASS', label); };
try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(async ({ id, catalog }) => {
    const useUiStore = window.__ui;
    const { setModelsCache } = await window.__importLive('/src/lib/use-models.ts');
    (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('zh');
    setModelsCache(catalog);
    useUiStore.getState().setSelectedModel('api-test');
    useUiStore.getState().setTutorialOpen(false);
    useUiStore.getState().setReleaseNotesOpen(false);
    useUiStore.getState().setPanelOpen(false);
    window.__store.getState().setNodes([{ id, type: 'thought', width: 520, dragHandle: '.drag-handle', position: { x: 0, y: 0 }, data: {
      executionKind: 'api', question: '', response: '', responses: [], responseIndex: -1,
      isCollapsed: false, isEditing: true, questionEditor: 'canvas', isEditingResponse: false, isLoading: false,
      detailLevel: 'full', tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
    } }]);
    window.__store.getState().setSelectedNodeId(id);
    window.__store.getState().setEdges([]);
    window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 });
  }, { id, catalog });
  await picker().waitFor();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 }));
  const codexOption = picker().locator('[data-node-execution-option="codex"]');
  assert.equal(await codexOption.count(), 0);
  await picker().locator('[data-model-picker-trigger]').press('Enter');
  await panel.getByText('API test model', { exact: true }).waitFor();
  assert.equal(await panel.locator('[data-runtime-group]').count(), 0);
  await page.keyboard.press('Escape');
  await page.evaluate(installNodeAgentCatalog, catalog.models);
  await page.evaluate(async catalog => (await window.__importLive('/src/lib/use-models.ts')).setModelsCache({ ...catalog, agentsPending: true }), catalog);
  await settle();
  assert.equal(await codexOption.count(), 0);
  await recheck();
  pass('Absent bridges and unverified catalog entries leave only API available until discovery confirms the runtime.');
  await picker().locator('[data-node-execution-option="codex"]').click();
  assert.equal((await data()).executionKind, 'codex');
  await picker().locator('[data-model-picker-trigger]').click();
  await panel.waitFor({ state: 'visible' });
  await panel.getByText('test-model', { exact: true }).waitFor({ state: 'visible' });
  assert.ok((await panel.textContent()).includes('test-model'));
  assert.ok(!(await panel.textContent()).includes('API test model'));
  assert.ok(!(await panel.textContent()).includes('legacy-model'));
  await page.keyboard.press('Escape');
  assert.equal(await panel.count(), 0);
  assert.equal((await data()).question, '');
  pass('Codex type filters the catalog; Escape closes only the model menu without sending.');
  await page.evaluate(() => window.__ui.getState().setSelectedModel('api-test'));
  assert.equal((await data()).executionKind, 'codex');
  await picker().locator('[data-node-execution-option="api"]').click();
  await picker().locator('[data-model-picker-trigger]').click();
  await panel.waitFor({ state: 'visible' });
  await panel.getByText('API test model', { exact: true }).waitFor({ state: 'visible' });
  assert.ok((await panel.textContent()).includes('API test model'));
  assert.ok(!(await panel.textContent()).includes('test-model'));
  await page.keyboard.press('Escape');
  pass('API type filters agent models and explicit node type survives global selection changes.');
  await page.evaluate(() => window.__store.getState().undo());
  assert.equal((await data()).executionKind, 'codex');
  await page.evaluate(() => window.__store.getState().redo());
  assert.equal((await data()).executionKind, 'api');
  pass('Type selection is one undoable change.');
  const child = await page.evaluate(async id => {
    const { createQuestionDraft } = await window.__importLive('/src/lib/question-draft.ts');
    const childId = createQuestionDraft({ parentId: id, position: { x: 620, y: 0 } });
    const first = window.__store.getState().nodes.find(n => n.id === childId).data.executionKind;
    window.__store.getState().setNodeExecutionKind(childId, 'codex');
    return { first, next: window.__store.getState().nodes.find(n => n.id === childId).data.executionKind };
  }, id);
  assert.deepEqual(child, { first: 'api', next: 'codex' });
  pass('A linked child inherits API and can explicitly switch to Codex for a mixed chain.');
  await page.evaluate(id => { window.__store.setState(s => ({ nodes: s.nodes.filter(n => n.id === id), edges: [], selectedNodeId: id, selectedNodeIds: [id] })); window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 }); }, id);
  await card().locator('[data-canvas-question-editor]').fill('Draft survives model dismissal');
  await picker().locator('[data-model-picker-trigger]').click();
  await page.mouse.click(780, 800);
  assert.equal(await panel.count(), 0);
  assert.equal(await card().locator('[data-canvas-question-editor]').inputValue(), 'Draft survives model dismissal');
  pass('Outside dismissal preserves the unsent question draft.');
  await page.evaluate(async () => (await window.__importLive('/src/lib/use-models.ts')).setModelsCache({ default: 'codex/codex/test-model', agentsPending: true, models: [{ id: 'codex/codex/test-model', name: 'Codex · test-model', provider: '__agent__', vision: false }] }));
  await page.evaluate(() => window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 }));
  await settle();
  await picker().locator('[data-model-picker-trigger]').click();
  await panel.locator('[data-node-model-empty]').waitFor();
  assert.ok((await panel.textContent()).includes('API'));
  await page.keyboard.press('Escape');
  pass('Missing API models show a setup action instead of silently using Codex.');
  await page.evaluate(async catalog => (await window.__importLive('/src/lib/use-models.ts')).setModelsCache(catalog), catalog);
  await recheck();
  await page.evaluate(async () => { document.documentElement.dataset.theme = 'light'; (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('zh'); window.__rf.setViewport({ x: 100, y: 150, zoom: 1 }, { duration: 0 }); });
  await settle();
  await page.waitForTimeout(500);
  assert.equal(await picker().locator('[data-node-execution-option="api"]').innerText(), 'API 聊天');
  await page.screenshot({ path: `${out}/light-zh.png`, animations: 'disabled' });
  await page.evaluate(async () => { document.documentElement.dataset.theme = 'dark'; (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('en'); });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.evaluate(() => window.__rf.setViewport({ x: 40, y: 150, zoom: .8 }, { duration: 0 }));
  await settle();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/dark-en-zoom80.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.evaluate(async id => {
    window.__nodeExecutionSends = [];
    window.__originalEditQuestion = window.__store.getState().editQuestion;
    window.__store.setState({ editQuestion: (nodeId, question) => { window.__nodeExecutionSends.push({ nodeId, question, executionKind: window.__store.getState().nodes.find(n => n.id === nodeId).data.executionKind }); } });
    window.__store.setState(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, isEditing: true, questionEditor: 'panel' } } : n), selectedNodeId: id, selectedNodeIds: [id] }));
    window.__ui.getState().setPanelOpen(true, id);
  }, id);
  const focus = page.locator('[data-focus-panel]');
  const focusPicker = focus.locator('[data-node-execution-picker]');
  await focusPicker.locator('[data-node-execution-option="codex"]').click();
  await focus.locator('[data-conversation-question] textarea').fill('Panel draft stays here');
  await focusPicker.locator('[data-model-picker-trigger]').click();
  await page.evaluate(installNodeAgentCatalog, []);
  await recheck();
  await panel.waitFor({ state: 'detached' });
  assert.equal(await codexOption.count(), 0);
  assert.equal(await focusPicker.locator('[data-node-execution-option="codex"], [data-model-picker-trigger]').count(), 0);
  assert.equal((await data()).executionKind, 'codex');
  assert.equal(await focus.locator('[data-conversation-question] textarea').inputValue(), 'Panel draft stays here');
  await focusPicker.locator('[data-node-execution-option="api"]').click();
  await focusPicker.locator('[data-model-picker-trigger]').click();
  await panel.getByText('API test model', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(installNodeAgentCatalog, catalog.models);
  await recheck();
  await focusPicker.locator('[data-node-execution-option="codex"]').waitFor();
  assert.equal((await data()).executionKind, 'api');
  pass('Disconnecting closes the open agent menu and preserves the draft; API stays usable and reconnecting restores the option.');
  assert.equal(await focus.count(), 1);
  assert.equal(await focus.locator('[data-conversation-question] textarea').inputValue(), 'Panel draft stays here');
  await focusPicker.locator('[data-node-execution-option="api"]').click();
  const questionInput = focus.locator('[data-conversation-question] textarea');
  await questionInput.fill('Panel line one');
  await questionInput.press('End');
  await questionInput.press('Shift+Enter');
  await questionInput.press('x');
  assert.equal(await questionInput.inputValue(), 'Panel line one\nx');
  assert.equal(await page.evaluate(() => window.__nodeExecutionSends.length), 0);
  await questionInput.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  assert.equal(await page.evaluate(() => window.__nodeExecutionSends.length), 0);
  await settle();
  await page.screenshot({ path: `${out}/panel-dark-en.png`, animations: 'disabled' });
  await focus.locator('[data-question-send]').click();
  await questionInput.fill('Ctrl send');
  await questionInput.press('Control+Enter');
  await questionInput.fill('Meta send');
  await questionInput.press('Meta+Enter');
  assert.deepEqual(await page.evaluate(() => window.__nodeExecutionSends), [
    { nodeId: id, question: 'Panel line one\nx', executionKind: 'api' },
    { nodeId: id, question: 'Ctrl send', executionKind: 'api' },
    { nodeId: id, question: 'Meta send', executionKind: 'api' },
  ]);
  await questionInput.fill('Keep on Escape');
  await questionInput.press('Escape');
  assert.equal(await page.evaluate(() => window.__nodeExecutionSends.length), 3);
  assert.equal(await page.evaluate(id => window.__ui.getState().drafts[`question-edit:${id}`], id), 'Keep on Escape');
  await page.evaluate(() => { window.__store.setState({ editQuestion: window.__originalEditQuestion }); window.__ui.getState().setPanelOpen(false); });
  pass('The reading panel preserves line breaks and IME input and sends with the chosen execution type via its button or Ctrl/Meta+Enter.');
  const versionState = await page.evaluate(id => {
    window.__store.setState(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, agentSession: { runtime: 'codex', threadId: 'fixture' }, codexHistories: [{ threadId: 'v1' }, { threadId: 'v2' }] } } : n) }));
    window.__store.getState().setNodeExecutionKind(id, 'codex');
    const switched = window.__store.getState().nodes.find(n => n.id === id).data;
    window.__store.setState(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, response: 'Answer 2', responses: ['Answer 1', 'Answer 2'], responseIndex: 1, isEditing: false } } : n) }));
    window.__store.getState().deleteVersion(id, 0);
    const after = window.__store.getState().nodes.find(n => n.id === id).data;
    return { oldSessionCleared: !switched.agentSession, mappingPreserved: switched.codexHistories.length, remaining: after.codexHistories.map(h => h.threadId) };
  }, id);
  assert.deepEqual(versionState, { oldSessionCleared: true, mappingPreserved: 2, remaining: ['v2'] });
  await settle();
  assert.equal(await picker().count(), 0);
  pass('Switching type clears the session without deleting history; deleting a version removes its history mapping and answered nodes show status only.');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(writes.length, 0, `Selection must not start requests: ${writes.join(', ')}`);
  pass('No model requests or page errors; light/Chinese and dark/English at 80% captured.');
  await writeFile(`${out}/result.json`, JSON.stringify({ checks, errors, writes }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, animations: 'disabled' }).catch(() => {});
  console.error('Fixture picker on failure:', await picker().innerText().catch(() => 'not mounted'));
  throw error;
} finally { await browser.close(); }
