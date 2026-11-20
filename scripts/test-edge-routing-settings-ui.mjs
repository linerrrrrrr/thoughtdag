// Run with THOUGHTDAG_DISK_STORAGE=0 to exercise preferences in isolated browser storage.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { clickSettingsBackdrop, openSettingsSection } from './fixtures/canvas-model-picker.mjs';

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
const preview = kind => item('routing-' + kind + '-preview');
const routeMode = value => item('routing-mode').locator(`input[value="${value}"]`);
const previewPath = kind => preview(kind).locator('[data-preview-route]').getAttribute('d');
const previewClearance = () => preview('avoidance').evaluate(svg => {
  const path = svg.querySelector('[data-preview-route]');
  const blocker = svg.querySelector('[data-preview-obstacle]').getBoundingClientRect();
  const length = path.getTotalLength(), matrix = path.getScreenCTM();
  let gap = Infinity;
  for (let index = 0; index <= 400; index++) {
    const point = path.getPointAtLength(length * index / 400).matrixTransform(matrix);
    gap = Math.min(gap, Math.hypot(Math.max(blocker.left - point.x, point.x - blocker.right, 0),
      Math.max(blocker.top - point.y, point.y - blocker.bottom, 0)));
  }
  return gap;
});
// The fixture's curve leaves the right side and enters the left side, so its
// angle from the horizontal measures the deviation from each port's normal.
const canvasCurveSelector = '.react-flow__edge[data-id="curve"] .react-flow__edge-path';
const expectEndpointAngles = (perpendicularity, selector = canvasCurveSelector) => page.waitForFunction(({ value, selector }) => {
  const path = document.querySelector(selector);
  if (!path) return false;
  const length = path.getTotalLength();
  const angle = (from, to) => {
    const a = path.getPointAtLength(from), b = path.getPointAtLength(to);
    return Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) * 180 / Math.PI;
  };
  const chordAngle = angle(0, length);
  const expected = (1 - value / 100) * chordAngle;
  const step = length / 800;
  return chordAngle > 5 && [angle(0, step), angle(length - step, length)].every(actual => Math.abs(actual - expected) < 1);
}, { value: perpendicularity, selector });
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
        layoutDirection: 'horizontal',
      } });
    const nodes = ['curve', 'orthogonal'].flatMap((route, index) => {
      const y = 260 + index * 450;
      return [make(`source-${route}`, 40, y, `来源 ${index + 1}`),
        make(`target-${route}`, 1240, y, `目标 ${index + 1}`),
        make(`blocker-${route}`, 600, y, `障碍 ${index + 1}`, 300)];
    });
    const edges = ['curve', 'orthogonal'].map(route => ({ id: route, type: 'smoothstep',
      source: `source-${route}`, target: `target-${route}`, sourceHandle: 'out-right', targetHandle: 'in-left',
      data: route === 'orthogonal' ? { route } : {}, style: { stroke: '#6B5CE7', strokeWidth: 2 } }));
    window.__ui.setState({ drafts: {} });
    window.__ui.getState().setPanelOpen(false);
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges }], historyIndex: 0 });
    window.__rf.setViewport({ x: 0, y: 0, zoom: 0.9 }, { duration: 0 });
  });
  await page.waitForTimeout(650);
};
const open = async () => {
  if (!await item('routing-avoid').isVisible()) await openSettingsSection(page, 'edges');
  await item('routing-avoid').waitFor();
};
const openLayout = async () => {
  if (await item('settings-panel').isVisible()) await close();
  if (!await item('canvas-layout-panel').isVisible()) await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor();
};
const close = async () => {
  await item('settings-panel').getByRole('button', { name: '关闭', exact: true }).click();
  await item('settings-panel').waitFor({ state: 'detached' });
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
  assert.equal(await item('routing-entry').count(), 0);
  assert.equal(await item('settings-entry').getAttribute('aria-expanded'), 'true');
  for (const route of ['curve', 'orthogonal']) {
    const arrow = page.locator(`[data-edge-direction="${route}"]`);
    assert.equal(await arrow.getAttribute('d'), 'M 0 0 L -11 -5 L -11 5 Z');
    assert.notEqual(await arrow.evaluate(element => getComputedStyle(element).fill), 'none');
  }
  check('curved and orthogonal connections use the same filled direction arrow');
  assert.equal(await item('settings-panel').locator('[data-routing-apply], [data-routing-cancel]').count(), 0);
  assert.equal(await page.locator('[data-layout-tab]').count(), 0);
  assert.equal(await chosen('avoid'), 'on');
  assert.equal(await chosen('clearance'), '20');
  assert.equal(await chosen('curvature'), '25');
  assert.equal(await chosen('endpoint-perpendicularity'), '100');
  const panel = item('settings-panel');
  const fixedInputs = item('connection-layout-enabled');
  assert.equal(await fixedInputs.count(), 0);
  await openSettingsSection(page, 'nodes');
  assert.equal(await fixedInputs.getAttribute('aria-checked'), 'false');
  assert.equal(await item('connection-layout-choice').count(), 0);
  await fixedInputs.click();
  assert.equal(await item('connection-layout-choice').count(), 3);
  assert.equal(await item('connection-layout-attachments').isVisible(), true);
  assert.equal(await item('connection-layout-settings').getByRole('radio').count(), 3);
  await fixedInputs.click();
  assert.equal(await item('connection-layout-choice').count(), 0);
  assert.equal(await item('connection-layout-attachments').count(), 0);
  await open();
  await settled();
  for (const kind of ['curve', 'avoidance']) {
    assert.equal(await panel.getByRole('img', { name: /\S/ }).and(preview(kind)).count(), 1, kind + ' preview has an accessible name');
    assert.equal(await preview(kind).locator('text:visible').count(), 0, kind + ' preview contains only the diagram');
  }
  for (const name of ['曲线弯曲', '端点垂直度', '避让距离']) {
    assert.equal(await panel.getByRole('spinbutton', { name, exact: true }).isVisible(), true, name + ' keeps its field label');
  }
  assert.equal(await panel.getByRole('slider').count(), 3, 'each routing value has one slider');
  const initialAvoidancePath = await previewPath('avoidance');
  const initialCurvePath = await previewPath('curve');
  assert.equal(await item('routing-mode').getByRole('radio').count(), 2);
  assert.equal(await routeMode('curve').isChecked(), true);
  await routeMode('curve').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await routeMode('orthogonal').isChecked(), true);
  assert.equal((await storedPreferences()).defaultRoute, 'orthogonal');
  assert.equal(await preview('curve').count(), 0);
  assert.equal(await item('routing-curvature').count(), 0);
  assert.equal(await item('routing-endpoint-perpendicularity').count(), 0);
  assert.match(await previewPath('avoidance'), /L/, 'the avoidance diagram shows the selected elbow route');
  const elbows = await paths();
  assert.match(elbows[0], /L/, 'an edge without an explicit route adopts the selected default');
  assert.equal(elbows[1], defaults[1].d, 'an explicitly styled edge keeps its route');
  assert.deepEqual(await graph(), originalGraph, 'changing the device default preserves graph and history');
  await choose('avoid', 'off');
  assert.equal(await panel.getByRole('slider').count(), 0, 'closed groups and elbow mode expose no curve or clearance sliders');
  assert.equal(await panel.getByRole('img').count(), 0, 'the fully collapsed panel contains no preview');
  await panel.screenshot({ path: output + '/panel-collapsed-zh.png' });
  await choose('avoid', 'on');
  await close();
  await page.reload();
  await ready();
  await fixture();
  await open();
  assert.equal(await routeMode('orthogonal').isChecked(), true, 'reloading preserves the default path mode');
  await item('routing-mode').locator('label:has(input[value="curve"])').click();
  assert.equal(await routeMode('curve').isChecked(), true);
  assert.equal(await previewPath('curve'), initialCurvePath);
  assert.equal(await previewPath('avoidance'), initialAvoidancePath);
  assert.equal((await paths())[0], defaults[0].d, 'selecting Curve restores the inherited curve');
  check('the default path selector updates inherited edges and the diagrams, and collapsed sections hide their controls');
  const clearanceRange = item('routing-clearance').locator('input[type="range"]');
  assert.equal(await clearanceRange.getAttribute('min'), '8');
  assert.equal(await clearanceRange.getAttribute('max'), '64');
  assert.equal(await clearanceRange.getAttribute('step'), '0.1');
  await clearanceRange.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await chosen('clearance'), '20.1');
  assert.equal((await storedPreferences()).obstacleClearance, 20.1, 'keyboard range changes apply immediately');
  assert.notEqual(await previewPath('avoidance'), initialAvoidancePath, 'keyboard changes redraw the avoidance sample');
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
  assert.equal(await item('settings-panel').isVisible(), true, 'IME Escape does not dismiss Settings');
  await clickSettingsBackdrop(page);
  await open();
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['source-curve', 'target-curve']));
  await choose('avoid', 'off');
  assert.deepEqual(await storedPreferences(), { defaultRoute: 'curve', avoidObstacles: false, obstacleClearance: 20, curvature: 0.25, endpointPerpendicularity: 1 });
  assert.equal(await item('routing-clearance').count(), 0, 'closing avoidance removes its numeric and slider controls');
  assert.equal(await preview('avoidance').count(), 0, 'closing avoidance collapses its preview');
  await item('settings-panel').screenshot({ path: output + '/zh-disabled.png' });
  await settled();
  const disabled = await routing();
  assert.equal(await previewPath('curve'), initialCurvePath, 'the obstacle-free curve sample stays independent of clearance');
  assert.ok(disabled.every(edge => edge.hits), 'both path styles outside the selection update before closing the panel');
  assert.deepEqual(await graph(), originalGraph, 'live preferences never mutate graph data or history');
  await page.keyboard.press('Escape');
  await item('settings-panel').waitFor({ state: 'detached' });
  await open();
  assert.equal(await chosen('avoid'), 'off', 'Escape preserves the applied setting');
  const moreBox = await item('toolbar-more').boundingBox();
  const morePoint = { x: moreBox.x + moreBox.width / 2, y: moreBox.y + moreBox.height / 2 };
  assert.equal(await panel.evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), morePoint), false,
    'The backdrop covers the toolbar button at this viewport');
  await page.mouse.click(morePoint.x, morePoint.y);
  await item('settings-panel').waitFor({ state: 'detached' });
  assert.equal(await item('toolbar-more-panel').count(), 0, 'Dismissing Settings cannot activate the toolbar underneath');
  await item('toolbar-more').click();
  await item('toolbar-more-panel').waitFor();
  assert.equal(await item('settings-panel').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await item('settings-panel').count(), 0, 'covered panel does not revive');
  await open();
  assert.equal(await chosen('avoid'), 'off');
  check('switch and keyboard changes update paths and persistent preferences immediately, independent of selection');

  await choose('avoid', 'on');
  await choose('clearance', '8');
  await settled();
  const light = await routing();
  const lightPreviewGap = await previewClearance();
  assert.ok(lightPreviewGap > 0, 'the avoidance sample clears the obstacle at the minimum distance');
  assert.ok(light.every(edge => !edge.hits && edge.gap > 2));
  await choose('clearance', '48');
  assert.equal((await storedPreferences()).obstacleClearance, 48, 'number input applies before blur');
  assert.equal(await item('routing-clearance').locator('input[type="number"]').evaluate(input => input === document.activeElement), true);
  await settled();
  const wide = await routing();
  const widePreviewPath = await previewPath('avoidance');
  assert.ok(await previewClearance() > lightPreviewGap + 1, 'increasing clearance visibly widens the sample detour');
  await choose('clearance', '64');
  await settled();
  assert.ok(await preview('avoidance').evaluate(svg => {
    const frame = svg.getBoundingClientRect(), path = svg.querySelector('[data-preview-route]').getBoundingClientRect();
    return path.left >= frame.left - 1 && path.right <= frame.right + 1 && path.top >= frame.top - 1 && path.bottom <= frame.bottom + 1;
  }), 'the maximum avoidance detour fits the sample diagram');
  await choose('clearance', '48');
  for (const edge of wide) {
    const before = light.find(candidate => candidate.id === edge.id);
    assert.equal(edge.hits, false);
    assert.ok(edge.gap > before.gap + 15, edge.id + ': wider avoidance must increase actual SVG clearance');
  }
  await choose('avoid', 'off');
  await choose('avoid', 'on');
  assert.equal(await previewPath('avoidance'), widePreviewPath, 'turning avoidance back on restores the sample detour');
  assert.equal(await chosen('clearance'), '48', 'disabling avoidance retains the clearance');
  assert.deepEqual(await graph(), originalGraph);
  await close();
  await page.reload();
  await ready();
  await fixture();
  await open();
  assert.equal(await chosen('clearance'), '48');
  assert.ok((await routing()).every(edge => !edge.hits && edge.gap > 20));
  await panel.screenshot({ path: output + '/preview-panel-zh.png' });
  check('continuous clearance immediately changes both path styles and persists through reload');

  const clearanceInput = item('routing-clearance').locator('input[type="number"]');
  const curvatureInput = item('routing-curvature').locator('input[type="number"]');
  await clearanceInput.fill('65');
  assert.equal(await previewPath('avoidance'), widePreviewPath, 'an invalid distance keeps the last valid sample path');
  assert.equal(await clearanceInput.getAttribute('aria-invalid'), 'true');
  await item('settings-panel').screenshot({ path: output + '/zh-invalid.png' });
  assert.equal((await storedPreferences()).obstacleClearance, 48, 'invalid clearance never replaces the last valid setting');
  assert.equal(await clearanceRange.inputValue(), '48', 'the slider shows the last effective value while text is invalid');
  await choose('curvature', '30');
  assert.equal((await storedPreferences()).curvature, 0.3, 'valid curvature remains live while clearance is invalid');
  assert.equal(await previewPath('avoidance'), widePreviewPath, 'curve adjustments stay independent of the avoidance sample');
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
  await routeMode('curve').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await item('routing-curvature').count(), 0);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await chosen('curvature'), '', 'switching back to Curve restores an unfinished numeric entry');
  await page.keyboard.press('Escape');
  await item('settings-panel').waitFor({ state: 'detached' });
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
  const shallowCurvePreview = await previewPath('curve');
  await choose('curvature', '73.2');
  await settled();
  const curved = await paths();
  assert.notEqual(await previewPath('curve'), shallowCurvePreview, 'curve bend redraws the sample curve');
  assert.notEqual(curved[0], shallow[0], 'curvature immediately changes a curved path');
  assert.equal(curved[1], shallow[1], 'curvature does not change an orthogonal path');
  assert.deepEqual(await graph(), curveGraph);
  assert.deepEqual(await storedPreferences(), { defaultRoute: 'curve', avoidObstacles: false, obstacleClearance: 37.4, curvature: 73.2 / 100, endpointPerpendicularity: 1 });
  const field = 'endpoint-perpendicularity';
  await expectEndpointAngles(100);
  const sampleSelector = '[data-routing-curve-preview] [data-preview-route]';
  await expectEndpointAngles(100, sampleSelector);
  await choose(field, '0');
  await expectEndpointAngles(0);
  await expectEndpointAngles(0, sampleSelector);
  await choose(field, '50');
  await expectEndpointAngles(50);
  await expectEndpointAngles(50, sampleSelector);
  const halfCurvePreview = await previewPath('curve');
  const controlPoints = await preview('curve').locator('[data-preview-control]').evaluateAll(controls =>
    controls.flatMap(control => [Number(control.getAttribute('cx')), Number(control.getAttribute('cy'))]));
  const pathCoordinates = halfCurvePreview.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
  assert.deepEqual(controlPoints, pathCoordinates.slice(2, 6), 'both control markers coincide with the actual cubic controls');
  assert.equal((await paths())[1], curved[1], 'endpoint direction leaves elbow geometry unchanged');
  const endpointInput = item('routing-' + field).getByRole('spinbutton');
  await endpointInput.fill('101');
  assert.equal(await previewPath('curve'), halfCurvePreview, 'an invalid angle keeps the last valid sample curve');
  assert.equal(await endpointInput.getAttribute('aria-invalid'), 'true');
  assert.equal((await storedPreferences()).endpointPerpendicularity, 0.5);
  await item('routing-' + field).getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await chosen(field), '50.1');
  assert.deepEqual(await graph(), curveGraph);
  await close();
  await page.reload();
  await ready();
  await open();
  assert.equal(await chosen('curvature'), '73.2');
  assert.equal(await chosen(field), '50.1');
  await choose('avoid', 'on');
  check('both diagrams follow the applied sliders, including endpoint angles, obstacle clearance and disabled avoidance');

  const escapeViewport = await moveViewport({ x: 130, y: 44, zoom: 0.91 });
  await page.keyboard.press('Escape');
  await item('settings-panel').waitFor({ state: 'detached' });
  await settled();
  sameViewport(escapeViewport, await viewport(), 'Escape on global settings preserves pan and zoom');
  await open();
  const toggleViewport = await moveViewport({ x: 90, y: 70, zoom: 0.86 });
  await close();
  await settled();
  sameViewport(toggleViewport, await viewport(), 'closing Settings preserves pan and zoom');
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
  assert.equal(await item('settings-entry').isVisible(), true);
  assert.equal(await item('settings-panel').isVisible(), true, 'resizing keeps the active panel open');
  assert.equal((await storedPreferences()).curvature, 0.625);
  await page.keyboard.press('Escape');
  await item('settings-panel').waitFor({ state: 'detached' });
  assert.equal(await item('settings-entry').evaluate(element => element === document.activeElement), true);
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
  await item('settings-panel').waitFor({ state: 'detached' });
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
    const height = width === 390 ? 560 : 900;
    await page.setViewportSize({ width, height });
    await settled();
    await open();
    await settled();
    const bounds = await panel.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1,
      lang + '/' + theme + '/' + width + ': routing card fits viewport');
    const fields = item('routing-settings');
    const groups = ['routing-mode', 'routing-curve-preview', 'routing-curvature', 'routing-endpoint-perpendicularity',
      'routing-avoid', 'routing-avoidance-preview', 'routing-clearance'];
    for (const group of groups) {
      const control = item(group);
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0 && box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1
        && box.y >= bounds.y - 1 && box.y + box.height <= bounds.y + bounds.height + 1,
      [lang, theme, width, group].join('/') + ': the whole control or preview is reachable inside the panel');
    }
    if (await fields.evaluate(el => el.scrollHeight > el.clientHeight + 1)) {
      assert.ok(await fields.evaluate(el => el.scrollTop > 0), 'overflowing content scrolls inside the panel');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: output + '/' + lang + '-' + theme + '-' + width + '.png' });
    await page.keyboard.press('Escape');
    await item('settings-panel').waitFor({ state: 'detached' });
  }
  check('both languages and themes keep live settings reachable on wide and narrow screens');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} catch (error) {
  await page.screenshot({ path: output + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await writeFile(output + '/results.json', JSON.stringify({ checks, errors, writes }, null, 2));
  await browser.close();
}
