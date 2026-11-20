// Browser regression for inserting, previewing and editing files in the three question composers.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import { initNodePickerFixture } from './fixtures/node-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5198');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
page.setDefaultTimeout(12000);
const requests = [], errors = [];
const catalog = { default: 'paste-test', models: [{ id: 'paste-test', name: 'Test model', provider: 'Test API', vision: true }] };
let pdfExtractionGate;
let extractions = 0;
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(initNodePickerFixture);
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname === '/__thoughtdag_storage') return route.fulfill({ status: 404 });
  if (url.pathname === '/api/models') return route.fulfill({ json: catalog });
  if (url.pathname === '/api/pdf-extract') {
    extractions++;
    await pdfExtractionGate;
    return route.fulfill({ json: { text: 'PDF 附件的正文', numPages: 2, images: [png, png] } });
  }
  if (url.pathname === '/api/stream' && request.method() === 'POST') {
    requests.push(request.postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"已收到"}\n\ndata: [DONE]\n\n' });
  }
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) return route.abort();
  return route.continue();
});
const id = 'clipboard-question';
const card = page.locator(`.react-flow__node[data-id="${id}"]`);
const input = card.locator('[data-canvas-question-editor]');
const panel = page.locator('[data-focus-panel]');
const panelInput = panel.locator('.focus-question-section textarea');
const node = () => page.evaluate(id => window.__store.getState().nodes.find(item => item.id === id).data, id);
const png = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = '#23344e';
  ctx.fillRect(0, 0, 640, 240);
  ctx.font = '28px sans-serif';
  ctx.fillStyle = 'white';
  ctx.fillText('附件预览', 28, 52);
  ctx.fillStyle = '#7dabf3';
  [44, 85, 57, 102, 77, 130].forEach((height, index) => ctx.fillRect(30 + 95 * index, 214 - height, 60, height));
  return canvas.toDataURL('image/png').split(',')[1];
});
const output = 'local-tests/question-clipboard';
await mkdir(output, { recursive: true });

const dialog = page.locator('[role="dialog"][data-question-attachment-dialog]');
const nameField = dialog.locator('[data-attachment-name]');
const textField = dialog.locator('[data-attachment-text]');
const save = dialog.locator('[data-attachment-save]');
const caption = '请核对最后一列。';
const revision = '修订后的资料正文。';

async function verifyTrayAboveQuestion(surface, textarea) {
  // Read both bounds in one frame, including while React Flow is fitting the canvas.
  const above = await surface.evaluate((root, input) => {
    const tray = root.querySelector('[data-question-attachments]').getBoundingClientRect();
    const editor = input.getBoundingClientRect();
    return tray.height > 0 && editor.height > 0 && tray.bottom <= editor.top + 1;
  }, await textarea.elementHandle());
  assert.ok(above, 'Attachments appear above the question text');
}

async function visibleAt(locator, edge) {
  return locator.evaluate((element, edge) => {
    const rect = element.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    const y = edge === 'bottom' ? rect.bottom - 3 : rect.top + Math.min(rect.height - 1, lineHeight - 2);
    const hit = document.elementFromPoint(rect.x + rect.width / 2, y);
    if (!element.contains(hit)) throw new Error(`${element.tagName} clipped at y=${y}; rect=${JSON.stringify(rect)}; hit=${hit?.tagName}.${hit?.className}`);
    return true;
  }, edge);
}

async function openFile(surface, id) {
  await surface.locator(`[data-question-attachment="${id}"] [data-attachment-open]`).click();
  await dialog.waitFor();
}

async function sizeCard(width, height) {
  await page.evaluate(({ id, width, height }) => {
    window.__store.setState(state => ({ nodes: state.nodes.map(node => node.id === id
      ? { ...node, width, height, style: { ...node.style, width, height } } : node) }));
    window.__rf.setViewport({ x: 120, y: 150, zoom: 1 }, { duration: 0 });
  }, { id, width, height });
  await page.waitForFunction(({ id, width, height }) => {
    const rect = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect();
    return Math.abs(rect.width - width) < 1 && Math.abs(rect.height - height) < 1;
  }, { id, width, height });
}

async function checkMixedRow(surface) {
  const tiles = await surface.locator('[data-question-attachment] [data-attachment-open]').evaluateAll(buttons =>
    buttons.map(button => {
      const bounds = element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return { face: bounds(button), name: bounds(button.querySelector('.question-attachment-name')),
        detail: bounds(button.querySelector('.question-attachment-detail')), art: bounds(button.querySelector('.question-attachment-art')) };
    }));
  assert.equal(tiles.length, 2, 'The image and PDF each have one tile');
  const [image, pdf] = tiles;
  for (const part of ['face', 'name', 'detail', 'art']) {
    assert.ok(Math.abs(image[part].y - pdf[part].y) <= 1, `${part} tops align`);
    assert.ok(Math.abs(image[part].height - pdf[part].height) <= 1, `${part} bottoms align`);
  }
  assert.ok(Math.abs(image.face.width - pdf.face.width) <= 1, 'File cards share a width');
  assert.ok(pdf.face.x >= image.face.x + image.face.width, 'The PDF follows the image in the same row');
  return tiles.map(tile => tile.face);
}

async function paste(locator, files, text = '', html = '') {
  return locator.evaluate((element, { files, text, html }) => {
    const data = new DataTransfer();
    if (text) data.setData('text/plain', text);
    if (html) data.setData('text/html', html);
    for (const file of files) {
      const bytes = file.base64 ? Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)) : file.content;
      data.items.add(new File([bytes], file.name, { type: file.type }));
    }
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, { files, text, html });
}
const imageFile = { name: '截图.png', type: 'image/png', base64: png };
const pdf = await PDFDocument.create();
pdf.addPage();
pdf.addPage();
const pdfFile = { name: 'tmp_docx_v3.pdf', type: 'application/pdf', base64: Buffer.from(await pdf.save()).toString('base64') };

try {
  await page.goto(appUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui, null, { timeout: 60000 });
  await page.evaluate(async ({ id, catalog }) => {
    (await window.__importLive('/src/lib/use-models.ts')).setModelsCache(catalog);
    const ui = window.__ui.getState();
    ui.setSelectedModel('paste-test'); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false);
    const nodes = [{ id, type: 'thought', width: 520, height: 300, dragHandle: '.drag-handle', position: { x: 0, y: 0 }, data: {
      executionKind: 'api', model: 'paste-test', question: '', response: '', responses: [], responseIndex: -1,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
    } }];
    window.__store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0, selectedNodeId: null, selectedNodeIds: [] });
    window.__rf.setViewport({ x: 120, y: 150, zoom: 1 }, { duration: 0 });
  }, { id, catalog });
  await input.fill('请结合附件回答');

  // Pause the real FileReader to exercise a quick Enter before bytes are ready.
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) {
      window.releaseClipboardRead = () => { FileReader.prototype.readAsDataURL = original; original.call(this, file); };
    };
  });
  assert.equal(await paste(input, [imageFile]), true);
  await page.waitForFunction(() => !!window.releaseClipboardRead);
  await card.locator('[data-pending-attachment] [role="status"]').waitFor();
  assert.equal(await card.locator('[data-pending-attachment]').count(), 1);
  assert.match(await card.locator('[data-pending-attachment] [role="status"]').getAttribute('aria-label'), /截图\.png/);
  assert.equal(await card.locator('[data-ask-submit]').isDisabled(), true);
  await input.press('Enter');
  assert.equal((await node()).question, '');
  assert.equal(requests.length, 0);
  await page.evaluate(() => window.releaseClipboardRead());
  await page.waitForFunction(id => window.__store.getState().nodes.find(item => item.id === id)?.data.attachments.length === 1, id);
  await card.locator('[data-question-attachment]').waitFor();
  assert.equal(await input.inputValue(), '请结合附件回答');
  assert.equal((await node()).attachments[0].content, png);
  assert.equal(await card.locator('[data-question-attachment] img').count(), 1);
  // Initial canvas fitting can run after the new test node has been measured.
  await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 150, zoom: 1 }, { duration: 0 }));
  await page.waitForFunction(id => Math.abs(document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect().width - 520) <= 1, id);
  await verifyTrayAboveQuestion(card, input);
  await page.screenshot({ path: `${output}/node-light.png` });
  assert.ok(await visibleAt(card.locator('[data-question-attachment] img'), 'bottom'), 'The full first thumbnail fits in a 520 × 300 node');
  assert.ok(await visibleAt(input, 'line'), 'At least one question line remains visible after inserting the first image');
  const [sendBox, composerBox] = await Promise.all([
    card.locator('[data-ask-submit]').boundingBox(), card.locator('.node-question-composer').boundingBox(),
  ]);
  assert.ok(sendBox && composerBox && composerBox.x + composerBox.width - sendBox.x - sendBox.width < 24,
    'The send button stays at the right edge of the composer');
  const editor = await input.elementHandle();
  await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 150, zoom: 0.6 }, { duration: 0 }));
  await page.waitForFunction(() => Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a - 0.6) < 0.001);
  assert.equal(await editor.evaluate(el => el.isConnected && el === document.activeElement), true);
  assert.equal(await card.locator('[data-question-attachment]').count(), 1);
  await page.evaluate(() => window.__rf.setViewport({ x: 120, y: 150, zoom: 1 }, { duration: 0 }));
  await input.press('Escape');
  assert.equal(await input.inputValue(), '请结合附件回答');
  assert.equal((await node()).attachments.length, 1);
  assert.equal(requests.length, 0);
  console.log('PASS canvas screenshot paste, preview, zoom, Escape and blocked early send');

  const imageId = (await node()).attachments[0].id;
  await sizeCard(600, 329);
  await page.evaluate(async () => (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  let finishPdf;
  pdfExtractionGate = new Promise(resolve => { finishPdf = resolve; });
  const pdfRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/pdf-extract');
  await paste(input, [pdfFile]);
  await pdfRequest;
  const pdfStatus = card.locator('[data-question-attachment] [role="status"]');
  await pdfStatus.waitFor();
  assert.match(await pdfStatus.getAttribute('aria-label'), /tmp_docx_v3\.pdf/);
  assert.equal(await card.locator('[data-question-attachments] [role="status"]').count(), 1);
  assert.equal(await card.locator('[data-pending-attachment]').count(), 0, 'No duplicate PDF after the read phase');
  assert.equal(await card.locator('[data-ask-submit]').isDisabled(), true);
  const processingBoxes = await checkMixedRow(card);
  await card.screenshot({ path: `${output}/mixed-pdf-processing-dark.png`, animations: 'disabled' });
  finishPdf();
  pdfExtractionGate = undefined;
  await pdfStatus.waitFor({ state: 'detached' });
  assert.equal(await card.locator('[data-ask-submit]').isEnabled(), true);
  assert.deepEqual(await checkMixedRow(card), processingBoxes, 'Completion preserves card positions and dimensions');
  const pdfTile = card.locator('[data-question-attachment]').filter({ hasText: pdfFile.name });
  assert.equal(await pdfTile.locator('.question-attachment-detail').innerText(), '2 页');
  assert.ok(await pdfTile.locator('.question-attachment-name').evaluate(name => name.scrollWidth <= name.clientWidth + 1),
    'The complete PDF filename fits on the 600px node');
  console.log('600 × 329 attachment geometry', processingBoxes);
  const toolbar = await card.locator('.node-ask-actions button:visible').evaluateAll(buttons => buttons.map(button => {
    const { y, height } = button.getBoundingClientRect();
    return [button.getAttribute('aria-label') || button.textContent.trim(), y + height / 2, height];
  }));
  console.log('600 × 329 toolbar: accessible name, vertical center and height', toolbar);
  assert.ok(toolbar.every(([, center, height]) => Math.abs(center - toolbar[0][1]) <= 1 && Math.abs(height - toolbar[0][2]) <= 1));
  await card.screenshot({ path: `${output}/mixed-pdf-ready-dark.png`, animations: 'disabled' });
  assert.equal(requests.length, 0);
  await page.evaluate(id => window.__ui.getState().setPanelOpen(true, id), id);
  await panelInput.waitFor();
  await checkMixedRow(panel);
  await verifyTrayAboveQuestion(panel, panelInput);
  await page.evaluate(() => window.__ui.getState().setPanelOpen(false));
  await sizeCard(360, 240);
  await checkMixedRow(card);
  assert.ok(await visibleAt(input, 'line'));
  assert.ok(await visibleAt(card.locator('[data-ask-submit]'), 'bottom'));
  const mixedPdfId = (await node()).attachments.find(file => file.name === pdfFile.name).id;
  await openFile(card, mixedPdfId);
  assert.equal(await textField.inputValue(), 'PDF 附件的正文');
  await textField.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await card.getByRole('button', { name: `移除附件 · ${pdfFile.name}` }).click();
  await sizeCard(520, 300);
  assert.equal((await node()).attachments.length, 1);
  console.log('PASS aligned image/PDF cards during and after extraction; narrow card editing and removal');
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) {
      if (file.name !== '取消.pdf') return read.call(this, file);
      FileReader.prototype.readAsDataURL = read;
      window.finishCancelledRead = () => new Promise(resolve => {
        this.addEventListener('loadend', resolve, { once: true });
        read.call(this, file);
      });
    };
  });
  const filesChosen = page.waitForEvent('filechooser');
  await card.getByRole('button', { name: '添加附件' }).click();
  await (await filesChosen).setFiles([
    { name: '取消.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfFile.base64, 'base64') },
    { name: '后续.txt', mimeType: 'text/plain', buffer: Buffer.from('继续导入') },
  ]);
  await page.waitForFunction(() => !!window.finishCancelledRead);
  assert.equal(await card.locator('[data-pending-attachment]').count(), 2);
  await card.getByRole('button', { name: '移除附件 · 取消.pdf' }).click();
  const queuedFile = card.locator('[data-question-attachment]').filter({ hasText: '后续.txt' });
  await queuedFile.waitFor();
  assert.equal(await card.locator('[data-ask-submit]').isEnabled(), true);
  await page.evaluate(async () => { await window.finishCancelledRead(); });
  await queuedFile.locator('[data-attachment-remove]').click();
  assert.equal((await node()).attachments.length, 1);
  assert.equal(extractions, 1);
  console.log('PASS removing an unread PDF immediately unblocks the next selected file');
  const thumb = await card.locator('[data-question-attachment] img').boundingBox();
  assert.ok(thumb && Math.min(thumb.width, thumb.height) >= 48, 'Image has a recognizable thumbnail');
  await openFile(card, imageId);
  const original = dialog.locator('[data-attachment-original]');
  await original.evaluate(image => image.decode());
  assert.deepEqual(await original.evaluate(image => [image.naturalWidth, image.naturalHeight]), [1280, 480]);
  const preview = await original.boundingBox();
  assert.ok(preview.width > thumb.width && preview.height > thumb.height, 'Preview is larger than the thumbnail');
  await dialog.getByRole('button', { name: '查看原始尺寸' }).click();
  assert.ok((await original.boundingBox()).width > preview.width, 'Actual-size view exposes fine details');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await dialog.getByRole('button', { name: '适应窗口' }).click();
  await page.screenshot({ path: `${output}/image-preview.png` });
  await nameField.fill('图表');
  await textField.fill(caption);
  await page.mouse.click(2, 2);
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await node()).attachments[0].name, '截图.png');

  await page.evaluate(id => window.__ui.getState().setPanelOpen(true, id), id);
  await panelInput.waitFor();
  assert.equal(await panelInput.inputValue(), '请结合附件回答');
  assert.equal(await panel.locator('[data-question-attachment]').count(), 1);
  await verifyTrayAboveQuestion(panel, panelInput);
  await openFile(panel, imageId);
  assert.equal(await nameField.inputValue(), '图表');
  assert.equal(await textField.inputValue(), caption);
  await save.click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await node()).attachments[0].name, '图表.png');
  assert.equal((await node()).attachments[0].content, png);
  assert.equal(requests.length, 0);
  console.log('PASS image opens at full source resolution and its draft is shared across composers');
  const chooserEvent = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: '添加附件', exact: true }).click();
  await (await chooserEvent).setFiles({ name: '选择文件.txt', mimeType: 'text/plain', buffer: Buffer.from('文件内容') });
  const picked = card.getByRole('button', { name: '移除附件 · 选择文件.txt' });
  await picked.waitFor();
  await picked.click();
  assert.equal((await node()).attachments.length, 1);
  await panelInput.focus();
  assert.equal(await paste(panelInput, [{ name: '资料.txt', type: 'text/plain', content: '这是粘贴的资料正文。' }], 'C:\\资料\\资料.txt'), true);
  await page.waitForFunction(id => window.__store.getState().nodes.find(item => item.id === id)?.data.attachments.length === 2, id);
  assert.equal(await panel.locator('[data-question-attachment]').count(), 2);
  assert.equal(await card.locator('[data-question-attachment]').count(), 2);
  assert.equal(await panelInput.inputValue(), '请结合附件回答');
  assert.equal(await paste(panelInput, [pdfFile]), true);
  await page.waitForFunction(id => window.__store.getState().nodes.find(item => item.id === id)?.data.attachments
    .some(file => file.name === 'tmp_docx_v3.pdf' && file.extractedText === 'PDF 附件的正文' && !file.isExtracting), id);
  assert.equal(await panel.locator('[data-question-attachment]').count(), 3);
  const context = await page.evaluate(async id => {
    const state = window.__store.getState();
    return (await window.__importLive('/src/store/context-builder.ts')).buildContext(id, state.nodes, state.edges);
  }, id);
  assert.equal(context.images[0].data, png);
  assert.ok(context.messages.some(message => message.content.includes('这是粘贴的资料正文。')));
  assert.ok(context.messages.some(message => message.content.includes('PDF 附件的正文')));
  console.log('PASS panel file paste shares image, text and PDF attachments with context');

  const pdfId = (await node()).attachments.find(file => file.name === pdfFile.name).id;
  await openFile(panel, pdfId);
  assert.equal(await textField.inputValue(), 'PDF 附件的正文');
  await textField.fill('修订的报告摘录');
  await textField.press('Control+Enter');
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await node()).attachments.find(file => file.id === pdfId).editedText, '修订的报告摘录');

  const textId = (await node()).attachments.find(file => file.name === '资料.txt').id;
  await openFile(panel, textId);
  assert.equal(await textField.inputValue(), '这是粘贴的资料正文。');
  await textField.fill('');
  await page.mouse.click(2, 2);
  await dialog.waitFor({ state: 'detached' });
  await openFile(card, textId);
  assert.equal(await textField.inputValue(), '', 'An empty draft survives dismissal');
  await textField.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await openFile(panel, textId);
  assert.equal(await textField.inputValue(), '这是粘贴的资料正文。', 'Escape discards the pending edit');
  await textField.fill(revision);
  await save.click();
  await dialog.waitFor({ state: 'detached' });
  await openFile(card, textId);
  assert.equal(await textField.inputValue(), revision);
  await textField.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(requests.length, 0);
  console.log('PASS editing file text, dismissing empty drafts, cancelling and saving across surfaces');

  assert.equal(await paste(panelInput, [], '普通文本'), false, 'Plain text paste must remain native');
  assert.equal(await paste(panelInput, [imageFile], '表格复制的文字', '<table><tr><td>表格复制的文字</td></tr></table>'), false, 'Rich text with bitmap preview keeps text');
  assert.equal((await node()).attachments.length, 3);
  assert.equal(await paste(panelInput, [{ ...imageFile, name: '另一张.png' }], '图片说明', '<p>图片说明</p><img src="example.png">'), false, 'A caption remains available for native insertion');
  await page.waitForFunction(id => window.__store.getState().nodes.find(item => item.id === id)?.data.attachments
    .some(file => file.name === '另一张.png'), id);
  await panel.getByRole('button', { name: '移除附件 · 另一张.png' }).click();
  assert.equal(await paste(panelInput, [{ ...imageFile, name: '网页图片.png' }], 'https://example.test/picture.png'), true);
  await page.waitForFunction(id => window.__store.getState().nodes.find(item => item.id === id)?.data.attachments
    .some(file => file.name === '网页图片.png'), id);
  await panel.getByRole('button', { name: '移除附件 · 网页图片.png' }).click();
  assert.equal(await paste(panelInput, [
    { name: '一.txt', type: 'text/plain', content: '第一份' },
    { name: '二.md', type: 'text/markdown', content: '第二份' },
  ], 'C:\\资料\\一.txt\nC:\\资料\\二.md'), true);
  await page.waitForFunction(id => window.__store.getState().nodes.find(item => item.id === id)?.data.attachments
    .filter(file => ['一.txt', '二.md'].includes(file.name)).length === 2, id);
  await panel.getByRole('button', { name: '移除附件 · 一.txt' }).click();
  await panel.getByRole('button', { name: '移除附件 · 二.md' }).click();
  assert.equal(await paste(panelInput, [{ name: '未知.xyz', type: 'application/octet-stream', content: 'x' }]), true);
  await page.getByText(/暂不支持.*未知.xyz/).waitFor();
  assert.equal((await node()).attachments.length, 3);
  assert.equal(await card.locator('[data-question-attachment]').count(), 3);
  console.log('PASS native text behavior, unsupported-file feedback and shared removal');

  await page.evaluate(async () => (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark'));
  await page.setViewportSize({ width: 1050, height: 800 });
  await page.screenshot({ path: `${output}/panel-dark.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await panelInput.fill('请说明这张截图');
  await panel.locator('[data-question-send]').click();
  await page.waitForFunction(() => window.__store.getState().nodes.find(item => item.id === 'clipboard-question')?.data.response === '已收到');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].images[0].data, png);
  assert.ok(requests[0].messages.some(message => message.content === '请说明这张截图'));
  assert.ok(requests[0].messages.some(message => message.content.includes('修订的报告摘录')));
  assert.equal(requests[0].messages.some(message => message.content.includes('PDF 附件的正文')), false);
  assert.ok(requests[0].messages.some(message => message.content.includes(revision)));
  assert.ok(requests[0].messages.some(message => message.content.includes(caption)));
  assert.equal(requests[0].messages.some(message => message.content.includes('这是粘贴的资料正文。')), false);
  assert.deepEqual(errors, []);
  console.log('PASS explicit send includes the pasted image, PDF text and question');

  await page.evaluate(() => {
    window.__ui.getState().setPanelOpen(false);
    window.__store.setState({ nodes: [], edges: [], selectedNodeId: null, selectedNodeIds: [] });
  });
  const landing = page.locator('[data-landing-page]');
  const landingInput = landing.locator('textarea');
  await landingInput.fill('首页问题');
  assert.equal(await paste(landingInput, [imageFile], 'C:\\图片\\截图.png'), true);
  await landing.locator('[data-question-attachment]').waitFor();
  await verifyTrayAboveQuestion(landing, landingInput);
  await landing.locator('[data-attachment-open]').click();
  await textField.fill('首页图片说明');
  await save.click();
  await dialog.waitFor({ state: 'detached' });
  await paste(landingInput, [pdfFile]);
  await landing.locator('[data-question-attachment]').nth(1).waitFor();
  await page.waitForFunction(() => !document.querySelector('.landing-send').disabled);
  await checkMixedRow(landing);
  await page.screenshot({ path: `${output}/landing-dark.png` });
  assert.equal(await landingInput.inputValue(), '首页问题');
  await landing.locator('.landing-send').click();
  await page.waitForFunction(() => window.__store.getState().nodes[0]?.data.response === '已收到');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].images[0].data, png);
  assert.equal(extractions, 3, 'The three accepted PDFs use extraction; the cancelled PDF never starts it');
  assert.ok(requests[1].messages.some(message => message.content.includes('首页图片说明')));
  assert.deepEqual(errors, []);
  console.log('PASS landing file-path paste and explicit send');
} catch (error) {
  console.error('Browser regression failed:', error.message, errors);
  await page.screenshot({ path: `${output}/failure.png`, timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
