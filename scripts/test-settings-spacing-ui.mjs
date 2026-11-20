// Measure the real Settings layout in a disposable browser profile.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { assertSettingsModal, openSettingsSection } from './fixtures/canvas-model-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');

const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(12000);
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.startsWith('/__thoughtdag_storage')) return route.fulfill({ status: 404 });
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(url.pathname);
      return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
    }
    return url.origin === appUrl.origin ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('thoughtdag.seeded', 'yes');
    localStorage.setItem('thoughtdag.tutorialDone', '1');
  });
  await page.goto(appUrl.href);
  await page.waitForFunction(() => window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
  });
  await openSettingsSection(page, 'general');
  await page.evaluate(() => document.fonts.ready);
  const panel = await assertSettingsModal(page);
  const { scale, expected } = await panel.evaluate(el => {
    const style = getComputedStyle(el);
    const roles = ['hint', 'heading', 'row', 'section'];
    return {
      scale: Number(style.getPropertyValue('--ui-scale')),
      expected: Object.fromEntries(roles.map(role =>
        [role, parseFloat(style.getPropertyValue('--settings-space-' + role))])),
    };
  });
  assert.ok(0 < expected.hint && expected.hint < expected.heading &&
    expected.heading < expected.row && expected.row < expected.section,
  'Hint, heading, row and section spacing must form a visible hierarchy');

  // Geometry is in viewport pixels. Remove the UI scale and any divider
  // thickness to measure the amount of empty space in layout CSS pixels.
  const gap = async (label, role, before, after, divider) => {
    const top = await panel.locator(before).boundingBox();
    const bottom = await panel.locator(after).boundingBox();
    assert.ok(top && bottom, label + ' requires both elements to be visible');
    const border = divider ? await panel.locator(divider).evaluate(el =>
      parseFloat(getComputedStyle(el).borderTopWidth)) : 0;
    const actual = (bottom.y - top.y - top.height) / scale - border;
    assert.ok(Math.abs(actual - expected[role]) < 0.25,
      label + ': expected ' + expected[role] + ' CSS px, got ' + actual.toFixed(2));
  };
  const shots = 'local-tests/settings-spacing';
  mkdirSync(shots, { recursive: true });
  for (const [width, height, lang, theme] of [
    [1440, 900, 'zh', 'light'], [1440, 900, 'en', 'dark'],
    [390, 700, 'zh', 'dark'], [390, 700, 'en', 'light'],
  ]) {
    await page.setViewportSize({ width, height });
    await openSettingsSection(page, 'general');
    await panel.locator('[data-menu-language]').getByRole('button', { name: lang === 'zh' ? '中文' : 'English' }).click();
    await panel.locator('[data-appearance-lighting] button').filter({ has: page.locator('[data-lighting="' + theme + '"]') }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    const appearance = '[data-interface-preferences] section:first-of-type';
    const controls = '[data-interface-preferences] section:nth-of-type(2)';
    assert.equal(await panel.locator(appearance + ' h4').innerText(), lang === 'zh' ? '外观' : 'Appearance');
    await gap('Appearance heading and first row', 'heading', appearance + ' h4', '[data-menu-language]');
    await gap('Language and theme rows', 'row', '[data-menu-language]', '[data-appearance-lighting]');
    await gap('Theme and paper rows', 'row', '[data-appearance-lighting]', '[data-appearance-paper]');
    await gap('Appearance and controls sections', 'section', '[data-appearance-paper]', controls + ' h4', controls);
    await page.screenshot({ path: shots + '/' + width + '-' + lang + '-' + theme + '.png' });

    await openSettingsSection(page, 'providers');
    await gap('Default model label and hint', 'hint',
      '[data-default-model-settings] .settings-field-title', '[data-default-model-settings] .settings-field-hint');
    await gap('Default model and API connections', 'section',
      '[data-default-model-settings]', '.settings-api-heading', '.settings-api');
    await openSettingsSection(page, 'agents');
    await gap('Agent connection and reasoning preference', 'section',
      '[data-agent-connection-page]', '[data-agent-effort]', '.settings-section-divider:has([data-agent-effort])');
    await openSettingsSection(page, 'tools');
    const memory = '[data-picker-caps] + .settings-field-section';
    await gap('Tools and memory settings', 'section', '[data-picker-caps]', memory + ' .canvas-routing-toggle', memory);
    await openSettingsSection(page, 'judge');
    const toggle = panel.locator('[data-picker-judge-toggle]');
    if (await toggle.getAttribute('aria-checked') === 'false') await toggle.click();
    await gap('Decision-model toggle and configuration', 'section',
      '[data-picker-judge-row]', '[data-judge-body]', '[data-judge-settings]');
    await openSettingsSection(page, 'nodes');
    const inputLayout = '[data-connection-layout-settings]';
    const typeGroup = '[data-canvas-typography-settings]';
    await gap('Detail and input layout controls', 'row', '.settings-node-detail', inputLayout);
    await gap('Input layout and typography section', 'section', inputLayout, typeGroup + ' h4', typeGroup);
    await gap('Typography heading and workspace', 'heading', typeGroup + ' h4', typeGroup + ' .canvas-type-workspace');
    const preview = await panel.locator(typeGroup + ' .type-demo').boundingBox();
    const curve = await panel.locator(typeGroup + ' .canvas-type-curve').boundingBox();
    const frame = await panel.locator(typeGroup + ' .type-demo-frame').boundingBox();
    const legendElement = panel.locator(typeGroup + ' .canvas-type-curve-legend');
    const legend = await legendElement.boundingBox();
    assert.ok(preview && curve && frame && legend, 'The preview and curve are visible');
    const legendBottom = await legendElement.evaluate(el => {
      const style = getComputedStyle(el);
      return { border: parseFloat(style.borderBottomWidth), padding: parseFloat(style.paddingBottom) };
    });
    assert.deepEqual(legendBottom, { border: 0, padding: 0 }, 'The legend ends at its value row');
    if (width === 1440) {
      assert.ok(Math.abs(preview.y - curve.y) < 1 && curve.x >= preview.x + preview.width,
        'The preview and curve share a row on desktop');
      const previewHeading = await panel.locator(typeGroup + ' .type-demo h5').boundingBox();
      const curveHeading = await panel.locator(typeGroup + ' figcaption').boundingBox();
      assert.ok(previewHeading && curveHeading && Math.abs(previewHeading.y - curveHeading.y) < 1,
        'The visible preview and curve headings align');
      const controls = await panel.locator('.type-demo-controls').boundingBox();
      assert.ok(controls && Math.abs(controls.y - legend.y) < 1,
        'The preview controls and legend share a top divider height');
      const baselines = await panel.locator('.canvas-type-workspace').evaluate(el => {
        const output = el.querySelector('.type-demo-controls output');
        const values = el.querySelectorAll('.canvas-type-curve-legend dd b');
        const zoomMarker = document.createElement('span');
        zoomMarker.style.cssText = 'display: inline-block; width: 0; height: 0; vertical-align: baseline';
        const valueMarker = zoomMarker.cloneNode();
        output.append(zoomMarker);
        try {
          return Array.from(values, value => {
            value.append(valueMarker);
            return { zoom: zoomMarker.getBoundingClientRect().bottom, value: valueMarker.getBoundingClientRect().bottom };
          });
        } finally {
          zoomMarker.remove();
          valueMarker.remove();
        }
      });
      assert.equal(baselines.length, 3, 'The legend shows all three series values');
      for (const {zoom, value} of baselines) {
        assert.ok(Math.abs(zoom - value) < 1, 'The zoom percentage and legend value share a text baseline');
      }
    } else {
      assert.ok(Math.abs(preview.x - curve.x) < 1 && curve.y >= preview.y + preview.height,
        'The preview and curve form a single column on mobile');
    }
    const hints = lang === 'zh'
      ? ['滚轮缩放，拖动平移', '上下拖动控制点调整字号，横向拖动图表预览不同倍率。']
      : ['Scroll to zoom, drag to pan', 'Drag a point up or down to change the font size. Drag across the chart to preview a zoom level.'];
    for (const text of hints) {
      const matches = await panel.getByText(text, { exact: true }).all();
      for (const match of matches) {
        const box = await match.boundingBox();
        assert.ok(!box || box.width <= 1 || box.height <= 1, 'Help text is hidden from the visual layout: ' + text);
      }
    }
    const reset = await panel.locator('[data-canvas-typography-reset]').boundingBox();
    const apply = await panel.locator('[data-canvas-typography-apply]').boundingBox();
    const workspace = await panel.locator('.canvas-type-workspace').boundingBox();
    assert.ok(reset && apply && workspace && reset.x + reset.width <= apply.x && Math.abs(reset.y - apply.y) < 1,
      'Reset and Apply share an action row');
    assert.ok(reset.y >= Math.max(frame.y + frame.height, legend.y + legend.height)
      && Math.abs(apply.x + apply.width - workspace.x - workspace.width) < 1,
    'The action row sits below both panels and aligns with the right edge of the workspace');
    const stage = await panel.locator('[data-canvas-typography-stage]').boundingBox();
    assert.equal(await panel.locator('[data-canvas-typography-preview-zoom]').inputValue(), '100');
    for (const role of ['full', 'summary']) {
      const node = await panel.locator(`[data-canvas-typography-node="${role}"]`).boundingBox();
      assert.ok(stage && node && node.x >= stage.x && node.y >= stage.y
        && node.x + node.width <= stage.x + stage.width && node.y + node.height <= stage.y + stage.height,
      `The entire ${role} sample fits the initial preview at ${width}px in ${lang}`);
    }
    assert.ok(await panel.locator('.settings-page-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1),
      'Node display fits the settings viewport width');
    await page.screenshot({ path: shots + '/nodes-' + width + '-' + lang + '-' + theme + '.png' });
    await openSettingsSection(page, 'edges');
    const groups = '[data-routing-settings] > section';
    await gap('Curve and obstacle avoidance sections', 'section', groups + ':first-of-type',
      groups + ':nth-of-type(2) .settings-route-controls', groups + ':nth-of-type(2)');
    await gap('Curve parameter rows', 'row', '[data-routing-curvature]', '[data-routing-endpoint-perpendicularity]');
    const scroll = panel.locator('.settings-page-scroll');
    assert.ok(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Settings content fits the viewport width');
    console.log('PASS settings spacing', width, height, lang, theme, expected);
  }
  assert.deepEqual(errors, [], 'Settings must render without page errors');
  assert.deepEqual(writes, [], 'Viewing settings must not submit configuration');
} finally {
  await browser.close();
}
