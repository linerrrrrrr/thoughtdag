// Deterministic approval-surface checks; no model or actual command is run.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const candidates = process.platform === 'win32'
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  : ['/usr/bin/chromium', '/usr/bin/google-chrome'];
const executablePath = process.env.CHROME_PATH ?? candidates.find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/codex-approval';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1450, height: 1050 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const cmd = ['powershell -NoProfile -Command', 'Write-Output "Inspect the requested workspace"', 'Write-Output "A longer third line for the preview"', 'Write-Output "The end of the command must remain available"'].join('\n');
const request = { id: 'approval-1', kind: 'confirm', toolName: 'codex', name: 'command needs approval', query: cmd,
  reason: '需要读取工作区以外的文件。', arguments: null, rule: 'codex:cmd:fixture', channel: { runId: 'fixture-run' }, askedAt: new Date().toISOString() };
const node = page.locator('.react-flow__node[data-id="approval-ui"]');
const card = scope => scope.locator('[data-codex-approval]');
const patch = async approval => page.evaluate(approval => window.__store.setState(state => ({
  nodes: state.nodes.map(n => n.id === 'approval-ui' ? { ...n, data: { ...n.data, pendingApprovals: [approval] } } : n),
})), approval);
try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(async approval => {
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    useUiStore.getState().setTutorialOpen(false);
    useUiStore.getState().setReleaseNotesOpen(false);
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    window.__approvalCalls = [];
    window.desktopAgents = { answer: async (...args) => { window.__approvalCalls.push(args); return true; } };
    window.__store.getState().setNodes([{ id: 'approval-ui', type: 'thought', position: { x: 0, y: 0 }, width: 440, data: {
      question: '请检查指定文件。', response: '', responses: [], responseIndex: 0, isCollapsed: false,
      isEditing: false, isEditingResponse: false, isLoading: true, tokenCount: 0, highlights: [],
      highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      roleMode: 'inherit', pendingApprovals: [approval], executionKind: 'codex', detailLevel: 'full',
      agentActivity: [{ id: 'fixture-comment', kind: 'commentary', status: 'completed', text: '我先核对请求，再继续处理。', startedAt: Date.now() - 1000 },
        { id: 'fixture-command', kind: 'command', status: 'running', title: '执行命令', command: approval.query, startedAt: Date.now() }],
    } }]);
    window.__store.getState().setEdges([]);
  }, request);
  await node.waitFor();
  await page.evaluate(() => window.__rf.setViewport({ x: 180, y: 90, zoom: 1 }, { duration: 0 }));
  const canvasCard = card(node);
  await canvasCard.waitFor({ state: 'visible' });
  assert.match(await canvasCard.innerText(), /终端[\s\S]*允许运行此命令吗/);
  assert.match(await canvasCard.innerText(), /需要读取工作区以外的文件/);
  assert.equal(await canvasCard.locator('[data-approval-preview]').textContent(), cmd);
  await canvasCard.locator('[data-approval-expand]').waitFor({ state: 'visible' });
  await canvasCard.screenshot({ path: `${outputDir}/node-dark-collapsed.png` });
  await canvasCard.locator('[data-approval-expand]').click();
  assert.equal(await canvasCard.locator('[data-approval-preview]').getAttribute('data-expanded'), 'true');
  await canvasCard.locator('[data-approval-expand]').click();
  assert.equal(await canvasCard.locator('[data-approval-preview]').getAttribute('data-expanded'), 'false');
  await page.evaluate(() => window.__rf.setViewport({ x: 180, y: 90, zoom: .72 }, { duration: 0 }));
  await node.screenshot({ path: `${outputDir}/node-dark-zoomed.png` });
  await canvasCard.locator('[data-approval-options]').click();
  assert.equal(await canvasCard.locator('[data-approval-options]').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__rf.setViewport({ x: 180, y: 90, zoom: 1 }, { duration: 0 }));
  console.log('PASS: native-style request, separate reason, and complete expandable command on canvas');

  await canvasCard.locator('[data-approval-options]').click();
  assert.match(await canvasCard.locator('[data-approval-session-scope]').innerText(), /本对话/);
  await canvasCard.screenshot({ path: `${outputDir}/node-dark-options.png` });
  assert.deepEqual(await page.evaluate(() => window.__approvalCalls), []);
  await canvasCard.locator('.codex-approval-title').click();
  assert.equal(await canvasCard.locator('[data-approval-options]').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(await page.evaluate(() => window.__approvalCalls), []);
  await canvasCard.locator('[data-approval-options]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await canvasCard.locator('[data-approval-options]').getAttribute('aria-expanded'), 'true');
  assert.equal(await canvasCard.locator('[data-approval-options]').evaluate(el => document.activeElement === el), true);
  assert.deepEqual(await page.evaluate(() => window.__approvalCalls), []);
  await page.keyboard.press('Escape');
  assert.equal(await canvasCard.locator('[data-approval-options]').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(await page.evaluate(() => window.__approvalCalls), []);
  await canvasCard.locator('[data-approval-options]').click();
  await canvasCard.locator('[data-approval-allow-session]').click();
  assert.deepEqual(await page.evaluate(() => window.__approvalCalls), [['fixture-run', 'approval-1', { confirmed: true, scope: 'session' }]]);
  assert.equal(await canvasCard.locator('[data-approval-allow]').isDisabled(), true);
  console.log('PASS: menu dismissal never authorizes; session choice sends the existing explicit scope once');

  await patch({ ...request, id: 'approval-2', query: 'npm test', reason: null, rule: null });
  assert.equal(await canvasCard.locator('[data-approval-options]').count(), 0);
  assert.equal(await canvasCard.locator('[data-approval-expand]').count(), 0);
  await canvasCard.locator('[data-approval-reject]').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual((await page.evaluate(() => window.__approvalCalls)).at(-1), ['fixture-run', 'approval-2', { confirmed: false }]);
  console.log('PASS: unavailable scope is hidden; a focused reject button sends a rejection');

  await patch({ ...request, id: 'approval-3', name: 'file change needs approval', query: 'D:/fixture/output', reason: '需要修改输出文件。', rule: 'codex:fileChange' });
  await page.evaluate(async () => {
    window.__store.getState().setSelectedNodeId('approval-ui');
    const ui = (await import('/src/lib/ui-store.ts')).useUiStore.getState();
    ui.setPanelWidth(380);
    ui.setPanelOpen(true, 'approval-ui');
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('en');
  });
  const panel = page.locator('[data-focus-panel]');
  const panelCard = card(panel);
  await panelCard.waitFor({ state: 'visible' });
  await panelCard.getByText('Edit files', { exact: true }).waitFor({ state: 'visible' });
  assert.match(await panelCard.innerText(), /Edit files[\s\S]*Allow these file changes/);
  await panelCard.locator('[data-approval-options]').click();
  assert.match(await panelCard.locator('[data-approval-session-scope]').innerText(), /subsequent file edits/);
  const dimensions = await panelCard.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions));
  await panelCard.screenshot({ path: `${outputDir}/panel-light-narrow-options.png` });
  await panelCard.locator('[data-approval-options]').click();
  await panelCard.locator('[data-approval-allow]').click();
  assert.deepEqual((await page.evaluate(() => window.__approvalCalls)).at(-1), ['fixture-run', 'approval-3', { confirmed: true }]);
  await patch({ ...request, id: 'approval-4', name: 'more permissions requested', query: '{"network":{"enabled":true}}', reason: '需要联网。', rule: null });
  assert.match(await panelCard.innerText(), /Permissions[\s\S]*Allow the requested permissions/);
  assert.equal(await panelCard.locator('[data-approval-options]').count(), 0);
  await panelCard.locator('[data-approval-reject]').click();
  assert.deepEqual((await page.evaluate(() => window.__approvalCalls)).at(-1), ['fixture-run', 'approval-4', { confirmed: false }]);
  assert.deepEqual(errors, []);
  console.log('PASS: narrow light English focus panel, file and permission requests, and allow-once decision');
} finally {
  await browser.close();
}
