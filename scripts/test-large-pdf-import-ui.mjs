// Exercise the real import and recognition entry points in an isolated browser.
// Run against local Vite with: node scripts/test-large-pdf-import-ui.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PDFDocument, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import { documentBrowser } from './fixtures/original-file-browser.mjs';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5180';
const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to a Chromium browser');
const pages = 530;
const expectedText = Array.from({ length: pages }, (_, index) => `Book page ${index + 1} of ${pages}`).join('\n\n');

async function makeBook() {
  const book = await PDFDocument.create();
  const font = await book.embedFont(StandardFonts.Helvetica);
  // A distinct, uncompressed scan per page puts real image objects in a
  // 36.8 MiB file without requiring external or copyrighted fixtures.
  const pixels = new Uint8Array(270 * 268);
  for (let i = 0; i < pages; i++) {
    const page = book.addPage([612, 792]);
    pixels.fill(192 + i % 64);
    const image = book.context.stream(pixels.slice(), { Type: 'XObject', Subtype: 'Image',
      Width: 270, Height: 268, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
    const name = page.node.newXObject('Scan', book.context.register(image));
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(540, 0, 0, 536, 36, 80), drawObject(name), popGraphicsState());
    page.drawText(`Book page ${i + 1} of ${pages}`, { x: 40, y: 720, size: 18, font });
  }
  return Buffer.from(await book.save());
}

const book = await makeBook();
const sizeMiB = book.length / 1024 ** 2;
assert.ok(sizeMiB > 36 && sizeMiB < 37.5);
const { context, close } = await documentBrowser(appUrl, { executablePath });
try {
  await context.addInitScript(() => {
    localStorage.setItem('thoughtdag.seeded', 'yes');
    localStorage.setItem('thoughtdag.tutorialDone', '1');
  });
  const catalog = { models: [{ id: 'test-vision', name: 'Test vision', provider: 'fixture', vision: true }], default: 'test-vision' };
  await context.route('**/__thoughtdag_storage**', route => route.fulfill({ status: 404 }));
  await context.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/models'
    ? route.fulfill({ json: catalog }) : route.abort());
  await context.routeWebSocket('**', socket => socket.close());
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__store?.persist.hasHydrated());
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'book-fixture';
    document.body.append(input);
  });
  await page.locator('#book-fixture').setInputFiles({ name: 'book.pdf', mimeType: 'application/pdf', buffer: book });
  await page.evaluate(async ({ pages, expectedText }) => {
    const useStore = window.__store;
    const { openPdf, processFile } = await import('/src/lib/attachments.ts');
    const { recognizePdfPages } = await import('/src/lib/content.ts');
    const file = document.querySelector('#book-fixture').files[0];
    const sample = await openPdf(new Uint8Array(await file.arrayBuffer()));
    const pageProxy = Object.getPrototypeOf(await sample.getPage(1));
    const originalRender = pageProxy.render;
    const rendered = [];
    pageProxy.render = function (...args) {
      rendered.push(this.pageNumber);
      return originalRender.apply(this, args);
    };
    await sample.destroy();
    const requests = [], modelCalls = [];
    let offline = false;
    const fetch = window.fetch.bind(window);
    window.fetch = async (resource, options) => {
      const path = new URL(resource instanceof Request ? resource.url : resource, location.href).pathname;
      if (path === '/api/pdf-extract') {
        const { base64, renderImages } = JSON.parse(options.body);
        requests.push({ renderImages, length: base64.length });
        if (offline) throw new TypeError('Proxy unavailable');
        return Response.json({ numPages: pages, text: expectedText });
      }
      if (path === '/api/claude') {
        const { images, model } = JSON.parse(options.body);
        modelCalls.push({ model, rendered: rendered.length, count: images.length, jpeg: images[0].mimeType === 'image/jpeg' && images[0].data.startsWith('/9j/') });
        return Response.json({ text: `Recognized page ${modelCalls.length}` });
      }
      return fetch(resource, options);
    };
    let attachment;
    window.importBook = async fallback => {
      offline = fallback;
      const started = performance.now();
      await processFile(file, {
        add(att) { attachment = att; },
        update(id, patch) { if (attachment.id !== id) throw new Error('Wrong attachment'); Object.assign(attachment, patch); },
      }, fallback ? 'local-book' : 'proxy-book');
      return { ms: Math.round(performance.now() - started), request: requests.at(-1), requests: requests.length,
        numPages: attachment.numPages, completeText: attachment.extractedText === expectedText,
        extracting: attachment.isExtracting, vaulted: attachment.contentInVault && attachment.content === '',
        cachedImages: attachment.pageImages?.length ?? 0, rendered: rendered.length, modelCalls: modelCalls.length };
    };
    window.recognizeAndCancel = async () => {
      const id = 'book-node';
      // Count recognition renders in isolation from the canvas reader.
      useStore.setState({ nodes: [{ id, type: 'thought', hidden: true, position: { x: 0, y: 0 }, data: { stepKind: 'file', question: '',
        response: '', responses: [], responseIndex: -1, attachments: [attachment], highlights: [] } }] });
      const progress = [];
      await recognizePdfPages(id, attachment.id, (done, total) => progress.push([done, total]), () => progress.length >= 2);
      const saved = useStore.getState().nodes[0].data.attachments[0];
      return { progress, rendered, modelCalls, originalText: saved.extractedText === expectedText,
        cachedImages: saved.pageImages?.length ?? 0 };
    };
  }, { pages, expectedText });
  for (const [i, mode] of ['proxy', 'fallback'].entries()) {
    const result = await page.evaluate(fallback => window.importBook(fallback), mode === 'fallback');
    assert.deepEqual({ ...result, ms: 0 }, { ms: 0, request: { renderImages: false, length: 4 * Math.ceil(book.length / 3) },
      requests: i + 1, numPages: pages, completeText: true, extracting: false, vaulted: true, cachedImages: 0, rendered: 0, modelCalls: 0 });
    console.log(`PASS ${mode} import: ${sizeMiB.toFixed(1)} MiB, all ${pages} page labels preserved, zero pages rendered or cached, ${result.ms} ms`);
  }
  const read = await page.evaluate(() => window.recognizeAndCancel());
  assert.deepEqual(read.progress, [[1, pages], [2, pages]]);
  assert.deepEqual(read.rendered, [1, 2]);
  assert.deepEqual(read.modelCalls, [1, 2].map(rendered => ({ model: 'test-vision', rendered, count: 1, jpeg: true })));
  assert.equal(read.originalText, true);
  assert.equal(read.cachedImages, 0);
  console.log('PASS explicit recognition: two pages rendered in order, two single-image model requests, cancellation preserved the complete text');
} finally {
  await close();
}
