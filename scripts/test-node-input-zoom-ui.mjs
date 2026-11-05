// Input visibility follows detail and editing, independently of canvas selection.
// Isolated browser storage and intercepted API requests; no model calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/node-input-zoom';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1680, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().method() + ' ' + route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const node = (id = 'input-a') => page.locator(`.react-flow__node[data-id="${id}"]`);
const question = (id = 'input-blank') => node(id).locator('[data-canvas-question-editor]');
const detail = (id = 'input-blank') => node(id).locator('[data-node-detail-level]').first().getAttribute('data-node-detail-level');
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const zoom = async value => { await page.evaluate(zoom => window.__rf.setViewport({ x: 110, y: 180, zoom }, { duration: 0 }), value); await settle(); };
const blank = async () => { await page.mouse.click(1350, 830); await settle(); };
const check = name => { checks.push(name); console.log('PASS', name); };
const assertFocused = async locator => assert.equal(await locator.evaluate(el => el === document.activeElement), true);
const draft = key => page.evaluate(key => window.__ui.getState().drafts[key], key);
const patch = async (id, patch) => { await page.evaluate(({ id, patch }) => window.__store.setState(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n) })), { id, patch }); await settle(); };

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5197', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.length), 0, 'Test storage must start empty');
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('auto');
    const base = { response: '把阅读层级与编辑状态分开。概览用来查看结构，正在编辑的输入保持打开，草稿在当前会话中保留。',
      responseIndex: 0, isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 60, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: false, isBranch: false };
    const nodes = ['a', 'b'].map((id, i) => ({ id: `input-${id}`, type: 'thought', dragHandle: '.drag-handle', position: { x: i * 650, y: 0 },
      data: { ...base, question: i ? '其他节点保持一致的显示规则' : '缩放时如何稳定地继续输入？', responses: [base.response], isRoot: i === 0 } }));
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  });
  await node().waitFor();
  await page.waitForTimeout(800);
  await zoom(1);
  for (const id of ['input-a', 'input-b']) {
    assert.equal(await node(id).locator('textarea, [data-inline-followup], [data-agent-composer-bar]').count(), 0);
  }
  await node().click({ position: { x: 40, y: 100 } });
  assert.equal(await node().locator('textarea').count(), 0, 'Selecting an answered node cannot reveal a composer');
  check('Answered cards contain no continuation inputs or composer settings, including after selection');

  await page.evaluate(() => {
    const first = window.__store.getState().nodes[0];
    const idle = { ...first, id: 'input-blank', position: { x: 0, y: 410 }, selected: false,
      data: { ...first.data, question: '', response: '', responses: [], responseIndex: -1, isRoot: false, isEditing: false } };
    window.__store.getState().setNodes([...window.__store.getState().nodes, idle]);
  });
  await question().waitFor();
  assert.equal(await question().evaluate(el => el === document.activeElement), false);
  await page.screenshot({ path: `${output}/work.png` });
  await question().fill('尚未发送的新节点问题');
  await assertFocused(question());
  const originalInput = await question().elementHandle();
  for (const value of [.8, .6, .3, .36, .4, .85, .9, 1]) {
    await zoom(value);
    assert.equal(await detail(), 'full');
    assert.equal(await originalInput.evaluate(el => el.isConnected && el === document.activeElement), true);
    assert.equal(await question().inputValue(), '尚未发送的新节点问题');
    assert.equal(await node().locator('textarea').count(), 0);
  }
  await zoom(.6);
  assert.equal(await detail('input-a'), 'summary');
  assert.equal(await detail('input-b'), 'summary');
  await page.screenshot({ path: `${output}/active-at-overview.png` });
  check('Zoom preserves the same active new-node input and focus while answered nodes follow overview detail');

  await question().evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const key of ['Enter', 'Escape']) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true, keyCode: 229 }));
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  assert.equal(await detail(), 'full');
  await assertFocused(question());
  await question().press('Shift+Enter');
  assert.ok((await question().inputValue()).includes('\n'));
  check('IME Enter/Escape and multiline input do not submit or hide the new-question editor');

  await question().fill('尚未发送的新节点问题');
  await page.locator('.react-flow__controls-zoomin').click();
  await page.waitForTimeout(300);
  assert.equal(await detail(), 'full', 'Zoom buttons stay within the ongoing editing session');
  await question().focus();
  await page.keyboard.press('Tab');
  assert.equal(await detail(), 'full', 'Input and actions share an editing boundary');
  await blank();
  assert.equal(await detail(), 'summary');
  assert.equal(await draft('question-edit:input-blank'), '尚未发送的新节点问题');
  await page.screenshot({ path: `${output}/idle-overview.png` });
  check('Outside click suspends new-question editing and keeps the draft; internal Tab and zoom controls do not');

  for (const [value, expected] of [[.85, 'summary'], [.88, 'summary'], [.9, 'full'], [.85, 'full'], [.81, 'full'], [.8, 'summary'], [.82, 'summary']]) {
    await zoom(value);
    for (const id of ['input-a', 'input-b', 'input-blank']) assert.equal(await detail(id), expected);
    assert.equal(await question().count(), expected === 'full' ? 1 : 0);
    assert.equal(await node().locator('textarea').count(), 0);
  }
  check('All idle cards share the 80%/90% hysteresis boundary; answered cards never acquire an input');

  await zoom(1);
  assert.equal(await question().inputValue(), '尚未发送的新节点问题');
  assert.equal(await question().evaluate(el => el === document.activeElement), false, 'Returning to full detail must not steal focus');
  await question().click();
  await zoom(.6);
  await question().press('Escape');
  await settle();
  assert.equal(await detail(), 'summary');
  assert.equal(await draft('question-edit:input-blank'), '尚未发送的新节点问题');
  check('Escape leaves new-question editing without sending or losing its draft');

  await zoom(1);
  await question().fill('固定层级下的草稿');
  await page.evaluate(() => window.__ui.getState().setCanvasDetail('compact'));
  await settle();
  assert.equal(await detail(), 'full');
  await blank();
  assert.equal(await detail(), 'compact');
  await page.evaluate(() => window.__ui.getState().setCanvasDetail('full'));
  await zoom(.3);
  assert.equal(await detail(), 'full');
  assert.equal(await question().count(), 1);
  await patch('input-blank', { detailLevel: 'summary' });
  assert.equal(await detail(), 'summary');
  await patch('input-blank', { detailLevel: undefined });
  await page.evaluate(() => window.__ui.getState().setCanvasDetail('auto'));
  check('Explicit detail settings apply after editing ends and remain independent of selection');

  await zoom(1);
  await question().fill('');
  await blank();
  await page.evaluate(() => window.__rf.setViewport({ x: -9000, y: 180, zoom: .6 }, { duration: 0 }));
  await node('input-blank').waitFor({ state: 'detached' });
  await zoom(.6);
  await node('input-blank').waitFor();
  assert.equal(await detail(), 'summary');
  await zoom(1);
  assert.equal(await question().inputValue(), '');
  assert.equal(await question().evaluate(el => el === document.activeElement), false);
  check('Pan culling and remount preserve an emptied question draft without taking focus');

  await zoom(.6);
  await page.locator('[data-content-palette] button').first().click();
  const freshId = await page.evaluate(() => window.__store.getState().nodes.at(-1).id);
  await question(freshId).waitFor();
  await page.waitForTimeout(200);
  await assertFocused(question(freshId));
  await question(freshId).fill('新建首问');
  // New-question navigation may deliberately zoom to working scale.
  await zoom(.6);
  await blank();
  assert.equal(await detail(freshId), 'summary');
  await zoom(1);
  assert.equal(await question(freshId).inputValue(), '新建首问');
  check('Creating a question explicitly opens editing even at overview scale');

  await node().locator('[data-edit-question]').click();
  await question('input-a').fill('修改问题的草稿');
  await zoom(.3);
  assert.equal(await detail('input-a'), 'full');
  await assertFocused(question('input-a'));
  await blank();
  assert.equal(await detail('input-a'), 'compact');
  assert.equal(await draft('question-edit:input-a'), '修改问题的草稿');
  await zoom(1);
  await node().locator('[data-edit-response]').click();
  await node().locator('[data-canvas-response-editor]').fill('修改回答的草稿');
  await zoom(.6);
  assert.equal(await detail('input-a'), 'full');
  await blank();
  assert.equal(await draft('response-edit:input-a'), '修改回答的草稿');
  check('Question and answer revision keep the established editing/dismissal contract');

  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await zoom(1);
  await page.screenshot({ path: `${output}/dark-work.png` });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: `${output}/narrow-work.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(writes, [], 'Visibility and dismissal must not generate requests');
  assert.deepEqual(errors, []);
  check('Light/dark and narrow layouts render without page errors or implicit API writes');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  await context.close();
  await browser.close();
}
