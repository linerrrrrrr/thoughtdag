// Ordinary conversation nodes derive their start state from connections.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const output = 'local-tests/chat-node-model';
await mkdir(output, { recursive: true });
const checks = [], errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [], items: [], hits: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.canvasDetail', 'full');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const check = name => { checks.push(name); console.log('PASS', name); };
const card = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setCanvasDetail('full');
    const base = { response: 'A single editable answer.', responses: ['A single editable answer.'], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 20, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [],
      includedAttachmentIds: [], roleMode: 'inherit', detailLevel: 'full' };
    const nodes = [
      { id: 'turn-a', type: 'thought', position: { x: 70, y: 140 }, width: 470, data: { ...base, question: '第一轮问题', displayName: '对话起点' } },
      { id: 'turn-b', type: 'thought', position: { x: 640, y: 140 }, width: 470, data: { ...base, question: '继续讨论', displayName: '普通问答' } },
      { id: 'material', type: 'thought', position: { x: 1200, y: 650 }, data: { ...base, response: '', responses: [], stepKind: 'note', question: 'Selected evidence stays visible.\n\nThe next paragraph supplies context.' } },
    ];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  await card('turn-b').locator('.root-node').waitFor();
  assert.equal(await card('turn-b').getByText('起点', { exact: true }).count(), 0);
  await page.evaluate(() => window.__store.getState().setEdges([{ id: 'a-b', source: 'turn-a', target: 'turn-b', data: {} }]));
  await card('turn-b').locator('.root-node').waitFor({ state: 'detached' });
  assert.equal(await card('turn-a').locator('.root-node').count(), 1);
  await page.evaluate(() => window.__store.getState().setEdges([{ id: 'a-b', source: 'turn-a', target: 'turn-b', data: { isCrossLink: true } }]));
  await card('turn-b').locator('.root-node').waitFor();
  await page.evaluate(() => window.__store.getState().setEdges([]));
  assert.equal(await card('turn-b').locator('.root-node').count(), 1);
  check('start styling follows structural edges without a label; references do not turn a start into a continuation');

  await page.evaluate(() => window.__ui.getState().setPanelOpen(true, 'turn-b'));
  const panel = page.locator('[data-focus-panel]');
  await panel.waitFor();
  await panel.getByRole('button', { name: '更多操作', exact: true }).click();
  const menuText = await panel.locator('.focus-panel-header-actions').innerText();
  assert.ok(!/添加视角|持续评审|自动刷新/.test(menuText));
  assert.ok(/重新生成/.test(menuText));
  await page.screenshot({ path: `${output}/menu-light-zh.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1120, height: 820 });
  await page.evaluate(async () => {
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('en');
  });
  await panel.getByRole('button', { name: 'More actions', exact: true }).click();
  assert.ok(!/Add perspectives|Keep reviewing|Auto-refresh/i.test(await panel.locator('.focus-panel-header-actions').innerText()));
  assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  await page.screenshot({ path: `${output}/menu-dark-en.png` });
  check('Chinese and English menus retain ordinary actions with no perspective or automatic review controls');

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async () => {
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setReaderMode('full');
    window.__ui.getState().setReaderNodeId('material');
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('zh');
    // Capture explicit UI submission without invoking an external model.
    window.__store.setState({ addQuestion: async (question, options) => { window.__submittedQuestion = { question, options }; } });
  });
  const reader = page.locator('[data-material-reader]');
  await reader.waitFor();
  await reader.locator('[data-reader-highlight-content]').evaluate(element => {
    const text = 'Selected evidence stays visible.';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.textContent.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + text.length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      return;
    }
    throw new Error('Selection fixture missing');
  });
  const ask = page.locator('[data-reader-askbar]');
  await ask.waitFor();
  assert.equal(await page.evaluate(() => window.__submittedQuestion), undefined);
  await ask.locator('textarea').fill('这段证据说明什么？');
  await page.screenshot({ path: `${output}/reader-explicit-quote.png` });
  await ask.locator('textarea').press('Enter');
  const submitted = await page.evaluate(() => window.__submittedQuestion);
  assert.deepEqual(submitted, { question: '> Selected evidence stays visible.\n\n这段证据说明什么？', options: { parentId: 'material' } });
  check('reader selection becomes visible quoted question content and submits only through the explicit send gesture');
  await settle();

  const legacy = await page.evaluate(() => {
    window.__ui.getState().setReaderNodeId(null);
    const base = window.__store.getState().nodes.find(node => node.id === 'turn-a');
    const nodes = [
      { ...base, id: 'legacy-a', position: { x: 70, y: 140 }, data: { ...base.data,
        question: 'Opening question', response: 'Opening answer', responses: ['Opening answer'],
        isRoot: false, isBranch: true, isEvaluator: true, autoRerun: true, autoRerunRounds: 5,
        evaluatorTrigger: 'auto', fanoutRoles: [{ name: 'Old role', prompt: 'Retired preset' }] } },
      { ...base, id: 'legacy-b', position: { x: 640, y: 140 }, data: { ...base.data,
        question: 'Follow-up question', questions: ['Follow-up question'], response: 'Existing answer', responses: ['Existing answer'],
        branchContext: 'Original selected words', isRoot: true, stepKind: 'fanout' } },
    ];
    const edges = [{ id: 'legacy-link', source: 'legacy-a', target: 'legacy-b',
      data: { isCrossLink: true, isWatch: true, followsTip: true, isBranchFromSelection: true, branchYRatio: 0.4, contextDepth: 'full' },
      style: { stroke: '#DC2626', strokeDasharray: '4 4' }, animated: true }];
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null });
    return { nodes, edges };
  });
  const retired = ['isRoot', 'isBranch', 'isEvaluator', 'branchContext', 'fanoutRoles', 'autoRerun',
    'autoRerunRounds', 'evaluatorTrigger', 'isBranchFromSelection', 'branchYRatio', 'isWatch', 'followsTip', 'contextDepth'];
  const assertClean = graph => {
    for (const record of [...graph.nodes, ...graph.edges]) {
      for (const key of retired) assert.equal(Object.hasOwn(record.data ?? {}, key), false, `${record.id} still contains ${key}`);
    }
    const followup = graph.nodes.find(node => node.id === 'legacy-b');
    assert.equal(followup.data.question, '> Original selected words\n\nFollow-up question');
    assert.deepEqual(followup.data.questions, ['> Original selected words\n\nFollow-up question']);
    assert.equal(followup.data.response, 'Existing answer');
    assert.equal(followup.data.stepKind, undefined);
    assert.equal(graph.edges[0].data.isCrossLink, true);
    assert.equal(graph.edges[0].source, 'legacy-a');
    assert.equal(graph.edges[0].target, 'legacy-b');
  };
  await page.waitForTimeout(1300);
  const stored = await page.evaluate(async () => {
    await (await import('/src/lib/persistence.ts')).flushPendingWrites();
    const options = window.__store.persist.getOptions();
    return (await options.storage.getItem(options.name)).state;
  });
  assertClean(stored);
  // Bypass partialize to emulate an old graph already on disk, then exercise
  // the application's real hydration merge by navigating to a fresh page.
  await page.evaluate(async legacy => {
    const options = window.__store.persist.getOptions();
    await options.storage.setItem(options.name, { state: legacy, version: 1 });
    await (await import('/src/lib/persistence.ts')).flushPendingWrites();
  }, legacy);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  const restored = await page.evaluate(() => ({ nodes: window.__store.getState().nodes, edges: window.__store.getState().edges }));
  assertClean(restored);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }));
  await card('legacy-a').locator('.root-node').waitFor();
  await card('legacy-b').locator('.root-node').waitFor();
  await page.evaluate(() => window.__store.getState().setEdges(window.__store.getState().edges.map(edge => ({ ...edge, data: {} }))));
  await card('legacy-b').locator('.root-node').waitFor({ state: 'detached' });
  await page.evaluate(() => window.__store.getState().setEdges(window.__store.getState().edges.map(edge => ({ ...edge, data: { isCrossLink: true } }))));
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(async () => (await import('/src/lib/export.ts')).exportActiveProjectJson());
  const download = await downloadPromise;
  const exportPath = `${output}/normalized.thoughtdag.json`;
  await download.saveAs(exportPath);
  assertClean(JSON.parse(await readFile(exportPath, 'utf8')));
  check('real persistence, hydration and JSON export strip retired settings while keeping answers, quoted passages and references');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  console.log(`PASS ${checks.length} ordinary-node UI checks; screenshots in ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
