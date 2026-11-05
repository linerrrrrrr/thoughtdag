// Deterministic workbench flow: actual store/dispatch/rendering, a local bridge fixture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = 'local-tests/codex-workbench';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1720, height: 1080 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (new URL(route.request().url()).pathname.endsWith('/models')) return route.fulfill({ json: { models: [{ id: 'api/fixture', name: 'API fixture', provider: 'api' }], default: 'api/fixture' } });
  return route.fulfill({ json: { text: '{"title":"检查工作区","summary":"已核对构建与执行过程。"}', sessions: [], providers: [], items: [], topics: [], hits: [] } });
});
await page.addInitScript(() => {
  for (const [key, value] of Object.entries({ seeded: 'yes', tutorialDone: '1', autoRefreshPaused: 'yes', lighting: 'dark', lang: 'zh' })) localStorage.setItem(`thoughtdag.${key}`, value);
  window.__calls = [];
  window.__runs = 0;
  window.__event = () => {};
  window.desktopAgents = {
    capabilities: { nativePicker: false },
    models: async runtime => ({ installed: runtime === 'codex', default: 'codex/fixture', models: runtime === 'codex' ? [{ provider: 'codex', id: 'fixture', name: 'Fixture', vision: true, efforts: ['low', 'high'], defaultEffort: 'high' }] : [] }),
    available: async () => ({ codex: 'codex' }),
    workspace: async () => 'D:/fixture',
    guardWrite: async (...args) => { window.__calls.push({ type: 'guard', args }); return true; },
    writeMaterials: async () => ({ dir: null, written: [] }),
    onEvent: callback => { window.__event = callback; },
    run: async request => {
      const runId = `run-${++window.__runs}`;
      window.__calls.push({ type: 'run', request, runId });
      setTimeout(() => {
        window.__event({ runId, event: { type: 'session', sessionId: '00000000-1111-2222-3333-444444444444', cwd: request.cwd } });
        window.__event({ runId, event: { type: 'activity', item: { id: 'live-note', kind: 'commentary', text: '正在核对 [配置文件](D:/fixture/src/config.ts:12)。', status: 'completed', startedAt: Date.now() } } });
      }, 30);
      return runId;
    },
    steer: async (runId, prompt) => {
      window.__calls.push({ type: 'steer', runId, prompt });
      if (window.__holdSteer) await new Promise(resolve => { window.__resolveSteer = resolve; });
      if (window.__rejectSteer) return false;
      window.__event({ runId, event: { type: 'activity', item: { id: `steer-${window.__calls.length}`, kind: 'user', status: 'completed', text: prompt, startedAt: Date.now() } } });
      return true;
    },
    abort: async runId => { window.__calls.push({ type: 'abort', runId }); return true; },
    answer: async (runId, id, answer) => { window.__calls.push({ type: 'answer', runId, id, answer }); return true; },
  };
  window.desktopSessions = { roots: async () => [], list: async () => [], watchStart: async () => true, onSessionsChanged: () => {} };
  window.desktopLocal = { open: async path => ({ ok: true, path }), reveal: async () => ({ ok: true }), read: async path => ({ ok: true, path, text: 'export const enabled = true;\n'.repeat(30), truncated: false }) };
});
const check = name => { checks.push(name); console.log('PASS', name); };
const panel = () => page.locator('[data-focus-panel]');
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const instruction = () => page.locator('[data-agent-instruction]');
const instructionInput = () => page.locator('[data-agent-instruction-input]');
const openInstruction = async () => {
  await panel().getByRole('button', { name: '更多操作', exact: true }).click();
  await panel().locator('[data-agent-instruction-trigger]').click();
  await instructionInput().waitFor();
};
const calls = type => page.evaluate(type => window.__calls.filter(call => call.type === type), type);
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5186', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated());
  await page.evaluate(async () => {
    // Follow Vite's exact module identity after HMR instead of creating a
    // second Zustand store by importing the unversioned module URL.
    const projectsUrl = performance.getEntriesByType('resource').map(r => r.name).find(url => new URL(url).pathname === '/src/store/projects.ts') ?? '/src/store/projects.ts';
    const { useProjects, bootProjects } = await import(projectsUrl);
    await bootProjects();
    window.__projects = useProjects;
    useProjects.setState({ activeId: 'workbench', projects: [{ id: 'workbench', name: 'Workbench', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceSession: { runner: 'codex', sessionId: '00000000-1111-2222-3333-444444444444', importedCount: 1, tailNodeId: 'source' } }] });
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    useUiStore.setState({ selectedModel: 'api/fixture', panelOpen: true, panelNodeId: 'source', panelWidth: 560, recallEnabled: false });
    const question = '检查项目的类型错误，并说明修复结果。';
    const response = '已完成修复。可以查看 [配置文件](D:/fixture/src/config.ts:12) 与 [变更说明](./README.md)。';
    const activity = [
      { id: 'note-1', kind: 'commentary', status: 'completed', text: '我先检查 [配置文件](D:/fixture/src/config.ts:12)，再核对构建结果。', startedAt: 1 },
      { id: 'cmd-1', kind: 'command', status: 'completed', command: 'npm run build', cwd: 'D:/fixture', output: 'Type check passed.\nBuild completed.', exitCode: 0, durationMs: 1520, startedAt: 2 },
      { id: 'note-2', kind: 'commentary', status: 'completed', text: '类型检查已通过，正在确认变更范围。', startedAt: 3 },
    ];
    window.__store.getState().setNodes([{ id: 'source', type: 'thought', dragHandle: '.drag-handle', position: { x: 0, y: 0 }, width: 670, data: {
      question, response, responses: [response], questions: [question], responseIndex: 0, isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 300, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: true,
      importSource: { runner: 'codex', sessionId: '00000000-1111-2222-3333-444444444444', itemIds: ['user-1', 'final-1'], cwd: 'D:/fixture' }, source: { question, response }, agentActivities: [activity], detailLevel: 'full',
    } }]);
    window.__store.getState().setEdges([]);
    window.__store.setState({ selectedNodeId: 'source' });
    window.__rf.setViewport({ x: 70, y: 110, zoom: 1 }, { duration: 0 });
  });
  await panel().waitFor();
  for (const surface of [node('source'), panel()]) {
    assert.equal(await surface.locator('textarea, [data-inline-followup], [data-panel-composer], [data-agent-composer-bar]').count(), 0);
  }
  assert.equal(await panel().locator('[data-agent-stop]').count(), 0);
  await panel().getByRole('button', { name: '更多操作', exact: true }).click();
  assert.equal(await panel().locator('[data-agent-instruction-trigger]').count(), 0);
  await page.keyboard.press('Escape');
  check('completed cards and reading panels contain no follow-up composer, settings, or active-run controls');

  await panel().locator('[data-activity-history]').click();
  assert.equal(await panel().locator('[data-activity-kind="commentary"]').count(), 2);
  assert.ok(await panel().locator('[data-activity-kind="commentary"] a[data-local-path]').count());
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rf.setViewport({ x: 70, y: 170, zoom: 1 }, { duration: 0 }));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${output}/dark-workbench.png` });
  check('history preserves ordered commentary and clickable local file links');

  await panel().locator('[data-node-details-close]').click();
  await page.evaluate(() => window.__rf.setViewport({ x: 70, y: 90, zoom: .75 }, { duration: 0 }));
  const handle = await node('source').locator('[data-connection-role="source"][data-connection-side="bottom"]').boundingBox();
  assert.ok(handle, 'The completed source keeps its output connection handle');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(80, Math.max(handle.y + 140, 650), { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__store.getState().nodes.length === 2);
  const childId = await page.evaluate(() => window.__store.getState().nodes.find(node => node.id !== 'source').id);
  const draftState = await page.evaluate(id => ({ node: window.__store.getState().nodes.find(node => node.id === id).data,
    edge: window.__store.getState().edges.find(edge => edge.target === id) }), childId);
  assert.equal(draftState.node.question, '');
  assert.equal(draftState.node.response, '');
  assert.equal(draftState.node.isLoading, false);
  assert.equal(draftState.edge.source, 'source');
  assert.match(draftState.node.model, /^codex\//);
  assert.equal((await calls('run')).length, 0, 'Dragging a continuation creates a draft without dispatching');
  const questionInput = node(childId).locator('[data-canvas-question-editor]');
  await questionInput.waitFor();
  assert.equal(await questionInput.inputValue(), '');
  await questionInput.fill('请继续检查测试失败的原因。');
  await node(childId).locator('[data-ask-submit]').click();
  await page.waitForFunction(() => window.__calls.some(call => call.type === 'run'));
  const request = (await calls('run'))[0].request;
  assert.equal(request.runtime, 'codex');
  assert.equal(request.cwd, 'D:/fixture');
  assert.equal(request.sessionPath, '00000000-1111-2222-3333-444444444444');
  assert.equal(request.prompt, '请继续检查测试失败的原因。', 'Native continuation sends only the new question');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.length), 2, 'Sending fills the draft node rather than creating a third card');
  await node(childId).locator('[data-node-details]').click();
  await panel().locator('[data-activity-id="live-note"]').waitFor();
  const geometry = await page.evaluate(id => {
    const nodes = window.__rf.getNodes();
    const source = nodes.find(node => node.id === 'source'), child = nodes.find(node => node.id === id);
    return { sourceBottom: source.position.y + (source.measured?.height ?? source.height), childTop: child.position.y };
  }, childId);
  assert.ok(geometry.childTop >= geometry.sourceBottom - 1, `Source and child cards do not overlap: ${JSON.stringify(geometry)}`);
  assert.equal(await panel().locator('textarea, [data-panel-composer], [data-agent-composer-bar]').count(), 0);
  check('dragging a connection creates an empty child; explicit send preserves the source runtime, native session and working directory');

  await openInstruction();
  await instructionInput().fill('尚未发送的运行指令');
  await panel().locator('[data-reading-node-name]').click();
  await instruction().waitFor({ state: 'detached' });
  assert.equal((await calls('steer')).length, 0);
  await openInstruction();
  assert.equal(await instructionInput().inputValue(), '尚未发送的运行指令');
  await instructionInput().press('Escape');
  await instruction().waitFor({ state: 'detached' });
  await openInstruction();
  assert.equal(await instructionInput().inputValue(), '');
  check('supplementary instructions are explicitly opened; outside dismissal keeps drafts and Escape cancels without dispatch');

  await instructionInput().fill('先只检查，不要修改文件。');
  await instruction().locator('[data-agent-instruction-send]').click();
  await page.waitForFunction(() => window.__calls.some(call => call.type === 'steer'));
  assert.equal((await calls('steer'))[0].prompt, '先只检查，不要修改文件。');
  await instruction().waitFor({ state: 'detached' });
  await panel().locator('[data-activity-kind="user"]').waitFor();
  assert.equal(await panel().locator('[data-conversation-question]').innerText().then(text => text.includes('先只检查')), false,
    'Supplementary instruction appears once in its chronological position');
  await page.evaluate(() => { window.__rejectSteer = true; });
  await openInstruction();
  await instructionInput().fill('保留未发送的补充要求');
  await instruction().locator('[data-agent-instruction-send]').click();
  await instruction().getByRole('alert').waitFor();
  assert.equal(await instructionInput().inputValue(), '保留未发送的补充要求');
  check('active turns accept explicit instructions; a rejected request keeps its draft');

  await page.evaluate(() => { window.__rejectSteer = false; window.__holdSteer = true; });
  await instructionInput().fill('补充检查边界情况');
  await instruction().locator('[data-agent-instruction-send]').click();
  await page.waitForFunction(() => typeof window.__resolveSteer === 'function');
  await instructionInput().fill('这是发送期间新写的草稿');
  await page.evaluate(() => window.__resolveSteer());
  await page.waitForFunction(() => window.__store.getState().nodes.some(node => node.data.question.includes('补充检查边界情况')));
  assert.equal(await instructionInput().inputValue(), '这是发送期间新写的草稿');
  check('a delayed acknowledgement preserves newer typing');
  await page.evaluate(() => { window.__rf.setViewport({ x: 180, y: 90, zoom: .72 }, { duration: 0 }); window.__ui.setState({ toasts: [] }); });
  await page.screenshot({ path: `${output}/dark-running.png` });
  await panel().locator('[data-agent-stop]').click();
  await page.waitForFunction(() => window.__calls.some(call => call.type === 'abort'));
  await page.waitForFunction(() => !window.__store.getState().nodes.some(node => node.data.isLoading));
  await instruction().waitFor({ state: 'detached' });
  assert.equal(await panel().locator('textarea, [data-agent-stop]').count(), 0);
  assert.ok(await panel().locator('[data-activity-kind="user"]').count(), 'Completed collapsed process retains user instructions');
  check('header Stop reaches the active runtime and removes temporary execution controls');
  await page.evaluate(async () => {
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    window.__ui.setState({ panelWidth: 380 });
  });
  await page.waitForFunction(() => Math.abs(document.querySelector('[data-focus-panel]').getBoundingClientRect().width - 380) < 1);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${output}/light-panel-380.png` });
  assert.equal(await panel().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  assert.equal(errors.length, 0, errors.join('\n'));
  check('narrow light panel stays usable and produces no page errors');
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  console.error('PAGE ERRORS', errors);
  console.error('STATE', await page.evaluate(async () => ({ nodes: window.__store?.getState().nodes.map(n => n.id), selected: window.__store?.getState().selectedNodeId, panel: (await import('/src/lib/ui-store.ts')).useUiStore.getState().panelOpen,
    projects: JSON.stringify(window.__projects?.getState()),
    source: JSON.stringify(window.__store?.getState().nodes.find(n => n.id === 'source')?.data),
    route: await (await import('/src/lib/agents/agent-runtime.ts')).previewAgentFollowup('source', 'codex/codex/default'),
  })));
  throw error;
} finally { await browser.close(); }
