// Verify source inspection against the real canvas in isolated storage.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const outputDir = 'local-tests/context-sources';
const captureOnly = process.env.CONTEXT_SOURCES_CAPTURE_ONLY === '1';
await mkdir(outputDir, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = [], errors = [], blockedWrites = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  blockedWrites.push(route.request().url());
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const trigger = () => page.locator('[data-context-sources-trigger="target"]');
const popover = () => page.locator('[data-context-sources-popover="target"]');
const row = id => popover().locator(`[data-context-source-edge="${id}"]`);
const snapshot = () => page.evaluate(() => {
  const state = window.__store.getState();
  return {
    nodes: state.nodes.map(({ id, position, data }) => ({ id, position, question: data.question, response: data.response })),
    edges: state.edges.map(({ id, source, target, data }) => ({ id, source, target, data })),
    selected: state.selectedNodeIds, selectedNodeId: state.selectedNodeId,
    historyIndex: state.historyIndex, historyLength: state.history.length,
  };
});
const seed = async ({ direction = 'vertical', reference = false, shared = false, lighting = 'dark', lang = 'zh', zoom = 0.85 } = {}) => {
  await page.evaluate(({ direction, reference, shared, zoom }) => {
    window.__contextInspection?.getState().close();
    window.__canvasEditing.getState().reset();
    const make = (id, x, y, name) => ({ id, type: 'thought', position: { x, y }, width: 420, height: 260,
      measured: { width: 420, height: 260 }, dragHandle: '.drag-handle', data: {
        displayName: name, question: name, response: id === 'target' ? '综合两路上下文，给出本轮讨论总结。' : '这一路内容将沿单向箭头进入下游问题。',
        responses: ['这一路内容将沿单向箭头进入下游问题。'], responseIndex: 0, summaries: [],
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 100,
        highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', isRoot: false, isBranch: false, detailLevel: 'full', layoutDirection: direction,
      } });
    const nodes = direction === 'horizontal'
      ? [make('source-a', 40, 130, '上游 A：今晚吃什么'), make('source-b', 40, 560, '上游 B：整理研究讨论'), make('target', 770, 290, '同一问题：总结我们聊了什么')]
      : [make('source-a', 80, 100, '上游 A：今晚吃什么'), make('source-b', 790, 100, '上游 B：整理研究讨论'), make('target', 80, 480, '同一问题：总结我们聊了什么')];
    if (shared) {
      nodes[1].position = { x: 560, y: -80 };
      nodes[1].width = 280; nodes[1].height = 440; nodes[1].measured = { width: 280, height: 440 };
      nodes[2].position.y = 450;
    }
    if (reference) nodes.push(make('reference', 790, 640, '参考材料：只带这一轮问答'));
    const edges = nodes.filter(node => node.id !== 'target').map((node, i) => ({
      id: `edge-${node.id}`, source: node.id, target: 'target', type: 'smoothstep',
      data: node.id === 'reference' ? { isCrossLink: true } : { contextOrder: i },
      style: { stroke: i === 1 ? '#E08A3C' : '#6B5CE7', strokeWidth: 2, ...(node.id === 'reference' ? { strokeDasharray: '8 4' } : {}) },
      markerEnd: { type: 'arrowclosed', color: i === 1 ? '#E08A3C' : '#6B5CE7', width: 18, height: 18 },
    }));
    window.__store.setState({ nodes, edges, selectedNodeId: null, selectedNodeIds: [], staleIds: [], staleFps: {}, staleVerdicts: {},
      history: [{ nodes, edges }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setPanelOpen(false); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setAutoRefreshPaused(true);
    window.__rf.setViewport({ x: 30, y: shared ? 140 : 40, zoom }, { duration: 0 });
  }, { direction, reference, shared, zoom });
  // Use the visible settings entry so Vite HMR cannot leave a second imported store.
  await page.locator('[data-toolbar-more]').click();
  await page.locator('[data-menu-language]').getByRole('button', { name: lang === 'en' ? 'English' : '中文', exact: true }).click();
  await page.locator('[data-appearance-lighting] button').nth(lighting === 'light' ? 0 : 1).click();
  await page.locator('[data-toolbar-more]').click();
  await page.waitForTimeout(650);
  await page.evaluate(({ zoom, shared }) => window.__rf.setViewport({ x: 30, y: shared ? 140 : 40, zoom }, { duration: 0 }), { zoom, shared });
  await page.waitForTimeout(180);
};
const paths = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].map(edge => ({
  id: edge.dataset.id, path: edge.querySelector('.react-flow__edge-path')?.getAttribute('d'),
})));
const assertDecorations = async () => {
  const geometry = await page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].map(edge => {
    const id = edge.dataset.id;
    const path = edge.querySelector('.react-flow__edge-path');
    const matrix = path.getScreenCTM(), length = path.getTotalLength();
    const points = Array.from({ length: 501 }, (_, i) => {
      const point = path.getPointAtLength(length * i / 500);
      return new DOMPoint(point.x, point.y).matrixTransform(matrix);
    });
    const boundsCenter = element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const arrows = [...edge.querySelectorAll('[data-edge-direction]')];
    const badge = document.querySelector(`[data-context-edge-id="${id}"][data-merge-order]`);
    const center = badge ? boundsCenter(badge) : null;
    return { id, arrowCount: arrows.length,
      arrowDistanceFromPort: arrows.length ? distance(boundsCenter(arrows[0]), points.at(-1)) : null,
      badge: center, badgeDistanceFromLine: center ? Math.min(...points.map(point => distance(point, center))) : null };
  }));
  for (const edge of geometry) {
    assert.equal(edge.arrowCount, 1, `${edge.id} must have one forward arrow`);
    assert.ok(edge.arrowDistanceFromPort > 6, `${edge.id} arrow must be distinguishable from the port`);
    if (edge.badge) assert.ok(edge.badgeDistanceFromLine < 30, `${edge.id} number must stay attached to its own route`);
  }
  const numbered = geometry.filter(edge => edge.badge);
  if (numbered.length === 2) assert.ok(Math.hypot(numbered[0].badge.x - numbered[1].badge.x,
    numbered[0].badge.y - numbered[1].badge.y) > 25, 'order numbers must not stack at the shared port');
};
const assertFits = async () => {
  const bounds = await popover().boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1
    && bounds.y + bounds.height <= viewport.height + 1, `popover must fit viewport: ${JSON.stringify(bounds)}`);
};
const capture = async name => {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outputDir}/${name}.png` });
};

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5187', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rf && window.__store?.persist.hasHydrated() && window.__canvasEditing && window.__contextInspection);
  if (captureOnly) {
    await seed({ shared: true });
    await trigger().click();
    await row('edge-source-b').hover();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${outputDir}/shared-port-detail.png`, clip: { x: 80, y: 60, width: 690, height: 720 } });
  } else {
  await seed();
  assert.match(await trigger().innerText(), /2/);
  assert.equal(await page.locator('[data-merge-order]').count(), 0);
  await capture('dark-default');
  check('default canvas keeps both single-direction connections without loose order numbers');

  const beforeInspect = await snapshot();
  const beforePaths = await paths();
  await trigger().click();
  await popover().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-merge-order]').length === 2);
  assert.deepEqual(await snapshot(), beforeInspect, 'opening inspection must not mutate selection, graph or history');
  assert.deepEqual(await paths(), beforePaths, 'inspection must not change edge routing');
  await assertFits();
  await assertDecorations();
  await row('edge-source-b').hover();
  await page.waitForFunction(() => window.__contextInspection.getState().activeEdgeId === 'edge-source-b');
  assert.equal(await page.locator('[data-context-edge-active]').count(), 1);
  assert.equal(await page.locator('.react-flow__node[data-id="source-b"].context-source-active').count(), 1);
  assert.equal(await page.locator('.react-flow__node[data-id="target"].context-target-active').count(), 1);
  await capture('dark-inspecting');
  check('inspection reveals two path-specific numbers and pointer source tracing without graph changes');

  await row('edge-source-a').focus();
  await page.waitForFunction(() => window.__contextInspection.getState().activeEdgeId === 'edge-source-a');
  await page.keyboard.press('Escape');
  await popover().waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-merge-order]').count(), 0);
  assert.deepEqual(await snapshot(), beforeInspect);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-context-sources-trigger')), 'target');
  check('keyboard source tracing and Escape restore trigger focus without submitting or changing selection');

  await trigger().click();
  await row('edge-source-b').locator('[data-ctx-up]').click();
  assert.deepEqual(await popover().locator('[data-context-order-item]').evaluateAll(items => items.map(item => item.dataset.contextOrderItem)), ['source-b', 'source-a']);
  const afterReorder = await snapshot();
  assert.equal(afterReorder.historyIndex, beforeInspect.historyIndex + 1, 'one explicit reorder creates one undo step');
  await page.evaluate(() => window.__store.getState().undo());
  await page.waitForTimeout(150);
  assert.deepEqual((await snapshot()).edges, beforeInspect.edges, 'one undo must restore original context order');
  check('explicit source reorder is a single reversible history step');

  await page.mouse.click(1500, 950);
  await popover().waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-merge-order]').count(), 0);
  assert.deepEqual((await snapshot()).edges, beforeInspect.edges);
  check('outside click only dismisses inspection and retains context order');

  await page.evaluate(() => window.__store.getState().setSelectedNodeId('source-a'));
  const withSelection = await snapshot();
  await trigger().click();
  await row('edge-source-b').hover();
  assert.deepEqual((await snapshot()).selected, withSelection.selected);
  assert.equal((await snapshot()).selectedNodeId, withSelection.selectedNodeId);
  assert.equal(await page.locator('.react-flow__node[data-id="source-b"]').evaluate(node => getComputedStyle(node).opacity), '1');
  assert.equal(await page.locator('.react-flow__node[data-id="target"]').evaluate(node => getComputedStyle(node).opacity), '1');
  await page.keyboard.press('Escape');
  check('source inspection overrides selection dimming while preserving the existing selected objects');

  await page.evaluate(() => {
    window.__store.getState().setSelectedNodeIds([]);
    const edge = window.__store.getState().edges.find(edge => edge.id === 'edge-source-b');
    window.__canvasEditing.getState().setEdgePreviews([{ ...edge, data: { ...edge.data, isCrossLink: true } }]);
  });
  await page.waitForFunction(() => window.__rf.getEdges().find(edge => edge.id === 'edge-source-b')?.data?.isCrossLink);
  await trigger().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-merge-order]').length === 2);
  assert.equal(await popover().locator('[data-context-order-item]').count(), 2);
  assert.equal(await popover().locator('[data-context-reference-item]').count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__rf.getEdges().find(edge => edge.id === 'edge-source-b')?.data?.isCrossLink);
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().edgePreviews?.length), 1);
  check('inspection reports committed context and restores an existing relation preview after dismissal');

  await seed({ reference: true });
  assert.match(await trigger().innerText(), /3/);
  await trigger().click();
  assert.equal(await popover().locator('[data-context-order-item]').count(), 2);
  assert.equal(await popover().locator('[data-context-reference-item]').count(), 1);
  assert.equal(await row('edge-reference').locator('[data-ctx-up], [data-ctx-down]').count(), 0);
  assert.equal(await page.locator('[data-merge-order]').count(), 2);
  await row('edge-reference').hover();
  await page.waitForFunction(() => window.__contextInspection.getState().activeEdgeId === 'edge-reference');
  await capture('reference-source');
  check('reference source is counted and traceable but excluded from structural ordering');
  await page.evaluate(() => window.__store.setState(state => ({ edges: state.edges.map(edge => edge.id === 'edge-reference'
    ? { ...edge, data: { ...edge.data, isWatch: true } } : edge) })));
  assert.equal(await popover().locator('[data-context-reference-item]').count(), 0);
  assert.equal(await popover().locator('[data-context-special-item]').count(), 1);
  assert.equal(await popover().locator('.context-source-hint').count(), 0);
  check('watch context stays separate and does not inherit the single-turn reference explanation');

  await seed({ direction: 'horizontal', lighting: 'light', lang: 'en', zoom: 0.9 });
  await trigger().click();
  await assertFits();
  assert.match(await trigger().innerText(), /Context/i);
  assert.equal(await page.locator('[data-merge-order]').count(), 2);
  await assertDecorations();
  await capture('light-horizontal-en');
  check('light English horizontal canvas keeps source inspection readable');

  await seed({ shared: true });
  assert.deepEqual(await page.evaluate(() => window.__rf.getEdges().map(edge => edge.targetHandle)), ['in-top', 'in-top']);
  await capture('shared-port-default');
  await trigger().click();
  await assertDecorations();
  await row('edge-source-b').hover();
  await capture('shared-port-inspecting');
  await page.screenshot({ path: `${outputDir}/shared-port-detail.png`, clip: { x: 80, y: 60, width: 690, height: 720 } });
  check('two incoming lines retain distinct arrows and route-owned numbers at a shared top port with a 90px gap');

  await page.setViewportSize({ width: 760, height: 720 });
  await seed({ zoom: 0.65 });
  await trigger().click();
  await assertFits();
  await row('edge-source-b').focus();
  await capture('narrow-zoom');
  await page.keyboard.press('Escape');
  await popover().waitFor({ state: 'detached' });
  check('narrow viewport at 65% zoom keeps popover within screen and keyboard dismissal working');

  await seed();
  await trigger().click();
  await page.evaluate(() => window.__store.setState(state => ({ nodes: state.nodes.filter(node => node.id !== 'target'), edges: [] })));
  await popover().waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__contextInspection.getState().targetId), null);
  check('removing the inspected node clears transient source inspection');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(blockedWrites, []);
} catch (error) {
  await page.screenshot({ path: `${outputDir}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${outputDir}/${captureOnly ? 'capture-results' : 'results'}.json`, JSON.stringify({ checks, errors, blockedWrites }, null, 2));
  await browser.close();
}
