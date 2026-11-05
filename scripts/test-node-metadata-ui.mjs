// Card metadata is a deferred, explicit multi-field edit, separate from the turn.
// Every API request is intercepted in a fresh browser context; no model is called.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/node-metadata';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], writes = [], checks = [];
let responseMode = 'success', releaseHeld;
const generated = { title: 'AI 整理的节点名称', summary: 'AI 整理的摘要：名称用于识别节点，摘要用于理解核心结论。' };
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ method: request.method(), path: url.pathname });
  if (url.pathname === '/api/models') return route.fulfill({ json: {
    models: [{ id: 'test/metadata', name: 'Metadata test', provider: 'test', vision: false }], default: 'test/metadata',
  } });
  if (url.pathname === '/api/claude') {
    const mode = responseMode;
    if (mode === 'hold') await new Promise(resolve => { releaseHeld = resolve; });
    // A canceled request may already be closed before the held response is released.
    await route.fulfill(mode === 'failure'
      ? { status: 500, json: { error: 'Metadata test failure' } }
      : { json: { text: JSON.stringify(generated), model: 'test/metadata' } }).catch(() => {});
    return;
  }
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lighting', 'light');
});
const node = () => page.locator('.react-flow__node[data-id="metadata-a"]');
const editor = () => node().locator('[data-node-metadata-editor]');
const title = () => node().locator('[data-node-title-input]');
const summary = () => node().locator('[data-node-summary-input]');
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const blank = async () => { await page.mouse.click(1300, 820); await settle(); };
const check = name => { checks.push(name); console.log('PASS', name); };
const saved = () => page.evaluate(() => {
  const data = window.__store.getState().nodes.find(item => item.id === 'metadata-a').data;
  return { title: data.displayName, summary: data.displaySummary, question: data.question, response: data.response };
});
const historyIndex = () => page.evaluate(() => window.__store.getState().historyIndex);
const open = async () => { await node().locator('[data-node-metadata-toggle]').click(); await editor().waitFor(); };
const cancel = async () => { await node().locator('[data-node-metadata-cancel]').click(); await editor().waitFor({ state: 'detached' }); };
const save = async () => { await node().locator('[data-node-metadata-save]').click(); await editor().waitFor({ state: 'detached' }); };
const setDetail = async detail => {
  await page.evaluate(detail => window.__store.setState(state => ({ nodes: state.nodes.map(item => item.id === 'metadata-a'
    ? { ...item, data: { ...item.data, detailLevel: detail } } : item) })), detail);
  await settle();
};
const setZoom = async zoom => { await page.evaluate(zoom => window.__rf.setViewport({ x: 120, y: 160, zoom }, { duration: 0 }), zoom); await settle(); };
const screenshot = async name => { await settle(); await page.screenshot({ path: `${output}/${name}.png` }); };

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5197', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.length), 0, 'Test storage must start empty');
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('auto');
    const response = '## 主要结论\n\n顶部状态栏负责拖拽和操作，名称与摘要用于概览，问答正文保留完整内容。\n\n- 阅读时收起编辑工具。\n- 需要修改时再展开名称与摘要。';
    const nodes = [{ id: 'metadata-a', type: 'thought', dragHandle: '.drag-handle', position: { x: 0, y: 0 }, width: 620,
      data: { question: '如何让节点卡片更易于阅读？', response, responses: [response], responseIndex: 0,
        displayName: '节点信息整理', displaySummary: '把状态操作、名称摘要和问答正文分开，降低重复信息带来的阅读负担。',
        summaries: ['后台自动摘要不应覆盖用户修改。'], summaryTopics: ['后台主题'],
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        tokenCount: 180, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [],
        includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false } }];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  });
  await node().waitFor();
  await page.waitForTimeout(500);
  await setZoom(1);
  const initial = await saved();
  assert.equal(await editor().count(), 0);
  assert.equal((await node().innerText()).includes(initial.title), false, 'Full cards keep metadata text collapsed');
  assert.equal((await node().innerText()).includes(initial.summary), false, 'Full cards keep the summary collapsed');
  assert.ok((await node().innerText()).includes(initial.question));
  await screenshot('light-full');
  check('Full detail shows the question and answer while metadata stays folded');

  const beforeDrag = await page.evaluate(() => window.__store.getState().nodes[0].position);
  const header = await node().locator('.thought-node-header').boundingBox();
  assert.ok(header);
  await page.mouse.move(header.x + header.width * .55, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + header.width * .55 + 72, header.y + header.height / 2 + 48, { steps: 12 });
  await page.mouse.up();
  await settle();
  const afterDrag = await page.evaluate(() => window.__store.getState().nodes[0].position);
  // React Flow starts the drag after its activation threshold, consuming the first pointer step.
  assert.ok(Math.abs(afterDrag.x - beforeDrag.x - 72) < 12 && Math.abs(afterDrag.y - beforeDrag.y - 48) < 12,
    `Header drag moved from ${JSON.stringify(beforeDrag)} to ${JSON.stringify(afterDrag)}`);
  assert.deepEqual(await saved(), initial);
  check('Holding and moving the header drags the node without changing content');

  await open();
  assert.equal(await title().inputValue(), initial.title);
  assert.equal(await summary().inputValue(), initial.summary);
  await title().fill('尚未保存的新名称');
  await title().press('Tab');
  assert.equal(await summary().evaluate(element => element === document.activeElement), true);
  await summary().fill('尚未保存的新摘要');
  await summary().press('Enter');
  assert.ok((await summary().inputValue()).includes('\n'));
  await summary().evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const key of ['Enter', 'Escape']) element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true, keyCode: 229 }));
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  assert.equal(await editor().count(), 1);
  assert.deepEqual(await saved(), initial);
  await blank();
  assert.equal(await editor().count(), 0);
  assert.deepEqual(await saved(), initial);
  await open();
  assert.equal(await title().inputValue(), '尚未保存的新名称');
  assert.ok((await summary().inputValue()).startsWith('尚未保存的新摘要'));
  await title().fill('');
  await summary().fill('');
  await blank();
  await open();
  assert.equal(await title().inputValue(), '');
  assert.equal(await summary().inputValue(), '');
  await summary().press('Escape');
  await editor().waitFor({ state: 'detached' });
  await open();
  assert.equal(await title().inputValue(), initial.title);
  assert.equal(await summary().inputValue(), initial.summary);
  await cancel();
  assert.deepEqual(writes, [], 'Opening, editing, outside click and Escape do not call APIs');
  check('Internal Tab and IME preserve editing; outside click keeps empty drafts; Escape discards them');

  await open();
  await title().fill('用户保存的名称');
  await summary().fill('用户保存的摘要，支持一次撤销恢复两个字段。');
  const beforeSave = await historyIndex();
  await save();
  const manuallySaved = await saved();
  assert.equal(manuallySaved.title, '用户保存的名称');
  assert.equal(manuallySaved.summary, '用户保存的摘要，支持一次撤销恢复两个字段。');
  assert.equal(manuallySaved.question, initial.question);
  assert.equal(manuallySaved.response, initial.response);
  assert.equal(await historyIndex(), beforeSave + 1);
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual(await saved(), initial);
  await page.evaluate(() => window.__store.getState().redo());
  assert.deepEqual(await saved(), manuallySaved);
  check('Explicit save changes both metadata fields in one undo step and preserves the turn');

  await open();
  await title().fill('');
  await summary().fill('');
  await summary().press('Control+Enter');
  await editor().waitFor({ state: 'detached' });
  assert.equal((await saved()).title, undefined, 'An empty saved title restores automatic naming');
  assert.equal((await saved()).summary, '', 'An empty saved summary is an explicit value');
  await setDetail('summary');
  assert.equal(await node().locator('[data-node-preview]').count(), 0, 'An explicitly cleared summary does not reveal the automatic summary or answer');
  // Restore the test-only detail patch before testing the content undo step.
  await setDetail(undefined);
  await page.evaluate(() => window.__store.getState().undo());
  assert.deepEqual(await saved(), manuallySaved);
  check('Ctrl+Enter explicitly saves; cleared summaries stay empty and clearing the title restores automatic naming');

  await setDetail('summary');
  assert.ok((await node().innerText()).includes(manuallySaved.title));
  assert.ok((await node().innerText()).includes(manuallySaved.summary));
  assert.equal((await node().innerText()).includes(initial.question), false);
  await screenshot('light-summary');
  await node().locator('[data-node-name]').first().click();
  await editor().waitFor();
  const titleElement = await title().elementHandle();
  await title().focus();
  for (const zoom of [.6, .3, 1]) {
    await setZoom(zoom);
    assert.equal(await titleElement.evaluate(element => element.isConnected && element === document.activeElement), true);
  }
  await cancel();
  assert.equal(await node().locator('[data-node-detail-level]').first().getAttribute('data-node-detail-level'), 'summary');
  check('Summary detail displays metadata; one click edits it and zoom preserves the editing session');

  await setDetail('full');
  await open();
  await title().fill('AI 填充之前的标题草稿');
  await summary().fill('AI 填充之前的摘要草稿');
  const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/claude');
  await node().locator('[data-node-metadata-generate]').click();
  await request;
  await page.waitForFunction(value => document.querySelector('[data-node-title-input]')?.value === value, generated.title);
  assert.equal(await summary().inputValue(), generated.summary);
  assert.deepEqual(await saved(), manuallySaved, 'AI fill only updates the draft');
  await screenshot('light-editor');
  await save();
  assert.equal((await saved()).title, generated.title);
  assert.equal((await saved()).summary, generated.summary);
  assert.equal(writes.length, 1);
  check('AI filling is explicit and stays in drafts until Save is clicked');

  responseMode = 'hold';
  await open();
  await title().fill('等待期间保留的草稿');
  const heldRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/claude');
  await node().locator('[data-node-metadata-generate]').click();
  await heldRequest;
  await blank();
  await editor().waitFor({ state: 'detached' });
  releaseHeld();
  await open();
  assert.equal(await title().inputValue(), '等待期间保留的草稿');
  await settle();
  assert.equal(await title().inputValue(), '等待期间保留的草稿');
  await cancel();
  responseMode = 'failure';
  await open();
  await title().fill('失败时保留的草稿');
  const failedRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/claude');
  await node().locator('[data-node-metadata-generate]').click();
  await failedRequest;
  await node().locator('[data-node-metadata-generate]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[data-node-metadata-generate]')?.disabled);
  assert.equal(await title().inputValue(), '失败时保留的草稿');
  assert.equal((await saved()).title, generated.title);
  await cancel();
  check('Closing cancels a pending fill; a failed fill preserves the draft and saved values');

  const beforeAutomatic = await page.evaluate(() => window.__store.getState().nodes[0].data);
  await page.evaluate(() => window.__store.setState(state => ({ nodes: state.nodes.map(item => ({ ...item, data: {
    ...item.data, displayName: undefined, displaySummary: undefined, summaryTopics: ['旧自动名称'], summaries: ['旧自动摘要'],
  } })) })));
  await open();
  assert.equal(await title().inputValue(), '旧自动名称');
  assert.equal(await summary().inputValue(), '旧自动摘要');
  await page.evaluate(() => window.__store.setState(state => ({ nodes: state.nodes.map(item => ({ ...item, data: {
    ...item.data, summaryTopics: ['后台更新后的名称'], summaries: ['后台更新后的摘要'],
  } })) })));
  await save();
  assert.equal((await saved()).title, undefined);
  assert.equal((await saved()).summary, undefined);
  await setDetail('summary');
  assert.ok((await node().innerText()).includes('后台更新后的名称'));
  assert.ok((await node().innerText()).includes('后台更新后的摘要'));
  await page.evaluate(data => window.__store.setState(state => ({ nodes: state.nodes.map(item => ({ ...item, data })) })), beforeAutomatic);
  check('Saving an untouched editor does not pin stale automatic metadata when the background updates it');

  await page.evaluate(() => window.__store.setState(state => ({ nodes: state.nodes.map(item => ({ ...item, height: 240 })) })));
  await settle();
  const fixedCard = () => node().locator('[data-node-detail-level]').first();
  assert.ok(Math.abs((await fixedCard().boundingBox()).height - 240) < 2);
  await open();
  assert.ok((await fixedCard().boundingBox()).height > 400, 'The editor expands a short card to its natural height');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes[0].height), 240);
  await cancel();
  assert.ok(Math.abs((await fixedCard().boundingBox()).height - 240) < 2, 'Closing restores the saved card height');
  await page.evaluate(() => window.__store.setState(state => ({ nodes: state.nodes.map(item => ({ ...item, height: undefined })) })));
  check('Opening metadata on a 240px card temporarily expands it and closing restores its saved height');

  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await screenshot('dark-full');
  await setDetail('summary');
  await screenshot('dark-summary');
  await node().locator('[data-node-name]').first().click();
  await editor().waitFor();
  await screenshot('dark-editor');
  await page.setViewportSize({ width: 900, height: 800 });
  await page.evaluate(() => window.__store.setState(state => ({ nodes: state.nodes.map(item => ({ ...item, width: 360 })) })));
  await setZoom(1);
  await screenshot('narrow-editor');
  assert.equal(await editor().evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.equal(writes.length, 3);
  assert.ok(writes.every(request => request.method === 'POST' && request.path === '/api/claude'));
  check('Light, dark and narrow metadata layouts render without page errors or unexpected API writes');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  releaseHeld?.();
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  await context.close();
  await browser.close();
}
