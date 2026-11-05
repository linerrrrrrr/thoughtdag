// Tooltips should supplement visible UI without removing accessible names.
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
const output = 'local-tests/tooltip-audit';
await mkdir(output, { recursive: true });
const tip = page.locator('.tdag-tooltip');
const reset = async () => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(1720, 980);
  await page.waitForTimeout(40);
};
const hover = async locator => {
  await reset();
  await locator.hover();
  await page.waitForTimeout(450);
};
const noTip = async message => assert.equal(await tip.count(), 0, message);

try {
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    const nodes = ['a', 'b'].map((id, i) => ({ id, type: 'thought', width: 380, height: 280,
      position: { x: 180 + i * 440, y: 220 }, data: {
        displayName: `节点 ${id}`, question: `研究问题 ${id}`, response: `回答 ${id}`,
        responses: [`回答 ${id}`], responseIndex: 0, isRoot: i === 0,
        isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 10, highlights: [], attachments: [],
      } }));
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 });
  });
  await page.waitForTimeout(400);

  const layout = page.locator('[data-layout-entry]');
  await hover(layout);
  await noTip('a visible toolbar label does not need a duplicate tooltip');
  assert.equal(await layout.getAttribute('title'), null, 'native tooltip is suppressed too');
  assert.ok(await layout.getAttribute('aria-label'), 'the accessible name survives suppression');
  await reset();
  assert.ok(await layout.getAttribute('title'), 'the title is restored after leaving');

  // Verify the real toolbar after its visible labels collapse to icons.
  let compactSeen = false;
  for (const width of [1000, 760, 520, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(150);
    const density = await page.locator('[data-canvas-header]').getAttribute('data-toolbar-density');
    if (!compactSeen && ['compact', 'overflow'].includes(density) && await layout.isVisible()) {
      await hover(layout);
      assert.ok((await tip.innerText()).includes('排版'), 'icon-only layout control keeps its name');
      compactSeen = true;
    }
  }
  assert.ok(compactSeen, 'responsive icon controls were exercised');
  await page.setViewportSize({ width: 1760, height: 1000 });
  await page.waitForTimeout(150);

  const more = page.locator('[data-toolbar-more]');
  await hover(more);
  await noTip('the familiar More icon remains quiet');
  assert.ok(await more.getAttribute('aria-label'));
  const zoom = page.locator('.react-flow__controls-zoomin');
  await hover(zoom);
  await noTip('a plus sign in the zoom rail needs no hover explanation');
  assert.equal(await zoom.getAttribute('aria-label'), '放大');
  assert.equal(await zoom.getAttribute('title'), null);
  await hover(page.locator('.react-flow__controls-fitview'));
  assert.equal(await tip.innerText(), '适配整张画布');

  const usage = page.locator('[data-node-token-usage]').first();
  await hover(usage);
  assert.equal(await page.locator('.tooltip-details-row').count(), 4, 'token breakdown is preserved');
  const descriptionId = await usage.getAttribute('aria-describedby');
  assert.equal(descriptionId, await tip.getAttribute('id'));
  await page.screenshot({ path: `${output}/token-details.png` });
  await page.mouse.down();
  await noTip('dragging immediately dismisses a tooltip');
  await page.mouse.up();
  await reset();
  await page.keyboard.press('Tab');
  await usage.focus();
  await tip.waitFor();
  assert.equal(await page.locator('.tooltip-details-row').count(), 4, 'keyboard users can read the breakdown');
  await page.keyboard.press('Escape');
  await noTip('Escape dismisses the explanation');

  // Exercise variable-length user content in the actual global tooltip layer.
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'tooltip-content-fixture';
    fixture.style.cssText = 'position:fixed;bottom:80px;right:30px;z-index:1000;background:white;padding:10px';
    fixture.innerHTML = '<button id="tooltip-name" title="完整内容 Full content" aria-label="完整内容 Full content" data-tooltip-overflow style="width:300px"><span style="display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">完整内容 Full content</span></button>'
      + '<button id="tooltip-both" title="模型名称" aria-label="模型名称" data-tooltip-overflow data-tooltip-icon-only style="width:120px"><span style="display:none">模型名称</span><svg width="16" height="16" aria-hidden="true"></svg></button>';
    document.body.append(fixture);
  });
  const name = page.locator('#tooltip-name');
  await hover(name);
  await noTip('fully visible user content is not repeated');
  assert.equal(await name.getAttribute('title'), null);
  await name.evaluate(element => { element.style.width = '60px'; });
  await hover(name);
  assert.equal(await tip.innerText(), '完整内容 Full content', 'clipped descendant content exposes its full text');
  await hover(page.locator('#tooltip-both'));
  assert.equal(await tip.innerText(), '模型名称', 'icon-only and overflow conditions are alternatives');
  await reset();
  await page.evaluate(() => document.querySelector('#tooltip-content-fixture').remove());

  // The new note affordance uses the existing content editor and draft route.
  await page.evaluate(() => window.__store.setState(state => ({ nodes: [...state.nodes, {
    id: 'note', type: 'thought', position: { x: 1080, y: 220 }, width: 380,
    data: { stepKind: 'note', question: '便笺正文', response: '', attachments: [], tokenCount: 4 },
  }] })));
  const editNote = page.locator('[data-note-edit]');
  await editNote.click();
  const note = page.locator('.react-flow__node[data-id="note"]');
  assert.equal(await note.locator('textarea').inputValue(), '便笺正文');
  await page.keyboard.press('Escape');
  await reset();
  await page.evaluate(() => window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${output}/canvas.png` });

  assert.deepEqual(writes, [], 'hover/focus and local edits never invoke remote actions');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS tooltip relevance, responsive controls, accessible names, token details, pointer/keyboard dismissal, and note editing');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally {
  await browser.close();
}
