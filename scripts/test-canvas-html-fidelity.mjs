// Run node scripts/test-canvas-html-fidelity.mjs to compare the real menu download
// with a frozen copy of the actual editor after applying its published removal list.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createTestServer } from './fixtures/vite-test-server.mjs';

const output = resolve('local-tests/canvas-html-fidelity');
const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
await mkdir(output, { recursive: true });
const viewport = { width: 1440, height: 900 };
const cases = [
  { theme: 'light', paper: 'plain', camera: { x: 110, y: 98, zoom: 1 }, panel: false },
  { theme: 'dark', paper: 'grid', camera: { x: 96, y: 126, zoom: .95 }, panel: true },
].filter(item => !process.env.FIDELITY_THEME || process.env.FIDELITY_THEME === item.theme);
assert.ok(cases.length);

const regions = {
  toolbar: '[data-canvas-header]', project: '.canvas-project-button', frameMenu: '[data-frame-nav-trigger]',
  controls: '.react-flow__controls', minimap: '.react-flow__minimap', pan: '.react-flow__controls-pan',
  zoomIn: '.react-flow__controls-zoomin', zoomOut: '.react-flow__controls-zoomout', fit: '.react-flow__controls-fitview',
  conversation: '.react-flow__node[data-id="visits"] [data-thought-body]',
  details: '[data-node-details="visits"]', note: '.react-flow__node[data-id="record"] .material-note',
  openNote: '.react-flow__node[data-id="record"] [data-open-export-reader]', frame: '[data-frame-header]',
  edge: '.react-flow__edge[data-id="observations"] .react-flow__edge-path',
};
// These are native editor commands, checked independently of the exporter's removal list.
const authoring = {
  add: '[data-content-palette]', settings: '[data-settings-entry]', more: '[data-toolbar-more]',
  layout: '[data-layout-entry]', lock: '.react-flow__controls-interactive', noteEdit: '[data-note-edit]',
  search: '[data-search-entry]', chat: '[data-chat-entry]', model: '[data-model-picker-trigger]',
  switchProject: 'button.canvas-project-button',
  questionSend: '[data-question-send]', editResponse: '[data-edit-response]',
  askMaterial: '[data-reader-wholeask], [data-reader-askbar]', send: 'button:has(svg.lucide-send)',
  upload: 'input[type="file"]', graphEdit: '.react-flow__resize-control',
};
const snap = { animations: 'disabled', caret: 'hide' };
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});

async function frozenCanvas(editor) {
  // Keep the real application DOM and styles. Never read HTML, CSS or graph markup
  // from the export under test. The reference page runs no application scripts.
  const html = await editor.evaluate(async () => {
    const { applyReadonlyCanvas } = await import('/src/lib/canvas-html-readonly.ts');
    const copy = document.documentElement.cloneNode(true);
    copy.querySelectorAll('script, link[rel=modulepreload]').forEach(el => el.remove());
    applyReadonlyCanvas(copy);
    return '<!doctype html>' + copy.outerHTML;
  });
  const reference = await editor.context().newPage();
  const url = new URL('/__readonly_reference__', editor.url()).href;
  await reference.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await reference.goto(url);
  await reference.mouse.move(15, viewport.height - 10);
  await settle(reference);
  return reference;
}

async function assertRemoved(page, html) {
  const remaining = await page.evaluate(({ selectors, html }) => {
    const hits = [];
    function visit(root) {
      for (const [name, selector] of Object.entries(selectors)) {
        for (const el of root.querySelectorAll(selector)) hits.push(name + ' ' + el.outerHTML.slice(0, 160));
      }
      for (const template of root.querySelectorAll('template')) visit(template.content);
    }
    visit(html === undefined ? document : new DOMParser().parseFromString(html, 'text/html'));
    return hits;
  }, { selectors: authoring, html });
  assert.deepEqual(remaining, [], 'Unsupported controls must be absent from the DOM and every reader template');
}

async function assertPresent(page, names) {
  for (const name of names) assert.ok(await page.locator(authoring[name]).count(), 'Native fixture must expose ' + name);
}

async function seed(editor, options) {
  await editor.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui, undefined, { timeout: 90000 });
  await editor.evaluate(async ({ camera, panel }) => {
    const { useProjects, renameProject } = await import('/src/store/projects.ts');
    await renameProject(useProjects.getState().activeId, '阅览室观察笔记');
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false);
    ui.setReleaseNotesOpen(false);
    const node = (id, x, y, width, height, data) => ({
      id, type: 'thought', position: { x, y }, width, height, style: { width, height }, data: {
        question: '', response: '', responses: [], responseIndex: 0, isEditing: false, isLoading: false, isCollapsed: false,
        highlights: [], highlightMode: 'off', tokenCount: 0, attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], ...data,
      },
    });
    const answer = '先记录**最常出现的等待环节**，再试验分流。\n\n| 观察时段 | 入馆人数 |\n| --- | ---: |\n| 09:00–10:00 | 32 |\n| 10:00–11:00 | 48 |\n\n把登记和问询分开，两处服务台分别计时。';
    const nodes = [
      node('group', 26, 26, 1100, 500, { stepKind: 'frame', question: '周末观察', frameColor: 'blue' }),
      node('visits', 72, 105, 468, 355, { displayName: '入口处的等待', question: '周末到馆读者较多，应该先观察哪个环节？',
        response: answer, responses: [answer], model: 'writing-model', tokenCount: 172,
        highlights: [{ id: 'waiting', text: '最常出现的等待环节' }], highlightMode: 'tag' }),
      node('record', 663, 160, 408, 254, { stepKind: 'note', displayName: '现场记录',
        question: '同一队列里，有人归还图书，也有人询问自习座位。\n\n**下次观察**\n\n- 记录两类读者各自的等待时间。\n- 标明临时增加服务台的时刻。' }),
      node('outside', 2920, 180, 435, 250, { stepKind: 'note', displayName: '二层阅览区',
        question: '开放自习室之前，先把剩余座位数写在入口标牌上。' }),
    ];
    const edges = [
      { id: 'observations', source: 'record', target: 'visits', type: 'smoothstep',
        data: { label: '待核对' }, style: { stroke: '#258373', strokeWidth: 3 } },
      { id: 'followup', source: 'outside', target: 'visits', type: 'smoothstep',
        data: { isCrossLink: true }, style: { stroke: '#b0814b', strokeWidth: 2, strokeDasharray: '7 4' } },
    ];
    window.__store.getState().setNodes(nodes);
    window.__store.getState().setEdges(edges);
    ui.setPanelOpen(panel, panel ? 'visits' : undefined);
    await window.__rf.setViewport(camera, { duration: 0 });
  }, options);
  await editor.locator(regions.note).waitFor();
  await editor.waitForFunction(() => window.__rf.getNode('visits')?.measured?.width);
  await editor.evaluate(async camera => {
    await Promise.all([...document.getAnimations()].filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    await window.__rf.setViewport(camera, { duration: 0 });
  }, options.camera);
  await editor.locator(regions.conversation).waitFor();
  await editor.locator('.react-flow__edge[data-id="observations"] path.react-flow__edge-path').waitFor();
  if (options.panel) await editor.locator('[data-focus-panel]').waitFor();
  await editor.mouse.move(15, viewport.height - 10);
  await settle(editor);
  await editor.locator('.react-flow__node[data-id="outside"]').waitFor({ state: 'detached' });
}

async function measurements(page, selectors) {
  return page.evaluate(selectors => {
    const result = {};
    for (const [name, selector] of Object.entries(selectors)) {
      const target = document.querySelector(selector);
      if (!target) continue;
      const { x, y, width, height } = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      result[name] = { box: [x, y, width, height], palette: [style.color, style.backgroundColor, style.borderTopColor,
        style.fill, style.stroke, style.strokeWidth, style.strokeDasharray],
        type: [style.fontFamily, style.fontSize, style.lineHeight] };
    }
    return result;
  }, selectors);
}

async function comparePixels(page, before, after, samples) {
  return page.evaluate(async ({ images, samples }) => {
    const [left, right] = await Promise.all(images.map(async data => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      return img;
    }));
    const { width, height } = left;
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height + 44;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, canvas.width, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px system-ui';
    ctx.fillText('原画布 · 按清单移除写操作', 16, 28);
    ctx.fillText('离线 HTML', width + 16, 28);
    ctx.drawImage(left, 0, 44);
    ctx.drawImage(right, width, 44);
    const a = ctx.getImageData(0, 44, width, height).data;
    const b = ctx.getImageData(width, 44, width, height).data;
    const ratios = {};
    const exact = { changed: 0, maxChannelDelta: 0, total: width * height };
    for (const [key, rect] of Object.entries({ screen: [0, 0, width, height], ...samples })) {
      const [leftX, top, w, h] = rect, endX = Math.min(width, Math.ceil(leftX + w)), endY = Math.min(height, Math.ceil(top + h));
      let total = 0, changed = 0;
      for (let y = Math.max(0, Math.floor(top)); y < endY; y++) {
        for (let x = Math.max(0, Math.floor(leftX)); x < endX; x++) {
          const i = (y * width + x) * 4;
          const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
          if (delta > 14) changed++;
          if (key === 'screen' && delta) {
            exact.changed++;
            exact.maxChannelDelta = Math.max(exact.maxChannelDelta, delta);
          }
          total++;
        }
      }
      if (total) ratios[key] = changed / total;
    }
    return { ratios, exact, comparison: canvas.toDataURL('image/png').split(',')[1] };
  }, { images: [before.toString('base64'), after.toString('base64')], samples });
}

async function captureReference(editor, selectors, prefix) {
  await editor.screenshot({ ...snap, path: resolve(output, prefix + '-original.png') });
  const reference = await frozenCanvas(editor);
  try {
    await assertRemoved(reference);
    const expected = await measurements(reference, selectors);
    assert.deepEqual(Object.keys(expected), Object.keys(selectors), 'The reference must retain each reading surface');
    const png = await reference.screenshot({ ...snap, path: resolve(output, prefix + '-reference.png') });
    return { expected, png };
  } finally {
    await reference.close();
  }
}

async function assertVisualMatch(page, selectors, reference, prefix) {
  const actual = await measurements(page, selectors);
  const { expected } = reference;
  const png = await page.screenshot({ ...snap, path: resolve(output, prefix + '-offline.png') });
  const { ratios, exact, comparison } = await comparePixels(page, reference.png, png,
    Object.fromEntries(Object.entries(expected).map(([name, { box }]) => [name, box])));
  await writeFile(resolve(output, prefix + '-comparison.png'), Buffer.from(comparison, 'base64'));
  console.log(prefix + ' pixel differences', exact, 'fractions above 14/255', ratios);
  assert.deepEqual(Object.keys(actual), Object.keys(expected), 'Offline canvas must retain each native reading surface');
  for (const [name, target] of Object.entries(expected)) {
    assert.deepEqual(actual[name].palette, target.palette, prefix + ' ' + name + ' colors');
    assert.deepEqual(actual[name].type, target.type, prefix + ' ' + name + ' typography');
    assert.ok(actual[name].box.every((n, i) => Math.abs(n - target.box[i]) <= 1),
      prefix + ' ' + name + ' geometry: ' + actual[name].box + ' vs ' + target.box);
    if (ratios[name] !== undefined) assert.ok(ratios[name] < .015, prefix + ' ' + name + ' changed ' + ratios[name]);
  }
  assert.ok(ratios.screen < .005, 'Less than 0.5% of the screen may differ by more than 14/255 in any channel');
}

async function check(browser, url, options) {
  const { theme, paper, panel } = options;
  const selectors = { ...regions, ...(panel ? { panel: '[data-focus-panel]' } : {}) };
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', deviceScaleFactor: 1 });
  const offline = await browser.newContext({ viewport, offline: true, serviceWorkers: 'block', deviceScaleFactor: 1 });
  try {
    await context.addInitScript(({ theme, paper }) => {
      for (const [key, value] of Object.entries({ seeded: 'yes', tutorialDone: '1', lang: 'zh', lighting: theme, paper })) {
        localStorage.setItem('thoughtdag.' + key, value);
      }
    }, { theme, paper });
    await context.route('**/*', route => {
      const req = new URL(route.request().url());
      return req.origin !== new URL(url).origin || req.pathname.startsWith('/api/') ? route.abort() : route.continue();
    });
    const editor = await context.newPage();
    editor.on('console', message => {
      if (message.type() === 'error' && message.text().includes('HTML export failed')) console.error(message.text());
    });
    editor.on('pageerror', error => console.error('Live editor:', error.message));
    await editor.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await seed(editor, options);
    await assertPresent(editor, ['add', 'settings', 'more', 'layout', 'lock', 'noteEdit', 'search', 'chat', 'switchProject',
      ...(panel ? ['editResponse'] : [])]);
    const camera = await editor.locator('.react-flow__viewport').evaluate(el => getComputedStyle(el).transform);
    const reference = await captureReference(editor, selectors, theme);
    await editor.locator('[data-toolbar-more]').click();
    const failure = editor.waitForEvent('console', { predicate: m => m.type() === 'error' && m.text().includes('HTML export failed'), timeout: 150000 })
      .then(message => { throw new Error(message.text()); });
    const [download] = await Promise.all([Promise.race([editor.waitForEvent('download', { timeout: 150000 }), failure]),
      editor.locator('[data-menu-export-html]').click()]);
    const file = resolve(output, theme + '.html');
    await download.saveAs(file);
    const readerSelectors = { reader: '[data-material-reader]', body: '[data-reader-body]', close: '[data-material-reader-close]' };
    let readerReference;
    if (!panel) {
      // The click uses the same book button in the editor and its offline copy.
      await editor.locator(regions.openNote).click();
      await editor.locator(readerSelectors.body).waitFor();
      await editor.locator('[data-toaster] > *').first().waitFor({ state: 'hidden' });
      await editor.mouse.move(15, viewport.height - 10);
      await settle(editor);
      await assertPresent(editor, ['askMaterial', 'send']);
      readerReference = await captureReference(editor, readerSelectors, 'reader');
    }
    await context.close();

    const page = await offline.newPage(), requests = [], errors = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    await page.mouse.move(15, viewport.height - 10);
    await settle(page);
    await assertRemoved(page, await readFile(file, 'utf8'));
    await assertRemoved(page);
    await assertVisualMatch(page, selectors, reference, theme);
    assert.equal(await page.locator('.react-flow__viewport').evaluate(el => getComputedStyle(el).transform), camera);
    assert.equal(await page.locator('span.canvas-project-button').innerText(), '阅览室观察笔记');
    assert.equal(await page.locator('template[data-reading-node="outside"]').count(), 1, 'The offscreen note must travel in the file');
    assert.equal(await page.locator('.react-flow__node[data-id="outside"]').count(), 1, 'Panning must reveal the offscreen note');
    assert.equal(await page.locator('[data-toolbar-more-panel]').count(), 0);
    assert.ok(await page.evaluate(() => !window.__store && !window.__rf), 'The graph editor must not run in the shared file');
    if (readerReference) {
      await page.locator(regions.openNote).click();
      await page.locator(readerSelectors.body).waitFor();
      await page.mouse.move(15, viewport.height - 10);
      await settle(page);
      await assertRemoved(page);
      await assertVisualMatch(page, readerSelectors, readerReference, 'reader');
      if (!await page.locator('[data-reader-docked]').count()) await page.locator('[data-reader-dock]').click();
      await page.locator('[data-reader-docked]').waitFor();
      await page.locator('[data-reader-expand]').click();
      await page.locator('[data-material-reader] [role="dialog"]').waitFor();
      await page.locator('[data-reader-dock]').click();
      await page.locator('[data-reader-docked]').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('[data-material-reader]').waitFor({ state: 'detached' });
    }
    if (panel) await page.locator('[data-node-details-close]').click();
    await page.locator('[data-node-details="visits"]').click();
    await page.locator('[data-focus-panel][data-focus-node-id="visits"]').waitFor();
    assert.match(await page.locator('[data-focus-panel]').innerText(), /入口处的等待/);
    await assertRemoved(page);
    await page.locator('[data-node-details-close]').click();
    const editable = 'textarea, input:not([type=hidden]), select, [contenteditable=true], [contenteditable=plaintext-only]';
    assert.deepEqual(await page.locator(editable).evaluateAll(els => els.filter(el =>
      !el.closest('[inert], [hidden]') && !el.matches(':disabled,[readonly]') && el.getClientRects().length).map(el => el.outerHTML.slice(0, 120))), []);
    const note = page.locator('.react-flow__node[data-id="record"]');
    const initial = await note.evaluate(el => [el.style.transform, el.textContent]);
    await note.dispatchEvent('dblclick');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Delete');
    assert.deepEqual(await note.evaluate(el => [el.style.transform, el.textContent]), initial);
    const transform = page.locator('.react-flow__viewport');
    await page.locator('.react-flow__controls-zoomin').click();
    await page.waitForFunction(initial => getComputedStyle(document.querySelector('.react-flow__viewport')).transform !== initial, camera);
    const afterZoom = await transform.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
    assert.ok(afterZoom > options.camera.zoom);
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForFunction(() => {
      const rect = document.querySelector('.react-flow__node[data-id="outside"]').getBoundingClientRect();
      return rect.width > 1 && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1;
    });
    const zoomedOut = await transform.evaluate(el => getComputedStyle(el).transform);
    await page.locator(regions.frameMenu).click();
    const frameMenu = page.locator('[data-frame-nav-panel]');
    await frameMenu.getByRole('button', { name: '周末观察' }).click();
    await frameMenu.waitFor({ state: 'hidden' });
    await page.waitForFunction(previous => {
      const frame = document.querySelector('.react-flow__node[data-id="group"]').getBoundingClientRect();
      const matrix = getComputedStyle(document.querySelector('.react-flow__viewport')).transform;
      const distantNote = document.querySelector('.react-flow__node[data-id="outside"]').getBoundingClientRect();
      return matrix !== previous && distantNote.left > innerWidth && frame.left >= 0 && frame.top >= 0
        && frame.right <= innerWidth + 1 && frame.bottom <= innerHeight + 1;
    }, zoomedOut);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    console.log('PASS ' + theme + ' native shell, camera, controls, graph, typography and offline read-only state');
  } finally {
    await offline.close();
    await context.close();
  }
}

process.env.THOUGHTDAG_DISK_STORAGE = '0';
const server = await createTestServer({ server: { hmr: false, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath, headless: true });
  for (const options of cases) await check(browser, server.resolvedUrls.local[0], options);
} finally {
  await browser?.close();
  await server.close();
}
