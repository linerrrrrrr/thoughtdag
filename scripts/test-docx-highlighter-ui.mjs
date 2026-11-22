import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Document, Packer, Paragraph } from 'docx';
import { documentBrowser, dropFixtureFiles } from './fixtures/original-file-browser.mjs';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5187';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
const { context, close } = await documentBrowser(appUrl, {
  executablePath, viewport: { width: 1640, height: 1080 }, locale: 'en', reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [];
const failures = [];
page.on('requestfailed', req => failures.push([req.url(), req.failure()?.errorText]));
page.on('response', res => { if (res.status() >= 400) failures.push([res.url(), res.status()]); });
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } }));
await context.route('https://api.github.com/**', route => route.fulfill({ json: { stargazers_count: 0 } }));
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.canvasDetail', 'full');
});

const phrase = 'Repeated passage';
const paragraphs = ['First occurrence: ', 'Second occurrence: '].map(prefix => prefix + phrase + '.');
const name = 'drag-to-highlight.docx';
const directory = 'local-tests/overview-ruler';
const file = directory + '/' + name;
const pen = page.locator('[data-docx-highlighter]');
const toolbar = page.locator('[data-docx-toolbar]');
const engine = page.locator('[data-superdoc-ready="true"] [data-superdoc-scroll]');
const ticks = page.locator('[data-overview-ruler-mark]');
const handles = () => ticks.evaluateAll(items => items.map(item => item.dataset.overviewRulerMark));
const ready = () => page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);

async function dragPassage(index, address) {
  await engine.evaluate(async (host, target) => {
    const session = host.__docxSession;
    session.viewport.beginNavigation();
    await session.instance.ui.viewport.scrollIntoView({ target, block: 'center', behavior: 'instant' });
  }, address);
  // The painted text belongs to the run itself on an unformatted paragraph.
  const textRun = engine.locator('.superdoc-text-run').filter({ hasText: paragraphs[index] }).first();
  await dragText(textRun, phrase);
}

async function caretAt(textRun, phrase, end) {
  return textRun.evaluate((element, { phrase, end }) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const start = text.textContent.indexOf(phrase);
      if (start < 0) continue;
      const caret = document.createRange();
      caret.setStart(text, start + (end ? phrase.length : 0));
      caret.collapse(true);
      const rect = caret.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    }
    throw new Error('The painted paragraph does not contain the target range');
  }, { phrase, end });
}

async function dragText(textRun, phrase, endRun = textRun, endPhrase = phrase) {
  const [from, to] = await Promise.all([caretAt(textRun, phrase, false), caretAt(endRun, endPhrase, true)]);
  await page.mouse.move(from.x + 0.2, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x - 0.2, to.y, { steps: 18 });
  await page.mouse.up();
}

async function inView(address) {
  await page.waitForFunction(target => {
    const host = document.querySelector('[data-superdoc-scroll]');
    const rect = host.__docxSession.instance.ui.viewport.getRect({ target }).rect;
    const bounds = host.getBoundingClientRect();
    return rect && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
  }, address);
}

try {
  await mkdir(directory, { recursive: true });
  await writeFile(file, await Packer.toBuffer(new Document({ sections: [{ children:
    [...paragraphs.map((text, index) => new Paragraph({ text, pageBreakBefore: index > 0 })), new Paragraph('NorthSouth'),
      new Paragraph('First paragraph ends here'), new Paragraph('Next paragraph begins here')],
  }] })));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.evaluate(() => {
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false);
    ui.setReleaseNotesOpen(false);
    ui.setCanvasDetail('full');
  });
  await dropFixtureFiles(page, [file], 690, 320);
  await engine.waitFor();
  const id = await engine.evaluate(host => host.closest('.react-flow__node').dataset.id);
  await page.evaluate(id => {
    const store = window.__store.getState();
    window.__store.setState({ nodes: store.nodes.map(node => node.id === id
      ? { ...node, position: { x: 45, y: 210 }, width: 710, height: 650 } : node) });
    window.__rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
    window.__ui.getState().setPanelOpen(false);
  }, id);
  const addresses = await engine.evaluate(async (el, pattern) => {
    const matches = await el.__docxSession.instance.activeEditor.doc.query.match({ select: { type: 'text', pattern, caseSensitive: true } });
    return matches.items.map(({ blocks: [block] }) => ({ kind: 'text', blockId: block.blockId, range: block.range }));
  }, phrase);
  assert.equal(addresses.length, 2);
  await dragPassage(0, addresses[0]);
  await toolbar.waitFor();
  const ink = pen.locator('.native-document-ink-line');
  const inkColor = () => ink.evaluate(line => getComputedStyle(line).backgroundColor);
  const palette = page.locator('[data-docx-pen-palette]');
  const color = page.locator('[data-docx-highlighter-color]');
  assert.equal(await inkColor(), 'rgb(255, 255, 0)');
  const actions = toolbar.locator('.native-document-toolbar-actions');
  assert.equal(await actions.locator(':scope > *').count(), 4, 'Only four icon actions, no split arrow');
  const boxes = await actions.locator(':scope > *').evaluateAll(items => items.map(el => el.getBoundingClientRect().toJSON()));
  assert.ok(boxes.every(box => box.y === boxes[0].y && box.width === boxes[0].width));
  const yellow = await ink.boundingBox();
  assert.equal(yellow.width, (await toolbar.locator('.native-document-color .native-document-ink-line').boundingBox()).width);
  await pen.hover();
  await palette.waitFor();
  assert.equal(await pen.getAttribute('aria-pressed'), 'false', 'Hovering only opens the palette');
  assert.equal(await palette.locator('[data-docx-ink]').count(), 8);
  await toolbar.locator('[data-docx-export]').hover();
  await palette.waitFor({ state: 'detached' });
  await pen.hover();
  await color.fill('#5681b3');
  // The native input event and the toolbar's paint can occur in separate frames.
  await page.waitForFunction(line => getComputedStyle(line).backgroundColor === 'rgb(86, 129, 179)', await ink.elementHandle());
  await palette.locator('[data-docx-ink="#0000ff"]').hover();
  await palette.locator('[data-docx-ink="#0000ff"]').click();
  await palette.waitFor({ state: 'detached' });
  assert.ok((await ink.boundingBox()).height > yellow.height, 'Brighter ink has a thinner rule');
  assert.equal(await pen.getAttribute('aria-pressed'), 'false', 'Choosing ink must not activate the pen');
  await pen.focus();
  await pen.press('ArrowDown');
  assert.equal(await palette.locator(':focus').getAttribute('data-docx-ink'), '#0000ff');
  await palette.locator('[data-docx-ink="#ffff00"]').focus();
  await page.keyboard.press('Enter');
  await palette.waitFor({ state: 'detached' });
  assert.ok(await pen.evaluate(button => button === document.activeElement));
  assert.equal(await ticks.count(), 0, 'Ordinary text selection must not mark the document');
  await engine.locator('.superdoc-text-run').filter({ hasText: paragraphs[0] }).first().click();
  await pen.click();
  assert.equal(await pen.getAttribute('aria-pressed'), 'true');
  const fill = await pen.evaluate(button => getComputedStyle(button).backgroundColor);
  assert.match(fill, /(?:rgba\(.+, 0\.\d+\)|color\(srgb .+ \/ 0\.\d+\))/, 'Active ink tints the button with a translucent fill');
  await dragPassage(0, addresses[0]);
  await ticks.first().waitFor();
  const firstHandle = (await handles())[0];
  await pen.hover();
  assert.equal(await color.inputValue(), '#ffff00');
  await color.click();
  await page.waitForFunction(() => document.querySelector('[data-docx-highlighter-color]').matches(':open'));
  await page.keyboard.press('Escape');
  assert.ok(await color.evaluate(input => !input.matches(':open')));
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached' });
  assert.equal(await pen.getAttribute('aria-pressed'), 'true', 'Escape closes the color picker before the pen');
  await pen.hover();
  await palette.locator('[data-docx-ink="#00ffff"]').click();
  assert.equal(await pen.getAttribute('aria-pressed'), 'true');
  assert.equal(await inkColor(), 'rgb(0, 255, 255)', 'The rule tracks the selected color');
  assert.deepEqual(await handles(), [firstHandle], 'Changing the pen color must not create a mark');
  await dragPassage(1, addresses[1]);
  await ticks.nth(1).waitFor();
  assert.equal(await pen.getAttribute('aria-pressed'), 'true');
  const [firstId, secondId] = await handles();
  assert.deepEqual(await ticks.evaluateAll(items => items.map(el => getComputedStyle(el).backgroundColor)),
    ['rgb(255, 255, 0)', 'rgb(0, 255, 255)']);
  assert.equal(firstId, firstHandle);
  assert.notEqual(firstId, secondId, 'Repeated passages have independent endpoints');
  assert.equal(await engine.evaluate(host => host.__docxSession.attachment.editedDocxRevision), undefined,
    'Two marking gestures must not commit a document revision');
  await page.keyboard.press('Escape');
  assert.equal(await pen.getAttribute('aria-pressed'), 'false');
  assert.equal(await inkColor(), 'rgb(0, 255, 255)', 'Putting the pen away retains its color');
  assert.ok(await toolbar.isVisible(), 'Escape puts away only the pen');

  await page.locator('[data-docx-command="undo"]').click();
  await ticks.nth(1).waitFor({ state: 'detached' });
  assert.deepEqual(await handles(), [firstHandle]);
  await page.locator('[data-docx-command="redo"]').click();
  await ticks.nth(1).waitFor();
  assert.deepEqual(await handles(), [firstId, secondId], 'Redo restores the original second endpoint');
  for (const index of [0, 1]) {
    await ticks.nth(index).click();
    await inView(addresses[index]);
  }
  console.log('PASS pen marks repeated passages across pages, with working draft ticks, navigation, Escape and undo');
  const source = await ticks.nth(1).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(1170, 770, { steps: 20 });
  await page.mouse.up();
  const wire = await page.waitForFunction(handle => window.__rf.getEdges().find(edge => edge.sourceHandle === handle)?.id, secondId);
  const edgeId = await wire.jsonValue();
  await page.locator('[data-docx-save]').click();
  await page.waitForFunction(id => window.__store.getState().nodes.find(node => node.id === id).data.attachments[0].editedDocxRevision, id);
  assert.deepEqual(await handles(), [firstId, secondId]);
  await page.evaluate(async () => { await (await import('/src/lib/persistence.ts')).flushPendingWrites(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await ticks.nth(1).waitFor();
  assert.deepEqual(await handles(), [firstId, secondId]);
  assert.equal(await page.evaluate(id => window.__rf.getEdges().find(edge => edge.id === id)?.sourceHandle, edgeId), secondId);
  await engine.waitFor();
  for (const index of [0, 1]) {
    await ticks.nth(index).click();
    await inView(addresses[index]);
  }
  console.log('PASS the wire and its second-page passage remain joined after saving and reopening');

  const north = engine.locator('.superdoc-text-run').filter({ hasText: 'North' }).first();
  const south = engine.locator('.superdoc-text-run').filter({ hasText: 'South' }).first();
  await north.click();
  await pen.click();
  await dragText(north, 'North');
  await ticks.nth(2).waitFor();
  await dragText(south, 'South');
  await ticks.nth(3).waitFor();
  const adjacent = await handles();
  assert.equal(new Set(adjacent).size, 4);
  assert.deepEqual(await ticks.evaluateAll(items => items.slice(2).map(item => getComputedStyle(item).backgroundColor)),
    ['rgb(255, 255, 0)', 'rgb(255, 255, 0)']);
  await page.locator('[data-docx-save]').click();
  await page.waitForFunction(id => window.__store.getState().nodes.find(node => node.id === id).data.attachments[0].documentHighlights?.length === 4, id);
  await page.evaluate(async () => { await (await import('/src/lib/persistence.ts')).flushPendingWrites(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await ticks.nth(3).waitFor();
  assert.deepEqual(await handles(), adjacent);
  assert.deepEqual(errors, []);
  console.log('PASS adjacent same-color strokes remain distinct through a native save and reload');

  await engine.waitFor();
  await engine.evaluate(async host => {
    const session = host.__docxSession;
    const result = await session.instance.activeEditor.doc.query.match({ select: { type: 'text', pattern: 'ends here' } });
    session.viewport.beginNavigation();
    await session.instance.ui.viewport.scrollIntoView({ target: result.items[0].target, block: 'center', behavior: 'instant' });
  });
  const startRun = engine.locator('.superdoc-text-run').filter({ hasText: 'First paragraph ends here' }).first();
  const endRun = engine.locator('.superdoc-text-run').filter({ hasText: 'Next paragraph begins here' }).first();
  await startRun.click();
  await pen.click();
  await dragText(startRun, 'ends here', endRun, 'Next paragraph');
  await ticks.nth(4).waitFor();
  const crossHandles = await handles();
  assert.equal(crossHandles.length, 5, 'One stroke across two paragraphs has one ruler endpoint');
  assert.deepEqual(crossHandles.slice(0, 4), adjacent);
  const segments = await engine.evaluate(async host => {
    const doc = host.__docxSession.instance.activeEditor.doc;
    const result = await doc.query.match({ select: { type: 'text', mode: 'regex', pattern: '.+' } });
    return result.items.flatMap(item => item.blocks.flatMap(block => block.runs
      .filter(run => run.text === 'ends here' || run.text === 'Next paragraph')
      .map(run => [run.text, run.range.start, run.range.end, run.styles.highlight?.toLowerCase()])));
  });
  assert.deepEqual(segments, [['ends here', 16, 25, '#ffff00'], ['Next paragraph', 0, 14, '#ffff00']]);
  await page.locator('[data-docx-save]').click();
  await page.waitForFunction(id => window.__store.getState().nodes.find(node => node.id === id).data.attachments[0]
    .documentHighlights?.some(mark => mark.text === 'Next paragraph'), id);
  await page.evaluate(async () => { await (await import('/src/lib/persistence.ts')).flushPendingWrites(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await ticks.nth(4).waitFor();
  assert.deepEqual(await handles(), crossHandles);
  assert.deepEqual(errors, []);
  console.log('PASS a cross-paragraph stroke colors both native ranges and retains one ruler handle after reload');
} catch (error) {
  console.error({ errors, failures: failures.slice(-10), body: (await page.locator('body').innerText()).slice(0, 500) });
  throw error;
} finally {
  await close();
}
