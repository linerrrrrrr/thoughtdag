// Run against Vite in an isolated browser context; all API writes are blocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to a Chromium browser');
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', async route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().method() + ' ' + route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const node = () => page.locator('.react-flow__node[data-id="dismiss-node"]');
const rename = () => node().locator('[data-canvas-rename]');
const question = () => node().locator('[data-canvas-question-editor]');
const response = () => node().locator('[data-canvas-response-editor]');
const current = () => page.evaluate(() => window.__store.getState().nodes.find(n => n.id === 'dismiss-node').data);
const blank = () => page.mouse.click(900, 840);
const check = name => { checks.push(name); console.log('PASS', name); };
const draft = key => page.evaluate(key => window.__ui.getState().drafts[key + ':dismiss-node'], key);
const focusNode = () => page.evaluate(() => window.__store.getState().setSelectedNodeId('dismiss-node'));
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5189', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__ui && window.__rf);
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__ui.getState().setPanelOpen(false);
    window.__store.getState().setNodes([{ id: 'dismiss-node', type: 'thought', position: { x: 100, y: 100 }, selected: true,
      data: { displayName: '原名称', question: '原问题', response: '原回答', responses: ['原回答'], responseIndex: 0,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        tokenCount: 12, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [],
        includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false } }]);
    window.__store.getState().setEdges([]);
    window.__store.getState().setSelectedNodeId('dismiss-node');
  });
  await node().waitFor();
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  await node().locator('[data-canvas-rename-button]').click();
  await rename().fill('外点保存的名称');
  await blank();
  await rename().waitFor({ state: 'detached' });
  assert.equal((await current()).displayName, '外点保存的名称');
  check('blank click commits a short name and exits');

  await focusNode();
  await node().locator('[data-canvas-rename-button]').click();
  await rename().fill('取消这个名称');
  await rename().press('Escape');
  await rename().waitFor({ state: 'detached' });
  assert.equal((await current()).displayName, '外点保存的名称');
  assert.equal(await page.evaluate(() => window.__store.getState().selectedNodeId), 'dismiss-node');
  assert.ok(await node().locator('[data-canvas-rename-button]').evaluate(el => el === document.activeElement), 'Escape returns focus to the remounted rename trigger');
  check('Escape cancels the edit without clearing canvas selection');

  await node().locator('[data-canvas-rename-button]').click();
  await rename().fill('中文组词');
  await rename().evaluate(el => {
    for (const key of ['Enter', 'Escape']) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true, keyCode: 229 }));
  });
  assert.equal(await rename().count(), 1);
  assert.equal((await current()).displayName, '外点保存的名称');
  await rename().press('Tab');
  assert.equal(await rename().count(), 1, 'Tab to cancel stays inside the form');
  await page.keyboard.press('Enter');
  assert.equal((await current()).displayName, '外点保存的名称');
  check('IME does not submit or cancel; internal Tab then Enter activates Cancel');

  await node().locator('[data-canvas-rename-button]').click();
  await rename().fill('Tab 保存');
  await rename().press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await rename().count(), 1);
  await page.keyboard.press('Tab');
  await rename().waitFor({ state: 'detached' });
  assert.equal((await current()).displayName, 'Tab 保存');
  check('Tab saves only after focus leaves the complete editor');

  await node().locator('[data-edit-question]').click();
  await question().fill('尚未提交的新问题');
  await blank();
  await question().waitFor({ state: 'detached' });
  assert.equal((await current()).question, '原问题');
  assert.equal(await draft('question-edit'), '尚未提交的新问题');
  await node().locator('[data-edit-question]').click();
  assert.equal(await question().inputValue(), '尚未提交的新问题');
  await question().fill('');
  await blank();
  await node().locator('[data-edit-question]').click();
  assert.equal(await question().inputValue(), '', 'Empty draft is distinct from missing draft');
  await question().press('Escape');
  assert.equal(await draft('question-edit'), undefined);
  await node().locator('[data-edit-question]').click();
  assert.equal(await question().inputValue(), '原问题');
  await question().press('End');
  await question().press('Shift+Enter');
  assert.equal(await question().inputValue(), '原问题\n');
  await question().press('Escape');
  check('question outside suspends, empty draft restores, Escape discards, Shift+Enter never generates');

  await node().locator('[data-edit-response]').click();
  await response().fill('修改的回答草稿');
  await blank();
  assert.equal((await current()).response, '原回答');
  await node().locator('[data-edit-response]').click();
  assert.equal(await response().inputValue(), '修改的回答草稿');
  await node().getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await current()).response, '修改的回答草稿');
  assert.equal(await draft('response-edit'), undefined);
  check('response resumes outside draft and saves only explicitly');

  await focusNode();
  await page.evaluate(() => window.__ui.getState().setPanelOpen(true, window.__store.getState().selectedNodeId));
  const panel = page.locator('[data-focus-panel]');
  await panel.waitFor();
  await panel.locator('[data-role-line-set], [data-role-line-edit]').first().click();
  const role = panel.locator('[data-role-editor-text]');
  await role.fill('临时角色草稿');
  await panel.locator('.question-md').click();
  await role.waitFor({ state: 'detached' });
  assert.equal(await draft('role-edit'), '临时角色草稿');
  await panel.locator('[data-role-line-set], [data-role-line-edit]').first().click();
  assert.equal(await role.inputValue(), '临时角色草稿');
  await role.press('Escape');
  assert.equal(await draft('role-edit'), undefined);
  assert.equal((await current()).rolePrompt, undefined);
  check('role editor suspends draft and Escape cancels without changing node role');

  const requestConfirm = () => page.evaluate(() => {
    window.__confirmResult = null;
    window.__ui.setState({ confirmRequest: { title: '测试确认', message: '焦点决定 Enter 行为', danger: true, confirmLabel: '删除', resolve: value => { window.__confirmResult = value; } } });
  });
  await requestConfirm();
  const confirm = page.getByRole('alertdialog');
  await confirm.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '取消');
  await page.keyboard.press('Enter');
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__confirmResult), false);
  await requestConfirm();
  await page.keyboard.press('Shift+Tab');
  assert.ok(await confirm.evaluate(el => el.contains(document.activeElement)));
  await page.keyboard.press('Tab');
  assert.ok(await confirm.evaluate(el => el.contains(document.activeElement)));
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__confirmResult), false);
  check('danger confirmation defaults to Cancel, respects Enter focus, traps Tab, and Escape cancels');

  assert.deepEqual(writes, [], 'Dismissal must never cause API writes');
  assert.deepEqual(errors, [], 'No page errors');
  await mkdir('local-tests/edit-dismiss', { recursive: true });
  await page.screenshot({ path: 'local-tests/edit-dismiss/verified.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await node().locator('[data-edit-question]').click();
  await page.screenshot({ path: 'local-tests/edit-dismiss/dark-editor.png' });
  await question().press('Escape');
  console.log(`${checks.length} interaction checks passed; no API writes or page errors.`);
} catch (error) {
  await mkdir('local-tests/edit-dismiss', { recursive: true });
  await page.screenshot({ path: 'local-tests/edit-dismiss/failure.png' });
  throw error;
} finally { await browser.close(); }
