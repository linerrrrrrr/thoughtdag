// Real production UI only: isolated browser, generated DOCX, no development hooks.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { documentBrowser, dropFixtureFiles } from './fixtures/original-file-browser.mjs';
import JSZip from 'jszip';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';

const output = 'local-tests/superdoc';
await mkdir(output, { recursive: true });
const fixtures = await Promise.all(['ALPHA', 'BRAVO', 'CHARLIE'].map(createSuperdocFixture));
const filePaths = fixtures.map((_, index) => `${output}/production-source-${index + 1}.docx`);
await Promise.all(fixtures.map((fixture, index) => writeFile(filePaths[index], fixture.buffer)));
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5196/';
const { context, close } = await documentBrowser(appUrl, { executablePath, viewport: { width: 1920, height: 1080 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [], failures = [], badResponses = [], writes = [], checks = [];
async function geometry(label) {
  const snapshot = await page.evaluate(() => ({
    viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
    elements: ['.react-flow__node', '.content-card', '[data-content-body]', '.docx-workspace', '.docx-view-host', '.superdoc'].map(selector => {
      const element = document.querySelector(selector);
      if (!element) return { selector, missing: true };
      const { x, y, width, height } = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { selector, rect: { x, y, width, height }, height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
    }),
  }));
  await writeFile(`${output}/production-geometry-${label}.json`, JSON.stringify(snapshot, null, 2));
}
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('response', response => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); });
await context.routeWebSocket('**', socket => socket.close());
// The optional public repository counter is unrelated to local document editing.
await context.route('https://api.github.com/repos/chenxiachan/thoughtdag', route => route.fulfill({ json: { stargazers_count: 0 } }));
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
  localStorage.setItem('thoughtdag.lighting', 'light');
});
try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => typeof window.__store), 'undefined');
  await page.locator('input[type=file]').nth(1).waitFor({ state: 'attached' });
  await dropFixtureFiles(page, filePaths, 1200, 550);
  const roots = page.locator('.react-flow__node [data-superdoc-editor]');
  const root = roots.first();
  const canvasNode = root.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]');
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node [data-superdoc-ready="true"]').length === 3);
  await geometry('ready');
  assert.equal(await page.locator('[data-material-reader]').count(), 0, 'DOCX import must stay on the canvas without opening a reader');
  checks.push('Production DOCX upload opens three native editors directly in their canvas nodes without a reader');
  // Wait for the import's own fit animation; no test-side viewport correction.
  await page.waitForTimeout(600);
  await geometry('settled');
  for (let index = 0; index < 3; index++) {
    const nodeBounds = await roots.nth(index).locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]').boundingBox();
    assert.ok(nodeBounds && nodeBounds.x >= 0 && nodeBounds.x + nodeBounds.width <= 1920 && nodeBounds.y >= 0 && nodeBounds.y + nodeBounds.height <= 1080, `Imported node ${index + 1} fits the initial viewport`);
  }
  const scroll = root.locator('[data-superdoc-scroll]');
  const scrollBounds = await scroll.evaluate(element => [element, ...element.querySelectorAll('*')].filter(child => child.clientHeight > 0 && child.scrollHeight > child.clientHeight + 100).map(child => ({ className: child.className, client: child.clientHeight, scroll: child.scrollHeight })));
  assert.ok(scrollBounds.length > 0, 'Native pages overflow inside the node instead of stretching its height');
  const viewportBeforeScroll = await page.locator('.react-flow__viewport').getAttribute('style');
  await scroll.hover();
  await page.mouse.wheel(0, 650);
  await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node [data-superdoc-scroll], .react-flow__node [data-superdoc-scroll] *')].some(element => element.scrollTop > 100));
  assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), viewportBeforeScroll);
  await page.mouse.wheel(0, -650);
  await page.waitForTimeout(200);
  checks.push('The initial canvas node fits the viewport and native pages have an internal scroll region');
  await root.getByText('ALPHA original document', { exact: true }).first().click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('CANVAS-EDIT ', { delay: 50 });
  await page.waitForFunction(() => document.querySelector('.react-flow__node [data-superdoc-editor]')?.textContent?.includes('CANVAS-EDIT'));
  await page.locator('[data-superdoc-toolbar]').waitFor();
  assert.equal(await root.getAttribute('data-superdoc-dirty'), 'true');
  checks.push('Real keyboard input edits the canvas document and activates its shared toolbar');
  await roots.nth(1).getByText('BRAVO original document', { exact: true }).first().click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('SECOND-EDIT ', { delay: 50 });
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node [data-superdoc-editor]')[1]?.textContent?.includes('SECOND-EDIT'));
  assert.ok((await root.textContent()).includes('CANVAS-EDIT'));
  assert.equal(await roots.locator('.superdoc').count(), 3);
  assert.equal(await page.locator('[data-material-reader]').count(), 0);
  checks.push('Switching between canvas nodes preserves all three editors and each document edit');
  await page.screenshot({ path: `${output}/canvas-editing-production.png` });
  const [download] = await Promise.all([page.waitForEvent('download'), canvasNode.locator('[data-superdoc-export]').click()]);
  await download.saveAs(`${output}/production-edited.docx`);
  const zip = await JSZip.loadAsync(await readFile(`${output}/production-edited.docx`));
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /CANVAS-EDIT/);
  assert.match(xml, /w:gridSpan/);
  assert.match(xml, /w:vMerge/);
  assert.ok(Object.keys(zip.files).some(name => name.startsWith('word/media/')));
  checks.push('Production ZIP worker exports the edited native DOCX with image and merged table structures');
  await canvasNode.locator('[data-superdoc-save]').click();
  await page.waitForFunction(() => document.querySelector('.react-flow__node [data-superdoc-editor]')?.getAttribute('data-superdoc-dirty') === 'false');
  assert.deepEqual(await readFile(filePaths[0]), fixtures[0].buffer);
  assert.deepEqual(await readFile(filePaths[1]), fixtures[1].buffer);
  checks.push('Saving in production retains the node revision and leaves both imported OS files untouched');
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  assert.deepEqual(badResponses, []);
  assert.deepEqual(writes, []);
  const result = { checks, errors, failures, badResponses, writes, devHooks: false };
  await writeFile(`${output}/production-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await geometry('failure');
  await page.screenshot({ path: `${output}/production-failure.png` });
  await writeFile(`${output}/production-failure.txt`, `${error.stack}\n${await page.locator('body').innerText()}\n${JSON.stringify({ errors, failures, badResponses, writes }, null, 2)}`);
  throw error;
} finally { await close(); }
