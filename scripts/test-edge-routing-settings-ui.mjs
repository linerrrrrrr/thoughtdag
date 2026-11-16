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
});
const item = name => page.locator(`[data-${name}]`);
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const choose = async (field, value) => {
  if (field === 'avoid') {
    const toggle = item('routing-avoid').getByRole('switch');
    if ((await toggle.getAttribute('aria-checked')) !== String(value === 'on')) await toggle.click();
  }
  else {
    await item(`routing-${field}`).locator('input[type="number"]').fill(String(value));
    assert.equal(await item(`routing-${field}`).locator('input[type="range"]').inputValue(), String(value), 'range and numeric entry stay synchronized');
  }
};
const chosen = async field => field === 'avoid'
  ? (await item('routing-avoid').getByRole('switch').getAttribute('aria-checked')) === 'true' ? 'on' : 'off'
  : item(`routing-${field}`).locator('input[type="number"]').inputValue();
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
        summaries: [], isCollapsed: false, isEditing: false,
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
  if (!await item('canvas-routing-panel').isVisible()) {
    if (await item('routing-entry').isVisible()) await item('routing-entry').click();
    else { await item('toolbar-more').click(); await item('menu-routing').click(); }
  }
  await item('canvas-routing-panel').waitFor();
  await item('routing-avoid').waitFor();
};
const openLayout = async () => {
  if (!await item('canvas-layout-panel').isVisible()) await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor();
};
const close = async () => {
  await item('canvas-routing-panel').getByRole('button', { name: '关闭', exact: true }).click();
  await item('canvas-routing-panel').waitFor({ state: 'detached' });
};

try {
  await page.goto(appUrl);
  await ready();
  await fixture();
  const originalGraph = await graph();
  const defaults = await routing();
  assert.ok(defaults.every(edge => !edge.absent && !edge.hits && edge.gap > 5));
  await open();
  assert.equal(await item('layout-entry').innerText(), '排版');
  assert.equal(await item('routing-entry').innerText(), '连线');
  assert.equal(await item('canvas-routing-panel').getByRole('heading').innerText(), '连线');
  assert.equal(await item('canvas-routing-panel').locator('[data-routing-apply], [data-routing-cancel]').count(), 0);
  assert.equal(await page.locator('[data-layout-tab]').count(), 0);
  assert.equal(await chosen('avoid'), 'on');
  assert.equal(await chosen('clearance'), '20');
  assert.equal(await chosen('curvature'), '25');
  const clearanceRange = item('routing-clearance').locator('input[type="range"]');
  assert.equal(await clearanceRange.getAttribute('min'), '8');
  assert.equal(await clearanceRange.getAttribute('max'), '64');
  assert.equal(await clearanceRange.getAttribute('step'), '0.1');
  await clearanceRange.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await chosen('clearance'), '20.1');
  assert.equal((await storedPreferences()).obstacleClearance, 20.1, 'keyboard range changes apply immediately');
  const beforeDrag = await paths();
  const sliderBox = await clearanceRange.boundingBox();
  await page.mouse.move(sliderBox.x + sliderBox.width * 0.25, sliderBox.y + sliderBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sliderBox.x + sliderBox.width * 0.7, sliderBox.y + sliderBox.height / 2, { steps: 5 });
  assert.ok((await storedPreferences()).obstacleClearance > 40, 'dragging updates the preference before pointer release');
  await settled();
  const duringDrag = await paths();
  assert.notEqual(duringDrag[0], beforeDrag[0], 'the curved path updates during the drag');
  assert.notEqual(duringDrag[1], beforeDrag[1], 'the orthogonal path updates during the drag');
  await page.mouse.up();
  await choose('clearance', '20');
  await item('routing-clearance').locator('input[type="number"]').evaluate(input => input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true })));
  assert.equal(await item('canvas-routing-panel').isVisible(), true, 'IME Escape does not dismiss the work panel');
  await page.mouse.click(400, 1040);
  assert.equal(await item('canvas-routing-panel').isVisible(), true, 'outside canvas clicks keep the panel open');
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['source-curve', 'target-curve']));
  await choose('avoid', 'off');
  assert.deepEqual(await storedPreferences(), { avoidObstacles: false, obstacleClearance: 20, curvature: 0.25 });
  assert.ok(await item('routing-clearance').locator('input').evaluateAll(inputs => inputs.every(input => input.matches(':disabled'))));
  await item('canvas-routing-panel').screenshot({ path: output + '/zh-disabled.png' });
  await settled();
  const disabled = await routing();
  assert.ok(disabled.every(edge => edge.hits), 'both path styles outside the selection update before closing the panel');
  assert.deepEqual(await graph(), originalGraph, 'live preferences never mutate graph data or history');
  await page.keyboard.press('Escape');
  await item('canvas-routing-panel').waitFor({ state: 'detached' });
  await open();
  assert.equal(await chosen('avoid'), 'off', 'Escape preserves the applied setting');
  await item('toolbar-more').click();
  await item('toolbar-more-panel').waitFor();
  assert.equal(await item('canvas-routing-panel').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await item('canvas-routing-panel').count(), 0, 'covered panel does not revive');
  await open();
  assert.equal(await chosen('avoid'), 'off');
  check('switch and keyboard changes update paths and persistent preferences immediately, independent of selection');

  await choose('avoid', 'on');
  await choose('clearance', '8');
  await settled();
  const light = await routing();
  assert.ok(light.every(edge => !edge.hits && edge.gap > 2));
  await choose('clearance', '48');
  assert.equal((await storedPreferences()).obstacleClearance, 48, 'number input applies before blur');
  assert.equal(await item('routing-clearance').locator('input[type="number"]').evaluate(input => input === document.activeElement), true);
  await settled();
  const wide = await routing();
  for (const edge of wide) {
    const before = light.find(candidate => candidate.id === edge.id);
    assert.equal(edge.hits, false);
    assert.ok(edge.gap > before.gap + 15, edge.id + ': wider avoidance must increase actual SVG clearance');
  }
  await choose('avoid', 'off');
  await choose('avoid', 'on');
  assert.equal(await chosen('clearance'), '48', 'disabling avoidance retains the clearance');
  assert.deepEqual(await graph(), originalGraph);
  await close();
  await page.reload();
  await ready();
  await fixture();
  await open();
  assert.equal(await chosen('clearance'), '48');
  assert.ok((await routing()).every(edge => !edge.hits && edge.gap > 20));
  check('continuous clearance immediately changes both path styles and persists through reload');

  const clearanceInput = item('routing-clearance').locator('input[type="number"]');
  const curvatureInput = item('routing-curvature').locator('input[type="number"]');
  await clearanceInput.fill('65');
  assert.equal(await clearanceInput.getAttribute('aria-invalid'), 'true');
  await item('canvas-routing-panel').screenshot({ path: output + '/zh-invalid.png' });
  assert.equal((await storedPreferences()).obstacleClearance, 48, 'invalid clearance never replaces the last valid setting');
  assert.equal(await clearanceRange.inputValue(), '48', 'the slider shows the last effective value while text is invalid');
  await choose('curvature', '30');
  assert.equal((await storedPreferences()).curvature, 0.3, 'valid curvature remains live while clearance is invalid');
  await clearanceInput.fill('');
  await close();
  await open();
  assert.equal(await chosen('clearance'), '', 'empty input survives closing and reopening');
  assert.equal(await chosen('curvature'), '30');
  await choose('avoid', 'off');
  assert.equal((await storedPreferences()).avoidObstacles, false, 'invalid input does not block the independent switch');
  await choose('avoid', 'on');
  assert.equal(await chosen('clearance'), '');
  await choose('clearance', '37.4');
  assert.equal((await storedPreferences()).obstacleClearance, 37.4);
  await curvatureInput.fill('101');
  assert.equal(await curvatureInput.getAttribute('aria-invalid'), 'true');
  assert.equal((await storedPreferences()).curvature, 0.3);
  await curvatureInput.fill('');
  await page.keyboard.press('Escape');
  await item('canvas-routing-panel').waitFor({ state: 'detached' });
  await open();
  assert.equal(await chosen('curvature'), '');
  await choose('curvature', '25');
  assert.equal((await storedPreferences()).curvature, 0.25);
  check('invalid and empty inputs preserve the last effective value and survive closing while other controls stay live');

  await page.evaluate(() => window.__store.setState(state => ({
    nodes: state.nodes.map(node => node.id === 'target-curve' ? { ...node, position: { ...node.position, y: node.position.y + 180 } } : node),
  })));
  await settled();
  const curveGraph = await graph();
  await choose('avoid', 'off');
  await choose('curvature', '0');
  await settled();
  const shallow = await paths();
  await choose('curvature', '73.2');
  await settled();
  const curved = await paths();
  assert.notEqual(curved[0], shallow[0], 'curvature immediately changes a curved path');
  assert.equal(curved[1], shallow[1], 'curvature does not change an orthogonal path');
  assert.deepEqual(await graph(), curveGraph);
  assert.deepEqual(await storedPreferences(), { avoidObstacles: false, obstacleClearance: 37.4, curvature: 73.2 / 100 });
  await close();
  await page.reload();
  await ready();
  await open();
  assert.equal(await chosen('curvature'), '73.2');
  await choose('avoid', 'on');
  check('curvature updates only curved connections without changing graph state and persists on reload');

  const escapeViewport = await moveViewport({ x: 130, y: 44, zoom: 0.91 });
  await page.keyboard.press('Escape');
  await item('canvas-routing-panel').waitFor({ state: 'detached' });
  await settled();
  sameViewport(escapeViewport, await viewport(), 'Escape on global settings preserves pan and zoom');
  await open();
  const toggleViewport = await moveViewport({ x: 90, y: 70, zoom: 0.86 });
  await item('routing-entry').click();
  await item('canvas-routing-panel').waitFor({ state: 'detached' });
  await settled();
  sameViewport(toggleViewport, await viewport(), 'closing the global settings entry preserves pan and zoom');
  await open();
  const switchViewport = await moveViewport({ x: 140, y: 60, zoom: 0.9 });
  await openLayout();
  await settled();
  sameViewport(switchViewport, await viewport(), 'opening layout without a preview preserves pan and zoom');
  await item('layout-direction').locator('label:has(input[value="horizontal"])').click();
  await open();
  assert.equal(await chosen('curvature'), '73.2');
  await openLayout();
  assert.equal(await item('layout-direction').locator('input:checked').inputValue(), 'horizontal');
  await item('layout-scope').locator('label:has(input[value="all"])').click();
  const beforePreview = await graph();
  await item('layout-preview').click();
  await page.waitForFunction(() => window.__canvasEditing.getState().layoutPreview && !window.__canvasEditing.getState().layoutBusy);
  await open();
  await page.waitForFunction(() => window.__canvasEditing.getState().layoutPreview === null);
  await settled();
  assert.deepEqual(await graph(), beforePreview);
  sameViewport(switchViewport, await viewport(), 'switching from layout preview restores the viewport');
  assert.equal(await chosen('curvature'), '73.2');
  check('switching separate panels retains layout drafts and live connection settings while removing layout previews');

  await choose('curvature', '62.5');
  await page.setViewportSize({ width: 390, height: 900 });
  await settled();
  assert.equal(await item('routing-entry').isVisible(), false);
  assert.equal(await item('canvas-routing-panel').isVisible(), true, 'resizing keeps the active panel open');
  assert.equal((await storedPreferences()).curvature, 0.625);
  await page.keyboard.press('Escape');
  await item('canvas-routing-panel').waitFor({ state: 'detached' });
  assert.equal(await item('toolbar-more').evaluate(element => element === document.activeElement), true);
  await open();
  assert.equal(await chosen('curvature'), '62.5');
  await close();
  check('responsive overflow preserves the active panel, applied setting and keyboard focus');

  await page.setViewportSize({ width: 1760, height: 900 });
  await settled();
  await open();
  await curvatureInput.fill('');
  const projects = await page.evaluate(async () => {
    const { useProjects } = await window.__routingImport('/src/store/projects.ts');
    window.__routingProjects = useProjects;
    const { activeId, projects } = useProjects.getState();
    const project = projects.find(value => value.id === activeId);
    const id = 'routing-panel-other-canvas';
    useProjects.setState({ activeId: id, projects: [...projects, { ...project, id, name: 'Other test canvas' }] });
    return { activeId, projects };
  });
  await item('canvas-routing-panel').waitFor({ state: 'detached' });
  await open();
  assert.equal(await chosen('curvature'), '', 'switching canvases retains incomplete numeric input');
  assert.equal((await storedPreferences()).curvature, 0.625);
  await choose('curvature', '63.2');
  await close();
  await page.evaluate(snapshot => window.__routingProjects.setState(snapshot), projects);
  await settled();
  check('switching canvases retains incomplete input and the last applied global setting');

  for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) for (const width of [1760, 390]) {
    await page.evaluate(async ({ lang, theme }) => {
      (await window.__routingImport('/src/i18n/index.ts')).useI18n.getState().setLang(lang);
      (await window.__routingImport('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme);
    }, { lang, theme });
    await page.setViewportSize({ width, height: 900 });
    await settled();
    await open();
    await settled();
    const panel = await item('canvas-routing-panel').boundingBox();
    assert.ok(panel && panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= width + 1 && panel.y + panel.height <= 901,
      lang + '/' + theme + '/' + width + ': routing card fits viewport');
    const controls = await item('canvas-routing-panel').locator('[data-routing-avoid], [data-routing-clearance], [data-routing-curvature]').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    assert.equal(controls.length, 3);
    assert.ok(controls.every(rect => rect.left >= panel.x && rect.right <= panel.x + panel.width + 1
      && rect.top >= panel.y && rect.bottom <= panel.y + panel.height + 1), lang + '/' + theme + '/' + width + ': controls remain visible');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: output + '/' + lang + '-' + theme + '-' + width + '.png' });
    await page.keyboard.press('Escape');
    await item('canvas-routing-panel').waitFor({ state: 'detached' });
  }
  check('both languages and themes keep the compact live settings reachable on wide and narrow screens');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} catch (error) {
  await page.screenshot({ path: output + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await writeFile(output + '/results.json', JSON.stringify({ checks, errors, writes }, null, 2));
  await browser.close();
}
