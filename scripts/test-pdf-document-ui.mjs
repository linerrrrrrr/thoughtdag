// PDF originals, highlights and comments in an isolated browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { documentBrowser } from './fixtures/original-file-browser.mjs';

const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
assert.ok(executablePath);
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5180';
const output = 'local-tests/pdf-document';
await mkdir(output, { recursive: true });
const { context, close } = await documentBrowser(appUrl, { executablePath, viewport: { width: 1500, height: 1050 }, reducedMotion: 'reduce', locale: 'zh-CN' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const checks = [], errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh'); localStorage.setItem('thoughtdag.lighting', 'light');
});

function pdfFixture() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, stream] of ['BT /F1 18 Tf 42 720 Td (Original PDF paragraph for native selection.) Tj ET', '.8 .9 1 rg 40 100 530 580 re f'].entries()) {
    const geometry = index === 0 ? '/Annots [8 0 R]' : '/CropBox [20 40 592 752] /Rotate 90';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${geometry} /Resources << /Font << /F1 3 0 R >> >> /Contents ${index * 2 + 5} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Annot /Subtype /Text /Rect [90 90 110 110] /NM (existing) /Contents (Existing note) >>');
  let raw = '%PDF-1.4\n'; const offsets = [];
  for (const [index, value] of objects.entries()) { offsets.push(Buffer.byteLength(raw)); raw += `${index + 1} 0 obj\n${value}\nendobj\n`; }
  const xref = Buffer.byteLength(raw);
  raw += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(raw).toString('base64');
}
const source = pdfFixture();
const fixture = { id: 'pdf-original', type: 'thought', dragHandle: '.drag-handle', position: { x: 140, y: 100 }, width: 570, height: 720,
  data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0, highlights: [], highlightMode: 'off', detailLevel: 'full',
    attachments: [{ id: 'pdf-original-att', name: '原页与扫描页.pdf', type: 'application/pdf', size: 1300, content: source, extractedText: 'Original source text.', numPages: 2 }] } };
const originalPath = `${output}/${fixture.data.attachments[0].name}`;
await writeFile(originalPath, Buffer.from(source, 'base64'));
async function savedAnnotations() {
  const content = await page.evaluate(async () => {
    const { loadNodePdfFile } = await import('/src/lib/attachment-vault.ts');
    return loadNodePdfFile(window.__store.getState().nodes[0].data.attachments[0]);
  });
  const pdf = await PDFDocument.load(Buffer.from(content, 'base64'));
  return pdf.getPages().flatMap((page, index) => (page.node.Annots()?.asArray() ?? []).map(ref => {
    const dict = pdf.context.lookup(ref, PDFDict);
    return { page: index + 1, type: dict.get(PDFName.of('Subtype')).asString().slice(1),
      id: dict.get(PDFName.of('NM')).decodeText(), comment: dict.get(PDFName.of('Contents')).decodeText(),
      quad: dict.lookupMaybe(PDFName.of('QuadPoints'), PDFArray)?.asArray().map(n => n.asNumber()),
      appearance: dict.has(PDFName.of('AP')) };
  }));
}
const root = () => page.locator('[data-pdf-document="pdf-original-att"]');
const canvasNode = () => page.locator('.react-flow__node[data-id="pdf-original"]');
const comment = () => page.locator('[data-pdf-comment-editor]');
const annotations = () => page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'pdf-original').data.attachments[0].pdfAnnotations ?? []);
const waitCount = count => page.waitForFunction(count => (window.__store.getState().nodes.find(node => node.id === 'pdf-original').data.attachments[0].pdfAnnotations ?? []).length === count, count);
const check = name => { checks.push(name); console.log('PASS', name); };
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(node => {
    const nodes = [node]; window.__store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0, selectedNodeId: null, selectedNodeIds: [] });
    const ui = window.__ui.getState(); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('full');
  }, fixture);
  await root().locator('[data-pdf-page][data-page="2"]').waitFor();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__rf.setViewport({ x: 50, y: 20, zoom: 1 }, { duration: 0 }));
  await settle();
  assert.equal(await root().locator('[data-pdf-page]').count(), 2);
  assert.equal(await canvasNode().locator('[data-document-edit], [data-document-copy-editor], [data-rich-document-editor]').count(), 0);
  const before = await page.evaluate(() => window.__rf.getViewport());
  const body = canvasNode().locator('[data-content-body]');
  const chromePositions = () => canvasNode().evaluate(node => {
    const rect = selector => {
      const { top, bottom } = node.querySelector(selector).getBoundingClientRect();
      return { top, bottom };
    };
    return { header: rect('[data-file-header]'), toolbar: rect('.pdf-document-toolbar'), viewport: rect('[data-content-body]') };
  });
  const positions = await chromePositions();
  assert.ok(positions.header.bottom <= positions.viewport.top && positions.toolbar.bottom <= positions.viewport.top,
    'The PDF scrollbar starts below the filename and annotation tools');
  await body.hover(); await page.waitForTimeout(100); await page.mouse.wheel(0, 420);
  await page.waitForFunction(() => document.querySelector('[data-content-body]').scrollTop > 100);
  assert.deepEqual(await page.evaluate(() => window.__rf.getViewport()), before);
  assert.deepEqual(await chromePositions(), positions, 'Reading the next page leaves the file header and annotation tools in place');
  await body.evaluate(element => { element.scrollTop = 0; });
  check('PDF uses continuous immutable original pages inside the canvas without moving the viewport');

  await root().locator('[data-pdf-mode="highlight"]').click();
  await root().locator('[data-pdf-mode="highlight"]').click();
  assert.equal(await root().locator('[data-pdf-mode="read"]').getAttribute('aria-pressed'), 'true');
  await root().locator('[data-pdf-mode="highlight"]').click();
  const span = root().locator('[data-page="1"] .tdag-textlayer span').first();
  await span.waitFor();
  const textBox = await span.boundingBox(); assert.ok(textBox);
  await page.mouse.move(textBox.x + 2, textBox.y + textBox.height / 2); await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width - 2, textBox.y + textBox.height / 2, { steps: 12 }); await page.mouse.up();
  await waitCount(1);
  const first = (await annotations())[0];
  assert.ok(first.text.includes('Original PDF'));
  assert.equal(first.page, 1);
  assert.ok(first.rects.every(rect => rect.every(value => value >= 0 && value <= 1) && rect[2] > 0 && rect[3] > 0));
  await page.evaluate(() => window.__store.getState().undo()); await waitCount(0);
  await page.evaluate(() => window.__store.getState().redo()); await waitCount(1);
  check('native text selection creates normalized highlights with one-step undo and redo');

  const resize = (width, height) => page.evaluate(({ width, height }) => {
    window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === 'pdf-original' ? { ...node, width, height } : node) }));
  }, { width, height });
  const setNames = (displayName, name) => page.evaluate(({ displayName, name }) => {
    window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === 'pdf-original'
      ? { ...node, data: { ...node.data, displayName, attachments: node.data.attachments.map(att => ({ ...att, name })) } }
      : node) }));
  }, { displayName, name });
  await setNames('两行自定义材料节点名称用于确认原页工具和带引用的评论始终保留可阅读空间', '研究文档原始附件的长文件名用于验证标题换行和文档工具栏的布局.pdf');
  const heights = [];
  for (const height of [221, 240, 300, 420]) {
    await resize(340, height);
    const sizes = { height };
    for (const mode of ['read', 'highlight', 'comment']) {
      await canvasNode().locator(`[data-pdf-mode="${mode}"]`).click();
      sizes[mode] = await body.evaluate(el => el.clientHeight);
    }
    await root().locator(`[data-pdf-comment-pin="${first.id}"]`).evaluate(el => el.click());
    await comment().locator('blockquote').waitFor();
    sizes.editor = await body.evaluate(el => el.clientHeight);
    assert.equal(sizes.editor, sizes.comment, 'Opening a quoted comment preserves the PDF reading height');
    assert.ok(await body.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.left + 8, rect.top + rect.height / 2));
    }), 'The page remains reachable beside the comment editor');
    heights.push(sizes);
    await comment().locator('textarea').press('Escape');
  }
  assert.ok(heights.every(row => ['read', 'highlight', 'comment', 'editor'].every(key => row[key] >= 20)), JSON.stringify(heights));
  await setNames(undefined, fixture.data.attachments[0].name);
  console.log('PDF page viewport heights:', heights);
  await resize(340, 120);
  const fileHeader = canvasNode().locator('[data-file-header]');
  await fileHeader.locator('[data-pdf-mode="read"]').click();
  await fileHeader.locator('[data-pdf-mode="comment"]').click();
  const shortViewport = await body.boundingBox();
  assert.ok(shortViewport && shortViewport.height > 8, 'Annotation mode leaves a usable PDF viewport at minimum node height');
  await root().locator(`[data-pdf-comment-pin="${first.id}"]`).click();
  await comment().locator('textarea').fill('short-card comment draft');
  await comment().locator('textarea').press('Escape');
  await comment().waitFor({ state: 'hidden' });
  await resize(fixture.width, fixture.height);
  await body.evaluate(element => { element.scrollTop = 0; });
  check('minimum-height PDF keeps reading tools and the comment editor reachable');

  await root().locator('[data-pdf-mode="read"]').click();
  await root().locator(`[data-pdf-comment-pin="${first.id}"]`).click();
  await comment().locator('textarea').fill('这是一条待保存的评论');
  await page.mouse.click(1250, 900);
  await comment().waitFor({ state: 'hidden' });
  assert.equal((await annotations())[0].comment, undefined);
  await root().locator(`[data-pdf-comment-pin="${first.id}"]`).click();
  assert.equal(await comment().locator('textarea').inputValue(), '这是一条待保存的评论');
  const saveComment = comment().getByRole('button', { name: '保存', exact: true });
  await page.evaluate(() => { window.showOpenFilePicker = () => { throw new Error('Unexpected external file request'); }; });
  await saveComment.click();
  await comment().waitFor({ state: 'hidden' });
  assert.equal((await annotations())[0].comment, '这是一条待保存的评论');
  assert.deepEqual(await readFile(originalPath), Buffer.from(source, 'base64'));
  const firstSave = await savedAnnotations();
  assert.equal(firstSave.length, 2);
  assert.equal(firstSave.find(mark => mark.id === 'existing').comment, 'Existing note');
  assert.equal(firstSave.find(mark => mark.id === first.id).comment, '这是一条待保存的评论');
  assert.equal(firstSave.find(mark => mark.id === first.id).appearance, true);
  await root().locator(`[data-pdf-comment-pin="${first.id}"]`).click();
  await comment().locator('textarea').fill('');
  await page.mouse.click(1250, 900);
  await comment().waitFor({ state: 'hidden' });
  await root().locator(`[data-pdf-comment-pin="${first.id}"]`).click();
  assert.equal(await comment().locator('textarea').inputValue(), '');
  await comment().locator('textarea').press('Escape');
  assert.equal((await annotations())[0].comment, '这是一条待保存的评论');
  check('comments require explicit saving; outside dismissal preserves even empty drafts and Escape cancels');

  await root().locator('[data-pdf-mode="comment"]').click();
  const selectBox = await span.boundingBox(); assert.ok(selectBox);
  await page.mouse.move(selectBox.x + 2, selectBox.y + selectBox.height / 2); await page.mouse.down();
  await page.mouse.move(selectBox.x + selectBox.width - 2, selectBox.y + selectBox.height / 2, { steps: 12 }); await page.mouse.up();
  await comment().waitFor();
  assert.ok((await comment().locator('blockquote').textContent()).includes('Original PDF'));
  await comment().getByRole('button', { name: '取消', exact: true }).click();
  await waitCount(1);
  check('text comments preserve the selected passage and cancelling a new comment creates no annotation');

  await root().locator('[data-pdf-mode="highlight"]').click();
  const scan = root().locator('[data-page="2"] [data-pdf-region-layer]');
  await scan.scrollIntoViewIfNeeded();
  const box = await scan.boundingBox(); assert.ok(box);
  const y = Math.max(box.y + 40, 350);
  await page.mouse.move(box.x + 60, y); await page.mouse.down();
  await page.mouse.move(box.x + 210, y + 60, { steps: 12 }); await page.mouse.up();
  await waitCount(2);
  assert.equal((await annotations())[1].page, 2);
  assert.equal((await annotations())[1].text, undefined);
  await root().locator('[data-pdf-mode="comment"]').click();
  await scan.scrollIntoViewIfNeeded();
  const scanBox = await scan.boundingBox(); assert.ok(scanBox);
  await page.mouse.click(scanBox.x + 220, Math.max(scanBox.y + 100, 420));
  await comment().locator('textarea').fill('扫描页位置评论');
  await comment().getByRole('button', { name: '保存', exact: true }).click();
  await waitCount(3);
  assert.equal((await annotations())[2].comment, '扫描页位置评论');
  const written = await savedAnnotations();
  assert.equal(written.length, 4);
  const [highlight, note] = (await annotations()).slice(1);
  const region = written.find(mark => mark.id === highlight.id);
  assert.equal(region.type, 'Highlight'); assert.equal(region.page, 2); assert.equal(region.appearance, true);
  const [left, top, width, height] = highlight.rects[0];
  const corners = [[left, top], [left + width, top], [left, top + height], [left + width, top + height]]
    .flatMap(([u, v]) => [20 + v * 572, 40 + u * 712]);
  region.quad.forEach((value,index) => assert.ok(Math.abs(value-corners[index]) < .001));
  const diskNote = written.find(mark => mark.id === note.id);
  assert.equal(diskNote.type, 'Text'); assert.equal(diskNote.comment, '扫描页位置评论');
  check('Saved PDF bytes preserve the existing note, Chinese comments and cropped, rotated highlight coordinates without duplicates');

  await root().locator('[data-pdf-mode="read"]').click();
  await body.evaluate(element => { element.scrollTop = 0; });
  await root().locator(`[data-pdf-comment-pin="${first.id}"]`).click();
  await comment().locator('[data-pdf-delete-annotation]').click(); await waitCount(2);
  await canvasNode().locator('[data-pdf-save]').click();
  await page.waitForFunction(() => document.querySelector('[data-pdf-save]')?.disabled && document.querySelector('[data-file-header]').textContent.includes('已保存'));
  assert.equal((await savedAnnotations()).some(mark => mark.id === first.id), false);
  await page.evaluate(() => window.__store.getState().undo());
  await page.evaluate(() => window.__store.getState().undo()); await waitCount(3);
  const preserved = await page.evaluate(async () => {
    const { loadAttachmentContent } = await import('/src/lib/attachment-vault.ts');
    const attachment = window.__store.getState().nodes[0].data.attachments[0];
    return { source: await loadAttachmentContent(attachment), extractedText: attachment.extractedText, editedText: attachment.editedText };
  });
  assert.equal(preserved.source, source); assert.equal(preserved.extractedText, 'Original source text.'); assert.equal(preserved.editedText, undefined);
  check('Save writes annotation deletion to disk, and canvas undo retains the import snapshot and source text');
  await page.screenshot({ path: `${output}/canvas-pdf-annotations.png` });

  await page.evaluate(() => window.__ui.getState().setReaderNodeId('pdf-original', { attachmentId: 'pdf-original-att' }));
  await page.locator('[data-reader-body] [data-pdf-page][data-page="2"]').waitFor();
  assert.equal(await page.locator('[data-reader-edit-toggle]').count(), 0);
  const readerPdf = page.locator('[data-reader-body] [data-pdf-document]');
  if (await readerPdf.locator('[data-pdf-save]').isEnabled()) await readerPdf.locator('[data-pdf-save]').click();
  await page.waitForFunction(() => document.querySelector('[data-reader-body] [data-pdf-save]')?.disabled && document.querySelector('[data-reader-body]').textContent.includes('已保存'));
  assert.equal((await savedAnnotations()).length, 4);
  await readerPdf.locator('[data-pdf-mode="highlight"]').click();
  await readerPdf.locator(`[data-pdf-comment-pin="${first.id}"]`).click();
  await comment().locator('textarea').fill('不保存的修改');
  await comment().locator('textarea').press('Escape');
  assert.equal(await readerPdf.locator('[data-pdf-mode="highlight"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await readerPdf.locator('[data-pdf-mode="read"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__ui.getState().readerNodeId), 'pdf-original');
  check('Escape closes comment editing before highlight mode and leaves the reader open');
  await page.setViewportSize({ width: 900, height: 750 });
  await page.evaluate(async () => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await page.screenshot({ path: `${output}/reader-pdf-narrow-dark.png` });

  const viewer = await context.newPage();
  const shareUrl = await page.evaluate(async () => {
    const { buildViewerLink } = await import('/src/lib/viewer.ts');
    const state = window.__store.getState();
    return buildViewerLink(state.nodes, state.edges);
  });
  await viewer.goto(`${appUrl}/${new URL(shareUrl).hash}`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForFunction(() => window.__ui && window.__rf && window.__store);
  await viewer.locator('[data-pdf-fallback]').waitFor();
  assert.equal(await viewer.evaluate(() => window.__store.getState().nodes[0].data.attachments[0].content), '');
  assert.equal(await viewer.locator('[data-pdf-mode], [data-pdf-delete-annotation]').count(), 0);
  assert.equal(await viewer.locator('[data-pdf-page]').count(), 0);
  assert.match(await viewer.locator('[data-pdf-fallback-text]').textContent(), /Original source text/);
  assert.match(await viewer.locator('[data-pdf-fallback-annotations]').textContent(), /这是一条待保存的评论/);
  assert.match(await viewer.locator('[data-pdf-fallback-annotations]').textContent(), /扫描页位置评论/);
  assert.equal(await viewer.locator('[data-pdf-fallback] textarea').count(), 0);
  await viewer.evaluate(() => window.__ui.getState().setReaderNodeId('pdf-original', { attachmentId: 'pdf-original-att' }));
  await viewer.locator('[data-reader-body] [data-pdf-fallback]').waitFor();
  assert.match(await viewer.locator('[data-reader-body] [data-pdf-fallback-annotations]').textContent(), /扫描页位置评论/);
  assert.equal(await viewer.locator('[data-reader-body] [data-pdf-mode], [data-reader-edit-toggle]').count(), 0);
  await viewer.screenshot({ path: `${output}/share-pdf-fallback.png` });
  await viewer.close();
  check('real share links without PDF bytes show extracted text and saved annotations read-only in cards and readers');
  await page.evaluate(node => {
    const attachment = { ...node.data.attachments[0], id: 'pdf-missing-att', content: '', contentInVault: false };
    window.__ui.getState().setReaderNodeId(null);
    window.__store.setState({ nodes: [{ ...node, id: 'pdf-missing', data: { ...node.data, attachments: [attachment] } }], edges: [] });
  }, fixture);
  const missing = page.locator('[data-pdf-document="pdf-missing-att"]');
  await missing.locator('[data-pdf-fallback]').waitFor();
  assert.equal(await missing.locator('[data-pdf-mode]').count(), 0);
  assert.equal(await missing.locator('[data-pdf-page]').count(), 0);
  assert.match(await missing.locator('[data-pdf-fallback-text]').textContent(), /Original source text/);
  check('missing local PDF originals also disable annotation creation and retain readable fallback text');

  // Keep the last-page ruler handle of the full-height fixture on screen.
  await page.setViewportSize({ width: 1500, height: 1050 });
  const longPdf = await PDFDocument.create();
  for (let i = 1; i <= 530; i++) {
    const sheet = longPdf.addPage(i === 530 ? [450, 1100] : [450, 600]);
    sheet.drawText(`Page ${i}`, { x: 40, y: 80 });
  }
  const longBytes = Buffer.from(await longPdf.save());
  await page.evaluate(({ node, content, size }) => {
    const att = { ...node.data.attachments[0], id: 'long-pdf-att', content, size, numPages: 530,
      pdfAnnotations: [{ id: 'end-mark', page: 530, kind: 'highlight', rects: [[0.2, 0.8, 0.3, 0.04]], color: '#ffcc00' }] };
    window.__store.setState({ nodes: [{ ...node, id: 'long-pdf', data: { ...node.data, attachments: [att] } }], edges: [] });
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
  }, { node: fixture, size: longBytes.length, content: longBytes.toString('base64') });
  const book = page.locator('.react-flow__node[data-id="long-pdf"]');
  await book.locator('[data-page="1"] .tdag-textlayer span').first().waitFor();
  assert.equal(await book.locator('[data-pdf-page]').count(), 530);
  assert.ok(await book.locator('[data-pdf-sized]').count() < 12, 'Opening the file must not request 530 page geometries');
  await book.locator('[data-overview-ruler-mark]').click();
  await book.locator('[data-page="530"] .tdag-textlayer span').first().waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector('.react-flow__node[data-id="long-pdf"]');
    const viewport = node.querySelector('.pdf-page-viewport').getBoundingClientRect();
    const mark = node.querySelector('[data-pdf-annotation="end-mark"]').getBoundingClientRect();
    return mark.top >= viewport.top && mark.bottom <= viewport.bottom && !node.querySelector('[data-page="1"] canvas');
  });
  const loadedPages = await book.locator('[data-pdf-sized]').count();
  const canvases = await book.locator('.pdf-document-page canvas').count();
  assert.ok(loadedPages < 16 && canvases < 10, 'A jump to the last page must skip the intervening pages');
  await book.locator('.pdf-page-viewport').evaluate(viewport => { viewport.scrollTop = 0; });
  await book.locator('[data-page="1"] .tdag-textlayer span').first().waitFor();
  assert.equal(await book.locator('[data-page="530"] canvas').count(), 0);
  check(`530-page PDF jumps to a highlighted area and back with ${loadedPages} measured pages and ${canvases} mounted canvas(es) at the destination`);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes, failure: String(error) }, null, 2));
  throw error;
} finally { await close(); }
