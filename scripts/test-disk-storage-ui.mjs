// Run against an isolated Vite server with THOUGHTDAG_DISK_STORAGE=1.
// Uses a fresh browser context and synthetic data, never the user's profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Document, Packer, Paragraph } from 'docx';
import { openModelConnection } from './fixtures/canvas-model-picker.mjs';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const origin = process.env.APP_URL ?? 'http://127.0.0.1:5199';
const alternate = new URL(process.env.APP_URL_SECONDARY ?? origin);
if (alternate.origin === new URL(origin).origin) alternate.hostname = alternate.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1365, height: 768 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
await page.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } }));

try {
  const [originalDocx, editedDocx, updatedDocx] = await Promise.all(['Original', 'Edited', 'Updated'].map(label =>
    Packer.toBase64String(new Document({ sections: [{ children: [new Paragraph(label)] }] }))));
  await page.goto(`${origin}/favicon.svg`);
  await page.evaluate(async ([original, edited]) => {
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
    store.put({ projects: [
      { id: 'migration-test', name: 'Migration Test', createdAt: now, updatedAt: now },
      { id: 'archived-migration', name: 'Archived', createdAt: now, updatedAt: now, archived: true },
    ], activeId: 'migration-test' }, 'thoughtdag:projects');
    store.put({ state: { nodes: [{ id: 'node', type: 'thought', position: { x: 0, y: 0 }, data: {
      question: 'Synthetic migration canvas', response: '', responses: [], responseIndex: -1,
      isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 0, highlights: [],
      highlightMode: 'off', attachments: [{ id: 'doc', name: 'sample.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 12, content: '', contentInVault: true, editedDocxRevision: 'saved-revision', extractedText: 'Original', editedText: 'Edited' }],
    } }], edges: [], events: [] }, version: 1 }, 'thoughtdag:project:migration-test');
    store.put(original, 'att-content:doc');
    store.put(edited, 'att-docx-revision:saved-revision');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, [originalDocx, editedDocx]);
  // Observe the application's own requests. Calling the directory API from
  // the test would create the folders and conceal a missing migration.
  const provisioned = id => page.waitForResponse(response => {
    if (!response.url().endsWith('/__thoughtdag_storage') || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return payload?.op === 'canvasWorkspace' && payload.canvasId === id;
  }, { timeout: 90000 }).then(async response => {
    assert.equal(response.status(), 200);
    return (await response.json()).dir;
  });
  const [existingDir, archivedDir] = await Promise.all([
    provisioned('migration-test'), provisioned('archived-migration'),
    page.goto(origin, { waitUntil: 'domcontentloaded' }),
  ]);
  const workspaceScope = path.dirname(path.dirname(existingDir));
  const folderFor = id => path.join(workspaceScope, id, 'external');
  assert.equal(existingDir, folderFor('migration-test'));
  assert.equal(archivedDir, folderFor('archived-migration'));
  assert.deepEqual(await readdir(existingDir), []);
  assert.deepEqual(await readdir(archivedDir), []);
  await page.waitForFunction(() => window.__projects?.getState().activeId === 'migration-test', null, { timeout: 30000 });
  const first = await page.evaluate(async () => {
    const data = await import('/src/lib/disk-storage.ts');
    return { original: await data.get('att-content:doc'), revision: await data.get('att-docx-revision:saved-revision'),
      providers: data.appSettings.getItem('thoughtdag.providers') };
  });
  assert.deepEqual(first, { original: originalDocx, revision: editedDocx, providers: 'synthetic-provider-configuration' });
  await openModelConnection(page, 'agents');
  await page.locator('[data-agent-connection-status="disconnected"]').waitFor();
  assert.equal(await page.evaluate(() => !!window.desktopAgents), false);
  await page.locator('[data-agent-cwd]').click();
  assert.equal(await page.locator('[data-agent-cwd-path]').textContent(), existingDir);
  assert.equal(await page.locator('[data-agent-permission-chip]').count(), 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-settings-panel]').waitFor({ state: 'detached' });
  console.log('PASS disk-only settings display the actual canvas directory with no agent connection');
  const menu = page.locator('[data-project-menu]');
  const openMenu = async () => {
    if (!await menu.isVisible()) await page.locator('.canvas-project-button').click();
  };
  const row = id => menu.getByRole('button', { name: `复制画布 UUID ${id}`, exact: true }).locator('..');
  const waitForActive = id => page.waitForFunction(id => window.__projects?.getState().activeId === id, id);
  const switchTo = async id => {
    await openMenu();
    await row(id).locator('div.truncate').click();
    await waitForActive(id);
  };
  await openMenu();
  await menu.getByRole('button', { name: '新建画布', exact: true }).click();
  await page.waitForFunction(() => window.__projects.getState().activeId !== 'migration-test');
  const newId = await page.evaluate(() => window.__projects.getState().activeId);
  const newDir = folderFor(newId);
  assert.deepEqual(await readdir(newDir), [], 'a new canvas gets an empty directory immediately');
  const marker = path.join(newDir, 'external-only.txt');
  await writeFile(marker, 'outside the canvas', { flag: 'wx' });
  await openMenu();
  await row(newId).getByRole('button', { name: '重命名' }).click();
  const editor = menu.locator('[data-project-name-editor]');
  await editor.fill('Renamed');
  await editor.press('Enter');
  await row(newId).locator('[data-archive-canvas]').click();
  await waitForActive('migration-test');
  await openMenu();
  await menu.locator('[data-archived-canvases]').click();
  await row(newId).locator('[data-restore-canvas]').click();
  await waitForActive(newId);
  assert.equal(await page.locator('.canvas-project-button').getAttribute('aria-label'), 'Renamed');
  await openMenu();
  await menu.locator('input[type=file]').setInputFiles({ name: 'copy.thoughtdag.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ name: 'Renamed', projectId: newId, nodes: [], edges: [] })) });
  await page.waitForFunction(id => window.__projects.getState().activeId !== id, newId);
  const importedId = await page.evaluate(() => window.__projects.getState().activeId);
  assert.deepEqual(await readdir(folderFor(importedId)), [], 'same-name import makes an independent folder even when the backup carries the source ID');
  await switchTo(newId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(id => window.__projects?.getState().activeId === id && window.__store?.persist.hasHydrated(), newId);
  assert.equal(await readFile(marker, 'utf8'), 'outside the canvas');
  assert.deepEqual(await readdir(newDir), ['external-only.txt']);
  assert.deepEqual(await page.evaluate(() => window.__store.getState().nodes.map(node => node.id)), [],
    'external files do not materialize as canvas nodes on reopen');
  await switchTo('migration-test');
  await page.evaluate(async updated => {
    const data = await import('/src/lib/disk-storage.ts');
    await data.set('att-docx-revision:saved-revision', updated);
    data.appSettings.setItem('thoughtdag.lang', 'en');
    await data.flushDiskWrites();
  }, updatedDocx);
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
  assert.deepEqual(reopened, { revision: updatedDocx, language: 'en', sourceRevision: editedDocx });
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
  await page.waitForFunction(() => window.__projects?.getState().activeId === 'migration-test', null, { timeout: 30000 });
  assert.equal(await page.evaluate(async () => (await import('/src/lib/disk-storage.ts')).get('att-docx-revision:saved-revision')), updatedDocx);
  const second = await context.newPage();
  second.on('pageerror', error => pageErrors.push(error.message));
  await second.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } }));
  await second.goto(alternate.origin, { waitUntil: 'domcontentloaded' });
  await second.waitForFunction(() => window.__projects?.getState().activeId === 'migration-test');
  assert.deepEqual(await second.evaluate(async () => {
    const disk = await import('/src/lib/disk-storage.ts');
    return [await disk.diskCanvasWorkspace('migration-test'), await disk.get('att-docx-revision:saved-revision')];
  }), [existingDir, updatedDocx]);
  const renameInWindow = (tab, id, name) => tab.evaluate(async ([id, name]) => {
    await (await import('/src/store/projects.ts')).renameProject(id, name);
  }, [id, name]);
  await Promise.all([renameInWindow(page, newId, 'From A'), renameInWindow(second, importedId, 'From B')]);
  const projectsOnDisk = await second.evaluate(async () => (await (await import('/src/lib/disk-storage.ts')).get('thoughtdag:projects')).projects);
  assert.equal(projectsOnDisk.find(p => p.id === newId).name, 'From A');
  assert.equal(projectsOnDisk.find(p => p.id === importedId).name, 'From B');
  await openMenu();
  await menu.getByText('From B', { exact: true }).waitFor();
  await second.close();
  await page.route('**/__thoughtdag_storage', route => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '无法打开本地数据' }).waitFor({ timeout: 15000 });
  if (process.env.STORAGE_SCREENSHOT) await page.screenshot({ path: process.env.STORAGE_SCREENSHOT });
  await page.unroute('**/__thoughtdag_storage');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__projects?.getState().activeId === 'migration-test', null, { timeout: 30000 });
  assert.deepEqual(pageErrors, []);
  console.log('PASS browser migration, shared local origins, concurrent catalog updates, external folder provisioning, reload, DOCX data and automatic reconnection');
} catch (error) {
  console.error({ pageErrors, screen: (await page.locator('body').innerText()).slice(0, 1000) });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
