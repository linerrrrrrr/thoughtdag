// Regression coverage for the available canvas width, rather than viewport breakpoints.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1716, height: 1000 }, locale: 'zh-CN' });
page.setDefaultTimeout(10000);
const output = 'local-tests/toolbar-responsive';
await mkdir(output, { recursive: true });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const item = name => page.locator(`[data-${name}]`);
const geometry = () => page.evaluate(() => {
  const rect = selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height, width: r.width };
  };
  return { header: rect('[data-canvas-header]'), left: rect('[data-project-switcher]'), right: rect('[data-top-toolbar]'),
    density: document.querySelector('[data-canvas-header]').dataset.toolbarDensity,
    overflow: document.documentElement.scrollWidth > innerWidth };
});
const fits = async label => {
  const g = await geometry();
  const detail = `${label}: ${JSON.stringify(g)}`;
  assert.ok(Math.abs(g.left.y - g.right.y) < 1, detail);
  assert.ok(Math.abs(g.left.height - g.right.height) < 1, detail);
  assert.ok(g.left.right + 7 <= g.right.x, detail);
  assert.ok(g.right.right <= g.header.right + 1, detail);
  assert.equal(g.overflow, false, detail);
  return g;
};
const openDetail = async () => {
  if (await item('canvas-detail-trigger').isVisible()) await item('canvas-detail-trigger').click();
  else { await item('toolbar-more').click(); await item('menu-detail').click(); }
  await item('canvas-detail-panel').waitFor();
};
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5193');
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(async () => {
    // Vite may append HMR timestamps; reuse the module that owns the mounted stores.
    window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    const nodes = ['a', 'b'].map((id, i) => ({ id, type: 'thought', width: 380, height: 280,
      position: { x: 100 + i * 430, y: 200 }, data: {
        displayName: `节点 ${id}`, question: `研究问题 ${id}`, response: `回答 ${id}`,
        responses: [`回答 ${id}`], responseIndex: 0, isRoot: i === 0,
        isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 10, highlights: [], attachments: [],
      } }));
    nodes.push({ id: 'frame', type: 'frame', position: { x: 80, y: 600 }, width: 600, height: 200,
      data: { stepKind: 'frame', question: '研究区域', response: '', responses: [] } });
    const edges = [{ id: 'ab', source: 'a', target: 'b', type: 'thought', data: {} }];
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
    const { useProjects } = await window.__importLive('/src/store/projects.ts');
    useProjects.setState(state => ({ projects: state.projects.map(project => ({ ...project, name: 'Long research canvas / 很长的研究项目名称，用于验证省略显示' })) }));
  });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-layout-quick], [data-canvas-layout-entry]').count(), 0);
  await page.locator('[data-top-toolbar]').screenshot({ path: `${output}/toolbar-wide.png` });
  assert.match(await page.locator('.canvas-project-button').getAttribute('title'), /Long research canvas/);
  const densities = new Set();
  for (const lang of ['zh', 'en']) {
    await page.evaluate(async lang => (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang(lang), lang);
    assert.equal(await item('search-entry').getAttribute('title'), await page.evaluate(async () => (await window.__importLive('/src/i18n/index.ts')).t('search.entryTitle')));
    for (const panelWidth of [0, 520, 900]) {
      await page.evaluate(width => {
        window.__ui.setState({ panelOpen: width > 0, panelNodeId: width ? 'a' : null, panelWidth: width || 520 });
      }, panelWidth);
      for (const width of [1760, 1440, 1200, 1024, 960, 959, 760, 520, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(280);
        const g = await fits(`${lang}, viewport ${width}, reader ${panelWidth}`);
        densities.add(g.density);
        if (lang === 'zh' && panelWidth === 0 && [1760, 390].includes(width)) {
          await item('toolbar-more').click();
          assert.equal(await item('menu-quick-layout').count(), 0);
          assert.equal(await item('layout-entry').isVisible(), true);
          await page.screenshot({ path: `${output}/menu-${width}.png` });
          await page.keyboard.press('Escape');
        }
        if (lang === 'zh' && panelWidth === 520 && [1440, 1024, 390].includes(width)) {
          await page.screenshot({ path: `${output}/reader-${width}.png` });
        }
      }
    }
  }
  assert.deepEqual([...densities].sort(), ['compact', 'full', 'minimal', 'overflow']);
  console.log('PASS 60 width/language/reader combinations stay on one row without overlap');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.__ui.setState({ panelOpen: true, panelNodeId: 'a', panelWidth: 520 }));
  await page.waitForTimeout(300);
  const before = await geometry();
  const reader = await item('focus-panel').boundingBox();
  await page.mouse.move(reader.x + 2, reader.y + 200);
  await page.mouse.down();
  await page.mouse.move(500, reader.y + 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.ok((await geometry()).header.width < before.header.width - 100);
  await fits('dragged reader');
  console.log('PASS dragging the reader changes density without wrapping');

  await page.evaluate(() => window.__store.getState().setSelectedNodeId('a'));
  await item('node-format-panel').waitFor();
  const row = await geometry();
  await item('search-entry').click();
  await item('search-input').fill('研究');
  await page.waitForTimeout(200);
  const search = await item('canvas-search').boundingBox();
  assert.equal(await page.locator('.canvas-tool-panel:visible').count(), 1);
  assert.equal(await item('node-format-panel').count(), 0);
  assert.ok(search.y >= row.header.bottom + 8);
  assert.deepEqual((await geometry()).header, row.header);
  await page.keyboard.press('Escape');
  await item('canvas-search').waitFor({ state: 'hidden' });
  await item('node-format-panel').waitFor();
  assert.equal(await item('focus-panel').isVisible(), true);
  console.log('PASS search opens independently and Escape preserves the reader');

  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['a', 'b']));
  await item('selection-target-picker').selectOption('edges');
  assert.equal(await page.evaluate(() => window.__store.getState().edges[0].selected), true);
  await item('selection-target-picker').selectOption('nodes');
  assert.deepEqual(await page.evaluate(() => window.__store.getState().selectedNodeIds.sort()), ['a', 'b']);
  await item('toolbar-more').click();
  assert.deepEqual(await page.evaluate(() => window.__store.getState().selectedNodeIds.sort()), ['a', 'b']);
  await page.keyboard.press('Escape');
  await openDetail();
  await page.keyboard.press('Escape');
  assert.equal(await item('toolbar-more').evaluate(el => el === document.activeElement), true);
  await item('toolbar-more').click();
  await item('menu-frames').click();
  await item('frame-nav-panel').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await item('toolbar-more').evaluate(el => el === document.activeElement), true);
  console.log('PASS compact selection retains its semantics; overflow tools restore keyboard focus');

  await page.setViewportSize({ width: 1760, height: 1000 });
  await page.evaluate(() => window.__ui.getState().setPanelOpen(false));
  await page.waitForTimeout(300);
  await openDetail();
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForTimeout(300);
  assert.equal(await item('canvas-detail-panel').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await item('toolbar-more').evaluate(el => el === document.activeElement), true);
  await page.evaluate(async () => {
    (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('zh');
    window.desktopAgents = { workspace: async () => 'E:/toolbar-test', capabilities: { nativePicker: false } };
    const id = 'codex/test/model';
    (await window.__importLive('/src/lib/use-models.ts')).setModelsCache({ models: [{ id, name: 'A long agent model name', provider: '__agent__', vision: false }], default: id });
    window.__ui.setState({ selectedModel: id, panelOpen: true, panelNodeId: 'a', panelWidth: 900 });
    window.__ui.getState().setCondenseRun({ status: 'building', current: 1, total: 12 });
    window.__store.setState(state => ({ staleIds: ['a'], nodes: state.nodes.map(node => node.id === 'b'
      ? { ...node, data: { ...node.data, isLoading: true, pendingApprovals: [{ id: 'test', name: 'Review', askedAt: Date.now(), answered: false }] } } : node) }));
  });
  await page.waitForTimeout(400);
  for (const width of [1760, 960, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    await fits(`agent controls and transient statuses at ${width}`);
  }
  const labels = await page.evaluate(async () => {
    const { t } = await window.__importLive('/src/i18n/index.ts');
    return { cwd: `${t('agent.cwd')} · ${t('agent.cwdWorkspace')}`, permission: `${t('agent.perm')} · ${t('agent.permAsk')}` };
  });
  await item('toolbar-more').click();
  await item('toolbar-more-panel').getByRole('button', { name: labels.cwd, exact: true }).click();
  await item('agent-cwd-menu').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await item('toolbar-more').evaluate(el => el === document.activeElement), true);
  await item('toolbar-more').click();
  await item('toolbar-more-panel').getByRole('button', { name: labels.permission, exact: true }).click();
  await item('agent-permission-menu').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await item('toolbar-more').evaluate(el => el === document.activeElement), true);
  console.log('PASS agent settings and transient statuses fit and remain accessible from More');
  await page.evaluate(async () => {
    const { useProjects } = await window.__importLive('/src/store/projects.ts');
    useProjects.setState(state => ({ projects: state.projects.map(project => ({ ...project, kind: 'paradigm' })) }));
  });
  for (const width of [1440, 760, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    await fits(`paradigm at ${width}`);
  }
  const viewerHash = await page.evaluate(async () => {
    const { buildViewerLink } = await window.__importLive('/src/lib/viewer.ts');
    const { nodes, edges } = window.__store.getState();
    return new URL(await buildViewerLink(nodes, edges)).hash;
  });
  await page.goto(`${process.env.APP_URL ?? 'http://127.0.0.1:5193'}/?test-viewer=1${viewerHash}`);
  await item('viewer-badge').waitFor();
  await page.waitForTimeout(300);
  const viewer = await page.evaluate(() => {
    const header = document.querySelector('[data-canvas-header]').getBoundingClientRect();
    const toolbar = document.querySelector('[data-top-toolbar]').getBoundingClientRect();
    return { left: toolbar.left, right: toolbar.right, availableRight: header.right, height: toolbar.height };
  });
  assert.ok(viewer.left >= 16 && viewer.right <= viewer.availableRight + 1 && viewer.height === 50, JSON.stringify(viewer));
  console.log('PASS paradigm and read-only toolbars also fit narrow windows');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log('PASS resizing preserves the open tool; no runtime errors or implicit API writes');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
