// Exercise the real project switcher and library against an isolated, pre-folder IndexedDB catalog.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';
import { createTestServer } from './fixtures/vite-test-server.mjs';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const output = await mkdtemp(join(tmpdir(), 'thoughtdag-library-ui-'));

function graph(id, question) {
  return { version: 1, nodes: [{ id, type: 'thought', position: { x: 100, y: 120 }, data: {
    question, response: '从这次访谈中提取线索。', responses: ['从这次访谈中提取线索。'], responseIndex: 0,
    isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 0,
    highlights: [], highlightMode: 'off', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
  } }], edges: [], events: [], lastNodeNumber: 1 };
}

async function seedLegacyCatalog(page) {
  const existing = [
    ['legacy-active', '工作草稿'], ['legacy-research', '访谈提纲'], ['legacy-archive', '前期结论'], ['legacy-other', '版本计划'],
  ].map(([id, name]) => ({ id, name, graph: graph(id + '-node', name + '的原始问题') }));
  await page.evaluate(async projects => {
    localStorage.setItem('thoughtdag.seeded', 'yes');
    localStorage.setItem('thoughtdag.tutorialDone', '1');
    localStorage.setItem('thoughtdag.lang', 'zh');
    localStorage.setItem('thoughtdag.lighting', 'light');
    const request = indexedDB.open('keyval-store', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keyval');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('keyval', 'readwrite');
    const store = tx.objectStore('keyval');
    const now = Date.now();
    store.put({
      activeId: projects[0].id,
      projects: projects.map(({ id, name }, index) => ({ id, name, createdAt: now - index * 1000, updatedAt: now - index * 1000 })),
    }, 'thoughtdag:projects');
    for (const { id, graph } of projects) {
      const { version, ...state } = graph;
      store.put(JSON.stringify({ version, state }), 'thoughtdag:project:' + id);
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, existing);
}

const library = page => page.locator('[data-canvas-library]');
const switcher = page => page.locator('[data-project-switcher] .canvas-project-button');
const cards = page => library(page).locator('[data-canvas-library-card]');
const folder = (page, id) => library(page).locator('[data-library-folder="' + id + '"]');
const waitForCards = (page, count) => page.waitForFunction(n =>
  document.querySelectorAll('[data-canvas-library] [data-canvas-library-card]').length === n, count);

async function ready(page) {
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__projects?.getState().activeId && window.__ui);
  await page.evaluate(() => {
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setTutorialOpen(false);
  });
}

async function openLibrary(page) {
  await switcher(page).click();
  await page.locator('[data-project-menu] [data-open-canvas-library]').click();
  await library(page).waitFor();
}

async function checkLibraryEntryPoints(page) {
  const trigger = switcher(page);
  const menu = page.locator('[data-project-menu]');
  const menuEntry = menu.locator('[data-open-canvas-library]');
  for (const startWithMenuOpen of [false, true]) {
    if (startWithMenuOpen) {
      await trigger.click();
      await menuEntry.waitFor();
      assert.equal(await library(page).isVisible(), false, 'A single click opens the recent canvases menu');
    }
    await trigger.dblclick();
    await library(page).waitFor();
    assert.equal(await menu.isVisible(), false, 'Double-click must replace the recent canvases menu');
    await page.keyboard.press('Escape');
    await library(page).waitFor({ state: 'hidden' });
    await trigger.and(page.locator(':focus')).waitFor();
    assert.equal(await menu.isVisible(), false, 'Closing the library must return directly to the canvas');
  }
  await page.keyboard.press('Enter');
  await menuEntry.waitFor();
  await menuEntry.press('Enter');
  await library(page).waitFor();
  console.log('PASS double-click from either menu state, Escape focus restoration and keyboard menu entry');
}

async function createNamed(page, action, name) {
  await library(page).locator(action).click();
  await page.locator('[data-library-name]').fill(name);
  await page.locator('[data-library-create]').click();
  await page.locator('[data-library-name]').waitFor({ state: 'hidden' });
}

async function move(page, projectId, destination) {
  await folder(page, '').click();
  await library(page).locator('[data-canvas-library-card="' + projectId + '"]').getByRole('button', { name: /^移动画布/ }).click();
  await page.locator('[data-library-move-to="' + destination + '"]').click();
}

function file(name, backup) {
  return { name, type: 'application/json', text: typeof backup === 'string' ? backup : JSON.stringify(backup) };
}

async function pickFiles(page, files) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    library(page).locator('[data-library-upload]').click(),
  ]);
  assert.ok(await chooser.element().evaluate(input => input.hasAttribute('data-library-file-input')));
  assert.ok(chooser.isMultiple());
  await chooser.setFiles(files.map(({ name, type, text }) => ({ name, mimeType: type, buffer: Buffer.from(text, 'utf8') })));
}

async function dropFiles(page, files) {
  await library(page).locator('[data-library-upload]').evaluate((target, files) => {
    const transfer = new DataTransfer();
    for (const { name, type, text } of files) transfer.items.add(new File([text], name, { type }));
    for (const eventName of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(eventName, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }
  }, files);
}

const activeGraph = page => page.evaluate(() => ({
  id: window.__projects.getState().activeId,
  questions: window.__store.getState().nodes.map(node => [node.id, node.data.question]),
}));

process.env.THOUGHTDAG_DISK_STORAGE = '0';
const vite = await createTestServer({ server: { open: false, hmr: false, watch: null }, logLevel: 'error' });
let browser;
try {
  await vite.listen();
  const url = vite.resolvedUrls.local[0];
  const origin = new URL(url).origin;
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true,
  });
  await context.route('**/*', route => {
    const request = new URL(route.request().url());
    if (request.origin !== origin || request.pathname.startsWith('/api/')) return route.abort();
    if (request.pathname === '/__thoughtdag_storage') return route.fulfill({ status: 404, body: '' });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [], downloads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download));
  page.setDefaultTimeout(20000);
  await page.goto(new URL('/favicon.svg', url).href);
  await seedLegacyCatalog(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await checkLibraryEntryPoints(page);
  await folder(page, '').click();
  await waitForCards(page, 4);

  await createNamed(page, '[data-library-new-folder]', '用户研究');
  const researchButton = library(page).locator('[data-library-folder]').filter({ hasText: '用户研究' });
  const researchId = await researchButton.getAttribute('data-library-folder');
  await createNamed(page, '[data-library-new-folder]', '产品计划');
  const otherButton = library(page).locator('[data-library-folder]').filter({ hasText: '产品计划' });
  const otherId = await otherButton.getAttribute('data-library-folder');
  assert.ok(researchId && otherId && researchId !== otherId);
  await move(page, 'legacy-research', researchId);
  await move(page, 'legacy-archive', researchId);
  await move(page, 'legacy-other', otherId);
  await page.evaluate(async () => (await import('/src/store/projects.ts')).setProjectArchived('legacy-archive', true));
  await folder(page, researchId).click();
  await waitForCards(page, 1);
  assert.match(await cards(page).innerText(), /访谈提纲/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await openLibrary(page);
  await folder(page, researchId).click();
  await waitForCards(page, 1);
  assert.equal(await cards(page).first().getAttribute('data-canvas-library-card'), 'legacy-research');
  console.log('PASS old catalog, one-level folders and saved membership after refresh');

  await createNamed(page, '[data-library-new-canvas]', '观察笔记');
  if (!(await library(page).isVisible())) await openLibrary(page);
  await folder(page, researchId).click();
  await waitForCards(page, 2);
  const beforeImport = await activeGraph(page);
  const named = '研究纪要';
  const empty = file('空白.thoughtdag.json', { version: 1, name: '空白画布', nodes: [], edges: [] });
  const first = file('第一份.thoughtdag.json', { ...graph('first-interview', '点选加入的第一份'), name: named });
  await pickFiles(page, [empty, first]);
  await waitForCards(page, 4);
  const second = file('第二份.json', { ...graph('second-interview', '拖入加入的第二份'), name: named });
  await dropFiles(page, [second, file('损坏.thoughtdag.json', '{')]);
  await waitForCards(page, 5);
  await library(page).getByText(/损坏\.thoughtdag\.json/).first().waitFor();
  assert.equal(await cards(page).filter({ hasText: named }).count(), 2);
  assert.deepEqual(await activeGraph(page), beforeImport, 'Background imports must preserve the active canvas and graph');
  console.log('PASS multi-file picker, empty canvas, mixed-validity drag/drop and unchanged active canvas');

  await library(page).locator('[data-library-back]').click();
  await library(page).waitFor({ state: 'hidden' });
  assert.deepEqual(await activeGraph(page), beforeImport);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await openLibrary(page);
  await folder(page, researchId).click();
  await waitForCards(page, 5);
  await page.screenshot({ path: join(output, 'light-zh-desktop.png') });
  const openExport = () => library(page).locator('[data-library-export]').click();
  await openExport();
  await page.locator('[data-library-download]').waitFor();
  const archivedRow = page.locator('[data-library-dialog="export"] li').filter({ hasText: '前期结论' });
  assert.match(await archivedRow.innerText(), /已归档/);
  await page.keyboard.press('Escape');
  await page.locator('[data-library-download]').waitFor({ state: 'hidden' });
  assert.ok(await library(page).isVisible(), 'Esc must only close the export preview');
  assert.equal(downloads.length, 0, 'Previewing or cancelling must not download');
  await openExport();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-library-download]').click()]);
  assert.equal(await download.failure(), null);
  assert.equal(download.suggestedFilename(), '用户研究.zip');
  const zip = await JSZip.loadAsync(await readFile(await download.path()), { checkCRC32: true });
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  assert.equal(entries.length, 6);
  assert.ok(entries.every(entry => entry.name.endsWith('.thoughtdag.json')));
  const payloads = await Promise.all(entries.map(async entry => JSON.parse(await entry.async('string'))));
  assert.deepEqual(payloads.map(record => record.name).sort(), ['访谈提纲','前期结论','观察笔记','空白画布',named,named].sort());
  assert.deepEqual(payloads.filter(record => record.name === named).map(record => record.nodes[0].data.question).sort(),
    ['点选加入的第一份','拖入加入的第二份'].sort(), 'Both different same-name canvases must survive as separate archive entries');
  assert.equal(payloads.find(record => record.name === '前期结论').nodes[0].data.question, '前期结论的原始问题');
  assert.deepEqual(payloads.find(record => record.name === '空白画布').nodes, []);
  assert.equal(downloads.length, 1);
  assert.deepEqual(await activeGraph(page), beforeImport);
  console.log('PASS explicit folder export, archived contents, duplicate filenames and no unrelated canvases');

  await page.evaluate(async () => {
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('en');
  });
  await page.setViewportSize({ width: 375, height: 812 });
  const nav = library(page).locator('[data-library-nav-toggle]').first();
  await nav.click();
  await folder(page, otherId).click();
  await waitForCards(page, 1);
  assert.match(await cards(page).innerText(), /版本计划/);
  await nav.click();
  await folder(page, researchId).click();
  await waitForCards(page, 5);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.ok(await library(page).evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1));
  await page.locator('[data-toaster] > *').first().waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(output, 'dark-en-mobile.png') });
  await library(page).locator('[data-canvas-library-card="legacy-research"]').getByRole('button', { name: /^Open/ }).click();
  await library(page).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__projects.getState().activeId === 'legacy-research');
  assert.equal((await activeGraph(page)).questions[0][1], '访谈提纲的原始问题');
  assert.deepEqual(errors, []);
  console.log('PASS localized mobile navigation and opening the selected canvas. Screenshots:', output);
} finally {
  await browser?.close();
  await vite.close();
}
