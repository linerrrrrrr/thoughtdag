// Conversation GUI regression and matched before/after captures.
// BASELINE=1 only captures the incumbent layout. All requests use local fixtures.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseline = process.env.BASELINE === '1';
const output = `local-tests/conversation-gui/${baseline ? 'before' : 'after'}`;
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1760, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  const request = route.request(), url = new URL(request.url());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ method: request.method(), path: url.pathname });
  if (url.pathname === '/api/models') return route.fulfill({ json: {
    models: [{ id: 'test/gui', name: 'Local fixture', provider: 'test', vision: false }], default: 'test/gui',
  } });
  if (url.pathname === '/api/claude') return route.fulfill({ json: {
    text: JSON.stringify({ title: '研究节点的组织方式', summary: '主线推进问题，分支探索局部疑问，材料引用提供可核查依据。' }), model: 'test/gui',
  } });
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [], items: [], hits: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lighting', 'light');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

const fixture = {
  title: '研究问题如何长成思维图',
  summary: '用主线保留推理顺序，用分支展开局部疑问，并通过材料引用追溯结论依据。',
  question: '我想把一次研究拆成可继续追问的节点。请说明主线、分支和材料引用各自承担什么角色，并给一个三步工作流。',
  response: `可以先把研究组织成一条清楚的主线，再从需要验证的结论处分出支线。每个节点保留一轮完整问答，连接表示后续问题会接收哪些上下文。

## 三种关系，各有职责

- **主线**：记录问题如何一步步得到回答，适合从定义、证据走向结论。
- **分支**：围绕某段回答继续追问，保留出处，也允许探索不同假设。
- **材料引用**：连接笔记、文档或网页，让判断能回到原始依据。

## 一个可复用的三步工作流

1. 收集材料，先确认研究对象、时间范围和不能省略的约束。
2. 提出一个边界明确的问题，把支持结论的材料接入节点。
3. 阅读回答后，将需要补证或存在分歧的部分拆为分支，最后回到主线综合。

\`\`\`ts
const research = {
  question: "How does the evidence support the conclusion?",
  materialIds: ["annual-report", "interview-notes", "source-table"],
  nextStep: "Verify assumptions before combining the branches",
};
\`\`\`

### 阅读时关注什么

先看问题是否清楚，再看回答是否给出了支持它的依据。如果两条分支得出不同结论，保留差异及其条件，避免过早合并。

> 节点名称用于快速定位；摘要帮助理解要点；完整问答保留推理细节。

材料不完整时，应明确写出缺失部分。后续补充证据后，可以重新生成回答并比较版本，而不是把旧结论直接当作事实。`,
};
const node = () => page.locator('.react-flow__node[data-id="conversation-a"]');
const reader = () => page.locator('[data-focus-panel]');
const editor = () => node().locator('[data-node-metadata-editor]');
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const check = name => { checks.push(name); console.log('PASS', name); };
const patch = async values => {
  await page.evaluate(values => window.__store.setState(state => ({ nodes: state.nodes.map(item => item.id === 'conversation-a'
    ? { ...item, ...values.node, data: { ...item.data, ...values.data } } : item) })), values);
  await settle();
};
const detail = value => patch({ data: { detailLevel: value } });
const openMetadata = async () => { await node().locator('[data-node-metadata-toggle]').click(); await editor().waitFor(); };
const closeMetadata = async () => { await node().locator('[data-node-metadata-cancel]').click(); await editor().waitFor({ state: 'detached' }); };
const openPanel = async () => { await node().locator('[data-node-details]').click(); await reader().waitFor(); };
const closePanel = async () => { if (await reader().count()) await reader().locator('[data-node-details-close]').click(); };
const lighting = value => page.evaluate(async value => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting(value), value);
const language = value => page.evaluate(async value => (await import('/src/i18n/index.ts')).useI18n.getState().setLang(value), value);
const screenshot = async name => { await settle(); await page.screenshot({ path: `${output}/${name}.png` }); };
const saved = () => page.evaluate(() => window.__store.getState().nodes.find(item => item.id === 'conversation-a').data);
const assertWithin = async (child, parent, message) => {
  const c = await child.boundingBox(), p = await parent.boundingBox();
  assert.ok(c && p && c.x >= p.x - 1 && c.y >= p.y - 1 && c.x + c.width <= p.x + p.width + 1 && c.y + c.height <= p.y + p.height + 1,
    `${message}: ${JSON.stringify({ child: c, parent: p })}`);
};
const assertClickable = async (target, label) => {
  await target.scrollIntoViewIfNeeded();
  assert.equal(await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !!hit && (hit === element || element.contains(hit));
  }), true, `${label} is covered or clipped`);
};
const assertConversation = async surface => {
  const question = surface.locator('[data-conversation-question]').first();
  const bubble = surface.locator('[data-conversation-user-message], .conversation-user-message').first();
  const answer = surface.locator('[data-conversation-answer]').first();
  assert.equal(await question.count(), 1);
  assert.equal(await bubble.count(), 1);
  assert.equal(await answer.count(), 1);
  const q = await question.boundingBox(), b = await bubble.boundingBox();
  assert.ok(q && b && b.x >= q.x && b.x + b.width <= q.x + q.width + 1);
  const bubbleStyle = await bubble.evaluate(element => {
    const css = getComputedStyle(element); return { background: css.backgroundColor, radius: css.borderTopLeftRadius };
  });
  assert.notEqual(bubbleStyle.background, 'rgba(0, 0, 0, 0)', 'The user message has its own bubble surface');
  assert.ok(parseFloat(bubbleStyle.radius) > 0);
  assert.equal(await answer.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Assistant prose is unboxed');
};

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5200', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.length), 0);
  await page.evaluate(fixture => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setPanelWidth(620);
    window.__ui.getState().setCanvasDetail('full');
    const nodes = [{ id: 'conversation-a', type: 'thought', dragHandle: '.drag-handle', width: 650, height: 790, position: { x: 0, y: 0 }, data: {
      displayName: fixture.title, displaySummary: fixture.summary, question: fixture.question, response: fixture.response,
      responses: [fixture.response], responseIndex: 0, detailLevel: 'full', isCollapsed: false,
      isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 735, highlights: [], highlightMode: 'tag',
      attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false,
    } }];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  }, fixture);
  await node().waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 160, zoom: 1 }, { duration: 0 }));
  await screenshot('light-card');
  await openPanel();
  await screenshot('light-card-panel');
  await page.evaluate(() => window.__ui.getState().setPanelWidth(380));
  await screenshot('light-panel-380');
  await reader().locator('.focus-panel-content').evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
  await screenshot('light-panel-380-code');
  await closePanel();
  await detail('summary');
  await screenshot('light-summary');
  if (!baseline) {
    await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 160, zoom: .6 }, { duration: 0 }));
    await settle();
    const screenFonts = await node().evaluate(element => ({
      title: parseFloat(getComputedStyle(element.querySelector('.node-summary-name')).fontSize) * .6,
      summary: parseFloat(getComputedStyle(element.querySelector('.node-summary-text')).fontSize) * .6,
    }));
    assert.ok(Math.abs(screenFonts.title - 16) < .1, `Summary title remains 16px on screen: ${screenFonts.title}`);
    assert.ok(Math.abs(screenFonts.summary - 14) < .1, `Summary remains 14px on screen: ${screenFonts.summary}`);
    await screenshot('light-summary-60-percent');
    await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 160, zoom: 1 }, { duration: 0 }));
    await settle();
    check('Summary typography compensates at 60% zoom to remain readable at 16px/14px');
  }
  await detail('full');
  await openMetadata();
  await screenshot('light-metadata');
  await closeMetadata();
  await lighting('dark');
  await screenshot('dark-card');
  await openPanel();
  await page.evaluate(() => window.__ui.getState().setPanelWidth(620));
  await screenshot('dark-card-panel');
  await closePanel();
  await patch({ node: { width: 360, height: 240 } });
  await screenshot('dark-node-360x240');
  await openMetadata();
  await screenshot('dark-node-360-metadata');
  await closeMetadata();
  await language('en');
  await patch({ node: { width: 650, height: 790 } });
  await openPanel();
  await page.evaluate(() => window.__ui.getState().setPanelWidth(380));
  await screenshot('dark-english-panel-380');
  await closePanel();
  await lighting('light');
  await openMetadata();
  await screenshot('light-english-metadata');
  await closeMetadata();
  assert.deepEqual(writes, [], 'Reading, resizing and metadata disclosure never call APIs');
  assert.deepEqual(errors, []);
  check('Matched light/dark, English, overview, metadata, 380px panel and 360x240 node captures');

  if (!baseline) {
    await language('zh');
    await assertConversation(node());
    await openPanel();
    await assertConversation(reader());
    for (const surface of [node(), reader()]) {
      assert.equal(await surface.locator('textarea, [data-inline-followup], [data-panel-composer], [data-agent-composer-bar]').count(), 0,
        'An answered conversation has no follow-up field or composer settings');
    }
    const contentBox = await reader().locator('.focus-panel-content').boundingBox(), panelBox = await reader().boundingBox();
    assert.ok(contentBox.y + contentBox.height >= panelBox.y + panelBox.height - 3, 'Reading content fills the space below the header');
    await assertClickable(reader().locator('[data-node-details-close]'), 'Panel close');
    await closePanel();
    await openPanel();
    assert.equal(await reader().locator('textarea').count(), 0, 'Reopening an answered node keeps a reading-only surface');
    await closePanel();
    check('Card and panel use user bubbles and plain assistant prose; completed conversations contain no composer');

    await openMetadata();
    await node().locator('[data-node-title-input]').fill('跨画布与侧栏保留的名称草稿');
    await node().locator('[data-node-summary-input]').fill('跨界面共享的摘要草稿。');
    await node().locator('[data-node-metadata-toggle]').click();
    await openPanel();
    await reader().locator('[data-node-metadata-toggle]').click();
    assert.equal(await reader().locator('[data-node-title-input]').inputValue(), '跨画布与侧栏保留的名称草稿');
    assert.equal(await reader().locator('[data-node-summary-input]').inputValue(), '跨界面共享的摘要草稿。');
    for (const selector of ['[data-node-title-input]', '[data-node-summary-input]', '[data-node-metadata-save]', '[data-node-metadata-cancel]', '[data-node-metadata-generate]']) {
      await assertWithin(reader().locator(selector), reader(), `Narrow panel metadata control ${selector}`);
      await assertClickable(reader().locator(selector), `Narrow panel metadata control ${selector}`);
    }
    await screenshot('light-panel-380-metadata');
    await reader().locator('[data-node-title-input]').fill('侧栏继续修改后的名称草稿');
    await closePanel();
    await openMetadata();
    assert.equal(await node().locator('[data-node-title-input]').inputValue(), '侧栏继续修改后的名称草稿');
    assert.equal(await node().locator('[data-node-summary-input]').inputValue(), '跨界面共享的摘要草稿。');
    await closeMetadata();
    assert.equal((await saved()).displayName, fixture.title);
    assert.equal((await saved()).displaySummary, fixture.summary);
    check('Metadata drafts move between the card and reading panel without implicit saves');

    const before = await page.evaluate(() => window.__store.getState().nodes[0].position);
    const header = await node().locator('.thought-node-header').boundingBox();
    await page.mouse.move(header.x + header.width * .6, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(header.x + header.width * .6 + 60, header.y + header.height / 2 + 30, { steps: 10 });
    await page.mouse.up();
    const after = await page.evaluate(() => window.__store.getState().nodes[0].position);
    assert.ok(after.x > before.x + 40 && after.y > before.y + 15, 'The header still drags the card');
    await patch({ node: { width: 360, height: 240, position: { x: 0, y: 0 } } });
    assert.equal(await node().locator('textarea, [data-inline-followup], [data-agent-composer-bar]').count(), 0,
      'A short answered card does not add a follow-up field');
    await openMetadata();
    assert.equal(await page.evaluate(() => window.__store.getState().nodes[0].height), 240);
    for (const selector of ['[data-node-title-input]', '[data-node-summary-input]', '[data-node-metadata-save]', '[data-node-metadata-cancel]', '[data-node-metadata-generate]']) {
      await assertWithin(node().locator(selector), editor(), `Narrow metadata control ${selector}`);
      await assertClickable(node().locator(selector), `Narrow metadata control ${selector}`);
    }
    await node().locator('[data-node-title-input]').fill('新的研究名称');
    await node().locator('[data-node-summary-input]').fill('新的研究摘要保留完整结论。');
    await node().locator('[data-node-metadata-save]').click();
    assert.equal((await saved()).displayName, '新的研究名称');
    assert.equal((await saved()).displaySummary, '新的研究摘要保留完整结论。');
    assert.equal((await saved()).question, fixture.question);
    assert.equal((await saved()).response, fixture.response);
    await detail('summary');
    assert.ok((await node().innerText()).includes('新的研究名称'));
    assert.ok((await node().innerText()).includes('新的研究摘要保留完整结论。'));
    await openMetadata();
    const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/claude');
    await node().locator('[data-node-metadata-generate]').click();
    await request;
    await page.waitForFunction(() => document.querySelector('[data-node-title-input]')?.value === '研究节点的组织方式');
    assert.equal((await saved()).displayName, '新的研究名称');
    await node().locator('[data-node-metadata-save]').click();
    assert.equal((await saved()).displayName, '研究节点的组织方式');
    check('Header drag, clean short cards, narrow metadata editing, overview and explicit AI drafts preserve their functions');

    await detail('full');
    await patch({ node: { width: 650, height: 790 } });
    await openPanel();
    const responseEdit = reader().locator('[data-edit-response]');
    await assertClickable(responseEdit, 'Panel answer edit');
    await responseEdit.click();
    const responseInput = reader().locator('[data-conversation-answer] textarea');
    await responseInput.fill(fixture.response + '\n\n补充：明确区分事实与判断。');
    await reader().getByRole('button', { name: '保存', exact: true }).click();
    assert.ok((await saved()).response.endsWith('补充：明确区分事实与判断。'));
    await reader().locator('.focus-panel-content').evaluate(element => { element.scrollTop = 0; });
    const questionEdit = reader().locator('[data-edit-question]');
    await questionEdit.click();
    const questionInput = reader().locator('[data-conversation-question] textarea');
    await questionInput.fill('尚未提交的问题修订');
    await questionInput.press('Escape');
    assert.equal((await saved()).question, fixture.question);
    assert.equal(await reader().count(), 1, 'Escape cancels the editor before closing the panel');
    assert.equal(await reader().locator('textarea, [data-panel-composer], [data-agent-composer-bar]').count(), 0,
      'Closing revision returns to an uncluttered reading surface');
    assert.equal(await reader().evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(writes, [{ method: 'POST', path: '/api/claude' }], 'Only explicit AI metadata fill calls the API');
    assert.deepEqual(errors, []);
    check('Panel answer edit saves, question Escape cancels only the editor, and long content does not overflow the panel');

    const passage = '保留差异及其条件，避免过早合并。';
    await patch({ data: { highlights: [{ id: 'explore-fixture', text: passage, createdAt: new Date().toISOString() }] } });
    await reader().locator('details').filter({ has: page.locator('[data-highlight-explore]') }).locator('summary').click();
    await reader().locator('[data-highlight-explore]').click();
    await page.waitForFunction(() => window.__store.getState().nodes.length === 2 && window.__ui.getState().panelNodeId !== 'conversation-a');
    const child = await page.evaluate(() => window.__store.getState().nodes.find(node => node.id === window.__ui.getState().panelNodeId));
    assert.equal(child.data.question, '');
    assert.equal(child.data.response, '');
    assert.equal(child.data.isLoading, false);
    assert.equal(child.data.branchContext, passage);
    assert.equal(await reader().locator('[data-conversation-question] textarea').inputValue(), '');
    assert.equal(await page.locator('[data-highlight-explore-editor], [data-panel-composer], [data-inline-followup]').count(), 0);
    assert.equal(await page.evaluate(id => window.__store.getState().edges.some(edge => edge.source === 'conversation-a' && edge.target === id && edge.data?.isBranchFromSelection), child.id), true);
    assert.equal((await saved()).isEditing, false);
    assert.deepEqual(writes, [{ method: 'POST', path: '/api/claude' }], 'Exploring a highlight creates a draft without a model call');
    await screenshot('light-highlight-new-node');
    check('Highlight exploration creates a linked empty question node and never adds an input to the answered parent');
  }
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ baseline, checks, errors, writes }, null, 2));
  await context.close();
  await browser.close();
}
