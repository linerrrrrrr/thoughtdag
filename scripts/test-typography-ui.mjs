// Typography roles must agree across reading/editing surfaces and remain usable
// at reduced canvas detail, narrow panel widths, and translated toolbar labels.
// A fresh browser context and intercepted APIs keep this fixture fully local.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/typography';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1760, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], writes = [], checks = [], measurements = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  const request = route.request();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ method: request.method(), url: request.url() });
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
  displayName: '研究记录 Research notes',
  displaySummary: '明确问题与证据之间的关系，并保留能够复核的分析过程。',
  question: '请整理研究的主要结论，并区分事实与判断。Explain which evidence supports each conclusion.',
  response: '# 分析记录 Research notes\n\n先明确样本范围、统计口径与适用条件。State the evidence before drawing a conclusion.\n\n## 主要结论\n\n- 保留关键证据及其出处。\n- 数据缺失时明确说明。\n\n### 复核步骤\n\n检查定义与时间范围，再解释结论。',
};
const node = () => page.locator('.react-flow__node[data-id="type-a"]');
const reader = () => page.locator('[data-focus-panel]');
const item = name => page.locator(`[data-${name}]`);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const check = label => { checks.push(label); console.log('PASS', label); };
const patch = async data => {
  await page.evaluate(data => window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === 'type-a'
    ? { ...node, data: { ...node.data, ...data } } : node) })), data);
  await settle();
};
const zoom = async value => {
  await page.evaluate(value => window.__rf.setViewport({ x: 100, y: 140, zoom: value }, { duration: 0 }), value);
  await settle();
  await page.waitForFunction(value => Math.abs(window.__rf.getZoom() - value) < .001
    && Math.abs(parseFloat(getComputedStyle(document.querySelector('.react-flow')).getPropertyValue('--tdag-zoom')) - value) < .001, value);
  await settle();
};
const font = async (locator, expected, label, lineHeight) => {
  const value = await locator.first().evaluate(element => {
    const css = getComputedStyle(element);
    return { size: parseFloat(css.fontSize), lineHeight: parseFloat(css.lineHeight), weight: css.fontWeight };
  });
  measurements.push({ label, ...value });
  assert.ok(Math.abs(value.size - expected) < .05, `${label}: expected ${expected}px, got ${value.size}px`);
  if (lineHeight != null) assert.ok(Math.abs(value.lineHeight - lineHeight) < .1,
    `${label}: expected ${lineHeight}px line height, got ${value.lineHeight}px`);
};
const contained = async (locator, label) => {
  assert.equal(await locator.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `${label} has horizontal overflow`);
};
const openReader = async width => {
  await page.evaluate(width => window.__ui.setState({ panelOpen: true, panelNodeId: 'type-a', panelWidth: width }), width);
  await reader().waitFor();
  await settle();
};
const closeReader = async () => { await page.evaluate(() => window.__ui.getState().setPanelOpen(false)); await settle(); };
const screenshot = async label => { await settle(); await page.screenshot({ path: `${output}/${label}.png` }); };

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5211', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.length), 0, 'Test storage starts empty');
  await page.evaluate(fixture => {
    window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('full');
    const nodes = [{ id: 'type-a', type: 'thought', dragHandle: '.drag-handle', width: 620, height: 780,
      position: { x: 0, y: 0 }, data: { ...fixture, responses: [fixture.response], responseIndex: 0,
        detailLevel: 'full', isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        tokenCount: 300, highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', isRoot: true, isBranch: false } }];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  }, fixture);
  await node().waitFor();
  await page.waitForTimeout(350);
  await zoom(1);

  for (const lighting of ['light', 'dark']) {
    await page.evaluate(async lighting => (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting(lighting), lighting);
    for (const language of ['zh', 'en']) {
      await page.evaluate(async language => (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang(language), language);
      await openReader(380);
      const label = `${lighting}/${language}`;
      await font(node().locator('.conversation-user-message'), 16, `${label} card question`, 28);
      await font(node().locator('.conversation-answer'), 16, `${label} card answer`, 28);
      await font(reader().locator('.focus-user-message'), 16, `${label} panel question`, 28);
      await font(reader().locator('.focus-assistant-message'), 16, `${label} panel answer`, 28);
      await font(reader().locator('.focus-panel-title'), 16, `${label} panel title`, 24);
      await font(node().locator('[data-node-token-total]'), 12, `${label} token count`, 18);
      for (const [heading, size] of [['h1', 24], ['h2', 20], ['h3', 18]]) {
        await font(node().locator(`.conversation-answer ${heading}`), size, `${label} card ${heading}`);
        await font(reader().locator(`.focus-assistant-message ${heading}`), size, `${label} panel ${heading}`);
      }
      await contained(reader(), `${label} 380px panel`);
      await contained(reader().locator('.focus-user-message'), `${label} question bubble`);
      await contained(reader().locator('.focus-assistant-message'), `${label} answer`);
      await screenshot(`${lighting}-${language}-panel-380`);
      await closeReader();
    }
  }
  check('Chinese/English, light/dark: full cards and 380px readers share 16px/28px prose, 12px metadata and the same Markdown hierarchy');

  for (const surface of ['card', 'panel']) {
    if (surface === 'panel') await openReader(380);
    const scope = surface === 'card' ? node() : reader();
    await scope.locator('[data-edit-question]').click();
    const questionInput = scope.locator(surface === 'card' ? '[data-canvas-question-editor]' : '[data-conversation-question] textarea');
    await font(questionInput, 16, `${surface} question editor`, 28);
    await contained(questionInput, `${surface} question editor`);
    await questionInput.press('Escape');
    await questionInput.waitFor({ state: 'detached' });
    await scope.locator('[data-edit-response]').scrollIntoViewIfNeeded();
    await scope.locator('[data-edit-response]').click();
    const answerInput = scope.locator(surface === 'card' ? '[data-canvas-response-editor]' : '[data-conversation-answer] textarea');
    await font(answerInput, 16, `${surface} answer editor`, 28);
    await contained(answerInput, `${surface} answer editor`);
    await answerInput.press('Escape');
    await answerInput.waitFor({ state: 'detached' });
    await scope.locator('[data-node-metadata-toggle]').click();
    await font(scope.locator('[data-node-title-input]'), 16, `${surface} metadata title`, 24);
    await font(scope.locator('[data-node-summary-input]'), 16, `${surface} summary editor`, 28);
    await font(scope.locator('[data-node-metadata-save]'), 14, `${surface} metadata save`);
    await scope.locator('[data-node-metadata-cancel]').click();
    if (surface === 'panel') await closeReader();
  }
  assert.deepEqual(await page.evaluate(() => {
    const { question, response } = window.__store.getState().nodes[0].data;
    return { question, response };
  }), { question: fixture.question, response: fixture.response });
  check('Question, answer and summary editing keep the reading scale; Escape leaves saved content untouched');

  await patch({ detailLevel: 'summary' });
  await zoom(.6);
  await page.waitForFunction(() => {
    const name = document.querySelector('.node-summary-name');
    return name && Math.abs(window.__rf.getZoom() - .6) < .001 && Math.abs(parseFloat(getComputedStyle(name).fontSize) * .6 - 16) < .1;
  });
  const summarySizes = await node().evaluate(element => ({
    zoom: window.__rf.getZoom(),
    cssZoom: getComputedStyle(element).getPropertyValue('--tdag-zoom'),
    name: parseFloat(getComputedStyle(element.querySelector('.node-summary-name')).fontSize) * .6,
    preview: parseFloat(getComputedStyle(element.querySelector('.node-summary-text')).fontSize) * .6,
  }));
  assert.ok(Math.abs(summarySizes.name - 16) < .1, JSON.stringify(summarySizes));
  assert.ok(Math.abs(summarySizes.preview - 14) < .1, JSON.stringify(summarySizes));
  await screenshot('summary-60-percent');
  await patch({ detailLevel: 'compact' });
  await zoom(.3);
  await page.waitForFunction(() => {
    const name = document.querySelector('.node-overview--compact .node-overview-name');
    return name && Math.abs(window.__rf.getZoom() - .3) < .001 && Math.abs(parseFloat(getComputedStyle(name).fontSize) * .3 - 12) < .1;
  });
  const compact = await node().locator('.node-overview-name').evaluate(element => ({
    font: getComputedStyle(element).fontSize,
    scale: getComputedStyle(element).getPropertyValue('--overview-scale'),
    cssZoom: getComputedStyle(element).getPropertyValue('--tdag-zoom'),
    zoom: window.__rf.getZoom(),
  }));
  measurements.push({ label: 'summary at 60%', ...summarySizes }, { label: 'compact at 30%', ...compact });
  assert.ok(Math.abs(compact.zoom - .3) < .001);
  assert.ok(Math.abs(parseFloat(compact.font) * compact.zoom - 12) < .1, `Compact name screen size: ${JSON.stringify(compact)}`);
  await screenshot('compact-30-percent');
  check('Summary and compact names retain bounded screen-space typography at 60% and 30% zoom');
  await patch({ detailLevel: 'full' });
  await zoom(1);

  for (const language of ['zh', 'en']) {
    await page.evaluate(async language => (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang(language), language);
    for (const width of [1760, 1024, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.waitForTimeout(280);
      const geometry = await page.evaluate(() => {
        const rect = selector => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        };
        return { left: rect('[data-project-switcher]'), right: rect('[data-top-toolbar]'),
          available: rect('[data-canvas-header]'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(geometry.overflow, false, `${language}/${width}: document overflow`);
      assert.ok(geometry.left.right + 7 <= geometry.right.left, `${language}/${width}: toolbar groups overlap`);
      assert.ok(geometry.right.right <= geometry.available.right + 1, `${language}/${width}: toolbar extends beyond available space`);
      await item('toolbar-more').click();
      await font(item('layout-entry'), 14, `${language}/${width} menu action`);
      await contained(item('toolbar-more-panel'), `${language}/${width} menu`);
      await page.keyboard.press('Escape');
      if (width === 390) await screenshot(`${language}-toolbar-390`);
    }
  }
  check('14px menu actions remain usable in both languages across 1760, 1024, 760, 390 and 320px windows');
  assert.deepEqual(errors, [], 'No runtime errors');
  assert.deepEqual(writes, [], 'Typography, editing dismissal and navigation do not issue API writes');
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, measurements, errors, writes }, null, 2));
  console.log(`PASS ${checks.length} typography groups; screenshots and measurements in ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, measurements, errors, writes, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
