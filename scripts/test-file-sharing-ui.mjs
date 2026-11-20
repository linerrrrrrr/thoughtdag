// Verify file sharing and legacy local viewing without contacting the public site.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createTestServer } from './fixtures/vite-test-server.mjs';

const output = resolve('local-tests/file-sharing');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
await mkdir(output, { recursive: true });
process.env.THOUGHTDAG_DISK_STORAGE = '0';
const vite = await createTestServer({ server: { open: false, hmr: false, watch: null }, logLevel: 'error' });
let browser;
try {
  await vite.listen();
  const local = vite.resolvedUrls.local[0];
  const localOrigin = new URL(local).origin;
  const remoteOrigin = 'https://viewer.example.invalid';
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  await context.route('**/*', async route => {
    const request = new URL(route.request().url());
    if (request.origin === remoteOrigin) {
      if (request.pathname.startsWith('/api/')) return route.abort();
      const response = await route.fetch({ url: new URL(request.pathname + request.search, local).href });
      return route.fulfill({ response });
    }
    if (request.origin !== localOrigin || request.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem('thoughtdag.seeded', 'yes');
    localStorage.setItem('thoughtdag.tutorialDone', '1');
    localStorage.setItem('thoughtdag.lang', 'zh');
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(local);
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  const hash = await page.evaluate(async () => {
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    const { buildViewerLink } = await import('/src/lib/viewer.ts');
    useUiStore.getState().setTutorialOpen(false);
    useUiStore.getState().setReleaseNotesOpen(false);
    const node = { id: 'file-sharing-test', type: 'thought', position: { x: 0, y: 0 }, width: 520, height: 280,
      data: { question: '用于验证的示例问题', response: '用于验证的示例回答', responses: ['用于验证的示例回答'], responseIndex: 0,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 0,
        highlights: [], highlightMode: 'off', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [] } };
    window.__store.getState().setNodes([node]);
    window.__store.getState().setEdges([]);
    return new URL(await buildViewerLink([node], [])).hash;
  });
  await page.locator('[data-toolbar-more]').click();
  await page.locator('[data-share-canvas]').click();
  const dialog = page.locator('[data-share-dialog]');
  await dialog.waitFor();
  assert.equal(await dialog.locator('[data-share-copy], [data-share-link], input[readonly]').count(), 0);
  assert.equal(await dialog.locator('[data-share-fullfile]').count(), 1);
  assert.equal(await dialog.locator('[data-share-thought-map]').count(), 1);
  assert.equal(await dialog.locator('input[type=checkbox]').isChecked(), true);
  await page.screenshot({ path: resolve(output, 'share-dialog.png') });
  const [download] = await Promise.all([
    page.waitForEvent('download'), dialog.locator('[data-share-fullfile]').click(),
  ]);
  const payload = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(payload.sharedReadonly, true);
  assert.equal(payload.nodes[0].data.question, '用于验证的示例问题');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  await page.evaluate(async () => {
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
    (await import('/src/i18n/index.ts')).useI18n.getState().setLang('en');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-toolbar-more]').click();
  await page.locator('[data-share-canvas]').click();
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('dialog', { name: 'Share canvas' }).count(), 1);
  assert.equal(await dialog.locator('input[readonly]').count(), 0);
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await page.screenshot({ path: resolve(output, 'share-dialog-narrow-dark.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.evaluate(async () => (await import('/src/i18n/index.ts')).useI18n.getState().setLang('zh'));

  const localViewer = await context.newPage();
  await localViewer.goto(`${local}${hash}`);
  await localViewer.locator('[data-viewer-badge]').waitFor();
  await localViewer.getByText('用于验证的示例问题').first().waitFor();
  assert.equal(await localViewer.locator('[data-share-canvas]').count(), 0);
  console.log('PASS file exports retain their read-only mark and legacy local viewer still opens');

  // Route a synthetic remote origin to the same local Vite source. This checks
  // the public-origin behavior without deploying or sending the sample data.
  const remoteViewer = await context.newPage();
  await remoteViewer.goto(`${remoteOrigin}/${hash}`);
  await remoteViewer.getByText('线上只读链接已停用').waitFor();
  assert.equal(await remoteViewer.locator('[data-viewer-badge], .react-flow__node').count(), 0);
  assert.equal(await remoteViewer.getByText('用于验证的示例问题').count(), 0);
  assert.equal(await remoteViewer.evaluate(async () => {
    try { await (await import('/src/lib/viewer.ts')).buildViewerLink([], []); return true; }
    catch { return false; }
  }), false);
  await remoteViewer.screenshot({ path: resolve(output, 'remote-unavailable.png') });
  console.log('PASS remote read-only URLs neither render their data nor generate new links');
  await context.close();
} finally {
  await browser?.close();
  await vite.close();
}
