// Isolated browser and native DOCX fixtures; never uses an existing canvas/profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { documentBrowser, chooseFixtureOriginal } from './fixtures/original-file-browser.mjs';
import { createSuperdocFixture, inspectDocx } from './fixtures/superdoc-fixture.mjs';

const output = 'local-tests/superdoc';
await mkdir(output, { recursive: true });
const sources = await Promise.all(['ALPHA', 'BRAVO', 'CHARLIE'].map(createSuperdocFixture));
await Promise.all(sources.map((source, index) => writeFile(`${output}/source-${index + 1}.docx`, source.buffer)));
if (process.argv.includes('--fixtures-only')) {
  console.log(`Wrote ${sources.length} native DOCX fixtures to ${output}.`);
  process.exit(0);
}

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5180';
const { context, close } = await documentBrowser(appUrl, { executablePath, viewport: { width: 1920, height: 1080 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [], writes = [], checks = [], timings = {};
const consoleErrors = [], failedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh'); localStorage.setItem('thoughtdag.lighting', 'light');
});
const fixtures = sources.map((source, index) => ({
  id: `superdoc-node-${index + 1}`, type: 'thought', position: { x: 40 + index * 610, y: 90 }, width: 580, height: 830, dragHandle: '.drag-handle',
  data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0,
    highlights: [], highlightMode: 'off', detailLevel: 'full', isLoading: false, isCollapsed: false,
    attachments: [{ id: `superdoc-att-${index + 1}`, name: `版式验证-${index + 1}.docx`,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: source.buffer.length,
      content: source.buffer.toString('base64'), extractedText: `${['ALPHA', 'BRAVO', 'CHARLIE'][index]} original document` }],
  },
}));
const root = (index = 1) => page.locator(`[data-superdoc-editor="superdoc-att-${index}"]`).first();
const canvasNode = (index = 1) => page.locator(`.react-flow__node[data-id="superdoc-node-${index}"]`);
const documentText = index => page.evaluate(index => window.__docxTestSessions[index - 1].element.innerText, index);
const check = name => { checks.push(name); console.log('PASS', name); };
const screenshot = name => page.screenshot({ path: `${output}/${name}.png` });

async function verifyExport(file, source, marker) {
  const exported = await inspectDocx(await readFile(file));
  assert.match(exported.document, new RegExp(marker));
  assert.match(exported.document, /<w:tbl[\s>]/);
  assert.match(exported.document, /w:gridSpan[^>]*w:val="2"/);
  assert.match(exported.document, /w:vMerge/);
  assert.match(exported.document, /w:tblBorders/);
  assert.match(exported.document, /355[Cc]7[Dd]/);
  assert.match(exported.document, /w:pgSz[^>]*w:w="11906"/);
  assert.match(exported.document, /w:pgSz[^>]*w:h="16838"/);
  assert.match(exported.document, /w:pgMar[^>]*w:top="1440"/);
  assert.match(exported.document, /wp:extent[^>]*cx="2286000"[^>]*cy="914400"/);
  assert.ok(exported.headers.some(xml => xml.includes('FIDELITY HEADER')));
  assert.ok(exported.footers.some(xml => xml.includes('FIDELITY FOOTER')));
  assert.ok(exported.media.some(media => media.bytes.equals(source.image)), 'Source image bytes survive DOCX export');
  return { media: exported.media.length, headers: exported.headers.length, footers: exported.footers.length };
}

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  const started = performance.now();
  await page.evaluate(nodes => {
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('full');
    window.__rf.setViewport({ x: 20, y: 0, zoom: 0.95 }, { duration: 0 });
  }, fixtures);
  for (let index = 1; index <= 3; index++) await page.locator(`[data-superdoc-editor="superdoc-att-${index}"][data-superdoc-ready="true"]`).waitFor();
  timings.threeEditorsReadyMs = Math.round(performance.now() - started);
  await page.waitForTimeout(500);
  // App centers newly inserted nodes after 100 ms + its camera animation.
  // Establish the test viewport after that existing insertion behavior settles.
  await page.evaluate(() => window.__rf.setViewport({ x: 20, y: 0, zoom: 0.95 }, { duration: 0 }));
  assert.equal(await page.locator('[data-superdoc-editor]').count(), 3);
  await screenshot('three-documents-light');
  check('Three native DOCX nodes stay mounted as editable documents');

  // Keep the exact DOM identities across pointer/selection changes, not just their count.
  await page.evaluate(() => {
    window.__docxTestSessions = [1, 2, 3].map(index => document.querySelector(`[data-superdoc-scroll="superdoc-att-${index}"]`).__docxSession);
    window.__superdocTestRoots = [...document.querySelectorAll('[data-superdoc-editor]')];
    window.__superdocTestViews = window.__docxTestSessions.map(session => session.element);
    window.__superdocTestInstances = window.__docxTestSessions.map(session => session.instance);
  });
  for (const index of [1, 2, 3, 1]) {
    await root(index).locator('[data-superdoc-scroll]').click({ position: { x: 180, y: 160 } });
    assert.equal(await page.locator('[data-superdoc-editor]').count(), 3);
    assert.deepEqual(await page.evaluate(() => window.__rf.getViewport()), { x: 20, y: 0, zoom: 0.95 }, 'Switching document focus must not pan or zoom the canvas');
  }
  const retained = await page.evaluate(() => ({
    roots: window.__superdocTestRoots.map(element => element.isConnected),
    views: window.__superdocTestViews.map(element => element.isConnected),
    instances: window.__docxTestSessions.map((session, index) => session.instance === window.__superdocTestInstances[index]),
    statuses: window.__docxTestSessions.map(session => session.status),
  }));
  assert.ok([...retained.roots, ...retained.views, ...retained.instances].every(Boolean), JSON.stringify(retained));
  check('Switching between nodes retains every document view and editor instance');

  const scroll = root(1).locator('[data-superdoc-scroll]');
  await scroll.waitFor();
  const viewport = await page.evaluate(() => window.__rf.getViewport());
  await scroll.hover(); await page.mouse.wheel(0, 650);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-superdoc-editor="superdoc-att-1"] [data-superdoc-scroll], [data-superdoc-editor="superdoc-att-1"] [data-superdoc-scroll] *')].some(element => element.scrollTop > 100));
  assert.deepEqual(await page.evaluate(() => window.__rf.getViewport()), viewport);
  const scrollTop = await scroll.evaluate(element => Math.max(...[element, ...element.querySelectorAll('*')].map(child => child.scrollTop)));
  await root(2).locator('[data-superdoc-scroll]').click({ position: { x: 180, y: 160 } });
  assert.equal(await scroll.evaluate(element => Math.max(...[element, ...element.querySelectorAll('*')].map(child => child.scrollTop))), scrollTop);
  await scroll.evaluate(element => { for (const child of [element, ...element.querySelectorAll('*')]) child.scrollTop = 0; });
  check('Continuous document scrolling stays inside its node; switching nodes preserves the scroll position');

  // Native export must retain structure even before any text changes.
  const [download] = await Promise.all([page.waitForEvent('download'), canvasNode(1).locator('[data-superdoc-export]').click()]);
  const exportedFile = `${output}/exported-1.docx`;
  await download.saveAs(exportedFile);
  const structure = await verifyExport(exportedFile, sources[0], 'ALPHA');
  check('DOCX export retains original image bytes, merged table, borders, page geometry, header and footer');

  // Focus via the public editor surface, then use real keyboard input.
  const initialText = await Promise.all([1, 2, 3].map(documentText));
  for (const [index, marker] of [[1, 'ALPHA-EDIT '], [2, 'BRAVO-EDIT ']]) {
    await root(index).locator('[data-superdoc-scroll]').click({ position: { x: 180, y: 160 } });
    await page.evaluate(index => window.__docxTestSessions[index - 1].instance.focus({ preventScroll: true }), index);
    await page.keyboard.press('Control+Home');
    await page.keyboard.type(marker, { delay: 30 });
    await page.waitForFunction(({ index, marker }) => window.__docxTestSessions[index - 1].element.innerText.includes(marker), { index, marker });
  }
  assert.ok((await documentText(1)).includes('ALPHA-EDIT'));
  assert.ok(!(await documentText(1)).includes('BRAVO-EDIT'));
  assert.equal(await documentText(3), initialText[2]);
  await page.locator('[data-docx-command="undo"]').click();
  await page.waitForFunction(() => !window.__docxTestSessions[1].element.innerText.includes('BRAVO-EDIT'));
  assert.ok((await documentText(1)).includes('ALPHA-EDIT'));
  await page.locator('[data-docx-command="redo"]').click();
  await page.waitForFunction(() => window.__docxTestSessions[1].element.innerText.includes('BRAVO-EDIT'));
  check('Real keyboard input and shared-toolbar undo/redo stay isolated to the active document');

  await page.evaluate(() => window.__ui.getState().setReaderNodeId('superdoc-node-1', { attachmentId: 'superdoc-att-1' }));
  await page.waitForFunction(() => document.querySelectorAll('[data-superdoc-editor="superdoc-att-1"]').length === 2);
  assert.equal(await page.locator('[data-docx-toolbar] .native-document-toolbar-name').textContent(), '版式验证-1.docx');
  assert.equal(await page.locator('[data-superdoc-scroll="superdoc-att-1"]').count(), 1);
  assert.equal(await page.evaluate(() => window.__docxTestSessions[0].instance === window.__superdocTestInstances[0]), true);
  assert.ok((await documentText(1)).includes('ALPHA-EDIT'));
  await screenshot('reader-same-live-document');
  await page.evaluate(() => window.__ui.getState().setReaderNodeId(null));
  await root(1).locator('[data-superdoc-scroll]').waitFor();
  assert.equal(await page.evaluate(() => window.__docxTestSessions[0].instance === window.__superdocTestInstances[0]), true);
  assert.ok((await documentText(1)).includes('ALPHA-EDIT'));
  check('Opening and closing the reader moves the same live document without losing edits or editor identity');

  const originalPath = `${output}/${fixtures[0].data.attachments[0].name}`;
  await writeFile(originalPath, sources[0].buffer);
  await chooseFixtureOriginal(page, originalPath);
  await canvasNode(1).locator('[data-superdoc-save]').click();
  await page.waitForFunction(() => !!window.__store.getState().nodes.find(node => node.id === 'superdoc-node-1').data.attachments[0].editedDocxRevision);
  assert.ok(await page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'superdoc-node-1').data.attachments[0].editedText?.includes('ALPHA-EDIT')));
  assert.equal(await root(1).getAttribute('data-superdoc-ready'), 'true');
  await verifyExport(originalPath, sources[0], 'ALPHA-EDIT');
  const [editedDownload] = await Promise.all([page.waitForEvent('download'), canvasNode(1).locator('[data-superdoc-export]').click()]);
  const editedFile = `${output}/edited-1.docx`;
  await editedDownload.saveAs(editedFile);
  await verifyExport(editedFile, sources[0], 'ALPHA-EDIT');
  const originalPreserved = await page.evaluate(async () => {
    const { loadAttachmentContent } = await import('/src/lib/attachment-vault.ts');
    return loadAttachmentContent(window.__store.getState().nodes.find(node => node.id === 'superdoc-node-1').data.attachments[0]);
  });
  assert.equal(originalPreserved, sources[0].buffer.toString('base64'));
  check('Explicit save writes the source path with its original layout and retains a separate import snapshot');

  const firstText = await documentText(1);
  await root(2).locator('[data-superdoc-scroll]').click({ position: { x: 180, y: 90 } });
  await page.evaluate(() => window.__docxTestSessions[1].instance.focus({ preventScroll: true, restoreSelection: true }));
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('BOLD-SIZE', { delay: 40 });
  await page.keyboard.press('Shift+Home');
  await page.locator('[data-docx-command="bold"]').click();
  await page.locator('[data-docx-size]').selectOption('24');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await documentText(1), firstText);
  check('Shared font-size and bold controls act on the current document without changing the other document');

  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-docx-insert-image]').click()]);
  await fileChooser.setFiles({ name: 'inserted-local-image.png', mimeType: 'image/png', buffer: tinyPng });
  await page.waitForFunction(() => !document.querySelector('[data-docx-insert-image]')?.disabled);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.locator('[data-docx-insert-table]').click();
  await page.locator('[data-docx-command-panel="table"] input').nth(0).fill('2');
  await page.locator('[data-docx-command-panel="table"] input').nth(1).fill('2');
  await page.locator('[data-docx-confirm-table]').click();
  await page.locator('[data-docx-command-panel]').waitFor({ state: 'hidden' });
  await page.keyboard.type('INSERTED CELL', { delay: 40 });
  await page.waitForFunction(() => window.__docxTestSessions[1].element.innerText.includes('INSERTED CELL'));
  // The active floating toolbar can cover this node's header; use its export
  // action while inserting document content.
  const [secondDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-docx-toolbar] [data-docx-export]').click()]);
  const secondFile = `${output}/edited-2.docx`;
  await secondDownload.saveAs(secondFile);
  const secondExport = await inspectDocx(await readFile(secondFile));
  assert.ok((secondExport.document.match(/<w:tbl(?:\s|>)/g) ?? []).length >= 2);
  assert.ok((secondExport.document.match(/<w:drawing(?:\s|>)/g) ?? []).length >= 2);
  assert.ok(secondExport.document.includes('INSERTED CELL') && secondExport.document.includes('BOLD-SIZE'));
  assert.match(secondExport.document, /w:sz[^>]*w:val="48"/);
  assert.ok(secondExport.media.some(media => media.bytes.equals(tinyPng)));
  assert.equal(await documentText(1), firstText);
  check('Local file chooser and explicit 2×2 table insertion create editable objects in the initiating document and native DOCX export');

  const switched = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/store\/projects\.ts(?:\?|$)/.test(name));
    if (!url) throw new Error('The mounted project module URL is unavailable');
    const projects = await import(url);
    if (projects.useProjects !== window.__projects) throw new Error('Project diagnostics must use the mounted store instance');
    const original = window.__projects.getState().activeId;
    const other = await projects.createProject('DOCX isolated second canvas');
    if (window.__projects.getState().activeId !== other) throw new Error('New canvas did not activate');
    await projects.switchProject(original);
    return { original, current: window.__projects.getState().activeId };
  });
  assert.equal(switched.current, switched.original);
  await root(2).locator('[data-superdoc-scroll]').waitFor();
  assert.equal(await page.evaluate(() => window.__docxTestSessions[1].instance === window.__superdocTestInstances[1]), true);
  assert.ok((await documentText(2)).includes('INSERTED CELL'));
  await page.evaluate(() => window.__rf.setViewport({ x: 20, y: 0, zoom: 0.95 }, { duration: 0 }));
  await root(2).locator('[data-superdoc-scroll]').click({ position: { x: 180, y: 90 } });
  await page.locator('[data-docx-command="undo"]').click();
  await page.waitForFunction(() => !window.__docxTestSessions[1].element.innerText.includes('INSERTED CELL'));
  await page.locator('[data-docx-command="redo"]').click();
  await page.waitForFunction(() => window.__docxTestSessions[1].element.innerText.includes('INSERTED CELL'));
  check('Switching to another canvas and back retains the unsaved document and its independent undo history');

  await page.evaluate(() => window.__ui.getState().setReaderNodeId('superdoc-node-2', { attachmentId: 'superdoc-att-2' }));
  await page.waitForFunction(() => document.querySelectorAll('[data-superdoc-editor="superdoc-att-2"]').length === 2);
  const readerEngine = page.locator('[data-superdoc-scroll="superdoc-att-2"]');
  await readerEngine.click({ position: { x: 150, y: 90 } });
  await page.locator('[data-docx-insert-table]').click();
  const panelInput = page.locator('[data-docx-command-panel="table"] input').first();
  await panelInput.fill('4');
  await panelInput.press('Escape');
  assert.equal(await page.locator('[data-docx-command-panel]').count(), 0);
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-docx-toolbar]').count(), 0);
  assert.equal(await page.locator('[data-superdoc-editor="superdoc-att-2"]').count(), 2);
  await readerEngine.click({ position: { x: 150, y: 90 } });
  await page.locator('[data-docx-toolbar]').waitFor();
  assert.ok((await documentText(2)).includes('INSERTED CELL'));
  check('Escape dismisses table controls then the toolbar while preserving the reader, editor and unsaved document');

  await page.setViewportSize({ width: 900, height: 780 });
  await page.evaluate(async () => { const { useAppearance } = await import('/src/lib/appearance.ts'); useAppearance.getState().setLighting('dark'); });
  await screenshot('reader-narrow-dark');
  const toolbarFits = await page.locator('[data-docx-toolbar]').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, rect: element.getBoundingClientRect().toJSON() }));
  assert.ok(toolbarFits.scroll <= toolbarFits.width + 2, JSON.stringify(toolbarFits));
  assert.ok(toolbarFits.rect.left >= 0 && toolbarFits.rect.right <= 901, JSON.stringify(toolbarFits));
  check('The shared document toolbar remains reachable and contained on a narrow dark viewport');

  const secondOriginal = `${output}/${fixtures[1].data.attachments[0].name}`;
  await writeFile(secondOriginal, sources[1].buffer);
  await chooseFixtureOriginal(page, secondOriginal);
  await page.locator('[data-docx-save]').click();
  await page.waitForFunction(() => !window.__docxTestSessions[1].dirty);
  await verifyExport(secondOriginal, sources[1], 'BRAVO-EDIT');
  const englishNode = structuredClone(fixtures[1]);
  englishNode.id = 'english-preview'; englishNode.position = { x: 100, y: 90 };
  englishNode.data.attachments[0] = { ...englishNode.data.attachments[0], id: 'english-preview-att', name: 'Document layout.docx',
    content: (await readFile(secondFile)).toString('base64') };
  await page.goto(`${appUrl}/?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(async node => {
    window.__store.setState({ nodes: [node], edges: [], selectedNodeId: null, selectedNodeIds: [] });
    const ui = window.__ui.getState(); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false);
    ui.setReaderMode('full'); ui.setReaderNodeId(node.id, { attachmentId: node.data.attachments[0].id });
    const { useAppearance } = await import('/src/lib/appearance.ts'); useAppearance.getState().setLighting('dark');
  }, englishNode);
  await page.locator('[data-docx-toolbar]').getByRole('button', { name: 'Export .docx', exact: true }).waitFor();
  await page.locator('[data-docx-toolbar]').getByRole('combobox', { name: 'Font', exact: true }).waitFor();
  await screenshot('reader-narrow-dark-en');
  check('The English document toolbar renders in the narrow dark reader with the native DOCX layout');

  assert.deepEqual(writes, [], 'Editing must not call model or write APIs');
  assert.deepEqual(errors, [], 'Browser must have no uncaught page errors');
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors, writes, timings, structure, nativeWordVerified: false }, null, 2));
  console.log(`SuperDoc UI: ${checks.length} checks passed.`);
} catch (error) {
  await screenshot('failure').catch(screenshotError => consoleErrors.push(`Failure screenshot: ${String(screenshotError)}`));
  const diagnostic = await page.evaluate(async () => {
    const session = document.querySelector('[data-superdoc-scroll="superdoc-att-1"]')?.__docxSession;
    if (!session?.instance) return { sessionStatus: session?.status };
    try {
      const blob = await session.instance.export({ exportType: ['docx'], triggerDownload: false });
      return { status: session.status, text: session.element.innerText.slice(0, 500), activeElement: document.activeElement?.outerHTML.slice(0, 600), kind: Object.prototype.toString.call(blob), constructor: blob?.constructor?.name, size: blob?.size, keys: Object.keys(blob ?? {}) };
    } catch (error) { return { status: session.status, exportError: String(error), stack: error.stack }; }
  }).catch(error => ({ diagnosticError: String(error) }));
  console.log('DIAGNOSTIC', JSON.stringify({ ...diagnostic, consoleErrors, failedRequests }));
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors, writes, timings, diagnostic, consoleErrors, failedRequests, failure: String(error), nativeWordVerified: false }, null, 2));
  throw error;
} finally { await close(); }
