// Global routing preferences in isolated browser storage; no external calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/edge-routing-settings';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1760, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = [], errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(url.pathname);
      return route.abort('blockedbyclient');
    }
    return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  }
  return url.origin === new URL(appUrl).origin ? route.continue() : route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const item = name => page.locator(`[data-${name}]`);
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const choose = async (field, value) => {
  if (field === 'avoid') await item('routing-avoid').locator(`label:has(input[value="${value}"])`).click();
  else {
    await item(`routing-${field}`).locator('input[type="number"]').fill(String(value));
    await item(`routing-${field}`).locator('input[type="number"]').press('Tab');
    assert.equal(await item(`routing-${field}`).locator('input[type="range"]').inputValue(), String(value), 'range and numeric entry stay synchronized');
  }
};
const chosen = field => item(`routing-${field}`).locator(field === 'avoid' ? 'input:checked' : 'input[type="number"]').inputValue();
const storedPreferences = () => page.evaluate(() => JSON.parse(localStorage.getItem('thoughtdag.edgeRouting') ?? 'null'));
const graph = () => page.evaluate(() => {
  const state = window.__store.getState();
  return {
    nodes: state.nodes.map(node => ({ id: node.id, position: node.position, width: node.width, height: node.height })),
    edges: state.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, data: edge.data })),
    historyIndex: state.historyIndex, historyLength: state.history.length,
  };
});
const routing = () => page.evaluate(() => ['curve', 'orthogonal'].map(id => {
  const path = document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
  if (!path) return { id, absent: true };
  const blocker = document.querySelector(`.react-flow__node[data-id="blocker-${id}"]`).getBoundingClientRect();
  const length = path.getTotalLength(), matrix = path.getScreenCTM();
  const points = Array.from({ length: 801 }, (_, index) => {
    const point = path.getPointAtLength(length * index / 800);
    return new DOMPoint(point.x, point.y).matrixTransform(matrix);
  });
  const gap = point => Math.hypot(Math.max(blocker.left - point.x, 0, point.x - blocker.right),
    Math.max(blocker.top - point.y, 0, point.y - blocker.bottom));
  return { id, d: path.getAttribute('d'), length, gap: Math.min(...points.map(gap)),
    hits: points.some(point => point.x > blocker.left + 1 && point.x < blocker.right - 1
      && point.y > blocker.top + 1 && point.y < blocker.bottom - 1) };
}));
const paths = async () => (await routing()).map(edge => edge.d);
const settled = () => page.waitForTimeout(250);
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const moveViewport = async next => {
  await page.evaluate(next => window.__rf.setViewport(next, { duration: 0 }), next);
  await settled();
  return viewport();
};
const sameViewport = (before, after, message) => {
  for (const key of ['x', 'y', 'zoom']) assert.ok(Math.abs(before[key] - after[key]) < 0.001, `${message}: ${key}`);
};
const ready = async () => {
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__routingImport = path => {
      const loaded = [...performance.getEntriesByType('resource')].reverse()
        .find(entry => new URL(entry.name).pathname === path)?.name ?? path;
      return import(loaded);
    };
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
  });
};
const fixture = async () => {
  await page.evaluate(() => {
    window.__canvasEditing.getState().reset();
    const make = (id, x, y, label, width = 240) => ({ id, type: 'thought', position: { x, y },
      width, height: 180, measured: { width, height: 180 }, dragHandle: '.drag-handle', data: {
        displayName: label, question: label, response: '连线避障验证。', responses: ['连线避障验证。'], responseIndex: 0,
        summaries: [], isRoot: id.startsWith('source'), isCollapsed: false, isEditing: false,
        isEditingResponse: false, isLoading: false, tokenCount: 10, highlights: [], attachments: [],
        layoutDirection: 'horizontal', edgeRouteDefault: 'curve',
      } });
    const nodes = ['curve', 'orthogonal'].flatMap((route, index) => {
      const y = 260 + index * 450;
      return [make(`source-${route}`, 40, y, `来源 ${index + 1}`),
        make(`target-${route}`, 1240, y, `目标 ${index + 1}`),
        make(`blocker-${route}`, 600, y, `障碍 ${index + 1}`, 300)];
    });
    const edges = ['curve', 'orthogonal'].map(route => ({ id: route, type: 'smoothstep',
      source: `source-${route}`, target: `target-${route}`, sourceHandle: 'out-right', targetHandle: 'in-left',
      data: { route }, style: { stroke: '#6B5CE7', strokeWidth: 2 } }));
    window.__ui.setState({ drafts: {} });
    window.__ui.getState().setPanelOpen(false);
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges }], historyIndex: 0 });
    window.__rf.setViewport({ x: 0, y: 0, zoom: 0.9 }, { duration: 0 });
  });
  await page.waitForTimeout(650);
};
const open = async () => {
  if (!await item('canvas-layout-panel').isVisible()) {
    if (await item('layout-entry').isVisible()) await item('layout-entry').click();
    else { await item('toolbar-more').click(); await item('layout-entry').click(); }
  }
  await item('canvas-layout-panel').waitFor();
  await page.locator('[data-layout-tab="routing"]').click();
  await item('routing-avoid').waitFor();
};
const apply = async () => { await item('routing-apply').click(); await settled(); };

try {
  await page.goto(appUrl);
  await ready();
  await fixture();
  const originalGraph = await graph();
  const defaults = await routing();
  assert.ok(defaults.every(edge => !edge.absent && !edge.hits && edge.gap > 5), 'default routes must clear both blockers');
  await open();
  assert.equal(await chosen('avoid'), 'on');
  assert.equal(await chosen('clearance'), '20');
  assert.equal(await chosen('curvature'), '25');
  const clearanceRange = item('routing-clearance').locator('input[type="range"]');
  assert.equal(await clearanceRange.getAttribute('min'), '8');
  assert.equal(await clearanceRange.getAttribute('max'), '64');
  assert.equal(await clearanceRange.getAttribute('step'), '0.1');
  await clearanceRange.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await chosen('clearance'), '20.1', 'keyboard changes avoidance in continuous increments');
  await choose('clearance', '20');
  await item('routing-clearance').locator('input[type="number"]').evaluate(input => input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true })));
  assert.equal(await item('canvas-layout-panel').isVisible(), true, 'IME Escape does not dismiss the work panel');
  await choose('avoid', 'off');
  assert.ok(await item('routing-clearance').locator('input').evaluateAll(inputs => inputs.every(input => input.matches(':disabled'))));
  assert.deepEqual(await paths(), defaults.map(edge => edge.d), 'draft changes do not reroute');
  assert.equal(await storedPreferences(), null, 'draft changes do not persist');
  await page.mouse.click(400, 1040);
  assert.equal(await item('canvas-layout-panel').isVisible(), true, 'outside canvas clicks keep the work panel open');
  assert.deepEqual(await paths(), defaults.map(edge => edge.d));
  await page.keyboard.press('Escape');
  await item('canvas-layout-panel').waitFor({ state: 'detached' });
  await open();
  assert.equal(await chosen('avoid'), 'off', 'Escape retains the routing draft');
  await item('toolbar-more').click();
  await item('toolbar-more-panel').waitFor();
  assert.equal(await item('canvas-layout-panel').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await item('canvas-layout-panel').count(), 0, 'covered work panel does not revive automatically');
  await open();
  assert.equal(await chosen('avoid'), 'off', 'replacement retains the routing draft');
  assert.deepEqual(await graph(), originalGraph);
  check('routing defaults clear obstacles; unapplied drafts survive Escape and replacement without graph or API changes');

  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['source-curve', 'target-curve']));
  await apply();
  const disabled = await routing();
  assert.ok(disabled.every(edge => edge.hits), 'one global choice affects both independently sourced path styles outside the selection');
  assert.deepEqual(await storedPreferences(), { avoidObstacles: false, obstacleClearance: 20, curvature: 0.25 });
  assert.deepEqual(await graph(), originalGraph, 'routing changes preserve node coordinates, edge data and history');
  check('explicitly disabling avoidance reroutes curve and orthogonal edges globally without moving objects');

  await open();
  await choose('avoid', 'on');
  await choose('clearance', '8');
  assert.deepEqual(await paths(), disabled.map(edge => edge.d));
  await apply();
  const light = await routing();
  assert.ok(light.every(edge => !edge.hits && edge.gap > 2));
  await open();
  await choose('clearance', '48');
  await apply();
  const wide = await routing();
  for (const edge of wide) {
    const before = light.find(candidate => candidate.id === edge.id);
    assert.equal(edge.hits, false);
    assert.ok(edge.gap > before.gap + 15, `${edge.id}: wider avoidance must increase actual node clearance (${before.gap} -> ${edge.gap})`);
  }
  assert.deepEqual(await storedPreferences(), { avoidObstacles: true, obstacleClearance: 48, curvature: 0.25 });
  assert.deepEqual(await graph(), originalGraph);
  check('light and wide settings increase real SVG clearance for both route styles without graph mutations');

  await open();
  await choose('avoid', 'off');
  await apply();
  await open();
  assert.equal(await chosen('clearance'), '48', 'disabling does not discard the chosen degree');
  await choose('avoid', 'on');
  assert.equal(await chosen('clearance'), '48');
  await apply();
  await open();
  await choose('clearance', '8');
  await item('routing-cancel').click();
  await item('canvas-layout-panel').waitFor({ state: 'detached' });
  await open();
  assert.equal(await chosen('clearance'), '48', 'Cancel discards the unsubmitted routing draft');
  await page.locator('[data-layout-tab="routing"]').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('[data-layout-tab="layout"]').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-layout-tab="routing"]').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('[data-layout-tab="layout"]').getAttribute('aria-selected'), 'true');
  await item('layout-direction').locator('label:has(input[value="vertical"])').click();
  await page.locator('[data-layout-tab="routing"]').click();
  await choose('clearance', '37.4');
  await page.locator('[data-layout-tab="layout"]').click();
  assert.equal(await item('layout-direction').locator('input:checked').inputValue(), 'vertical');
  await page.locator('[data-layout-tab="routing"]').click();
  assert.equal(await chosen('clearance'), '37.4', 'layout and routing tabs retain independent drafts, including intermediate clearance values');
  await item('canvas-layout-panel').getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await ready();
  assert.deepEqual(await storedPreferences(), { avoidObstacles: true, obstacleClearance: 48, curvature: 0.25 });
  await fixture();
  await open();
  assert.equal(await chosen('clearance'), '48', 'reload restores committed preferences, never the session draft');
  assert.ok((await routing()).every(edge => !edge.hits && edge.gap > 20));
  check('degree survives disabling; Cancel discards drafts; tab drafts stay independent and reload restores committed global values');

  await item('routing-clearance').locator('input[type="number"]').fill('');
  assert.equal(await item('routing-apply').isDisabled(), true, 'empty clearance cannot be submitted');
  await item('canvas-layout-panel').getByRole('button', { name: '关闭', exact: true }).click();
  await open();
  assert.equal(await chosen('clearance'), '', 'empty numeric session drafts survive close/reopen');
  assert.equal(await item('routing-apply').isDisabled(), true);
  await item('routing-clearance').locator('input[type="number"]').fill('65');
  assert.equal(await item('routing-apply').isDisabled(), true, 'out-of-range clearance cannot be submitted');
  await choose('clearance', '37.4');
  await item('routing-curvature').locator('input[type="number"]').fill('101');
  assert.equal(await item('routing-apply').isDisabled(), true, 'out-of-range curvature cannot be submitted');
  await choose('curvature', '25');
  await apply();
  assert.deepEqual(await storedPreferences(), { avoidObstacles: true, obstacleClearance: 37.4, curvature: 0.25 });
  check('empty numeric drafts survive close/reopen and invalid numeric ranges block explicit submission');

  await open();
  await page.evaluate(() => window.__store.setState(state => ({
    nodes: state.nodes.map(node => node.id === 'target-curve' ? { ...node, position: { ...node.position, y: node.position.y + 180 } } : node),
  })));
  await settled();
  const curveGraph = await graph();
  await choose('avoid', 'off');
  await choose('curvature', '0');
  await apply();
  const shallow = await paths();
  await open();
  await choose('curvature', '73.2');
  assert.deepEqual(await paths(), shallow, 'draft curvature does not alter rendered paths');
  await apply();
  const curved = await paths();
  assert.notEqual(curved[0], shallow[0], 'curvature changes the natural curve between staggered cards');
  assert.equal(curved[1], shallow[1], 'curvature does not change an orthogonal connection');
  assert.deepEqual(await graph(), curveGraph);
  assert.deepEqual(await storedPreferences(), { avoidObstacles: false, obstacleClearance: 37.4, curvature: 73.2 / 100 });
  await page.reload();
  await ready();
  await open();
  assert.equal(await chosen('curvature'), '73.2', 'non-preset curvature survives reload');
  await choose('avoid', 'on');
  await choose('clearance', '37.4');
  await apply();
  assert.deepEqual(await storedPreferences(), { avoidObstacles: true, obstacleClearance: 37.4, curvature: 73.2 / 100 });
  check('continuous clearance and curvature accept intermediate values; committed curvature changes curves alone and survives reload');

  await open();
  const escapeViewport = await moveViewport({ x: 130, y: 44, zoom: 0.91 });
  await page.keyboard.press('Escape');
  await item('canvas-layout-panel').waitFor({ state: 'detached' });
  await settled();
  sameViewport(escapeViewport, await viewport(), 'Escape on global settings preserves the actively inspected canvas');
  await open();
  const toggleViewport = await moveViewport({ x: 90, y: 70, zoom: 0.86 });
  await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor({ state: 'detached' });
  await settled();
  sameViewport(toggleViewport, await viewport(), 'closing the global settings entry preserves pan and zoom');
  await open();
  const applyViewport = await moveViewport({ x: 45, y: 65, zoom: 0.88 });
  await apply();
  await item('canvas-layout-panel').waitFor({ state: 'detached' });
  sameViewport(applyViewport, await viewport(), 'applying global settings preserves pan and zoom');
  await open();
  const tabViewport = await moveViewport({ x: 140, y: 60, zoom: 0.9 });
  await page.locator('[data-layout-tab="layout"]').click();
  await settled();
  sameViewport(tabViewport, await viewport(), 'switching to node layout without a preview preserves pan and zoom');
  await page.locator('[data-layout-tab="routing"]').click();
  await settled();
  sameViewport(tabViewport, await viewport(), 'switching back to global settings without a preview preserves pan and zoom');
  const beforePreview = await graph();
  await page.locator('[data-layout-tab="layout"]').click();
  await item('layout-preview').click();
  await page.waitForFunction(() => window.__canvasEditing.getState().layoutPreview && !window.__canvasEditing.getState().layoutBusy);
  await page.locator('[data-layout-tab="routing"]').click();
  await page.waitForFunction(() => window.__canvasEditing.getState().layoutPreview === null);
  await settled();
  assert.deepEqual(await graph(), beforePreview, 'discarding the layout preview never commits graph geometry or history');
  check('global settings preserve inspection pan/zoom on close, apply and tab switches; entering global settings clears a node-layout preview');

  for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) for (const width of [1760, 390]) {
    await page.evaluate(async ({ lang, theme }) => {
      (await window.__routingImport('/src/i18n/index.ts')).useI18n.getState().setLang(lang);
      (await window.__routingImport('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme);
    }, { lang, theme });
    await page.setViewportSize({ width, height: 900 });
    await open();
    await settled();
    const panel = await item('canvas-layout-panel').boundingBox();
    assert.ok(panel && panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= width + 1 && panel.y + panel.height <= 901,
      `${lang}/${theme}/${width}: routing card fits viewport`);
    const controls = await item('canvas-layout-panel').locator('[data-routing-avoid], [data-routing-clearance], [data-routing-curvature], [data-routing-apply]').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    assert.equal(controls.length, 4);
    assert.ok(controls.every(rect => rect.left >= panel.x && rect.right <= panel.x + panel.width + 1
      && rect.top >= panel.y && rect.bottom <= panel.y + panel.height + 1), `${lang}/${theme}/${width}: all settings and Apply remain visible`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${lang}-${theme}-${width}.png` });
    await page.keyboard.press('Escape');
    await item('canvas-layout-panel').waitFor({ state: 'detached' });
  }
  check('both languages and themes keep the independent global settings and explicit action reachable on wide and narrow screens');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
  await browser.close();
}
