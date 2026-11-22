// Isolated browser checks for file identity, internal files and document actions.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { documentBrowser } from './fixtures/original-file-browser.mjs';
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
const path = () => node().locator('[data-file-path]');

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
  assert.equal(await path().count(), 0);
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
  console.log('PASS detached source, aligned file identity and document header actions');

  const viewerPath = await page.evaluate(async () => {
    const { buildViewerLink, decodeViewerHash } = await import('/src/lib/viewer.ts');
    const s = window.__store.getState();
    return (await decodeViewerHash(new URL(await buildViewerLink(s.nodes, s.edges)).hash)).nodes[0].data.attachments[0].sourcePath;
  });
  assert.equal(viewerPath, undefined, 'local paths do not travel in read-only share links');
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__store.getState().nodes.some(n => n.id === 'document'), null, { timeout: 90000 });
  assert.equal(await path().count(), 0);
  assert.equal(await page.evaluate(() => window.__store.getState().nodes[0].data.attachments[0].sourcePath), undefined);
  console.log('PASS old source links are detached on reload and omitted from shares');

  await node().locator('[data-superdoc-editor="doc"][data-superdoc-ready="true"]').waitFor();
  await node().locator('[data-superdoc-scroll="doc"]').click({ position: { x: 150, y: 150 } });
  await node().locator('[data-superdoc-scroll="doc"]').evaluate(el => el.__docxSession.instance.focus({ preventScroll: true }));
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' FILE CHANGE');
  await page.waitForFunction(() => document.querySelector('[data-superdoc-editor="doc"]')?.getAttribute('data-superdoc-dirty') === 'true');
  assert.match(await node().locator('[data-file-header="doc"]').innerText(), /未保存/);
  const originalPath = `local-tests/file-node-layout/${attachment.name}`;
  await writeFile(originalPath, source.buffer);
  await page.evaluate(() => { window.showOpenFilePicker = () => { throw new Error('Unexpected external file request'); }; });
  assert.equal(await node().locator('.material-header [data-superdoc-save]').count(), 0, 'The active toolbar owns Save');
  await page.locator('[data-docx-save]').click();
  await page.waitForFunction(() => !!window.__store.getState().nodes.find(n => n.id === 'document')?.data.attachments[0].editedDocxRevision);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-docx-export]').click()]);
  assert.match(download.suggestedFilename(), /\.docx$/i);
  console.log('PASS document status, explicit save and export');

  assert.deepEqual(await readFile(originalPath), source.buffer);
  const latest = await page.evaluate(async () => {
    const { loadDocumentContent } = await import('/src/lib/attachment-vault.ts');
    return loadDocumentContent(window.__store.getState().nodes[0].data.attachments[0]);
  });
  assert.match((await inspectDocx(Buffer.from(latest, 'base64'))).document, /FILE CHANGE/);

  const preview = async value => page.evaluate(async update => {
    const { fileEditPreview } = await import('/src/lib/node-file-edits.ts');
    fileEditPreview(window.__projects.getState().activeId ?? 'default', 'document', 'doc', update);
  }, value);
  await preview({ before: 'FILE CHANGE', after: '实时' });
  await node().locator('[data-file-edit-replacement]').getByText('实时', { exact: true }).waitFor();
  await preview({ before: 'FILE CHANGE', after: '实时修改' });
  await node().locator('[data-file-edit-replacement]').getByText('实时修改', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__store.getState().nodes[0].data.attachments[0].editedText.includes('实时')), false);
  await page.screenshot({ path: 'local-tests/file-node-layout/edit-preview-dark-zh.png' });
  await preview(null);
  await node().locator('[data-document-edit-preview]').waitFor({ state: 'detached' });

  await node().locator('[data-superdoc-scroll="doc"]').evaluate(el => el.__docxSession.instance.focus({ preventScroll: true }));
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' USER DRAFT');
  await node().locator('[data-superdoc-dirty="true"]').waitFor();
  const agentDoc = await createSuperdocFixture('AGENT EDIT');
  await page.evaluate(async content => {
    const { applyNodeFile } = await import('/src/lib/node-file-edits.ts');
    const att = window.__store.getState().nodes[0].data.attachments[0];
    await applyNodeFile(window.__projects.getState().activeId ?? 'default', 'document', att, content, 'base64', () => true, 'test-revision');
  }, agentDoc.buffer.toString('base64'));
  await node().getByText('已保存版本发生变化，当前草稿已保留。', { exact: false }).waitFor();
  assert.match(await node().locator('[data-superdoc-scroll]').innerText(), /USER DRAFT/);
  await node().getByRole('button', { name: '放弃草稿并重新载入已保存文件' }).click();
  await node().locator('[data-superdoc-ready="true"]').waitFor();
  assert.match(await node().locator('[data-superdoc-scroll]').innerText(), /AGENT EDIT/);
  assert.deepEqual(await readFile(originalPath), source.buffer);
  console.log('PASS streamed edit preview, saved node revision, retained concurrent draft and explicit reload');

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="#b8cedc"/><text x="30" y="120" font-size="40">Image preview</text></svg>';
  const image = { id: 'image', name: 'image.svg', type: 'image/svg+xml', size: svg.length, content: Buffer.from(svg).toString('base64') };
  const text = { id: 'text', name: 'notes.txt', type: 'text/plain', size: 25, content: 'First line\nSecond line', sourcePath: '/home/user/notes.txt' };
  await page.evaluate(nodes => {
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    window.__rf.setViewport({ x: 30, y: 0, zoom: 1 }, { duration: 0 });
  }, [makeNode('image-node', image, 20, 480, 550), makeNode('text-node', text, 550, 480, 550)]);
  assert.equal(await page.locator('[data-file-path]').count(), 0);
  assert.equal(await page.locator('.react-flow__node[data-id="image-node"] img[alt="image.svg"]').count(), 1);
  assert.match(await page.locator('[data-file-text-preview="text"]').innerText(), /First line/);
  await page.screenshot({ path: 'local-tests/file-node-layout/other-files-dark-zh.png' });
  await page.evaluate(async () => {
    const liveModule = path => import([...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    (await liveModule('/src/lib/appearance.ts')).useAppearance.getState().setLighting('light');
    (await liveModule('/src/i18n/index.ts')).useI18n.getState().setLang('en');
  });
  await page.screenshot({ path: 'local-tests/file-node-layout/other-files-light-en.png' });
  assert.equal(await page.locator('[data-file-path]').count(), 0);
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
  assert.deepEqual(acquired, { desktop: undefined, browser: undefined });
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log('PASS desktop and browser import detached files');
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
