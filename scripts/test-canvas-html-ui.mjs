// Export through the application, then read the downloaded file in a fresh, offline browser.
// Run with node scripts/test-canvas-html-ui.mjs; --dark also checks the Chinese dark theme.
// CHROME_PATH can select a Chromium installation.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Document, Paragraph, Packer } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const dark = process.argv.includes('--dark');
const output = resolve(dark ? 'local-tests/canvas-html-dark' : 'local-tests/canvas-html');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
await mkdir(output, { recursive: true });

const docx = text => Packer.toBase64String(new Document({ sections: [{ children: [new Paragraph(text)] }] }));
const original = 'Superseded document body';
const saved = 'The saved document revision.';
const pdf = await PDFDocument.create();
pdf.addPage([320, 220]).drawText('Static PDF page');
const pdfBytes = Buffer.from(await pdf.save()).toString('base64');
const attachments = [
  { id: 'document', name: 'Decision.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: await docx(original), editedDocxContent: await docx(saved), editedText: saved, documentHtml: '<p>' + original + '</p>' },
  { id: 'empty', name: 'Empty.docx', type: 'text/plain', content: original, editedText: '', extractedText: original },
  { id: 'missing', name: 'Recovered.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: '', editedDocxRevision: 'absent-vault-entry', editedText: 'Recovered saved text' },
  { id: 'pdf', name: 'Page.pdf', type: 'application/pdf', content: pdfBytes, extractedText: 'Static PDF page',
    pdfAnnotations: [{ id: 'saved-mark', kind: 'note', page: 1, rects: [[0.1, 0.2, 0.3, 0.05]], color: '#ffdd88', comment: 'Existing page annotation' }] },
  { id: 'image', name: 'Figure.png', type: 'image/png', content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jac8AAAAASUVORK5CYII=' },
  { id: 'html', name: 'Source.html', type: 'text/html', content: '<p contenteditable="true">A <strong>formatted</strong> paragraph.</p><form><input type="text"></form>' },
].map(a => ({ ...a, size: a.content.length }));

process.env.THOUGHTDAG_DISK_STORAGE = '0';
const vite = await createServer({ server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: null }, logLevel: 'error' });
let browser;
try {
  await vite.listen();
  const appUrl = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath, headless: true });
  const editor = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await editor.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || url.origin !== new URL(appUrl).origin) return route.abort();
    return route.continue();
  });
  await editor.addInitScript(dark => {
    localStorage.setItem('thoughtdag.seeded', 'yes');
    localStorage.setItem('thoughtdag.tutorialDone', '1');
    localStorage.setItem('thoughtdag.lang', dark ? 'zh' : 'en');
    localStorage.setItem('thoughtdag.lighting', dark ? 'dark' : 'light');
  }, dark);
  const app = await editor.newPage();
  app.setDefaultTimeout(25000);
  app.on('pageerror', error => console.error('Editor page error:', error.message));
  app.on('console', msg => {
    if (msg.type() === 'error' && msg.text().includes('HTML export failed')) console.error(msg.text());
  });
  await app.goto(appUrl);
  await app.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await app.evaluate(async attachments => {
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    const { internNodes } = await import('/src/lib/attachment-vault.ts');
    useUiStore.getState().setTutorialOpen(false);
    useUiStore.getState().setReleaseNotesOpen(false);
    function node(id, x, y, width, height, data) {
      return { id, type: 'thought', position: { x, y }, width, height, style: { width, height }, data: {
        question: '', response: '', responses: [], responseIndex: -1, isEditing: false, isLoading: false, isCollapsed: false,
        highlights: [], highlightMode: 'off', tokenCount: 0, attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], ...data,
      } };
    }
    const response = 'First paragraph.\n\nMarked conclusion.\n\n- [ ] Review the source';
    const nodes = await internNodes([
      node('frame', -310, -180, 1060, 420, { stepKind: 'frame', question: 'Review group' }),
      node('qa', -280, -110, 360, 290, { displayName: 'Discussion', question: 'Which finding matters?',
        response, responses: [response], responseIndex: 0, highlights: [{ id: 'mark', text: 'Marked conclusion.' }], highlightMode: 'tag' }),
      node('docs', 220, -110, 480, 250, { stepKind: 'file', displayName: 'Evidence', attachments }),
    ]);
    window.__store.getState().setNodes(nodes);
    window.__store.getState().setEdges([{ id: 'connection', source: 'docs', target: 'qa', data: { label: 'Source' } }]);
  }, attachments);
  await app.locator('[data-toolbar-more]').click();
  const exportButton = app.locator('[data-menu-export-html]');
  assert.match(await exportButton.innerText(), /\.html/i);
  console.log('Checking the HTML export from the More menu');
  const [download] = await Promise.all([app.waitForEvent('download', { timeout: 45000 }), exportButton.click()])
    .catch(async error => {
      await app.screenshot({ path: resolve(output, 'export-failure.png') });
      throw error;
    });
  assert.match(download.suggestedFilename(), /\.html$/i);
  const archive = resolve(output, 'canvas.html');
  await download.saveAs(archive);
  assert.doesNotMatch(await readFile(archive, 'utf8'), /Superseded document body/);
  await editor.close();
  console.log('PASS app export and vaulted document revisions');

  const offline = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true, serviceWorkers: 'block' });
  const page = await offline.newPage();
  const errors = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()); });
  await page.goto(pathToFileURL(archive).href);
  assert.equal(await page.locator('html').getAttribute('lang'), dark ? 'zh-CN' : 'en');
  assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme), dark ? 'dark' : 'light');
  const cards = page.locator('.canvas-node');
  assert.equal(await cards.count(), 2);
  assert.equal(await page.locator('.canvas-frame').count(), 1);
  assert.equal(await page.locator('.canvas-edge').count(), 1);
  assert.ok(await page.getByText('Source', { exact: true }).isVisible());
  const question = cards.filter({ hasText: 'Discussion' });
  const files = cards.filter({ hasText: 'Evidence' });
  const q = await question.boundingBox(), f = await files.boundingBox();
  assert.ok(q && f && q.x < f.x && q.width < f.width, 'Card position and dimensions survive the export');
  const geometry = locator => locator.evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height]);
  const savedGeometry = await geometry(question);
  await page.mouse.move(q.x + 15, q.y + 15);
  await page.mouse.down();
  await page.mouse.move(q.x + 65, q.y + 35, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  assert.deepEqual(await geometry(question), savedGeometry);
  const beforeZoom = await question.boundingBox();
  await page.locator('#zoom-in').click();
  await page.waitForFunction(w => document.querySelector('.canvas-node').getBoundingClientRect().width > w + 1, beforeZoom.width);
  await page.locator('#fit-view').click();
  await page.screenshot({ path: resolve(output, 'canvas.png') });
  await question.click();
  const panel = page.locator('#reader');
  await panel.waitFor();
  assert.match(await panel.innerText(), /Which finding matters\?/);
  assert.match(await panel.locator('mark').innerText(), /Marked conclusion/);
  await page.screenshot({ path: resolve(output, 'discussion.png') });
  const editing = 'textarea, input:not(:disabled), select, form, [contenteditable]:not([contenteditable="false"]), [draggable="true"]';
  assert.equal(await page.locator(editing).count(), 0);
  await panel.locator('mark').dblclick();
  await page.keyboard.press('Delete');
  assert.match(await panel.locator('mark').innerText(), /Marked conclusion/);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  console.log('PASS offline canvas navigation, reading and immutable highlights');

  await files.click();
  await panel.waitFor();
  const documents = panel.locator('.reading-attachment');
  assert.match(await documents.filter({ hasText: 'Decision.docx' }).textContent(), /The saved document revision/);
  assert.ok(await documents.filter({ hasText: 'Empty.docx' }).count());
  assert.match(await documents.filter({ hasText: 'Recovered.docx' }).textContent(), /Recovered saved text/);
  const pdfPage = documents.filter({ hasText: 'Page.pdf' }).locator('img');
  await pdfPage.first().scrollIntoViewIfNeeded();
  await pdfPage.first().evaluate(img => img.decode());
  assert.ok(await panel.getByText('Existing page annotation', { exact: true }).isVisible());
  const figure = documents.filter({ hasText: 'Figure.png' }).locator('img');
  await figure.evaluate(img => img.decode());
  assert.match(await documents.filter({ hasText: 'Source.html' }).locator('strong').textContent(), /formatted/);
  assert.equal(await page.locator(editing).count(), 0);
  assert.equal(await page.locator('iframe, object, embed').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'mobile-reader.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#close-reader').click();
  await panel.waitFor({ state: 'hidden' });
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  console.log('PASS PDF, image and saved document content at desktop and phone widths without network or editor controls');
} finally {
  await browser?.close();
  await vite.close();
}
