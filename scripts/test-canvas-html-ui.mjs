// Export through the application, then read the downloaded file in a fresh, offline browser.
// Run with node scripts/test-canvas-html-ui.mjs; --dark also checks the Chinese dark theme.
// After npm run build, --built drives the main download through the compiled application.
// CHROME_PATH can select a Chromium installation.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Document, Paragraph, Packer, PageBreak, TextRun } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { createTestServer } from './fixtures/vite-test-server.mjs';

const dark = process.argv.includes('--dark');
const output = resolve(dark ? 'local-tests/canvas-html-dark' : 'local-tests/canvas-html');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
await mkdir(output, { recursive: true });

const docx = text => Packer.toBase64String(new Document({ sections: [{ children: [
  new Paragraph({ children: [new TextRun({ text, bold: true, color: '8A3418' })] }),
  new Paragraph({ children: [new PageBreak(), new TextRun('Appendix')] }),
] }] }));
const original = 'Superseded document body';
const saved = 'The saved document revision.';
const pdf = await PDFDocument.create();
pdf.addPage([320, 220]).drawText('Static PDF page');
pdf.addPage([320, 220]).drawText('Second PDF page');
const pdfBytes = Buffer.from(await pdf.save()).toString('base64');
const attachments = [
  { id: 'document', name: 'Decision.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: await docx(original), editedDocxContent: await docx(saved), editedText: saved, documentHtml: '<p>' + original + '</p>' },
  { id: 'empty', name: 'Empty.docx', type: 'text/plain', content: original, editedText: '', extractedText: original },
  { id: 'missing', name: 'Recovered.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: '', editedDocxRevision: 'absent-vault-entry', editedText: 'Recovered saved text' },
  { id: 'pdf', name: 'Page.pdf', type: 'application/pdf', content: pdfBytes, extractedText: 'Static PDF page',
    pdfAnnotations: [{ id: 'saved-mark', kind: 'note', page: 1, rects: [[0.1, 0.2, 0.3, 0.05]], color: '#ffdd88', comment: 'Existing page annotation' },
      { id: 'passage', kind: 'highlight', page: 1, rects: [[0.1, 0.5, 0.3, 0.05]], color: '#d3ed9b', text: 'Marked PDF passage' }] },
  { id: 'image', name: 'Figure.png', type: 'image/png', content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jac8AAAAASUVORK5CYII=' },
  { id: 'html', name: 'Source.html', type: 'text/html', extractedText: 'Extracted text only',
    content: '<style>p { background: #ccbb99; padding: 30px; }</style><p contenteditable="true">A <strong>formatted</strong> paragraph.</p><form><input type="text"></form>' },
  { id: 'notebook', name: 'Figure.ipynb', type: 'application/x-ipynb+json', extractedText: 'Short model projection',
    content: JSON.stringify({ nbformat: 4, cells: [{ cell_type: 'code', execution_count: 7, source: 'x = 2', outputs: [
      { output_type: 'stream', text: Array.from({ length: 120 }, (_, i) => 'Saved output line ' + i).join('\n') },
      { output_type: 'display_data', data: { 'image/svg+xml': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"><circle cx="15" cy="15" r="12"/></svg>' } },
    ] }] }) },
].map(a => ({ ...a, size: a.content.length }));

process.env.THOUGHTDAG_DISK_STORAGE = '0';
const vite = await createTestServer({ cacheDir: 'node_modules/.vite-canvas-html-content' + (dark ? '-dark' : ''),
  server: { open: false, hmr: false, watch: null }, logLevel: 'error' });
let browser;
try {
  await vite.listen();
  const appUrl = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath, headless: true });
  const editor = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await editor.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(appUrl).origin && url.pathname === '/export-test-image.png') {
      return route.fulfill({ contentType: 'image/png', body: Buffer.from(attachments.find(a => a.type === 'image/png').content, 'base64') });
    }
    if (url.origin === new URL(appUrl).origin && url.pathname === '/export-test-style.css') {
      return route.fulfill({ contentType: 'text/css',
        body: '.original-layout{height:3300px;display:flex;flex-direction:column;justify-content:space-between}.end-band{height:120px;background:#346b52}' });
    }
    if (url.pathname.startsWith('/api/') || url.origin !== new URL(appUrl).origin) return route.abort();
    return route.continue();
  });
  await editor.addInitScript(dark => {
    localStorage.setItem('thoughtdag.seeded', 'yes');
    localStorage.setItem('thoughtdag.tutorialDone', '1');
    localStorage.setItem('thoughtdag.lang', dark ? 'zh' : 'en');
    localStorage.setItem('thoughtdag.lighting', dark ? 'dark' : 'light');
    localStorage.setItem('thoughtdag.paper', dark ? 'grid' : 'plain');
  }, dark);
  const app = await editor.newPage();
  app.setDefaultTimeout(25000);
  app.on('pageerror', error => console.error('Editor page error:', error.message));
  app.on('console', msg => {
    if (msg.type() === 'error' && msg.text().includes('HTML export failed')) console.error(msg.text());
  });
  await app.goto(appUrl, { waitUntil: 'commit' });
  try {
    await app.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf, undefined, { timeout: 120000 });
  } catch (error) {
    console.error('Editor startup failed', await app.locator('body').innerText());
    throw error;
  }
  await app.evaluate(async attachments => {
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    const { internNodes } = await import('/src/lib/attachment-vault.ts');
    const { renameProject, useProjects } = await import('/src/store/projects.ts');
    await renameProject(useProjects.getState().activeId, localStorage.getItem('thoughtdag.lang') === 'zh' ? '阅读示例 · 问答与材料' : 'Reading example');
    useUiStore.getState().setTutorialOpen(false);
    useUiStore.getState().setReleaseNotesOpen(false);
    function node(id, x, y, width, height, data) {
      return { id, type: 'thought', position: { x, y }, width, height, style: { width, height }, data: {
        question: '', response: '', responses: [], responseIndex: -1, isEditing: false, isLoading: false, isCollapsed: false,
        highlights: [], highlightMode: 'off', tokenCount: 0, attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], ...data,
      } };
    }
    const response = ['First paragraph about the finding.', 'Marked conclusion.', '- [ ] Review the source',
      '| Metric | Value |\n| --- | ---: |\n| Total | 18 |', '$$\\frac{a}{b}$$',
      '```js\nconst result = 18;\n```', '```mermaid\nflowchart LR\n A[Inputs] --> B[Result]\n```',
      'Evidence. '.repeat(150) + 'End of the complete answer.',
      '![Embedded preview](' + location.origin + '/export-test-image.png)',
      '![Unavailable preview](https://example.invalid/unavailable.png)',
    ].join('\n\n');
    const question = 'Which finding matters?\n\n1. Disclosure\n1. 信息披露\n2. Ownership\n2. 所有权';
    const previousQuestion = 'Earlier question?\n\n3. Topic\n3. 主题';
    const previousResponse = 'Earlier version.\n\n1. First step\n1. Second step';
    const nodes = await internNodes([
      node('frame', -310, -180, 1060, 530, { stepKind: 'frame', question: 'Review group' }),
      node('qa', -280, -110, 360, 385, { displayName: 'Discussion', question,
        model: 'sample/writing-model', response, responses: [previousResponse, response], responseIndex: 1,
        questions: [previousQuestion, question], highlights: [{ id: 'mark', text: 'Marked conclusion.' },
          { id: 'prompt-mark', text: 'finding', source: 'question' }], highlightMode: 'tag',
        references: [{ title: 'Source document', url: 'https://example.org/source' }] }),
      node('docs', 220, -110, 480, 390, { stepKind: 'file', displayName: 'Evidence', attachments }),
    ]);
    window.__store.getState().setNodes(nodes);
    window.__store.getState().setEdges([{ id: 'connection', source: 'docs', sourceHandle: 'ruler/mark/pdf/passage', target: 'qa',
      style: { stroke: '#258373', strokeWidth: 3, strokeDasharray: '7 3' }, data: { label: 'Source', isCrossLink: true } }]);
    await window.__rf.setViewport({ x: 425, y: 280, zoom: 1 });
  }, attachments);
  async function downloadFromMenu(exporter, archive) {
    await exporter.locator('[data-toolbar-more]').click();
    const exportButton = exporter.locator('[data-menu-export-html]');
    assert.match(await exportButton.innerText(), /\.html/i);
    const [download] = await Promise.all([exporter.waitForEvent('download', { timeout: 90000 }), exportButton.click()])
      .catch(async error => {
        await exporter.screenshot({ path: resolve(output, 'export-failure.png') });
        throw error;
      });
    assert.match(download.suggestedFilename(), /\.html$/i);
    await download.saveAs(archive);
  }
  const authoring = '[data-settings-entry], [data-layout-entry], [data-edit-question], [data-edit-response], [data-edit-submit], [data-superdoc-save], [data-superdoc-toolbar]';
  await app.locator('[data-settings-entry]').waitFor();
  await app.locator('.react-flow__node[data-id="qa"] [data-edit-question]').waitFor({ state: 'attached' });
  const productionArchive = resolve(output, 'canvas-production.html');
  if (process.argv.includes('--built')) {
    // Keep the origin and its real IndexedDB fixture. Only the document and
    // application assets switch to the production files, with no dev imports.
    const dist = resolve(process.env.THOUGHTDAG_TEST_BUILD_DIR ?? 'dist');
    assert.ok(existsSync(resolve(dist, 'index.html')), 'Build the production app first');
    console.log('Opening the production build with the saved fixture');
    await app.evaluate(async () => (await import('/src/lib/persistence.ts')).flushPendingWrites());
    const exporter = await editor.newPage();
    exporter.setDefaultTimeout(45000);
    exporter.on('pageerror', error => console.error('Production page error:', error.message));
    await exporter.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(appUrl).origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/export-test-')) return route.fallback();
      const file = resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
      if (!file.startsWith(dist + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: file });
    });
    await exporter.goto(appUrl);
    await exporter.locator('.react-flow__node[data-id="qa"]').waitFor();
    await exporter.locator('[data-superdoc-editor="document"][data-superdoc-ready="true"] .superdoc-page').first().waitFor();
    await exporter.evaluate(() => document.fonts.ready);
    await exporter.mouse.move(8, 380);
    await exporter.screenshot({ path: resolve(output, 'canvas-production-original.png'), animations: 'disabled' });
    await downloadFromMenu(exporter, productionArchive);
    await exporter.close();
    console.log('PASS download from the production build');
  }
  console.log('Checking the HTML export from the More menu');
  const archive = resolve(output, 'canvas.html');
  await downloadFromMenu(app, archive);
  await app.locator('[data-settings-entry]').waitFor();
  assert.equal(await app.locator('.react-flow__node[data-id="qa"] [data-edit-question]').count(), 1);
  assert.doesNotMatch(await readFile(archive, 'utf8'), /Superseded document body/);
  const secondary = resolve(output, 'paradigm.html');
  const dockArchive = resolve(output, 'input-dock.html');
  await app.evaluate(async () => {
    const { useConnectionLayoutPreferences } = await import('/src/lib/connection-layout-preferences.ts');
    useConnectionLayoutPreferences.getState().setSettings({ enabled: true, layout: 'dock' });
  });
  const sourceRow = '.react-flow__node[data-id="qa"] [data-connection-layout="dock"] [data-input-source-id="docs"] .input-source-name';
  await app.locator(sourceRow).first().waitFor();
  const sourceName = await app.locator(sourceRow).first().textContent();
  await downloadFromMenu(app, dockArchive);
  await app.evaluate(async () => {
    const { useConnectionLayoutPreferences } = await import('/src/lib/connection-layout-preferences.ts');
    const { createProject } = await import('/src/store/projects.ts');
    const template = window.__store.getState().nodes.find(n => n.id === 'qa');
    const blank = { ...template, position: { x: 20, y: 40 }, width: 470, height: 290, style: { width: 470, height: 290 },
      data: { question: '', response: '', responses: [], responseIndex: -1, isEditing: false, isLoading: false,
        isCollapsed: false, highlights: [], highlightMode: 'off', tokenCount: 0, attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [] } };
    const node = (id, x, y, data) => ({ ...blank, id, position: { x, y }, data: { ...blank.data, ...data } });
    const prompt = node('prompt', 20, 40, { displayName: '提取要点', question: '提取要点', stepKind: 'prompt', instruction: '列出材料中的**关键证据**。', detailLevel: 'full' });
    const human = node('human', 580, 40, { displayName: '人工复核', question: '人工复核', stepKind: 'human', instruction: '核对表格与原文。', detailLevel: 'summary' });
    const link = node('link', 580, 440, { stepKind: 'link', linkUrl: 'https://example.org/article', linkTitle: '原文快照',
      linkSnapshotHtml: '<link rel="stylesheet" href="' + location.origin + '/export-test-style.css"><article class="original-layout"><p>网页中的<strong>原始段落</strong>。</p><div class="end-band"></div></article>', question: '网页中的原始段落。',
      highlights: [{ id: 'quote', text: '网页中的原始段落。' }] });
    const note = node('offscreen-note', 4200, 40, { stepKind: 'note', displayName: '远处的笔记',
      question: '| 名称 | 数量 |\n| --- | ---: |\n| 已复核 | 42 |' });
    const legacy = node('offscreen-document', 4900, 40, { stepKind: 'file', detailLevel: 'full', attachments: [
      { id: 'legacy-text', name: 'Legacy.docx', type: 'text/plain', size: 15, content: '', editedText: 'Saved legacy document text' },
    ] });
    useConnectionLayoutPreferences.getState().setSettings({ enabled: false });
    await createProject('阅读示例', 'paradigm');
    window.__store.getState().setNodes([prompt, human, link, note, legacy]);
    window.__store.getState().setEdges([
      { id: 'review', source: prompt.id, target: human.id, data: { label: '复核' } },
      { id: 'source', source: link.id, target: human.id }, { id: 'notes', source: human.id, target: note.id },
    ]);
    await window.__rf.setViewport({ x: 36, y: 36, zoom: 1 });
  });
  await app.locator('.react-flow__node[data-id="prompt"]').waitFor();
  await app.locator('.react-flow__node[data-id="offscreen-note"]').waitFor({ state: 'detached' });
  await app.locator('.react-flow__node[data-id="offscreen-document"]').waitFor({ state: 'detached' });
  await app.locator('[data-toolbar-more]').click();
  const [workflow] = await Promise.all([app.waitForEvent('download'), app.locator('[data-menu-export-html]').click()]);
  await workflow.saveAs(secondary);
  await editor.close();
  console.log('PASS app export and vaulted document revisions');

  const offline = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true, serviceWorkers: 'block' });
  const page = await offline.newPage();
  const errors = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()); });
  await page.goto(pathToFileURL(archive).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, 'canvas.png') });
  const card = id => page.locator('.react-flow__node[data-id="' + id + '"]');
  const panel = page.locator('[data-offline-reader]');
  const reader = panel.locator('[data-export-reading-body]');
  const closeReader = async () => {
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
  };
  const read = async node => {
    await node.focus();
    await page.keyboard.press('Enter');
    await panel.waitFor();
  };
  const editable = 'input:not(:disabled):not([inert]),textarea:not(:disabled):not([inert]),select:not(:disabled):not([inert]),[contenteditable="true"]:not([inert]),form,[draggable="true"]';
  const templatesWithAuthoring = () => page.evaluate(selector => Array.from(document.querySelectorAll('template'))
    .filter(template => template.content.querySelector(selector))
    .map(template => template.dataset.readingNode ?? template.dataset.readingDock ?? template.dataset.readingDetails), authoring);
  assert.equal(await page.locator('html').getAttribute('lang'), dark ? 'zh-CN' : 'en');
  assert.equal(await page.locator('html').getAttribute('data-theme'), dark ? 'dark' : 'light');
  assert.equal(await page.locator('html').getAttribute('data-paper'), dark ? 'grid' : 'plain');
  const discussion = card('qa'), files = card('docs');
  assert.equal(await page.locator(authoring).count(), 0);
  assert.deepEqual(await templatesWithAuthoring(), []);
  assert.equal(await page.locator('.react-flow__node[data-id]').count(), 3);
  assert.equal(await card('frame').locator('[data-frame-node]').count(), 1);
  assert.ok(await discussion.locator('[data-conversation-answer]').getByText(/End of the complete answer/).count());
  const edge = page.locator('.react-flow__edge[data-id="connection"] .react-flow__edge-path');
  assert.equal(await edge.evaluate(el => getComputedStyle(el).stroke), 'rgb(37, 131, 115)');
  assert.equal((await edge.evaluate(el => getComputedStyle(el).strokeDasharray)).replaceAll('px', '').replaceAll(',', ''), '7 3');
  const geometry = node => node.evaluate(el => [el.style.transform, el.offsetWidth, el.offsetHeight]);
  const before = await geometry(discussion);
  async function verifyFocusPanel() {
    const details = discussion.locator('[data-node-details]').first();
    await details.click();
    const focus = page.locator('[data-focus-panel][data-focus-node-id="qa"]');
    await focus.waitFor();
    assert.equal(await focus.locator('[data-reading-node-name]').textContent(), 'Discussion');
    assert.match(await focus.textContent(), /First paragraph about the finding/);
    await page.keyboard.press('Escape');
    await focus.waitFor({ state: 'detached' });
    assert.ok(await details.evaluate(el => document.activeElement === el));
  }
  await verifyFocusPanel();
  const width = (await discussion.boundingBox()).width;
  await page.locator('.react-flow__controls-zoomin').click();
  assert.ok((await discussion.boundingBox()).width > width);
  await page.locator('.react-flow__controls-fitview').click();
  await page.mouse.move(82, 135);
  await page.mouse.down();
  await page.mouse.move(132, 155, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await geometry(discussion), before, 'Camera navigation leaves the saved node geometry intact');

  // Check the application's visible ruler and edge, using the exported mark ID.
  const pdfTick = files.locator('[data-overview-ruler-mark="ruler/mark/pdf/passage"]');
  const gap = await pdfTick.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    const path = document.querySelector('.react-flow__edge[data-id="connection"] .react-flow__edge-path');
    const tip = path.getPointAtLength(0).matrixTransform(path.getScreenCTM());
    return Math.hypot(bounds.right - tip.x, bounds.y + bounds.height / 2 - tip.y);
  });
  assert.ok(gap < 5, 'The reference edge starts on its document highlight (' + gap + ' px)');
  await pdfTick.click();
  const pdfInk = reader.locator('[data-pdf-mark="passage"]');
  await pdfInk.waitFor({ state: 'visible' });
  assert.equal(await reader.locator('[data-pdf-comment-pin="saved-mark"] svg').count(), 1);
  assert.ok(await pdfInk.evaluate(el => {
    const ink = el.getBoundingClientRect(), body = el.closest('[data-reader-body]').getBoundingClientRect();
    return ink.bottom > body.top && ink.top < body.bottom;
  }));
  await reader.locator('[data-pdf-comment-pin="saved-mark"]').click();
  const savedComment = reader.locator('[data-reading-pdf-note="saved-mark"]');
  assert.equal(await savedComment.textContent(), 'Existing page annotation');
  assert.ok(await savedComment.evaluate(el => {
    const note = el.getBoundingClientRect(), body = el.closest('[data-reader-body]').getBoundingClientRect();
    return note.bottom > body.top && note.top < body.bottom;
  }));
  await closeReader();
  assert.ok(await pdfTick.evaluate(el => el === document.activeElement));
  const turnTick = word => discussion.locator('[data-overview-ruler-mark][aria-label*="' + word + '"]');
  await turnTick('finding').press('Enter');
  assert.equal(await reader.locator('[data-reading-question] mark').textContent(), 'finding');
  assert.deepEqual(await reader.locator('[data-reading-answer] mark').allTextContents(), ['Marked conclusion.']);
  await closeReader();
  const answerTick = turnTick('Marked conclusion.');
  await answerTick.press('Enter');
  assert.equal(await reader.locator('[data-reading-answer] mark').textContent(), 'Marked conclusion.');
  await closeReader();

  async function verifyDockAndExpand() {
    const docked = page.locator('[data-offline-reader][data-reader-docked]');
    await docked.waitFor();
    await panel.locator('[data-reader-expand]').click();
    await panel.getByRole('dialog').waitFor();
    await panel.locator('[data-reader-dock]').click();
    await docked.waitFor();
  }
  await read(discussion);
  await verifyDockAndExpand();
  assert.equal(await panel.locator(authoring).count(), 0);
  const listNumbers = list => {
    let next = list.start;
    return Array.from(list.children, item => {
      if (item.hasAttribute('value')) next = item.value;
      return next++;
    });
  };
  const lists = reader.locator('.conversation-question ol');
  assert.deepEqual(await discussion.locator('[data-conversation-question] ol').first().evaluate(listNumbers), [1, 1, 2, 2]);
  assert.deepEqual(await lists.nth(0).evaluate(listNumbers), [1, 1, 2, 2]);
  assert.deepEqual(await lists.nth(1).evaluate(listNumbers), [3, 3]);
  assert.deepEqual(await reader.locator('.conversation-answer ol').evaluate(listNumbers), [1, 2]);
  assert.equal(await reader.locator('table td').last().textContent(), '18');
  assert.equal(await reader.locator('.katex .katex-html').count(), 1);
  assert.ok(await page.evaluate(async () => (await document.fonts.load('16px KaTeX_Main', 'a')).some(face => face.status === 'loaded')));
  assert.ok(await reader.locator('code .hljs-keyword').count());
  const diagram = reader.locator('img.reading-diagram');
  await diagram.scrollIntoViewIfNeeded();
  await diagram.evaluate(el => el.decode());
  assert.match(await reader.textContent(), /End of the complete answer/);
  assert.match(await reader.textContent(), /Earlier version/);
  assert.match(await reader.textContent(), /Source document/);
  assert.match(await reader.getByAltText('Embedded preview').getAttribute('src'), /^data:image\/png;base64,/);
  assert.equal(await reader.getByText('Unavailable preview', { exact: true }).getAttribute('href'), 'https://example.invalid/unavailable.png');
  const highlight = reader.locator('[data-reading-answer] mark');
  await highlight.dblclick();
  await page.keyboard.press('Delete');
  assert.equal(await highlight.textContent(), 'Marked conclusion.');
  await page.screenshot({ path: resolve(output, 'discussion.png') });
  assert.equal(await page.locator(editable).count(), 0);
  await closeReader();

  async function pagePixels(locator, color) {
    await locator.scrollIntoViewIfNeeded();
    return locator.evaluate(async (img, rgb) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const pen = canvas.getContext('2d');
      pen.drawImage(img, 0, 0);
      const { data } = pen.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let p = 0; p < data.length; p += 4) {
        if (data[p + 3] > 220 && rgb.every((channel, i) => Math.abs(data[p + i] - channel) < 25)) count++;
      }
      return count;
    }, color);
  }
  await read(files);
  const file = id => reader.locator('[data-reading-file="' + id + '"]');
  assert.equal(await panel.locator(authoring).count(), 0);
  assert.equal(await file('pdf').locator('.pdf-sheet img').count(), 2);
  assert.equal(await file('document').locator('.document-page img').count(), 2);
  assert.ok(await pagePixels(file('document').locator('.document-page img').first(), [138, 52, 24]) > 15,
    'The native Word page contains the saved run color');
  assert.match(await file('document').textContent(), /The saved document revision/);
  assert.equal(await file('empty').count(), 1);
  assert.match(await file('missing').textContent(), /Recovered saved text/);
  assert.match(await file('pdf').textContent(), /Existing page annotation/);
  const figure = file('image').locator('img');
  await figure.scrollIntoViewIfNeeded();
  await figure.evaluate(img => img.decode());
  assert.equal(await file('html').locator('.document-page img').count(), 1);
  assert.ok(await pagePixels(file('html').locator('.document-page img'), [204, 187, 153]) > 300);
  assert.equal(await file('html').locator('strong').textContent(), 'formatted');
  const notebook = file('notebook').locator('[data-notebook]');
  assert.match(await notebook.textContent(), /Saved output line 65/);
  await notebook.locator('img').scrollIntoViewIfNeeded();
  await notebook.locator('img').evaluate(img => img.decode());
  assert.equal(await page.locator(editable).count(), 0);
  assert.equal(await page.locator('iframe, object, embed').count(), 0);
  await closeReader();
  await page.setViewportSize({ width: 390, height: 844 });
  await read(files);
  await panel.getByRole('dialog').waitFor();
  assert.ok(await panel.locator('[data-material-reader-close]').isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(output, 'mobile-reader.png') });
  await panel.locator('[data-material-reader-close]').click();
  await panel.waitFor({ state: 'detached' });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(dockArchive).href);
  assert.equal(await page.locator(sourceRow).first().textContent(), sourceName);
  assert.equal(await page.locator(editable).count(), 0);
  await page.goto(pathToFileURL(secondary).href);
  const prompt = card('prompt'), human = card('human'), note = card('offscreen-note');
  assert.equal(await page.locator('.react-flow__node[data-id]').count(), 5);
  assert.match(await prompt.textContent(), /提取要点/);
  assert.match(await prompt.textContent(), /列出材料中的\*\*关键证据\*\*/);
  assert.match(await card('offscreen-document').locator('[data-document-card]').textContent(), /Saved legacy document text/);
  assert.equal(await prompt.locator('[data-node-detail-level]').getAttribute('data-node-detail-level'), 'full');
  assert.equal(await human.locator('[data-node-detail-level]').getAttribute('data-node-detail-level'), 'summary');
  await read(prompt);
  assert.equal(await reader.locator('strong').textContent(), '关键证据');
  await closeReader();
  await read(note);
  assert.equal(await reader.locator('table td').last().textContent(), '42');
  await closeReader();
  await read(card('link'));
  assert.equal(await reader.locator('[data-reading-primary] strong').textContent(), '原始段落');
  assert.equal((await reader.locator('[data-reading-primary] mark').allTextContents()).join(''), '网页中的原始段落。');
  const slices = reader.locator('.document-page img');
  assert.equal(await slices.count(), 3);
  assert.ok(await pagePixels(slices.last(), [52, 107, 82]) > 300);
  await closeReader();

  if (process.argv.includes('--built')) {
    await page.goto(pathToFileURL(productionArchive).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(output, 'canvas-production.png'), animations: 'disabled' });
    assert.equal(await page.locator(authoring).count(), 0);
    assert.deepEqual(await templatesWithAuthoring(), []);
    const emptyPage = page.locator('[data-document-card="empty"] [data-document-rich-body="empty"]');
    assert.equal(await emptyPage.textContent(), '');
    assert.equal(await emptyPage.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    await verifyFocusPanel();
    await read(discussion);
    await verifyDockAndExpand();
    assert.match(await reader.textContent(), /End of the complete answer/);
    assert.equal(await reader.locator('.katex .katex-html').count(), 1);
    assert.equal(await reader.locator('img.reading-diagram').count(), 1);
    await closeReader();
    for (const [id, selector] of [['document', '.document-page img'], ['pdf', '.pdf-sheet img']]) {
      // Restoring an older graph can split one multi-file node into individual file cards.
      const owner = await page.evaluate(attachment => [...document.querySelectorAll('template[data-reading-node]')]
        .find(template => template.content.querySelector('[data-reading-file="' + attachment + '"]'))?.dataset.readingNode, id);
      assert.ok(owner);
      await read(card(owner));
      assert.equal(await file(id).locator(selector).count(), 2);
      await closeReader();
    }
    assert.equal(await page.locator(editable).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await read(discussion);
    await panel.getByRole('dialog').waitFor();
    assert.match(await reader.textContent(), /End of the complete answer/);
    await closeReader();
    console.log('PASS production HTML in a fresh offline browser');
  }
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  console.log('PASS native canvas navigation, saved attachments, rich content, versions, ordered lists and immutable annotation links');
  console.log('PASS virtualized notes, paradigm instructions, web snapshots, read-only input docks and phone layouts without the network');
} finally {
  await browser?.close();
  await vite.close();
}
