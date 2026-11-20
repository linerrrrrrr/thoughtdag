import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { documentBrowser, dropFixtureFiles } from './fixtures/original-file-browser.mjs';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5187';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
const { context, close } = await documentBrowser(appUrl, { executablePath,
  viewport: { width: 1600, height: 1000 }, locale: 'en', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const failedRequests = [];
page.on('requestfailed', request => failedRequests.push([request.url(), request.failure()?.errorText]));
page.on('response', response => { if (response.status() >= 400) failedRequests.push([response.url(), response.status()]); });
await context.routeWebSocket('**', listener => listener.close());
await context.route('https://api.github.com/repos/chenxiachan/thoughtdag', route => route.fulfill({ json: { stargazers_count: 0 } }));
await context.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } }));
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.canvasDetail', 'full');
});
const folder = 'local-tests/overview-ruler';
const file = `${folder}/highlighted-passages.docx`;
const phrase = 'Repeated mark';
const highlightedParagraph = (pageBreakBefore = false) => new Paragraph({ pageBreakBefore, children: [
  new TextRun({ text: 'Repeated ', highlight: 'yellow' }),
  new TextRun({ text: 'mark', bold: true, highlight: 'yellow' }),
] });
const doc = new Document({ sections: [{ children: [
  new Paragraph('Opening. Repeated mark'), highlightedParagraph(), new Paragraph('Middle content.'), highlightedParagraph(true),
  new Paragraph({ children: [new TextRun('Plain text. '), new TextRun({ text: 'Last passage', highlight: 'cyan' })] }),
] }] });
const snapshot = () => page.evaluate(() => {
  const source = window.__store.getState().nodes.find(node => node.data.attachments?.some(att => att.name === 'highlighted-passages.docx'));
  return { id: source.id, attachment: source.data.attachments[0] };
});

try {
  await mkdir(folder, { recursive: true });
  await writeFile(file, await Packer.toBuffer(doc));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && !!window.__rf && !!window.__ui);
  await page.evaluate(() => {
    const ui = window.__ui.getState(); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setCanvasDetail('full');
  });
  await dropFixtureFiles(page, [file], 920, 350);
  await page.waitForFunction(() => window.__store.getState().nodes.some(node => node.data.attachments?.[0]?.name === 'highlighted-passages.docx'));
  const first = await snapshot();
  const { id } = first;
  const before = first.attachment.documentHighlights;
  assert.deepEqual(before.map(mark => mark.text), [phrase, phrase, 'Last passage']);
  assert.equal(new Set(before.map(mark => mark.id)).size, 3);
  assert.ok(before[0].fraction < before[1].fraction && before[1].fraction < before[2].fraction);
  const node = page.locator(`.react-flow__node[data-id="${id}"]`);
  const ticks = node.locator('[data-overview-ruler-mark]');
  const handles = () => ticks.evaluateAll(elements => elements.map(element => element.dataset.overviewRulerMark));
  await ticks.nth(2).waitFor();
  const originalHandles = await handles();
  assert.deepEqual(await ticks.evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor)),
    ['rgb(255, 255, 0)', 'rgb(255, 255, 0)', 'rgb(0, 255, 255)']);
  console.log('PASS file drop imports real DOCX highlight colors, repeated passages and adjacent formatted runs');

  const editor = node.locator('[data-superdoc-ready="true"]');
  const scroll = editor.locator('[data-superdoc-scroll]');
  const hitAddresses = await scroll.evaluate(async (element, text) => {
    const doc = element.__docxSession.instance.activeEditor.doc;
    const matches = await doc.query.match({ select: { type: 'text', pattern: text, caseSensitive: true } });
    return matches.items.filter(item => item.blocks[0].runs.every(run => !!run.styles.highlight))
      .map(({ blocks: [block] }) => ({ kind: 'text', blockId: block.blockId, range: block.range }));
  }, phrase);
  assert.equal(hitAddresses.length, 2);
  const hitInView = (address, inReader = false) => page.waitForFunction(({ address, id, inReader }) => {
    const owner = inReader ? '[data-material-reader]' : `.react-flow__node[data-id="${id}"]`;
    const el = document.querySelector(owner + ' [data-superdoc-scroll]');
    const rect = el?.__docxSession.instance.ui.viewport.getRect({ target: address }).rect;
    if (!rect) return false;
    const port = el.getBoundingClientRect();
    return rect.top >= port.top - 1 && rect.bottom <= port.bottom + 1;
  }, { address, id, inReader });
  for (const index of [1, 0]) {
    await ticks.nth(index).click();
    await hitInView(hitAddresses[index]);
    assert.equal(await page.locator('[data-material-reader]').count(), 0);
    assert.equal(await scroll.evaluate(el => el.__docxSession.dirty), false);
  }
  console.log('PASS clicking identical DOCX highlights on separate pages reveals the specific original range in-place');
  await page.evaluate(async id => {
    window.__ui.getState().setReaderMode('dock');
    (await import('/src/lib/node-detail.ts')).setNodeDetail(id, 'compact');
  }, id);
  await node.locator('[data-node-detail-level="compact"]').waitFor();
  await ticks.nth(1).click();
  await hitInView(hitAddresses[1], true);
  await ticks.nth(0).click();
  await hitInView(hitAddresses[0], true);
  await page.evaluate(async id => {
    window.__ui.getState().setReaderNodeId(null);
    (await import('/src/lib/node-detail.ts')).setNodeDetail(id, 'full');
  }, id);
  console.log('PASS a compact DOCX opens at its highlighted text and subsequent clicks navigate the open reader');
  await scroll.click({ position: { x: 120, y: 90 } });
  await scroll.evaluate(element => element.__docxSession.instance.focus({ preventScroll: true, restoreSelection: true }));
  await page.keyboard.press('Control+Home');
  const prefix = 'New introductory sentence. '.repeat(4);
  await page.keyboard.insertText(prefix);
  const draftVersion = await scroll.evaluate(el => el.__docxSession.instance.ui.document.getVersion());
  await ticks.nth(1).click();
  await hitInView(hitAddresses[1]);
  assert.equal(await scroll.evaluate(el => el.__docxSession.instance.ui.document.getVersion()), draftVersion);
  assert.equal(await scroll.evaluate(el => el.__docxSession.dirty), true);
  await page.locator('[data-docx-save]').click();
  await page.waitForFunction(id => window.__store.getState().nodes.find(node => node.id === id).data.attachments[0].editedText?.includes('New introductory sentence'), id);
  const saved = (await snapshot()).attachment;
  assert.ok(saved.editedDocxRevision);
  assert.deepEqual(saved.documentHighlights.map(mark => mark.text), before.map(mark => mark.text));
  assert.deepEqual(saved.documentHighlights.map(mark => mark.id), before.map(mark => mark.id),
    'Inserting a long preface retains the original wired passage at both repeated excerpts');
  assert.ok(saved.documentHighlights[0].fraction > before[1].fraction);
  assert.deepEqual(await handles(), originalHandles);
  console.log('PASS native editor save moves the ruler ticks while preserving the identities of duplicate passages');

  await page.evaluate(id => {
    const store = window.__store.getState(), source = store.nodes.find(node => node.id === id);
    const legacyData = { ...source.data.attachments[0] };
    delete legacyData.documentHighlights;
    window.__store.setState({ nodes: store.nodes.map(node => node === source
      ? { ...node, data: { ...node.data, attachments: [legacyData] } } : node) });
  }, id);
  await page.waitForFunction(id => window.__store.getState().nodes.find(node => node.id === id).data.attachments[0].documentHighlights?.length === 3, id);
  const indexed = (await snapshot()).attachment.documentHighlights;
  assert.deepEqual(indexed.map(({ text, color, fraction }) => ({ text, color, fraction })),
    saved.documentHighlights.map(({ text, color, fraction }) => ({ text, color, fraction })));
  assert.equal(await ticks.count(), 3);
  console.log('PASS older canvas metadata backfills the saved native revision including its edited reading positions');

  const rich = await page.evaluate(async () => {
    const { richTextHighlights } = await import('/src/lib/document-highlights.ts');
    const html = '<p><span style="background-color:#fed000">one <b>passage</b></span> plain.</p><p><mark>second</mark></p>';
    const before = richTextHighlights(html);
    const after = richTextHighlights('<p>Prefix</p>' + html, before);
    return { before, after };
  });
  assert.deepEqual(rich.before.map(mark => mark.text), ['one passage', 'second']);
  assert.deepEqual(rich.after.map(mark => mark.id), rich.before.map(mark => mark.id));
  assert.deepEqual(errors, []);
  console.log('PASS saved rich text preserves adjacent formatting and stable mark IDs');
} catch (error) {
  console.error({ errors, failedRequests: failedRequests.slice(-10), body: (await page.locator('body').innerText()).slice(0, 700) });
  throw error;
} finally {
  await close();
}
