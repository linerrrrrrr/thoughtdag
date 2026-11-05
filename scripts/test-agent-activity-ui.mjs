// Browser regression for the activity timeline. Run against a Vite dev server.
// APP_URL and CHROME_PATH override the local server and browser executable.
// Fixtures exercise rendering and persistence without invoking an LLM or tools.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const candidates = process.platform === 'win32'
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
const executablePath = process.env.CHROME_PATH ?? candidates.find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/agent-activity';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1450, height: 1050 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
});

const now = Date.now();
const entries = [
  { id: 'turn-1', kind: 'status', sourceType: 'turn', status: 'running', startedAt: now - 2500 },
  { id: 'comment-1', kind: 'commentary', status: 'completed', text: '我先检查构建日志，再验证相关文件。', startedAt: now - 2000, endedAt: now - 1500 },
  { id: 'reason-1', kind: 'reasoning', status: 'completed', text: '先区分类型检查与打包错误，缩小排查范围。', startedAt: now - 1500, endedAt: now - 1000 },
  { id: 'command-1', kind: 'command', status: 'running', title: '执行命令', command: 'npm run build', cwd: 'D:/workspace/project', output: '> tsc -b\nChecking types…\n', startedAt: now - 1000 },
  { id: 'tool-1', kind: 'tool', status: 'running', title: '读取配置文件', text: '读取 tsconfig.app.json', details: { arguments: { path: 'tsconfig.app.json' } }, startedAt: now - 500 },
];
const node = () => page.locator('.react-flow__node[data-id="agent-ui"]');
const row = (scope, id) => scope.locator(`[data-activity-id="${id}"]`);
const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const patch = async (value) => page.evaluate(value => window.__store.setState(state => ({
  nodes: state.nodes.map(n => n.id === 'agent-ui' ? { ...n, data: { ...n.data, ...value } } : n),
})), value);
const screenshot = async (name) => page.screenshot({ path: `${outputDir}/${name}.png` });
const openHistory = async (scope) => {
  const button = scope.locator('[data-activity-history]');
  if (await button.count() && await button.getAttribute('aria-expanded') !== 'true') await button.click();
};
const outputText = async (scope, id) => {
  const item = row(scope, id);
  const heading = item.locator('button[aria-expanded]').first();
  if (await heading.count() && await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
  return item.locator('[data-activity-output]').textContent();
};

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(async activity => {
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    useUiStore.getState().setTutorialOpen(false);
    useUiStore.getState().setReleaseNotesOpen(false);
    window.__store.getState().setNodes([{ id: 'agent-ui', type: 'thought', position: { x: 0, y: 0 }, data: {
      question: '检查构建失败的原因，并验证修复。', response: '', responses: [], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: true,
      tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [],
      excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false,
      agentActivity: activity,
    } }]);
    window.__store.getState().setEdges([]);
  }, entries);
  await node().waitFor();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rf.setViewport({ x: 140, y: 120, zoom: 1 }, { duration: 0 }));
  await row(node(), 'comment-1').waitFor({ state: 'visible' });
  assert.match(await row(node(), 'comment-1').textContent(), /我先检查构建日志/);
  await row(node(), 'reason-1').waitFor({ state: 'visible' });
  assert.equal(await node().locator('[data-activity-kind="command"]').count(), 1);
  assert.equal(await node().locator('[data-activity-kind="tool"]').count(), 1);
  check('commentary, reasoning summary, and concurrent tools appear before answer text');
  assert.match(await outputText(node(), 'command-1'), /Checking types/);
  await screenshot('live-before-answer');

  const streamed = entries.map(e => e.id === 'command-1' ? { ...e, output: `${e.output}Types passed.\nBundling assets…\n` } : e);
  await patch({ agentActivity: streamed });
  await page.waitForFunction(() => document.querySelector('[data-activity-id="command-1"] [data-activity-output]')?.textContent.includes('Bundling assets'));
  assert.match(await outputText(node(), 'command-1'), /Checking types[\s\S]*Types passed[\s\S]*Bundling assets/);
  check('command output increments in order without losing earlier output');

  const withAnswer = [...streamed, { id: 'answer-1', kind: 'message', phase: 'partial_answer', status: 'running', text: '已定位问题，正在核对修复结果。', startedAt: now + 100 }];
  await patch({ agentActivity: withAnswer, response: '已定位问题，正在核对修复结果。', pendingApprovals: [{ id: 'approval-1', name: '执行命令', toolName: 'shell', query: 'npm run build', reason: '需要验证项目构建。' }] });
  await node().locator('[data-approval-card="approval-1"]').waitFor({ state: 'visible' });
  await row(node(), 'command-1').waitFor({ state: 'visible' });
  assert.match(await node().textContent(), /已定位问题/);
  check('activity, answer text, and an approval remain visible together');
  await patch({ pendingApprovals: [] });

  await page.evaluate(async () => {
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    window.__store.getState().setSelectedNodeId('agent-ui');
    useUiStore.getState().setPanelOpen(true, 'agent-ui');
  });
  const panel = page.locator('[data-focus-panel]');
  await row(panel, 'comment-1').waitFor({ state: 'visible' });
  await row(panel, 'command-1').waitFor({ state: 'visible' });
  assert.match(await panel.textContent(), /已定位问题/);
  assert.match(await outputText(panel, 'command-1'), /Checking types[\s\S]*Types passed[\s\S]*Bundling assets/);
  await screenshot('live-focus-panel');
  check('focus panel shows the same activity alongside the answer');

  // The work panel intentionally closes when the entire viewport is too
  // narrow to coexist with the canvas. Exercise its supported minimum width.
  await page.evaluate(async () => {
    (await import('/src/lib/ui-store.ts')).useUiStore.getState().setPanelWidth(380);
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
  });
  await row(panel, 'command-1').waitFor({ state: 'visible' });
  await screenshot('live-focus-panel-narrow-dark');
  const overflow = await panel.evaluate(el => {
    const activity = el.querySelector('[data-agent-activity]');
    return { width: el.getBoundingClientRect().width, scrollWidth: activity.scrollWidth, clientWidth: activity.clientWidth, viewport: innerWidth };
  });
  assert.ok(overflow.width <= overflow.viewport, JSON.stringify(overflow));
  assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, JSON.stringify(overflow));
  check('narrow dark focus panel contains the timeline without horizontal overflow');
  await page.setViewportSize({ width: 1450, height: 1050 });
  await page.evaluate(async () => {
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    (await import('/src/lib/ui-store.ts')).useUiStore.getState().setPanelWidth(620);
    (await import('/src/lib/ui-store.ts')).useUiStore.getState().setPanelOpen(false);
  });

  const completed = withAnswer.map(e => ({ ...e, status: 'completed', endedAt: now + 1000, ...(e.id === 'command-1' ? { exitCode: 0, durationMs: 2000, output: `${e.output}Build passed.\n` } : {}) }));
  await patch({ isLoading: false, agentActivity: null, agentActivities: [completed], response: '构建已通过，修复完成。', responses: ['构建已通过，修复完成。'], responseIndex: 0 });
  const history = node().locator('[data-activity-history]');
  await history.waitFor({ state: 'visible' });
  assert.equal(await history.getAttribute('aria-expanded'), 'false');
  await openHistory(node());
  assert.match(await outputText(node(), 'command-1'), /Build passed/);
  await screenshot('completed-expanded');
  check('completed activity is collapsed by default and can reveal the retained output');

  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(() => window.__rf.setViewport({ x: 140, y: 120, zoom: 1 }, { duration: 0 }));
  await openHistory(node());
  assert.match(await outputText(node(), 'command-1'), /Build passed/);
  check('completed activity survives IndexedDB persistence and reload');

  const previous = [{ id: 'previous-comment', kind: 'commentary', status: 'completed', text: '上一版本独有的活动记录。', startedAt: now - 5000, endedAt: now - 4000 }];
  await patch({ response: '第二版回答', responses: ['第一版回答', '第二版回答'], responseIndex: 1, agentActivities: [previous, completed] });
  await page.evaluate(() => window.__store.getState().navigateVersion('agent-ui', 'prev'));
  await openHistory(node());
  await row(node(), 'previous-comment').waitFor({ state: 'visible' });
  assert.equal(await row(node(), 'command-1').count(), 0);
  await page.evaluate(() => window.__store.getState().navigateVersion('agent-ui', 'next'));
  await openHistory(node());
  await row(node(), 'command-1').waitFor({ state: 'visible' });
  assert.equal(await row(node(), 'previous-comment').count(), 0);
  check('changing answer versions changes the associated activity history');

  const structured = [
    { id: 'plan-1', kind: 'plan', status: 'running', sourceType: 'turn/plan/updated', startedAt: now, details: { plan: [
      { step: '检查构建日志', status: 'completed' },
      { step: '修复类型定义', status: 'in_progress' },
      { step: '运行验证', status: 'pending' },
    ] } },
    { id: 'file-1', kind: 'file', status: 'running', sourceType: 'fileChange', startedAt: now + 100, details: { changes: [
      { path: 'src/example.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-const count = "1";\n+const count = 1;\n' },
    ] } },
  ];
  await patch({ isLoading: true, generationFailed: false, response: '', agentActivity: structured });
  await openHistory(node());
  await row(node(), 'plan-1').locator('.activity-plan').waitFor({ state: 'visible' });
  const steps = await row(node(), 'plan-1').locator('.activity-plan li').allTextContents();
  assert.deepEqual(steps, ['检查构建日志已完成', '修复类型定义进行中', '运行验证待执行']);
  check('plan steps render their completed, running, and pending states');
  await row(node(), 'file-1').locator('.activity-files summary').press('Enter');
  assert.match(await row(node(), 'file-1').locator('.activity-diff-remove').textContent(), /const count = "1"/);
  assert.match(await row(node(), 'file-1').locator('.activity-diff-add').textContent(), /const count = 1/);
  check('file changes reveal a readable diff with separate added and removed lines');
  await page.evaluate(async () => {
    window.__store.getState().setSelectedNodeId('agent-ui');
    (await import('/src/lib/ui-store.ts')).useUiStore.getState().setPanelOpen(true, 'agent-ui');
  });
  await row(panel, 'file-1').locator('.activity-files summary').press('Enter');
  assert.match(await row(panel, 'file-1').locator('.activity-diff-add').textContent(), /const count = 1/);
  await screenshot('structured-plan-file');
  await page.evaluate(async () => (await import('/src/lib/ui-store.ts')).useUiStore.getState().setPanelOpen(false));

  await patch({ isLoading: false, generationFailed: true, agentActivity: [
    { id: 'completed-turn', kind: 'status', sourceType: 'turn', status: 'completed', startedAt: now, endedAt: now + 500 },
    { id: 'run-error', kind: 'status', status: 'failed', text: 'Run failed after turn completion.', startedAt: now + 600, endedAt: now + 600 },
  ] });
  await openHistory(node());
  await row(node(), 'completed-turn').waitFor({ state: 'visible' });
  assert.match(await node().locator('[data-activity-history]').textContent(), /执行失败/);
  check('a failed run remains labeled failed even when its turn item says completed');

  const failed = [{ id: 'failed-command', kind: 'command', status: 'failed', title: '执行命令', command: 'npm run build', output: 'Type check failed.\n', exitCode: 1, startedAt: now, endedAt: now + 200 }];
  await patch({ generationFailed: true, response: '', responses: [], responseIndex: 0, agentActivity: failed, agentActivities: [] });
  await openHistory(node());
  await row(node(), 'failed-command').waitFor({ state: 'visible' });
  assert.match(await outputText(node(), 'failed-command'), /Type check failed/);
  await screenshot('failed-activity');
  check('failed runs retain command output even without a final answer');

  await patch({ generationFailed: false, isLoading: true, agentActivity: [{ ...failed[0], id: 'interrupted-command', status: 'running', output: 'Partial output before interruption.\n', endedAt: null, exitCode: null }] });
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(() => window.__rf.setViewport({ x: 140, y: 120, zoom: 1 }, { duration: 0 }));
  const restored = await page.evaluate(() => window.__store.getState().nodes.find(n => n.id === 'agent-ui').data);
  assert.equal(restored.isLoading, false);
  assert.equal(restored.agentActivities[restored.responseIndex][0].status, 'interrupted');
  await openHistory(node());
  assert.match(await outputText(node(), 'interrupted-command'), /Partial output before interruption/);
  await screenshot('interrupted-activity');
  check('refresh during a run settles running activity as interrupted and retains partial output');

  const oldAnswer = '上一版的完整答案保持不变。';
  const oldActivity = [{ id: 'old-answer-activity', kind: 'commentary', status: 'completed', text: '上一版活动记录。', startedAt: now - 5000, endedAt: now - 4000 }];
  const rerunActivity = [
    { id: 'rerun-comment', kind: 'commentary', status: 'completed', text: '正在重新检查，尚未生成新回答。', startedAt: now, endedAt: now + 100 },
    { id: 'rerun-command', kind: 'command', status: 'running', command: 'npm run build', output: 'Rerun partial output.\n', startedAt: now + 200 },
  ];
  await patch({ response: oldAnswer, responses: [oldAnswer], responseIndex: 0, agentActivities: [oldActivity], agentActivity: rerunActivity, restreaming: true, isLoading: true, generationFailed: false });
  await row(node(), 'rerun-comment').waitFor({ state: 'visible' });
  assert.doesNotMatch(await node().textContent(), /上一版的完整答案保持不变/);
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(() => window.__rf.setViewport({ x: 140, y: 120, zoom: 1 }, { duration: 0 }));
  const rerunRestored = await page.evaluate(() => window.__store.getState().nodes.find(n => n.id === 'agent-ui').data);
  assert.equal(rerunRestored.responseIndex, 1);
  assert.equal(rerunRestored.responses.length, 2);
  assert.equal(rerunRestored.responses[0], oldAnswer);
  assert.notEqual(rerunRestored.response, oldAnswer);
  assert.deepEqual(rerunRestored.agentActivities[0], oldActivity);
  assert.equal(rerunRestored.agentActivities[1][1].status, 'interrupted');
  await openHistory(node());
  assert.match(await outputText(node(), 'rerun-command'), /Rerun partial output/);
  await page.evaluate(() => window.__store.getState().navigateVersion('agent-ui', 'prev'));
  await openHistory(node());
  await row(node(), 'old-answer-activity').waitFor({ state: 'visible' });
  assert.equal(await row(node(), 'rerun-command').count(), 0);
  assert.match(await node().textContent(), /上一版的完整答案保持不变/);
  await page.evaluate(() => window.__store.getState().navigateVersion('agent-ui', 'next'));
  await openHistory(node());
  await row(node(), 'rerun-command').waitFor({ state: 'visible' });
  assert.equal(await row(node(), 'old-answer-activity').count(), 0);
  await screenshot('rerun-interrupted-version');
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated());
  const versionCount = await page.evaluate(() => window.__store.getState().nodes.find(n => n.id === 'agent-ui').data.responses.length);
  assert.equal(versionCount, 2);
  check('refresh before rerun answer text archives a separate interrupted version without mixing or duplicating old history');
  const imported = [
    { id: 'import-comment', kind: 'commentary', status: 'completed', text: '**正在检查** [parser.ts](src/parser.ts:42)\n\n- 保留原有接口\n- 修复边界条件', startedAt: now, endedAt: now + 100 },
    { id: 'import-user', kind: 'user', sourceType: 'userMessage', status: 'completed', text: '请保持 **兼容性**。', startedAt: now + 200 },
    { id: 'recovered-command', kind: 'command', status: 'failed', command: 'npm test', output: 'First attempt failed', exitCode: 1, startedAt: now + 300 },
    { id: 'import-final', kind: 'message', phase: 'final_answer', status: 'completed', text: '修复完成。', startedAt: now + 600, endedAt: now + 900 },
  ];
  await patch({ isLoading: false, generationFailed: false, agentActivity: undefined, agentActivities: [imported], response: '修复完成。', responses: ['修复完成。'], responseIndex: 0, importSource: { runner: 'codex', sessionId: 'fixture', itemIds: ['turn'], cwd: 'D:/work' } });
  await openHistory(node());
  assert.equal(await row(node(), 'import-comment').locator('strong').textContent(), '正在检查');
  assert.equal(await row(node(), 'import-comment').locator('li').count(), 2);
  assert.match(await row(node(), 'import-comment').locator('a').getAttribute('data-local-path'), /parser\.ts/);
  assert.equal(await row(node(), 'import-user').locator('.activity-user-message strong').textContent(), '兼容性');
  assert.doesNotMatch(await node().locator('[data-activity-history]').textContent(), /执行失败/);
  await screenshot('imported-commentary-and-steering');
  check('imported commentary renders original Markdown and file links; steering appears in order and recovered command failure does not mislabel the turn');
  await node().locator('[data-activity-history]').click();
  await node().locator('[data-activity-user-summary]').waitFor();
  assert.equal(await row(node(), 'import-user').count(), 1);
  assert.equal(await row(node(), 'import-comment').count(), 0);
  assert.equal(await row(node(), 'import-user').locator('.activity-user-message strong').textContent(), '兼容性');
  await screenshot('completed-steering-collapsed');
  await openHistory(node());
  assert.equal(await node().locator('[data-activity-user-summary]').count(), 0);
  assert.equal(await row(node(), 'import-user').count(), 1);
  check('folding completed work keeps supplementary user input visible without duplicating it on expansion');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ appUrl, checks, errors }, null, 2));
  console.log(`ACTIVITY UI PASS (${checks.length} checks)`);
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile(`${outputDir}/results.json`, JSON.stringify({ appUrl, checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
