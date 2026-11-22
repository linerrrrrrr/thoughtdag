// Select from independently known PDF glyph positions, including on a rotated page.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import { documentBrowser } from './fixtures/original-file-browser.mjs';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5180';
const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const pdf = await PDFDocument.create();
pdf.setLanguage('zh-CN');
const regular = await pdf.embedFont(StandardFonts.Courier);
const bold = await pdf.embedFont(StandardFonts.CourierBold);
const pages = [{ width: 500, height: 310, lines: 12 }, { width: 470, height: 280, lines: 8 }];
const fontSize = 12, advance = fontSize * 0.6, margin = 35;
const lineText = (page, line) => `p${page}/${String(line + 1).padStart(2, '0')} ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789`;
const baseline = line => 32 + 21 * line;
for (const [index, { width, height, lines }] of pages.entries()) {
  const rotated = index === 1;
  const sheet = pdf.addPage(rotated ? [height + 60, width + 90] : [width, height]);
  if (rotated) {
    sheet.setRotation(degrees(90));
    sheet.setCropBox(12, 24, height, width);
    sheet.node.set(PDFName.of('UserUnit'), pdf.context.obj(2));
  }
  for (let line = 0; line < lines; line++) {
    const text = lineText(index + 1, line);
    const runs = rotated ? [[0, text.slice(0, 19), regular], [19, text.slice(19), bold]]
      : Array.from(text, (char, i) => [i, char, i % 2 ? bold : regular]);
    for (const [start, run, font] of runs) {
      const x = margin + start * advance, y = baseline(line);
      sheet.drawText(run, { font, size: fontSize, ...(rotated ? { x: 12 + y, y: 24 + x, rotate: degrees(90) } : { x, y: height - y }) });
    }
  }
}
const bytes = Buffer.from(await pdf.save());
const attachment = { id: 'pdf-geometry-att', name: 'Selection.pdf', type: 'application/pdf', content: bytes.toString('base64'), size: bytes.length, numPages: 2 };
const node = { id: 'pdf-geometry', type: 'thought', position: { x: 100, y: 100 }, width: 800, height: 1100,
  data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0,
    highlights: [], detailLevel: 'full', attachments: [attachment] } };
const { context, close } = await documentBrowser(appUrl, { executablePath, viewport: { width: 1600, height: 1160 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce', locale: 'zh-CN' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } }));
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1'); localStorage.setItem('thoughtdag.lang', 'zh');
});

const marks = () => page.evaluate(() => window.__store.getState().nodes.find(n => n.id === 'pdf-geometry').data.attachments[0].pdfAnnotations ?? []);
const compact = page.locator('.react-flow__node[data-id="pdf-geometry"]');
const reader = page.locator('[data-reader-body] [data-pdf-document]');
const normalize = text => text.replace(/\s+/g, '');
async function point(root, pageNo, line, offset) {
  const sheet = root.locator(`[data-pdf-page][data-page="${pageNo}"]`);
  await sheet.locator('.tdag-textlayer span').first().waitFor();
  const box = await sheet.boundingBox(), geometry = pages[pageNo - 1];
  return { x: box.x + (margin + advance * (offset + .05)) * box.width / geometry.width,
    y: box.y + (baseline(line) - fontSize * .35) * box.height / geometry.height };
}
async function drag(root, from, to) {
  const a = await point(root, ...from), b = await point(root, ...to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 }); await page.mouse.up();
}

// Full interior lines, partial endpoints and whitespace between baselines all have independent expected bounds.
function checkSelection(mark, pageNo, firstLine, start, lastLine, end) {
  const { width, height } = pages[pageNo - 1];
  const texts = [];
  for (let line = firstLine; line <= lastLine; line++) {
    const text = lineText(pageNo, line);
    const a = line === firstLine ? start : 0, b = line === lastLine ? end : text.length;
    texts.push(text.slice(a, b));
    const y = (baseline(line) - 4) / height;
    const covers = x => mark.rects.some(([left, top, w, h]) => x / width >= left && x / width < left + w && y >= top && y < top + h);
    for (let char = 0; char < text.length; char++) {
      assert.equal(covers(margin + (char + .5) * advance), char >= a && char < b, `page ${pageNo}, line ${line + 1}, glyph ${char + 1}`);
    }
  }
  for (const [x, y, w, h] of mark.rects) {
    assert.ok(x >= 0 && y >= 0 && x + w <= 1.00001 && y + h <= 1.00001);
    assert.ok(h > 0 && h * height < 21 && w > 0, 'A text rectangle must fit one printed line');
    const center = (y + h / 2) * height;
    assert.ok(center > baseline(firstLine) - fontSize - 2 && center < baseline(lastLine) + 2);
  }
  if (mark.text !== undefined) assert.equal(normalize(mark.text), normalize(texts.join(' ')));
  return texts.join(' ');
}

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__rf && window.__store?.persist.hasHydrated());
  await page.evaluate(node => {
    window.__store.setState({ nodes: [node], edges: [], selectedNodeId: null, selectedNodeIds: [] });
    const ui = window.__ui.getState(); ui.setPanelOpen(false); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setReaderMode('full');
  }, node);
  await compact.locator('[data-page="1"] .tdag-textlayer span').first().waitFor();
  const firstLayer = compact.locator('[data-page="1"] .tdag-textlayer');
  assert.ok(await firstLayer.locator('span').count() > 200, 'Fixture exercises many separately positioned runs');
  assert.equal(await firstLayer.getAttribute('lang'), 'zh-CN');
  // Adding the fixture node schedules a 400ms camera animation after 100ms.
  await page.waitForTimeout(550);
  await compact.locator('[data-pdf-mode="highlight"]').click();
  await page.evaluate(() => window.__rf.setViewport({ x: 90, y: 10, zoom: .65 }, { duration: 0 }));
  await drag(compact, [1, 4, 36], [1, 0, 24]);
  await page.waitForFunction(() => window.__store.getState().nodes[0].data.attachments[0].pdfAnnotations?.length === 1);
  checkSelection((await marks())[0], 1, 0, 24, 4, 36);
  console.log('PASS reverse multiline drag from printed glyphs on the zoomed canvas');

  await page.evaluate(() => window.__ui.getState().setReaderNodeId('pdf-geometry', { attachmentId: 'pdf-geometry-att' }));
  await reader.locator('[data-pdf-mode="highlight"]').click();
  await drag(reader, [1, 0, 7], [2, 2, 25]);
  const cross = (await marks()).slice(1);
  assert.equal(cross.length, 2);
  const full = lineText(1, 0).length;
  const prefix = checkSelection(cross[0], 1, 0, 7, 11, full);
  const suffix = checkSelection(cross[1], 2, 0, 0, 2, 25);
  console.log('PASS page-local text and rectangles across a page break and a rotated text layer');

  await reader.locator('[data-pdf-mode="read"]').click();
  await page.evaluate(() => window.__store.getState().undo());
  assert.equal((await marks()).length, 1, 'One undo removes the entire cross-page drag');
  await drag(reader, [1, 0, 7], [2, 2, 25]);
  await page.locator('[data-reader-clip-note]').click();
  const note = await page.evaluate(() => window.__store.getState().nodes.find(n => n.data.stepKind === 'note').data);
  assert.equal(normalize(note.question), normalize(prefix + suffix));
  checkSelection(note.anchor, 1, 0, 7, 11, full);
  assert.equal(note.anchor.additionalPages.length, 1);
  checkSelection(note.anchor.additionalPages[0], 2, 0, 0, 2, 25);
  assert.equal(await reader.locator('[data-page="2"] [data-anchor-bubble]').count(), 1);
  console.log('PASS excerpt anchors retain all lines and the source page of each rectangle');

  await reader.locator('[data-pdf-mode="comment"]').click();
  await drag(reader, [1, 0, 7], [2, 2, 25]);
  const editor = reader.locator('[data-pdf-comment-editor]');
  assert.equal(normalize(await editor.locator('blockquote').innerText()), normalize(prefix + suffix));
  assert.equal((await marks()).length, 1, 'Comment drag creates a draft');
  await editor.locator('textarea').fill('跨页评论');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const saved = (await marks()).slice(1);
  assert.equal(saved.length, 2);
  assert.ok(saved[0].commentGroupId);
  assert.equal(saved[1].commentGroupId, saved[0].commentGroupId);
  assert.ok(saved.every(mark => mark.comment === '跨页评论'));
  checkSelection(saved[0], 1, 0, 7, 11, full);
  checkSelection(saved[1], 2, 0, 0, 2, 25);
  const recovered = await page.evaluate(async () => {
    const { loadNodePdfFile } = await import('/src/lib/attachment-vault.ts');
    const { loadPdfjs } = await import('/src/lib/pdf-document-cache.ts');
    const { readSavedCanvasMarks } = await import('/src/lib/pdf-annotations.ts');
    const file = window.__store.getState().nodes.find(n => n.id === 'pdf-geometry').data.attachments[0];
    const data = Uint8Array.from(atob(await loadNodePdfFile(file)), char => char.charCodeAt(0));
    const pdfjs = await loadPdfjs();
    const savedDoc = await pdfjs.getDocument({ data: data.slice() }).promise;
    try { return await readSavedCanvasMarks(data, savedDoc, file.pdfSavedAnnotations); }
    finally { await savedDoc.destroy(); }
  });
  for (const mark of saved) {
    const written = recovered.find(item => item.id === mark.id);
    assert.equal(written.comment, '跨页评论');
    assert.equal(written.rects.length, mark.rects.length);
    const expected = mark.rects.flat();
    written.rects.flat().forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6));
  }
  await reader.locator(`[data-pdf-comment-pin="${saved[1].id}"]`).click();
  assert.equal(normalize(await editor.locator('blockquote').innerText()), normalize(prefix + suffix));
  await editor.locator('[data-pdf-delete-annotation]').click();
  assert.equal((await marks()).length, 1);
  await page.evaluate(() => window.__store.getState().undo());
  assert.equal((await marks()).length, 3);
  console.log('PASS a cross-page comment saves, reopens from page two, deletes, and undoes as one comment');

  // Select a fresh passage, with a different start and end, for a source-linked question.
  await reader.locator('[data-pdf-mode="read"]').click();
  await drag(reader, [1, 0, 1], [2, 5, 12]);
  const askBar = page.locator('[data-reader-askbar]');
  await askBar.locator('textarea').fill('Which passage?');
  await askBar.locator('textarea').press('Enter');
  const question = await page.evaluate(() => window.__store.getState().nodes.find(n => n.data.question?.endsWith('Which passage?')).data);
  assert.equal(question.anchor.attId, attachment.id);
  assert.equal(question.anchor.page, 1);
  const askedFirst = checkSelection(question.anchor, 1, 0, 1, 11, full);
  const askedLast = checkSelection(question.anchor.additionalPages[0], 2, 0, 0, 5, 12);
  assert.equal(normalize(question.question.replace(/^> /gm, '')), normalize(`(p.1, 2) ${askedFirst} ${askedLast} Which passage?`));
  console.log('PASS a reader question quotes exactly the selected passage and anchors to both original pages');
  assert.deepEqual(errors, []);
} finally { await close(); }
