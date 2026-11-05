// Toolbar feedback, stable geometry, and explicit reopening with retained drafts.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1760, height: 1000 }, locale: 'zh-CN' });
page.setDefaultTimeout(10000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5193';
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(url.pathname);
    return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  }
  return url.origin === new URL(appUrl).origin ? route.continue() : route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const output = 'local-tests/toolbar-states';
await mkdir(output, { recursive: true });
const item = name => page.locator(`[data-${name}]`);
const settle = async () => { await page.mouse.move(800, 980); await page.waitForTimeout(220); };
const style = name => item(name).evaluate(element => {
  const css = getComputedStyle(element);
  return { background: css.backgroundColor, color: css.color };
});
const choice = (name, value) => item(`layout-${name}`).locator(`label:has(input[value="${value}"])`).click();
const value = name => item(`layout-${name}`).locator('input:checked').inputValue();
const none = async () => {
  await settle();
  assert.equal(await page.locator('.canvas-tool-panel:visible, [data-canvas-chat]').count(), 0,
    'closing a replacement must not revive an older card');
};
const stable = (before, after, message) => {
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[key] - after[key]) <= 1, `${message}: ${key}`);
};

try {
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__toolbarImport = path => {
      const url = [...performance.getEntriesByType('resource')].reverse()
        .find(entry => new URL(entry.name).pathname === path)?.name ?? path;
      return import(url);
    };
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    const nodes = ['a', 'b'].map((id, i) => ({ id, type: 'thought', width: 380, height: 280,
      position: { x: 80 + i * 440, y: 180 }, data: {
        displayName: `节点 ${id}`, question: `研究问题 ${id}`, response: `回答 ${id}`,
        responses: [`回答 ${id}`], responseIndex: 0, isRoot: i === 0,
        isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 10, highlights: [], attachments: [],
      } }));
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges: [] }], historyIndex: 0 });
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__store.getState().setSelectedNodeId('a'));
  await item('node-format-panel').waitFor();
  const graphBefore = await page.evaluate(() => JSON.stringify(window.__store.getState().nodes.map(node => ({ id: node.id, position: node.position }))));
  await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor();
  await choice('scope', 'all');
  await choice('direction', 'horizontal');
  await item('layout-entry').click();
  await none();
  assert.equal(await item('layout-entry').getAttribute('aria-expanded'), 'false');
  await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor();
  assert.equal(await value('scope'), 'all');
  assert.equal(await value('direction'), 'horizontal');
  const viewportBefore = await page.evaluate(() => window.__rf.getViewport());
  await item('layout-preview').click();
  await page.waitForFunction(() => window.__canvasEditing.getState().layoutPreview !== null);
  await item('layout-entry').click();
  await none();
  assert.equal(await page.evaluate(() => window.__canvasEditing.getState().layoutPreview), null);
  const viewportAfter = await page.evaluate(() => window.__rf.getViewport());
  for (const key of ['x', 'y', 'zoom']) assert.ok(Math.abs(viewportAfter[key] - viewportBefore[key]) < 0.01,
    `toolbar close restores the viewport like the panel close button: ${key}`);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__store.getState().nodes.map(node => ({ id: node.id, position: node.position })))), graphBefore);
  await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor();
  await item('toolbar-more').click();
  await item('toolbar-more-panel').waitFor();
  assert.equal(await item('layout-entry').getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Escape');
  await none();
  await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor();
  assert.equal(await value('scope'), 'all');
  assert.equal(await value('direction'), 'horizontal');
  await choice('scope', 'selection');
  await item('layout-entry').click();
  await page.evaluate(() => window.__store.getState().setSelectedNodeIds([]));
  await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor();
  assert.equal(await value('scope'), 'selection', 'a saved selection scope must not silently expand to the whole canvas');
  await item('layout-apply').click();
  await page.locator('[data-canvas-layout-panel] [role="alert"]').waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__store.getState().nodes.map(node => ({ id: node.id, position: node.position })))), graphBefore);
  await page.keyboard.press('Escape');
  await none();
  await item('layout-entry').click();
  await item('canvas-layout-panel').waitFor();
  assert.equal(await value('scope'), 'all', 'Escape cancels the session draft and restores the default scope');
  await item('layout-entry').click();
  console.log('PASS layout toggles, retains scope and options, clears previews, and never revives covered cards');

  await item('chat-entry').click();
  await item('canvas-chat').waitFor();
  await item('chat-input').fill('保留输入');
  await item('toolbar-more').click();
  await item('toolbar-more-panel').waitFor();
  assert.equal(await item('chat-entry').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Escape');
  await none();
  await item('chat-entry').click();
  await item('canvas-chat').waitFor();
  assert.equal(await item('chat-input').inputValue(), '保留输入');
  await item('chat-input').fill('');
  await item('canvas-detail-trigger').click();
  await item('canvas-detail-panel').waitFor();
  await page.keyboard.press('Escape');
  await none();
  await item('chat-entry').click();
  await item('canvas-chat').waitFor();
  assert.equal(await item('chat-input').inputValue(), '');
  await item('chat-entry').click();
  console.log('PASS replacement closes chat and clears its trigger while retaining both nonempty and empty drafts');

  for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    await page.evaluate(async ({ lang, theme }) => {
      (await window.__toolbarImport('/src/i18n/index.ts')).useI18n.getState().setLang(lang);
      (await window.__toolbarImport('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme);
    }, { lang, theme });
    for (const width of [1760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await settle();
      const toolbar = await item('top-toolbar').boundingBox();
      const target = await page.evaluate(() => window.__canvasEditing.getState().selectionTarget);
      await item('layout-entry').click();
      await item('canvas-layout-panel').waitFor();
      await settle();
      stable(toolbar, await item('top-toolbar').boundingBox(), `${lang}/${theme}/${width} opens layout`);
      assert.equal(await item('selection-target-control').count(), 0, 'ordinary selection does not expose marquee choices');
      assert.equal(await page.evaluate(() => window.__canvasEditing.getState().selectionTarget), target);
      await page.screenshot({ path: `${output}/${lang}-${theme}-${width}-layout.png` });
      await item('toolbar-more').click();
      await item('toolbar-more-panel').waitFor();
      await settle();
      stable(toolbar, await item('top-toolbar').boundingBox(), `${lang}/${theme}/${width} replaces layout`);
      await page.keyboard.press('Escape');
      await none();
    }
    await page.setViewportSize({ width: 1760, height: 1000 });
    await settle();
    await item('canvas-detail-trigger').click();
    await item('canvas-detail-panel').waitFor();
    await item('canvas-detail-panel').locator('fieldset').first().locator('button').last().click();
    await settle();
    const open = await style('canvas-detail-trigger');
    await page.keyboard.press('Escape');
    await settle();
    const closed = await style('canvas-detail-trigger');
    assert.notEqual(closed.background, open.background);
    assert.equal(await item('canvas-detail-trigger').getAttribute('data-setting-active'), 'true');
    assert.equal(await item('canvas-detail-trigger').getAttribute('aria-expanded'), 'false');
    assert.equal(await item('canvas-detail-trigger').evaluate(el => getComputedStyle(el, '::after').content), '""');
    await page.screenshot({ path: `${output}/${lang}-${theme}-detail-closed.png` });
  }
  console.log('PASS stable toolbar in both languages, themes and wide/narrow windows; detail setting uses a separate marker');

  await page.evaluate(async () => {
    window.desktopAgents = { workspace: async () => 'E:/toolbar-test', capabilities: { nativePicker: false } };
    const id = 'codex/test/model';
    (await window.__toolbarImport('/src/lib/use-models.ts')).setModelsCache({
      models: [{ id, name: 'Test model', provider: '__agent__', vision: false }], default: id,
    });
    window.__ui.setState({ selectedModel: id });
  });
  await item('agent-cwd').waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => (await window.__toolbarImport('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme), theme);
    await item('layout-entry').click();
    await item('canvas-layout-panel').waitFor();
    await settle();
    const expected = await style('layout-entry');
    await item('layout-entry').click();
    for (const [entry, panel] of [['agent-cwd', 'agent-cwd-menu'], ['agent-permission-chip', 'agent-permission-menu'], ['model-picker-trigger', 'model-picker-panel']]) {
      await settle();
      const before = await item(entry).boundingBox();
      await item(entry).click();
      await item(panel).waitFor();
      await settle();
      assert.deepEqual(await style(entry), expected, `${theme} ${entry} expanded`);
      stable(before, await item(entry).boundingBox(), `${entry} keeps geometry`);
      await item(entry).hover();
      await page.waitForTimeout(220);
      assert.deepEqual(await style(entry), expected, `${theme} ${entry} expanded hover`);
      const iconColors = await item(entry).locator(':scope > svg').evaluateAll(icons => icons.map(icon => getComputedStyle(icon).color));
      assert.ok(iconColors.every(color => color === expected.color));
      await page.screenshot({ path: `${output}/${theme}-${entry}.png` });
      await item(entry).click();
      await none();
      assert.equal(await item(entry).getAttribute('aria-expanded'), 'false');
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log('PASS model, directory and permissions share expanded and hover feedback without changing geometry or sending requests');
} finally {
  await browser.close();
}
