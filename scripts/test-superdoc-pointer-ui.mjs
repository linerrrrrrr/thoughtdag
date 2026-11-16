// Pointer coordinates come only from rendered text DOM Ranges. No private engine APIs.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';
import { blueSelectionBounds } from './fixtures/png-pixels.mjs';

const adapt = process.argv.includes('--adapt');
const tag = process.argv.find(arg => arg.startsWith('--tag='))?.split('=')[1];
assert.ok(!tag || /^[a-z0-9_-]+$/.test(tag), 'Artifact tag must be a simple directory name');
const output = `local-tests/superdoc-pointer${tag ? `/${tag}` : adapt ? '/adapted' : ''}`;
await mkdir(output, { recursive: true });
const source = await createSuperdocFixture('POINTER');
const chineseSource = await createSuperdocFixture('POINTER', { pointerParagraph: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const onlyZoom = process.argv.find(arg => arg.startsWith('--zoom='))?.split('=')[1];
const cases = onlyZoom ? [{ surface: 'canvas', zoom: Number(onlyZoom) }] : [
  ...[0.5, 0.75, 1, 1.5].map(zoom => ({ surface: 'canvas', zoom })),
  { surface: 'reader', zoom: 1 },
  ...(process.argv.includes('--extended') ? [
    { surface: 'canvas', zoom: 0.75, uiScale: 1 },
    { surface: 'reader', zoom: 1, uiScale: 1 },
    { surface: 'canvas', zoom: 0.75, nativeZoom: 75 },
    { surface: 'canvas', zoom: 1.5, nativeZoom: 150 },
    { surface: 'canvas', zoom: 0.75, page: 2 },
    { surface: 'canvas', zoom: 1.5, content: 'table' },
    { surface: 'canvas', zoom: 0.75, content: 'chinese' },
  ] : []),
];
const results = [];
try {
  for (const scenario of cases) {
    const label = `${scenario.surface}-${scenario.zoom}${scenario.uiScale ? `-ui${scenario.uiScale}` : ''}${scenario.nativeZoom ? `-native${scenario.nativeZoom}` : ''}${scenario.page ? `-page${scenario.page}` : ''}${scenario.content ? `-${scenario.content}` : ''}`;
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.routeWebSocket('**', socket => socket.close());
    await context.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } }));
    await context.route('https://api.github.com/repos/chenxiachan/thoughtdag', route => route.fulfill({ json: { stargazers_count: 0 } }));
    await context.addInitScript(lighting => {
      localStorage.setItem('thoughtdag.seeded', 'yes');
      localStorage.setItem('thoughtdag.tutorialDone', '1');
      localStorage.setItem('thoughtdag.lang', 'zh');
      localStorage.setItem('thoughtdag.lighting', lighting);
    }, scenario.content === 'chinese' ? 'dark' : 'light');
    try {
      await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5198', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__ui && window.__rf && window.__store?.persist.hasHydrated());
      if (scenario.uiScale) await page.evaluate(scale => document.documentElement.style.setProperty('--ui-scale', String(scale)), scenario.uiScale);
      await page.evaluate(base64 => {
        const nodes = [{ id: 'pointer-node', type: 'thought', position: { x: 100, y: 100 }, width: 740, height: 900, dragHandle: '.drag-handle',
          data: { stepKind: 'file', question: '', response: '', responses: [], responseIndex: 0, tokenCount: 0, highlights: [], highlightMode: 'off', detailLevel: 'full', isLoading: false, isCollapsed: false,
            attachments: [{ id: 'pointer-att', name: 'pointer.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: base64.length, content: base64, extractedText: 'Pointer fixture' }] } }];
        window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
        const ui = window.__ui.getState();
        ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('full');
      }, (scenario.content === 'chinese' ? chineseSource : source).buffer.toString('base64'));
      await page.locator('[data-superdoc-ready="true"]').waitFor();
      await page.waitForTimeout(700);
      if (process.argv.includes('--trace')) await page.evaluate(() => {
        const engine = document.querySelector('[data-superdoc-scroll="pointer-att"]');
        const session = engine.__docxSession;
        window.__pointerRefreshLog = [];
        const snapshot = kind => window.__pointerRefreshLog.push({ kind, time: performance.now(), transform: document.querySelector('.react-flow__viewport').style.transform, computedTransform: getComputedStyle(document.querySelector('.react-flow__viewport')).transform, rect: engine.parentElement.getBoundingClientRect().width, style: engine.getAttribute('style'), ownerMatches: session.owner === engine.parentElement, hosts: session.hosts.size, connected: engine.isConnected, debug: engine.__docxViewportDebug });
        const original = session.viewport.refresh;
        session.viewport.refresh = () => { snapshot('refresh-called'); original(); requestAnimationFrame(() => snapshot('refresh-next-frame')); for (const ms of [50, 150, 300]) setTimeout(() => snapshot(`after-${ms}`), ms); };
        const observer = new MutationObserver(() => snapshot('RF-mutation'));
        observer.observe(document.querySelector('.react-flow__viewport'), { attributes: true, attributeFilter: ['style'] });
        window.__pointerTraceObserver = observer;
      });
      await page.evaluate(({ surface, zoom }) => {
        window.__rf.setViewport({ x: 80, y: 40, zoom }, { duration: 0 });
        if (surface === 'reader') window.__ui.getState().setReaderNodeId('pointer-node', { attachmentId: 'pointer-att' });
      }, scenario);
      await page.waitForTimeout(500);
      if (process.argv.includes('--refresh')) {
        await page.evaluate(() => document.querySelector('[data-superdoc-scroll="pointer-att"]').__docxSession.viewport.refresh());
        await page.waitForTimeout(300);
      }
      if (scenario.nativeZoom) {
        await page.locator('[data-superdoc-scroll="pointer-att"]').getByText('POINTER original document', { exact: true }).first().click();
        await page.locator('[data-docx-toolbar] .native-document-zoom').selectOption(String(scenario.nativeZoom));
        await page.waitForTimeout(500);
      }
      if (adapt) {
        await page.evaluate(() => {
          for (const host of document.querySelectorAll('.docx-view-host')) {
            const engine = host.querySelector('.docx-engine');
            if (!engine) continue;
            const box = host.getBoundingClientRect();
            Object.assign(engine.style, { position: 'absolute', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
              transformOrigin: '0 0', transform: `scale(${host.clientWidth / box.width},${host.clientHeight / box.height})`,
              width: `${box.width}px`, height: `${box.height}px` });
            engine.__docxSession.instance.setZoomMode('fit-width');
          }
        });
        await page.waitForTimeout(500);
      }
      const phrase = scenario.content === 'chinese'
        ? '请从这里开始拖动选中这一段正文，跨越第二行后高亮应始终与实际文字重合。'
        : scenario.content === 'table' ? 'Independent cell'
          : scenario.page === 2 ? 'Continuous reading paragraph 1.' : 'editable opening paragraph.';
      if (scenario.page || scenario.content === 'table') {
        const anchor = page.locator('[data-superdoc-scroll="pointer-att"] .superdoc-text-run').filter({ hasText: phrase }).first();
        const engine = page.locator('[data-superdoc-scroll="pointer-att"]');
        for (let attempt = 0; attempt < 10; attempt++) {
          const box = await anchor.boundingBox(), clip = await engine.boundingBox();
          if (box && clip && box.y >= clip.y + 30 && box.y + box.height < Math.min(clip.y + clip.height, 1200) - 30) break;
          await engine.hover();
          await page.mouse.wheel(0, box && clip && box.y < clip.y + 30 ? -250 : 250);
          await page.waitForTimeout(150);
        }
      }
      const target = await page.evaluate(phrase => {
        const root = document.querySelector('[data-superdoc-scroll="pointer-att"]');
        window.__pointerSession = root.__docxSession;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const records = [];
        let allText = '';
        while (walker.nextNode()) {
          const textNode = walker.currentNode;
          if (!textNode.parentElement?.closest('.superdoc-text-run')) continue;
          records.push({ node: textNode, start: allText.length, end: allText.length + textNode.textContent.length });
          allText += textNode.textContent;
        }
        const start = allText.indexOf(phrase);
        if (start < 0) throw new Error(`Rendered target text was not found: ${phrase}`);
        const first = records.find(record => record.start <= start && record.end > start);
        const end = start + phrase.length;
        const last = records.find(record => record.start < end && record.end >= end);
        const range = document.createRange();
        range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
        const rangeRect = range.getBoundingClientRect();
        if (rangeRect.top < 0 || rangeRect.bottom > innerHeight) throw new Error('Target text is outside the screen');
        window.__pointerRange = range;
        const startRange = range.cloneRange(); startRange.collapse(true);
        const endRange = range.cloneRange(); endRange.collapse(false);
        const startRect = startRange.getBoundingClientRect(), endRect = endRange.getBoundingClientRect();
        const rect = r => ({ x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
        const ancestors = [];
        for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
          ancestors.push({ tag: ancestor.tagName, className: ancestor.className, style: ancestor.getAttribute('style'), width: getComputedStyle(ancestor).width, rect: rect(ancestor.getBoundingClientRect()) });
        }
        return { phrase, uiScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'), canvasTransform: document.querySelector('.react-flow__viewport').style.transform, engine: rect(root.getBoundingClientRect()), engineStyle: root.getAttribute('style'), ancestors, trace: window.__pointerRefreshLog, debug: root.__docxViewportDebug,
          nativeZoom: root.__docxSession.instance.ui.zoom.getSnapshot(), range: rect(rangeRect), rangeRects: [...range.getClientRects()].map(rect),
          start: { x: startRect.x + 0.2, y: startRect.y + startRect.height / 2 }, end: { x: endRect.x - 0.2, y: endRect.y + endRect.height / 2 },
          sourceText: allText.slice(Math.max(0, start - 30), end + 30) };
      }, phrase);
      const beforeSelection = await page.screenshot();
      await page.mouse.move(target.start.x, target.start.y);
      await page.mouse.down();
      await page.mouse.move(target.end.x, target.end.y, { steps: 18 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const selection = await page.evaluate(() => {
        const selection = window.__pointerSession.instance.ui.selection;
        const root = window.__pointerSession.element;
        const rect = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });
        const browser = getSelection();
        return { browserText: browser?.toString(), browserRects: browser?.rangeCount ? [...browser.getRangeAt(0).getClientRects()].map(rect) : [], snapshot: selection.getSnapshot(), current: selection.current(), rects: selection.getRects(),
          overlays: [...root.querySelectorAll('[class*="selection"], [class*="Selection"], [class*="caret"], [class*="Caret"]')].map(element => ({ tag: element.tagName, className: element.className, rect: rect(element.getBoundingClientRect()), style: element.getAttribute('style') })).filter(item => item.rect.width > 0 && item.rect.height > 0).slice(0, 40) };
      });
      await writeFile(`${output}/${label}-dom.html`, await page.locator('[data-superdoc-scroll="pointer-att"]').evaluate(element => element.outerHTML));
      const selectedImage = await page.screenshot({ path: `${output}/${label}-selection.png` });
      const painted = blueSelectionBounds(selectedImage, target.engine, beforeSelection);
      const paintedMatches = !!painted && Math.abs(painted.left - target.range.left) < 4 && Math.abs(painted.right - target.range.right) < 4 && painted.top <= target.range.y + target.range.height / 2 && painted.bottom >= target.range.y + target.range.height / 2;
      const marker = 'CLICKMARK';
      await page.mouse.click(target.start.x, target.start.y);
      await page.keyboard.type(marker, { delay: 30 });
      await page.waitForTimeout(250);
      const insertion = await page.evaluate(({ marker, phrase }) => {
        const root = window.__pointerSession.element;
        const text = root.innerText;
        const index = text.indexOf(marker);
        return { index, nearby: index < 0 ? null : text.slice(Math.max(0, index - 80), index + 120),
          expectedPresent: text.replace(/\s/g, '').includes(`${marker}${phrase}`.replace(/\s/g, '')),
          selected: window.__pointerSession.instance.ui.selection.getSnapshot() };
      }, { marker, phrase });
      let imageSelection = null;
      if (!scenario.page && !scenario.content && !scenario.nativeZoom) {
        const picture = page.locator('[data-superdoc-scroll="pointer-att"] .superdoc-inline-image').first();
        const pictureBox = await picture.boundingBox();
        if (pictureBox && pictureBox.y > 0 && pictureBox.y + pictureBox.height < 1200) {
          await picture.click();
          await page.waitForTimeout(250);
          imageSelection = await page.evaluate(() => {
            const root = document.querySelector('[data-superdoc-scroll="pointer-att"]');
            const picture = root.querySelector('.superdoc-inline-image');
            const overlay = root.querySelector('[data-sd-image-resize-overlay]');
            const border = root.querySelector('[data-sd-image-resize-border]');
            const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
            const imageRect = rect(picture), borderRect = border ? rect(border) : null;
            return { picture: imageRect, border: borderRect, borderMatches: !!borderRect && ['left', 'top', 'right', 'bottom'].every(edge => Math.abs(imageRect[edge] - borderRect[edge]) < 3), overlayHtml: overlay?.outerHTML,
              boxes: overlay ? [overlay, ...overlay.querySelectorAll('*')].map(element => ({ className: element.className, rect: rect(element), border: getComputedStyle(element).border, display: getComputedStyle(element).display })) : [] };
          });
          await page.screenshot({ path: `${output}/${label}-image.png` });
        }
      }
      const selectionMatches = selection.snapshot.quotedText.replace(/\s/g, '') === target.phrase.replace(/\s/g, '');
      const selectedRect = selection.rects.length ? { left: Math.min(...selection.rects.map(r => r.left)), right: Math.max(...selection.rects.map(r => r.right)), top: Math.min(...selection.rects.map(r => r.top)), bottom: Math.max(...selection.rects.map(r => r.bottom)) } : null;
      const geometryMatches = !!selectedRect && Math.abs(selectedRect.left - target.range.left) < 3 && Math.abs(selectedRect.right - target.range.right) < 3 && selectedRect.top <= target.range.y + target.range.height / 2 && selectedRect.bottom >= target.range.y + target.range.height / 2;
      const result = { ...scenario, adapted: adapt, target, selection, painted, paintedMatches, insertion, imageSelection, selectionMatches, geometryMatches, errors };
      results.push(result);
      await writeFile(`${output}/${label}.json`, JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ label, adapted: adapt, quotedText: selection.snapshot.quotedText, selectionMatches, geometryMatches, paintedMatches, imageMatches: imageSelection?.borderMatches, insertion: insertion.nearby, insertionMatches: insertion.expectedPresent, errors }));
    } catch (error) {
      await page.screenshot({ path: `${output}/${label}-failure.png` });
      results.push({ ...scenario, error: error.stack, errors });
      console.log(label, error.message);
    } finally { await context.close(); }
  }
  await writeFile(`${output}/result.json`, JSON.stringify(results, null, 2));
  if (process.argv.includes('--assert')) assert.ok(results.every(result => result.selectionMatches && result.geometryMatches && result.paintedMatches && result.insertion.expectedPresent && (!result.imageSelection || result.imageSelection.borderMatches) && result.errors.length === 0), 'Pointer selection geometry, painted highlight, image border and insertion must match the visible target in every scenario');
} finally { await browser.close(); }
