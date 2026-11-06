// Toolbar replacement, retained drafts, and responsive placement; no model calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1760, height: 1100 }, locale: 'zh-CN' });
page.setDefaultTimeout(10000);
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
const output = 'local-tests/toolbar-cards';
await mkdir(output, { recursive: true });
const card = name => page.locator(`[data-${name}]`);
const rightCards = new Set(['selection-properties', 'canvas-layout-panel',
  'canvas-detail-panel', 'toolbar-more-panel', 'frame-nav-panel', 'diagnostics-panel']);
const one = async name => {
  await card(name).waitFor();
  assert.equal(await page.locator('.canvas-tool-panel:visible').count(), 1, name);
  const panel = await card(name).boundingBox();
  const header = await card('canvas-header').boundingBox();
  const anchor = await card(rightCards.has(name) ? 'top-toolbar' : 'project-switcher').boundingBox();
  assert.equal(Math.round(panel.width), 320, name);
  assert.ok(Math.abs(panel.y - (header.y + header.height + 16)) <= 1, `${name} below toolbar`);
  assert.ok(rightCards.has(name)
    ? Math.abs(panel.x + panel.width - (anchor.x + anchor.width)) <= 1
    : Math.abs(panel.x - anchor.x) <= 1, `${name} docks on its owning side`);
};
const check = name => console.log('PASS', name);
const none = async () => {
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.canvas-tool-panel:visible, [data-canvas-chat]').count(), 0,
    'replaced panels must stay closed after their replacement closes');
};
const selectFormat = async () => {
  // Clicking the already-selected node is also an explicit reopen action.
  await page.locator('.react-flow__node[data-id="a"] [data-node-details-header]').click();
  await one('selection-properties');
};
const selectConnection = async () => {
  await page.evaluate(() => {
    window.__canvasEditing.getState().setSelectionRegion(null);
    window.__store.getState().setSelectedNodeIds([]);
    window.__store.setState(state => ({ edges: state.edges.map(edge => ({ ...edge, selected: edge.id === 'ab' })) }));
    window.__canvasEditing.getState().requestProperties();
  });
  await one('selection-properties');
};
const openConnection = async () => {
  await card('model-picker-trigger').click();
  await page.locator('[data-model-connection-panel], [data-model-picker-panel]').waitFor();
  if (await card('model-picker-panel').isVisible()) {
    await one('model-picker-panel');
    await card('model-picker-panel').getByRole('button', { name: '配置模型 API', exact: true }).click();
  }
  await one('model-connection-panel');
};
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5193');
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  assert.equal(await card('top-toolbar').locator('[data-apikey-entry]').count(), 0);
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    const nodes = ['a', 'b'].map((id, i) => ({ id, type: 'thought', width: 380, height: 280,
      position: { x: 80 + i * 440, y: 180 }, data: {
        displayName: `节点 ${id.toUpperCase()}`, question: `研究问题 ${id}`, response: `回答 ${id}`,
        responses: [`回答 ${id}`], responseIndex: 0, isRoot: i === 0,
        isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 10, highlights: [], attachments: [],
      } }));
    nodes.push({ id: 'frame', type: 'frame', position: { x: 80, y: 600 }, width: 600, height: 200,
      data: { stepKind: 'frame', frameTitle: '研究区域', question: '', response: '', responses: [] } });
    const edges = [{ id: 'ab', source: 'a', target: 'b', type: 'thought', data: {} }];
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
    window.__maxVisibleCards = 0;
    const observe = () => {
      const count = [...document.querySelectorAll('.canvas-tool-panel')].filter(el => el.getClientRects().length).length;
      window.__maxVisibleCards = Math.max(window.__maxVisibleCards, count);
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    window.__rf.setViewport({ x: 0, y: 0, zoom: 0.85 }, { duration: 0 });
    window.__store.getState().setSelectedNodeId('a');
  });
  await one('selection-properties');
  assert.equal(await card('project-switcher').locator('[data-model-picker-trigger]').count(), 1);
  assert.equal(await card('top-toolbar').locator('[data-model-picker-trigger]').count(), 0);
  for (const entry of ['search-entry', 'chat-entry', 'frame-nav-trigger', 'canvas-detail-trigger', 'toolbar-more']) {
    assert.equal(await card('project-switcher').locator(`[data-${entry}]`).count(), 0, entry);
    assert.equal(await card('top-toolbar').locator(`[data-${entry}]`).count(), 1, entry);
  }
  assert.equal(await card('top-toolbar').locator('[data-layout-entry]').count(), 1);
  check('session entries stay on the left; canvas tools and layout live on the right');

  await page.locator('[data-node-format-field="width"]').fill('420');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'a').width), 420,
    'leaving geometry for another card saves the local edit');
  await card('toolbar-more').click(); await one('toolbar-more-panel');
  await page.keyboard.press('Escape'); await none();
  assert.deepEqual(await page.evaluate(() => window.__store.getState().selectedNodeIds), ['a']);
  await selectFormat();
  assert.equal(await page.locator('[data-node-format-field="width"]').inputValue(), '420');
  assert.equal(await card('node-format-cancel').count(), 0);
  await card('frame-nav-trigger').click(); await one('frame-nav-panel');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await page.keyboard.press('Escape'); await none();
  await card('toolbar-more').click();
  await card('menu-diagnose').click(); await one('diagnostics-panel');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await page.keyboard.press('Escape'); await none();
  check('detail, overflow, and frame cards replace each other at 320px');

  await card('search-entry').click();
  await card('search-input').fill('研究问题 b');
  await card('canvas-search').locator('li').first().click();
  assert.equal(await card('canvas-search').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__store.getState().selectedNodeId), 'b');
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 0.85 }, { duration: 0 }));
  await selectFormat();
  assert.equal(await card('canvas-search').count(), 0);
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await page.keyboard.press('Escape'); await none();
  check('search result navigation keeps search open; explicit canvas selection replaces it');

  await openConnection();
  await card('provider-add').click();
  await page.locator('[data-preset="custom"]').click();
  await card('provider-url').fill('https://draft.invalid/v1');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await openConnection();
  assert.equal(await card('provider-url').inputValue(), 'https://draft.invalid/v1');
  await card('provider-url').fill('');
  await card('toolbar-more').click(); await one('toolbar-more-panel');
  await openConnection();
  assert.equal(await card('provider-url').inputValue(), '');
  await page.keyboard.press('Escape'); await none();
  check('switching cards preserves connection drafts, including empty values');

  await card('layout-entry').click(); await one('canvas-layout-panel');
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds(['a', 'b']));
  await one('canvas-layout-panel');
  await page.evaluate(() => window.__store.getState().setSelectedNodeId('a'));
  await one('canvas-layout-panel');
  await card('layout-direction').locator('label:has(input[value="horizontal"])').click();
  await card('toolbar-more').click(); await one('toolbar-more-panel');
  await card('layout-entry').click(); await one('canvas-layout-panel');
  assert.equal(await card('toolbar-more-panel').count(), 0);
  assert.equal(await card('layout-direction').locator('input:checked').inputValue(), 'horizontal');
  check('the direct layout entry explicitly reopens a closed layout with its draft');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().layoutOpen), false);
  await page.keyboard.press('Escape'); await none();
  await card('layout-entry').click(); await one('canvas-layout-panel');
  assert.equal(await card('layout-direction').locator('input:checked').inputValue(), 'horizontal');
  await page.keyboard.press('Escape');
  await card('canvas-layout-panel').waitFor({ state: 'detached' });
  assert.equal(await card('layout-entry').evaluate(el => el === document.activeElement), true);
  await selectConnection();
  await card('edge-label').fill('即时保存的连线标注');
  await card('toolbar-more').click(); await one('toolbar-more-panel');
  assert.equal(await page.evaluate(() => window.__store.getState().edges[0].data.label), '即时保存的连线标注');
  await page.keyboard.press('Escape'); await none();
  await selectConnection();
  assert.equal(await card('edge-label').inputValue(), '即时保存的连线标注');
  assert.equal(await page.evaluate(() => window.__store.getState().edges[0].data.label), '即时保存的连线标注');
  await card('selection-properties-close').click();
  await none();
  assert.equal(await page.evaluate(() => window.__store.getState().edges[0].selected), true);
  await selectConnection();
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  await page.keyboard.press('Escape'); await none();
  assert.equal(await page.evaluate(() => window.__store.getState().edges[0].selected), true);
  await page.evaluate(() => {
    window.__canvasEditing.getState().setSelectionTarget('nodes');
    window.__store.setState(state => ({ edges: state.edges.map(edge => ({ ...edge, selected: false })) }));
  });
  await none();
  await selectFormat();
  check('layout and selection properties close without losing selections or submitting drafts');

  await page.locator('.canvas-project-button').click(); await one('project-menu');
  await page.keyboard.press('Escape'); await none();
  await card('chat-entry').click();
  await card('canvas-chat').waitFor();
  const chat = await card('canvas-chat').boundingBox();
  const header = await card('canvas-header').boundingBox();
  const toolbar = await card('top-toolbar').boundingBox();
  assert.equal(chat.x + chat.width, toolbar.x + toolbar.width);
  assert.equal(chat.y, header.y + header.height + 16);
  await card('chat-input').fill('保留画布问答草稿');
  await card('toolbar-more').click(); await one('toolbar-more-panel');
  assert.equal(await card('canvas-chat').count(), 0);
  assert.equal(await card('chat-entry').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await none();
  await card('chat-entry').click();
  await card('canvas-chat').waitFor();
  assert.equal(await card('chat-input').inputValue(), '保留画布问答草稿');
  await card('chat-input').fill('');
  await card('canvas-detail-trigger').click(); await one('canvas-detail-panel');
  assert.equal(await card('canvas-chat').count(), 0);
  await page.keyboard.press('Escape');
  await none();
  await card('chat-entry').click();
  await card('canvas-chat').waitFor();
  assert.equal(await card('chat-input').inputValue(), '');
  await page.locator('.canvas-project-button').click(); await one('project-menu');
  assert.equal(await card('canvas-chat').count(), 0);
  const originalProjects = await page.evaluate(async () => {
    const path = '/src/store/projects.ts';
    const moduleUrl = [...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path;
    const { useProjects } = await import(moduleUrl);
    window.__toolbarProjects = useProjects;
    const { activeId, projects } = useProjects.getState();
    const id = 'toolbar-chat-switched-project';
    const project = projects.find(value => value.id === activeId);
    useProjects.setState({ activeId: id, projects: [...projects, { ...project, id, name: 'Other test canvas' }] });
    return { activeId, projects };
  });
  await page.waitForFunction(() => document.querySelector('[data-chat-entry]')?.getAttribute('aria-pressed') === 'false');
  await page.keyboard.press('Escape');
  await card('project-menu').waitFor({ state: 'detached' });
  assert.equal(await card('canvas-chat').count(), 0);
  await card('chat-entry').click();
  await card('canvas-chat').waitFor();
  assert.equal(await card('chat-input').inputValue(), '');
  await card('chat-entry').click();
  await page.evaluate(snapshot => window.__toolbarProjects.setState(snapshot), originalProjects);
  check('project menu stays on the left and canvas chat opens on the right; temporary cards preserve chat drafts without covering each other');
  check('switching projects does not reopen the replaced chat');

  await selectFormat();
  await page.locator('.react-flow__node[data-id="a"] [data-node-details="a"]').click();
  await card('focus-panel').waitFor();
  for (const width of [1760, 760, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    if (await card('canvas-detail-trigger').isVisible()) await card('canvas-detail-trigger').click();
    else { await card('toolbar-more').click(); await card('menu-detail').click(); }
    await one('canvas-detail-panel');
    await page.waitForTimeout(400);
    const panel = await card('canvas-detail-panel').boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 1);
    if (width >= 960) {
      const reader = await card('focus-panel').boundingBox();
      assert.ok(panel.x + panel.width <= reader.x + 1 || panel.y + panel.height <= reader.y + 1, JSON.stringify({ panel, reader }));
      assert.equal(await page.evaluate(() => window.__ui.getState().panelNodeId), 'a');
    } else {
      assert.equal(await card('focus-panel').count(), 0);
      assert.equal(await page.evaluate(() => window.__ui.getState().panelOpen), false);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/detail-reader-${width}.png` });
    if (width === 1760) {
      await page.evaluate(async () => { (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'); });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${output}/detail-reader-dark.png` });
      await page.evaluate(async () => { (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light'); });
      await page.evaluate(async () => { (await import('/src/i18n/index.ts')).useI18n.getState().setLang('en'); });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${output}/detail-reader-en.png` });
      await page.evaluate(async () => { (await import('/src/i18n/index.ts')).useI18n.getState().setLang('zh'); });
    }
    await page.keyboard.press('Escape'); await none();
    if (width === 390) {
      await card('toolbar-more').click();
      await card('menu-chat').click();
      await card('canvas-chat').waitFor();
      assert.equal(await card('node-format-panel').count(), 0);
      assert.equal(await page.locator('.canvas-tool-panel:visible').count(), 0);
      assert.equal(await page.evaluate(() => window.__store.getState().selectedNodeId), 'a');
      await page.keyboard.press('Escape');
      await card('canvas-chat').waitFor({ state: 'detached' });
      await none();
      check('narrow canvas chat leaves the replaced inspector closed and its selection intact');
    }
  }
  check('desktop retains the independent reader; narrow windows collapse it and keep tool cards accessible');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  assert.equal(await page.evaluate(() => window.__maxVisibleCards), 1);
  check('no painted card stacks, runtime errors, or implicit API writes');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
