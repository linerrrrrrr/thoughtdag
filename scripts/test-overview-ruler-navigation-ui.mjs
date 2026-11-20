// Navigation is read-only. All gestures run against an isolated canvas and local documents.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { documentBrowser } from './fixtures/original-file-browser.mjs';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const output = 'local-tests/overview-ruler';
await mkdir(output, { recursive: true });
const { context, close } = await documentBrowser(appUrl, {
  executablePath, viewport: { width: 1780, height: 1120 }, locale: 'zh-CN', reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(60000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { providers: [], models: [], topics: [], sessions: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const card = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const marks = id => card(id).locator('[data-overview-ruler] [data-overview-ruler-mark]');
const ready = () => page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated(),
  undefined, { timeout: 60000 });
const camera = async zoom => {
  await page.evaluate(zoom => window.__rf.setViewport({ x: 45, y: 45, zoom }, { duration: 0 }), zoom);
};
const graph = () => page.evaluate(() => ({
  ids: window.__store.getState().nodes.map(node => node.id),
  edges: window.__rf.getEdges().map(({ id, source, target, sourceHandle }) => ({ id, source, target, sourceHandle })),
}));

// A passage can have a DOM box while it is thousands of pixels outside its
// own scroll pane. Check every clipping ancestor, including nested PDF pages.
async function assertInReadingViewport(locator) {
  const element = await locator.first().elementHandle();
  await page.waitForFunction(target => {
    const rect = target.getBoundingClientRect();
    const y = rect.y + rect.height / 2;
    if (!rect.height || y < 0 || y >= innerHeight) return false;
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll|clip|hidden/.test(getComputedStyle(parent).overflowY)) {
        const box = parent.getBoundingClientRect();
        if (y < box.top || y >= box.bottom) return false;
      }
    }
    return true;
  }, element);
  await element.dispose();
}

// Read the passage's place in the full document independently of scrollTop.
async function assertScrolledRuler(nodeId, paneSelector) {
  await page.waitForFunction(({ nodeId, paneSelector }) => {
    const card = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    const pane = card.querySelector(paneSelector);
    const content = pane.firstElementChild.getBoundingClientRect();
    const last = [...pane.querySelectorAll('mark.highlight-mark')].at(-1)?.getBoundingClientRect();
    const tick = card.querySelector('[data-overview-ruler-mark="ruler/text//repeated/1"]').getBoundingClientRect();
    if (!last || pane.scrollTop <= pane.clientHeight || !content.height) return false;
    const fraction = (last.top + last.height / 2 - content.top) / content.height;
    const view = pane.getBoundingClientRect();
    return Math.abs(tick.top + tick.height / 2 - (view.top + fraction * view.height)) < 3;
  }, { nodeId, paneSelector });
}

async function checkConversationRulerGeometry() {
  await page.evaluate(() => {
    const response = [
      '## 观测结果', '以下表格列出沿河路段的观测情况。',
      '| 路段 | 复查记录 |', '| --- | --- |',
      ...Array.from({ length: 4 }, (_, index) =>
        `| 路段 ${index + 1} | ${index === 0 ? '早期采样。' : ''}积水消退时间在降雨结束后测量。 |`),
      '', '## 后续行动', '1. 汇总各路段记录。', '2. 复核采样时间。', '3. 优先复查沿河路段。',
    ].join('\n');
    const attachments = Array.from({ length: 8 }, (_, index) => ({
      id: `report-${index}`, name: `观测记录${index}.txt`, type: 'text/plain', content: '未标注的记录。', size: 24,
    }));
    const nodes = [{ id: 'report', type: 'thought', position: { x: 20, y: 20 }, width: 620,
      dragHandle: '.drag-handle', data: { question: '哪些路段需要复查？', response, responses: [response],
        responseIndex: 0, tokenCount: 0, detailLevel: 'full', fitContentHeight: true, attachments,
        highlights: [{ id: 'early', text: '早期采样。' }, { id: 'late', text: '优先复查沿河路段。' }], highlightMode: 'off' } }];
    window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null,
      history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setPanelOpen(false); ui.setCanvasDetail('full'); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false);
  });
  const report = card('report');
  await report.locator('[data-conversation-answer] mark.highlight-mark').last().waitFor();
  for (const [zoom, size] of [[1, 16], [0.75, 16], [0.75, 19]]) {
    await page.evaluate(async size => {
      const { useCanvasTypographyPreferences } = await import('/src/lib/canvas-typography-preferences.ts');
      const { settings, setSettings } = useCanvasTypographyPreferences.getState();
      setSettings({ ...settings, bodySize: size });
    }, size);
    await camera(zoom);
    const measure = element => {
      const centerY = part => {
        const box = part.getBoundingClientRect();
        return box.top + box.height / 2;
      };
      const highlighted = [...element.querySelectorAll('[data-conversation-answer] mark.highlight-mark')];
      const ticks = [...element.querySelectorAll('[data-overview-ruler-mark]')];
      return highlighted.map(part => {
        const tick = ticks.find(tick => tick.getAttribute('aria-label').includes(part.textContent));
        return { text: part.textContent, y: centerY(part), tick: tick ? centerY(tick) : null };
      });
    };
    const limit = Date.now() + 3000;
    let rows;
    do {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      rows = await report.evaluate(measure);
      if (rows.length === 2 && rows.every(row => Math.abs(row.y - row.tick) < 3)) break;
    } while (Date.now() < limit);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.tick != null && Math.abs(row.y - row.tick) < 3),
      `Ruler ticks must align with the highlighted table cell and last list item at zoom ${zoom}, font ${size}: ${JSON.stringify(rows)}`);
  }
  const box = await report.boundingBox();
  const ruler = await report.locator('[data-overview-ruler]').boundingBox();
  await page.screenshot({ path: `${output}/conversation-ruler.png`, clip: {
    x: box.x - 8, y: box.y - 8, width: ruler.x + ruler.width - box.x + 16, height: box.height + 16,
  } });
  await page.evaluate(async () =>
    (await import('/src/lib/canvas-typography-preferences.ts')).useCanvasTypographyPreferences.getState().reset());
  console.log('PASS eight attachments leave the table and final answer highlights aligned after zoom and font changes');
}

const pdf = await PDFDocument.create();
pdf.addPage([420, 560]).drawText('First page', { x: 20, y: 450 });
pdf.addPage([420, 1800]).drawText('Tall page', { x: 20, y: 1640 });
const content = Buffer.from(await pdf.save()).toString('base64');

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await ready();
  await checkConversationRulerGeometry();
  await page.evaluate(content => {
    const body = [
      '起始观测：**沿河**复查。',
      ...Array.from({ length: 65 }, (_, i) => `观测点 ${i + 1} 的附加记录。`),
      '后续观测：**沿河**复查。',
      ...Array.from({ length: 12 }, (_, i) => `补充记录 ${i + 1}。`),
    ].join('\n\n');
    const highlights = [{ id: 'repeated', text: '沿河复查' }];
    const make = (id, x, y, width, height, data) => ({
      id, type: 'thought', position: { x, y }, width, height, dragHandle: '.drag-handle',
      data: { question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0,
        highlights: [], highlightMode: 'off', detailLevel: 'full', attachments: [], ...data },
    });
    const annotation = (id, page, y) => ({ id, page, kind: 'highlight', color: '#ffdd22',
      rects: [[0.07, y, 0.3, 0.012]], createdAt: new Date().toISOString() });
    const nodes = [
      make('note', 100, 70, 480, 300, { stepKind: 'note', question: body, highlights }),
      make('file', 100, 460, 480, 470, { stepKind: 'file', attachments: [
        { id: 'jump-original', name: '原始观测.pdf', type: 'application/pdf', content, size: content.length,
          numPages: 2, pdfAnnotations: [annotation('early-area', 1, 0.15), annotation('late-area', 2, 0.86)] },
      ] }),
      make('target', 850, 150, 470, 420, { question: '复查哪些路段？', response: body, responses: [body], highlights }),
      make('two-files', 800, 690, 480, 300, { stepKind: 'file', attachments: ['first', 'second'].map(id => ({
        id, name: `${id}.txt`, type: 'text/plain', content: '各路段共用同一句记录。', size: 32,
      })) }),
    ];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [],
      history: [{ nodes, edges: [] }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setPanelOpen(false); ui.setCanvasDetail('full'); ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false);
    ui.setReaderMode('dock'); ui.setReaderWidth(420);
  }, content);
  const reader = page.locator('[data-material-reader]');
  await card('file').locator('[data-page="1"] .tdag-textlayer span').first().waitFor();
  await camera(1);
  const beforeJumps = await graph();
  const passage = (scope, label) => scope.locator('p').filter({ hasText: label }).locator('mark.highlight-mark');
  const latePassage = scope => passage(scope, '后续观测');
  const secondNoteTick = marks('note').last();
  const noteScroll = card('note').locator('[data-content-body]');
  await noteScroll.evaluate(el => { el.scrollTop = 0; });
  const tick = await secondNoteTick.boundingBox();
  const x = tick.x + tick.width / 2, y = tick.y + tick.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y, { steps: 7 });
  await page.mouse.move(x, y, { steps: 7 });
  await page.mouse.up();
  assert.equal(await noteScroll.evaluate(el => el.scrollTop), 0, 'Returning a wire to its starting tick must not navigate');
  assert.deepEqual(await graph(), beforeJumps, 'Returning a wire to its origin must not create a new question');
  await secondNoteTick.click();
  await assertInReadingViewport(latePassage(card('note')));
  await assertScrolledRuler('note', '[data-content-body]');
  assert.equal(await reader.count(), 0);
  await noteScroll.evaluate(el => { el.scrollTop = 0; });
  await secondNoteTick.click();
  await assertInReadingViewport(latePassage(card('note')));
  await marks('note').first().focus();
  await page.keyboard.press('Enter');
  await assertInReadingViewport(passage(card('note'), '起始观测'));
  console.log('PASS repeat clicks and keyboard activation navigate to the requested occurrence in the material');

  const answerTick = marks('target').last();
  await answerTick.click();
  await assertInReadingViewport(latePassage(card('target').locator('[data-conversation-answer]')));
  // Reflow while scrolled. The locator stays at its proportional place in the
  // complete answer, even though clicking has centered the passage on screen.
  await page.evaluate(async () => {
    const { settings, setSettings } = (await import('/src/lib/canvas-typography-preferences.ts')).useCanvasTypographyPreferences.getState();
    setSettings({ ...settings, bodySize: settings.bodySize + 2 });
  });
  await assertScrolledRuler('target', '[data-conversation-split-answer]');
  await page.evaluate(async () =>
    (await import('/src/lib/canvas-typography-preferences.ts')).useCanvasTypographyPreferences.getState().reset());
  assert.equal(await page.locator('[data-focus-panel]').count(), 0);
  await camera(0.75);
  await page.evaluate(() => window.__ui.getState().setPanelOpen(true, 'target'));
  const details = page.locator('[data-focus-panel][data-focus-node-id="target"]');
  await details.locator('[data-conversation-answer]').waitFor();
  await answerTick.click();
  await assertInReadingViewport(latePassage(details.locator('[data-conversation-answer]')));
  await page.evaluate(() => window.__ui.getState().setPanelOpen(false));
  await camera(1);
  console.log('PASS answer ticks scroll the visible answer in the card or its open details panel');

  const pdfTick = marks('file').last();
  await pdfTick.click();
  await assertInReadingViewport(card('file').locator('[data-page="2"] [data-pdf-annotation="late-area"]'));
  assert.equal(await card('file').locator('[data-pdf-comment-editor]').count(), 0);
  await page.evaluate(() => window.__ui.getState().setReaderNodeId('file', { attachmentId: 'jump-original' }));
  await reader.locator('[data-page="1"] [data-pdf-annotation]').first().waitFor();
  await pdfTick.click();
  await assertInReadingViewport(reader.locator('[data-page="2"] [data-pdf-annotation="late-area"]'));
  await marks('file').first().click();
  await assertInReadingViewport(reader.locator('[data-page="1"] [data-pdf-annotation]'));
  assert.equal(await reader.locator('[data-pdf-comment-editor]').count(), 0);
  console.log('PASS PDF ticks address the exact area inside long pages on the canvas and in the open reader');

  await page.evaluate(async () => {
    window.__ui.getState().setReaderNodeId(null);
    window.__store.getState().setSelectedNodeId('file');
    const { setNodeDetail } = await import('/src/lib/node-detail.ts');
    setNodeDetail('note', 'compact');
  });
  await card('note').locator('[data-node-overview-surface="compact"]').waitFor();
  await reader.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__store.getState().selectedNodeId), 'file');
  await secondNoteTick.click();
  const readingSurface = page.locator('[data-reader-docked] [data-reader-highlight-content]');
  await assertInReadingViewport(latePassage(readingSurface));
  assert.equal(await page.evaluate(() => window.__ui.getState().readerNodeId), 'note',
    'Opening a docked ruler jump must override an earlier selection of another material');
  await marks('note').first().click();
  await assertInReadingViewport(passage(readingSurface, '起始观测'));
  assert.deepEqual(await graph(), beforeJumps, 'Navigation must never create a question or a wire');
  console.log('PASS compact-card ticks reveal the passage in the reader and each later click moves to its own occurrence');

  const openBothFiles = () => page.evaluate(() => {
    window.__ui.getState().setReaderMode('full');
    window.__ui.getState().setReaderNodeId('two-files');
  });
  await openBothFiles();
  const secondFile = reader.locator('[data-reading-attachment="second"]');
  await secondFile.waitFor();
  await reader.locator('[data-highlighter-toggle]').first().click();
  await secondFile.locator('p').evaluate(paragraph => {
    const text = document.createRange();
    text.selectNodeContents(paragraph);
    const selection = getSelection();
    selection.removeAllRanges(); selection.addRange(text);
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  });
  const saved = await page.waitForFunction(() =>
    window.__store.getState().nodes.find(node => node.id === 'two-files').data.highlights[0]);
  assert.equal((await saved.jsonValue()).attachmentId, 'second');
  await saved.dispose();
  assert.equal(await marks('two-files').count(), 1);
  await page.evaluate(() => window.__ui.getState().setReaderNodeId(null));
  await reader.waitFor({ state: 'detached' });
  await openBothFiles();
  await secondFile.locator('mark.highlight-mark').waitFor();
  const firstFile = reader.locator('[data-reading-attachment="first"]');
  assert.equal(await firstFile.locator('p').textContent(), await secondFile.locator('mark.highlight-mark').textContent());
  assert.equal(await firstFile.locator('mark.highlight-mark').count(), 0);
  console.log('PASS a highlight in the combined reader stays on the selected attachment after reopening');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} catch (error) {
  console.error({ graph: await graph().catch(() => null), errors, writes });
  await page.screenshot({ path: `${output}/navigation-failure.png` }).catch(() => {});
  throw error;
} finally {
  await close();
}
