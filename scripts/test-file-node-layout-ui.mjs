// Isolated browser checks for file identity, source-path display and document actions.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { documentBrowser, chooseFixtureOriginal } from './fixtures/original-file-browser.mjs';
import { createSuperdocFixture, inspectDocx } from './fixtures/superdoc-fixture.mjs';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5190';
const { context, close } = await documentBrowser(appUrl, { executablePath, viewport: { width: 1500, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh'); localStorage.setItem('thoughtdag.lighting', 'dark');
});
const source = await createSuperdocFixture('FILE LAYOUT');
const attachment = { id: 'doc', name: '文件材料布局验证.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: source.buffer.length, content: source.buffer.toString('base64'), extractedText: 'FILE LAYOUT original', sourcePath: 'D:\\资料\\原始文档.docx' };
const makeNode = (id, att, x, width = 660, height = 780) => ({ id, type: 'thought', dragHandle: '.drag-handle', position: { x, y: 90 }, width, height,
  data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: -1, tokenCount: 0, highlights: [],
    highlightMode: 'off', detailLevel: 'full', attachments: [att] } });
const node = () => page.locator('.react-flow__node[data-id="document"]');
const path = () => node().locator('[data-file-path="doc"]');

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__ui && window.__rf, null, { timeout: 90000 });
  await page.evaluate(node => {
    const nodes = [node];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState(); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderNodeId(null);
    window.__rf.setViewport({ x: 60, y: 0, zoom: 1 }, { duration: 0 });
  }, makeNode('document', attachment, 80));
  await node().locator('[data-superdoc-editor="doc"][data-superdoc-ready="true"]').waitFor();
  assert.equal(await path().innerText(), attachment.sourcePath);
  assert.equal(await path().evaluate(element => element.isContentEditable || element.matches('input,textarea')), false);
  assert.equal(await node().locator('[data-file-header="doc"] input, [data-file-header="doc"] textarea').count(), 0);
  assert.equal(await node().locator('.material-header [data-superdoc-save]').count(), 1);
  assert.equal(await node().locator('.material-header [data-superdoc-export]').count(), 1);
  assert.equal(await node().locator('[data-document-open="doc"]').count(), 1);
  const alignment = await node().locator('[data-file-header="doc"]').evaluate(row => {
    const center = element => { const r = element.getBoundingClientRect(); return r.top + r.height / 2; };
    return { icon: center(row.querySelector('.file-identity')), text: center(row.querySelector('.min-w-0.flex-1')), remove: center(row.querySelector('button')) };
  });
  assert.ok(Math.abs(alignment.icon - alignment.text) < 1 && Math.abs(alignment.remove - alignment.text) < 1, 'icon, text group and remove action share a vertical center');
  await mkdir('local-tests/file-node-layout', { recursive: true });
  await page.screenshot({ path: 'local-tests/file-node-layout/docx-dark-zh.png' });
  console.log('PASS read-only path, aligned file identity and document header actions');

  const longPath = 'D:\\资料\\' + 'a-very-long-folder-name\\'.repeat(8) + '原始文档.docx';
  await page.evaluate(value => window.__store.getState().setAttachmentData('document', 'doc', { sourcePath: value }), longPath);
  assert.equal(await path().innerText(), longPath);
  assert.equal(await path().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'long paths wrap inside the card');
  const viewerPath = await page.evaluate(async () => {
    const { buildViewerLink, decodeViewerHash } = await import('/src/lib/viewer.ts');
    const s = window.__store.getState();
    return (await decodeViewerHash(new URL(await buildViewerLink(s.nodes, s.edges)).hash)).nodes[0].data.attachments[0].sourcePath;
  });
  assert.equal(viewerPath, undefined, 'local paths do not travel in read-only share links');
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__store.getState().nodes.some(n => n.id === 'document'), null, { timeout: 90000 });
  await path().waitFor();
  assert.equal(await path().innerText(), longPath, 'path survives reload');
  console.log('PASS long path wrapping, persistence and private share links');

  await node().locator('[data-superdoc-editor="doc"][data-superdoc-ready="true"]').waitFor();
  await node().locator('[data-superdoc-scroll="doc"]').click({ position: { x: 150, y: 150 } });
  await node().locator('[data-superdoc-scroll="doc"]').evaluate(el => el.__docxSession.instance.focus({ preventScroll: true }));
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' FILE CHANGE');
  await page.waitForFunction(() => document.querySelector('[data-superdoc-editor="doc"]')?.getAttribute('data-superdoc-dirty') === 'true');
  assert.match(await node().locator('[data-file-header="doc"]').innerText(), /待写回原文件/);
  const originalPath = `local-tests/file-node-layout/${attachment.name}`;
  await writeFile(originalPath, source.buffer);
  await chooseFixtureOriginal(page, originalPath);
  await node().locator('.material-header [data-superdoc-save]').click();
  await page.waitForFunction(() => !!window.__store.getState().nodes.find(n => n.id === 'document')?.data.attachments[0].editedDocxRevision);
  const [download] = await Promise.all([page.waitForEvent('download'), node().locator('.material-header [data-superdoc-export]').click()]);
  assert.match(download.suggestedFilename(), /\.docx$/i);
  console.log('PASS document status, explicit save and export');

  const diskRevision = await readFile(originalPath);
  assert.match((await inspectDocx(diskRevision)).document, /FILE CHANGE/);
  const revisionId = await page.evaluate(() => window.__store.getState().nodes[0].data.attachments[0].editedDocxRevision);
  const legacy = { ...attachment, id: 'legacy-att', sourcePath: undefined, editedDocxRevision: revisionId };
  await page.evaluate(node => window.__store.setState({ nodes: [node], edges: [] }), makeNode('old-canvas', legacy, 80));
  const oldNode = page.locator('.react-flow__node[data-id="old-canvas"]');
  const oldSave = oldNode.locator('[data-superdoc-save]');
  await oldNode.locator('[data-superdoc-ready="true"][data-superdoc-dirty="false"]').waitFor();
  await oldNode.getByText('待写回原文件').waitFor();
  const legacyDir = 'local-tests/file-node-layout/legacy';
  const wrongDir = 'local-tests/file-node-layout/different';
  const legacyPath = `${legacyDir}/${attachment.name}`, wrongPath = `${wrongDir}/${attachment.name}`;
  await Promise.all([mkdir(legacyDir, { recursive: true }), mkdir(wrongDir, { recursive: true })]);
  const other = (await createSuperdocFixture('EXTERNAL EDIT')).buffer;
  await writeFile(legacyPath, source.buffer);
  await writeFile(wrongPath, other);
  await chooseFixtureOriginal(page, wrongPath);
  await oldSave.click();
  await page.getByText('所选文件与导入的文档不一致，请选择原文件。').waitFor();
  assert.deepEqual(await readFile(wrongPath), other);
  await chooseFixtureOriginal(page, legacyPath);
  await oldSave.click();
  await oldNode.getByText('已写回原文件').waitFor();
  assert.deepEqual(await readFile(legacyPath), diskRevision, 'Legacy clean-editor Save writes the exact canvas revision');
  console.log('PASS a legacy revision writes byte-for-byte to its original, without overwriting a different same-name file');

  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/lib/persistence.ts')?.name;
    await (await import(url ?? '/src/lib/persistence.ts')).flushPendingWrites();
  });
  await page.waitForFunction(async () => {
    const { name, storage } = window.__store.persist.getOptions();
    return (await storage.getItem(name))?.state.nodes[0]?.id === 'old-canvas';
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__store.getState().nodes[0]?.id === 'old-canvas');
  await oldNode.locator('[data-superdoc-ready="true"]').waitFor();
  await oldNode.getByText('已写回原文件').waitFor();
  await page.evaluate(() => { window.showOpenFilePicker = () => { throw new Error('Saved handle should be reused'); }; });
  const engine = oldNode.locator('[data-superdoc-scroll]');
  await engine.click({ position: { x: 150, y: 150 } });
  await engine.evaluate(el => el.__docxSession.instance.focus({ preventScroll: true }));
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' SECOND CHANGE');
  await oldNode.locator('[data-superdoc-dirty="true"]').waitFor();
  await writeFile(legacyPath, other);
  await oldSave.click();
  await page.waitForFunction(() => window.__ui.getState().toasts.some(toast => toast.kind === 'error'));
  assert.match(await page.evaluate(() => window.__ui.getState().toasts.find(toast => toast.kind === 'error')?.message), /磁盘上的原文件已发生变化/);
  assert.deepEqual(await readFile(legacyPath), other);
  assert.equal(await oldNode.locator('[data-superdoc-editor]').getAttribute('data-superdoc-dirty'), 'true');
  await writeFile(legacyPath, diskRevision);
  await oldSave.click();
  await oldNode.getByText('已写回原文件').waitFor();
  assert.match((await inspectDocx(await readFile(legacyPath))).document, /SECOND CHANGE/);
  console.log('PASS persisted handle, external write conflict, retained draft and successful retry to the same path');

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="#b8cedc"/><text x="30" y="120" font-size="40">Image preview</text></svg>';
  const image = { id: 'image', name: 'image.svg', type: 'image/svg+xml', size: svg.length, content: Buffer.from(svg).toString('base64') };
  const text = { id: 'text', name: 'notes.txt', type: 'text/plain', size: 25, content: 'First line\nSecond line', sourcePath: '/home/user/notes.txt' };
  await page.evaluate(nodes => {
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__rf.setViewport({ x: 30, y: 0, zoom: 1 }, { duration: 0 });
  }, [makeNode('image-node', image, 20, 480, 550), makeNode('text-node', text, 550, 480, 550)]);
  assert.equal(await page.locator('[data-file-path="image"]').innerText(), '未获取文件路径');
  assert.equal(await page.locator('[data-file-path="text"]').innerText(), '/home/user/notes.txt');
  assert.equal(await page.locator('.react-flow__node[data-id="image-node"] img[alt="image.svg"]').count(), 1);
  assert.match(await page.locator('[data-file-text-preview="text"]').innerText(), /First line/);
  await page.screenshot({ path: 'local-tests/file-node-layout/other-files-dark-zh.png' });
  await page.evaluate(async () => {
    const liveModule = path => import([...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    (await liveModule('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    (await liveModule('/src/i18n/index.ts')).useI18n.getState().setLang('en');
  });
  await page.locator('[data-file-path="image"]').getByText('File path unavailable').waitFor();
  await page.screenshot({ path: 'local-tests/file-node-layout/other-files-light-en.png' });
  assert.equal(await page.locator('[data-file-path="image"]').innerText(), 'File path unavailable');
  console.log('PASS image and text previews, missing paths, themes and languages');

  const acquired = await page.evaluate(async () => {
    const { ingestFiles, buildContentNode } = await import('/src/lib/content.ts');
    const previous = window.desktop;
    const desktopNode = { ...buildContentNode('file', { x: 0, y: 0 }), id: 'desktop-path' };
    const browserNode = { ...buildContentNode('file', { x: 500, y: 0 }), id: 'browser-path' };
    window.__store.setState({ nodes: [desktopNode, browserNode], edges: [] });
    window.desktop = { getPathForFile: () => 'C:\\fixtures\\chosen.txt' };
    await ingestFiles('desktop-path', [new File(['example'], 'chosen.txt', { type: 'text/plain' })]);
    window.desktop = undefined;
    await ingestFiles('browser-path', [new File(['example'], 'chosen.txt', { type: 'text/plain' })]);
    window.desktop = previous;
    const nodes = window.__store.getState().nodes;
    return { desktop: nodes.find(node => node.id === 'desktop-path').data.attachments[0].sourcePath,
      browser: nodes.find(node => node.id === 'browser-path').data.attachments[0].sourcePath };
  });
  assert.deepEqual(acquired, { desktop: 'C:\\fixtures\\chosen.txt', browser: undefined });
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log('PASS desktop path bridge and browser fallback');
} catch (error) {
  console.error('File node diagnostics', await page.evaluate(() => ({
    nodes: window.__store?.getState().nodes.map(n => ({ id: n.id, attachments: n.data.attachments?.map(a => [a.id, !!a.editedDocxRevision]) })),
    editors: [...document.querySelectorAll('[data-superdoc-editor]')].map(el => [el.dataset.superdocEditor, el.dataset.superdocReady, el.dataset.superdocDirty]),
    status: [...document.querySelectorAll('[role=status]')].map(el => el.innerText),
    toasts: window.__ui?.getState().toasts.map(t => t.message),
  })));
  throw error;
} finally {
  await close();
}
