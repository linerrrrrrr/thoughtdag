// Run against an isolated Vite server with THOUGHTDAG_DISK_STORAGE=1.
// Uses a fresh browser context and synthetic data, never the user's profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const origin = process.env.APP_URL ?? 'http://127.0.0.1:5199';
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1365, height: 768 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
await page.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } }));

try {
  await page.goto(`${origin}/favicon.svg`);
  await page.evaluate(async () => {
    localStorage.setItem('thoughtdag.lang', 'zh');
    localStorage.setItem('thoughtdag.tutorialDone', '1');
    localStorage.setItem('thoughtdag.providers', 'synthetic-provider-configuration');
    const open = indexedDB.open('keyval-store', 1);
    await new Promise((resolve, reject) => {
      open.onupgradeneeded = () => open.result.createObjectStore('keyval');
      open.onsuccess = resolve;
      open.onerror = () => reject(open.error);
    });
    const db = open.result;
    const tx = db.transaction('keyval', 'readwrite');
    const store = tx.objectStore('keyval');
    const now = Date.now();
    store.put({ projects: [{ id: 'migration-test', name: 'Migration Test', createdAt: now, updatedAt: now }], activeId: 'migration-test' }, 'thoughtdag:projects');
    store.put({ state: { nodes: [{ id: 'node', type: 'thought', position: { x: 0, y: 0 }, data: {
      question: 'Synthetic migration canvas', response: '', responses: [], responseIndex: -1,
      isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 0, highlights: [],
      highlightMode: 'off', attachments: [{ id: 'doc', name: 'sample.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 12, content: '', contentInVault: true, editedDocxRevision: 'saved-revision', extractedText: 'Original', editedText: 'Edited' }],
    } }], edges: [], events: [] }, version: 1 }, 'thoughtdag:project:migration-test');
    store.put('UEsDB-original', 'att-content:doc');
    store.put('UEsDB-edited', 'att-docx-revision:saved-revision');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__projects?.getState().activeId === 'migration-test', null, { timeout: 30000 });
  const first = await page.evaluate(async () => {
    const data = await import('/src/lib/disk-storage.ts');
    return { original: await data.get('att-content:doc'), revision: await data.get('att-docx-revision:saved-revision'),
      providers: data.appSettings.getItem('thoughtdag.providers') };
  });
  assert.deepEqual(first, { original: 'UEsDB-original', revision: 'UEsDB-edited', providers: 'synthetic-provider-configuration' });
  await page.evaluate(async () => {
    const data = await import('/src/lib/disk-storage.ts');
    await data.set('att-docx-revision:saved-revision', 'UEsDB-updated');
    data.appSettings.setItem('thoughtdag.lang', 'en');
    await data.flushDiskWrites();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__projects?.getState().activeId === 'migration-test', null, { timeout: 30000 });
  const reopened = await page.evaluate(async () => {
    const data = await import('/src/lib/disk-storage.ts');
    const dbOpen = indexedDB.open('keyval-store', 1);
    await new Promise((resolve, reject) => { dbOpen.onsuccess = resolve; dbOpen.onerror = () => reject(dbOpen.error); });
    const original = await new Promise((resolve, reject) => {
      const req = dbOpen.result.transaction('keyval').objectStore('keyval').get('att-docx-revision:saved-revision');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    dbOpen.result.close();
    return { revision: await data.get('att-docx-revision:saved-revision'), language: data.appSettings.getItem('thoughtdag.lang'), sourceRevision: original };
  });
  assert.deepEqual(reopened, { revision: 'UEsDB-updated', language: 'en', sourceRevision: 'UEsDB-edited' });
  await page.evaluate(async () => {
    const data = await import('/src/lib/disk-storage.ts');
    await data.flushDiskWrites();
    const dbOpen = indexedDB.open('keyval-store', 1);
    await new Promise((resolve, reject) => { dbOpen.onsuccess = resolve; dbOpen.onerror = () => reject(dbOpen.error); });
    const tx = dbOpen.result.transaction('keyval', 'readwrite');
    tx.objectStore('keyval').delete('thoughtdag:disk-storage:locator:v1');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    dbOpen.result.close();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '发现已有本地数据' }).waitFor({ timeout: 15000 });
  if (process.env.STORAGE_RECOVERY_SCREENSHOT) await page.screenshot({ path: process.env.STORAGE_RECOVERY_SCREENSHOT });
  await page.locator('[data-storage-recovery-namespace]').first().click();
  await page.waitForFunction(() => window.__projects?.getState().activeId === 'migration-test', null, { timeout: 30000 });
  assert.equal(await page.evaluate(async () => (await import('/src/lib/disk-storage.ts')).get('att-docx-revision:saved-revision')), 'UEsDB-updated');
  await page.route('**/__thoughtdag_storage', route => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '无法打开本地数据' }).waitFor({ timeout: 15000 });
  if (process.env.STORAGE_SCREENSHOT) await page.screenshot({ path: process.env.STORAGE_SCREENSHOT });
  await page.unroute('**/__thoughtdag_storage');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__projects?.getState().activeId === 'migration-test', null, { timeout: 30000 });
  assert.deepEqual(pageErrors, []);
  console.log('PASS browser migration, DOCX data, settings, reload, recovery and unavailable-storage guard');
} finally {
  await context.close();
  await browser.close();
}
