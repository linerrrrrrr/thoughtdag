// Real wheel regression for nested conversation scrollers. No model/tool calls.
// Run against Vite with APP_URL and an optional CHROME_PATH override.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const candidates = process.platform === 'win32'
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
const executablePath = process.env.CHROME_PATH ?? candidates.find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const outputDir = 'local-tests/nested-scroll';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1050 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const checks = [];
const errors = [];
const writes = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
await context.route('**/api/**', async route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const viewport = () => page.evaluate(() => window.__rf.getViewport());
const top = locator => locator.evaluate(el => el.scrollTop);
const setTop = (locator, value) => locator.evaluate((el, value) => { el.scrollTop = value === 'end' ? el.scrollHeight : value; }, value);
const assertClose = (a, b, message) => assert.ok(Math.abs(a - b) < 2, `${message}: ${a} vs ${b}`);
const assertOverflow = async locator => assert.ok(await locator.evaluate(el => el.scrollHeight > el.clientHeight + 20), 'Fixture must genuinely overflow');

// Avoid locator.hover(), which can scroll ancestors and conceal a broken chain.
async function wheel(locator, deltaY, deltaX = 0) {
  const point = await locator.evaluate(el => {
    let { left, right, top, bottom } = el.getBoundingClientRect();
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, box.left); right = Math.min(right, box.right);
      }
    }
    top = Math.max(top, 0); bottom = Math.min(bottom, innerHeight);
    left = Math.max(left, 0); right = Math.min(right, innerWidth);
    if (bottom - top < 8 || right - left < 8) throw new Error('Wheel target is clipped');
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    if (!el.contains(document.elementFromPoint(x, y))) throw new Error('Wheel target is covered');
    return { x, y };
  });
  await page.mouse.move(point.x, point.y);
  // Let the preceding wheel transaction end before targeting a different layer.
  await page.waitForTimeout(250);
  await page.mouse.wheel(deltaX, deltaY);
  await page.waitForTimeout(350);
}

async function alignActivity(scope, outer) {
  const offset = await scope.locator('[data-agent-activity]').evaluate(el => {
    const outer = el.closest('[data-thought-body], .focus-panel-content');
    const box = outer.getBoundingClientRect();
    const scale = box.height / outer.offsetHeight;
    return outer.scrollTop + (el.getBoundingClientRect().top - box.top) / scale - 20;
  });
  await setTop(outer, offset);
}

async function openActivity(scope) {
  const history = scope.locator('[data-activity-history]');
  if (await history.getAttribute('aria-expanded') !== 'true') await history.click();
  for (const id of ['first-command', 'last-command']) {
    const button = scope.locator(`[data-activity-id="${id}"] .activity-item-heading`);
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  }
}

async function exerciseActivity(scope, outer, label, baseline = false) {
  await openActivity(scope);
  const timeline = scope.locator('.activity-scroll');
  const first = scope.locator('[data-activity-id="first-command"] [data-activity-output]');
  const last = scope.locator('[data-activity-id="last-command"] [data-activity-output]');
  await Promise.all([assertOverflow(outer), assertOverflow(timeline), assertOverflow(first), assertOverflow(last)]);
  await setTop(timeline, 0);
  await setTop(first, 60);
  await alignActivity(scope, outer);
  const initialViewport = await viewport();
  const outerStart = await top(outer);
  await wheel(first, 90);
  assert.ok(await top(first) > 60, 'Output scrolls before its parents');
  assertClose(await top(timeline), 0, 'Timeline stays still while output can scroll');
  assertClose(await top(outer), outerStart, 'Outer stays still while output can scroll');
  check(`${label}: output consumes wheel while it has content`);

  if (baseline) {
    const oldStyle = await page.addStyleTag({ content: '.activity-scroll, .activity-output { overscroll-behavior: contain !important; }' });
    await setTop(first, 'end');
    await wheel(first, 90);
    assertClose(await top(timeline), 0, 'Old containment reproduces blocked output handoff');
    assertClose(await top(outer), outerStart, 'Old containment also blocks the card');
    await oldStyle.evaluate(el => el.remove());
    check('original contain styling reproduces the reported stuck wheel');
  }

  await setTop(first, 'end');
  await wheel(first, 90);
  assert.ok(await top(timeline) > 20, 'Output bottom hands wheel to timeline');
  assertClose(await top(outer), outerStart, 'Timeline consumes wheel before the card');
  check(`${label}: output bottom continues into timeline`);

  await setTop(timeline, 'end');
  await setTop(last, 'end');
  await alignActivity(scope, outer);
  const beforeDown = await top(outer);
  await wheel(last, 90);
  assert.ok(await top(outer) > beforeDown + 20, 'Timeline bottom hands wheel to outer card');
  check(`${label}: both inner bottoms continue into outer card`);

  await setTop(timeline, 'end');
  await setTop(last, 0);
  await alignActivity(scope, outer);
  const timelineEnd = await top(timeline);
  const outerBeforeUp = await top(outer);
  await wheel(last, -90);
  assert.ok(await top(timeline) < timelineEnd - 20, 'Output top hands wheel upward to timeline');
  assertClose(await top(outer), outerBeforeUp, 'Timeline consumes upward wheel before the card');
  await setTop(timeline, 0);
  await setTop(first, 0);
  await alignActivity(scope, outer);
  const beforeUp = await top(outer);
  await wheel(first, -90);
  assert.ok(await top(outer) < beforeUp - 20, 'Timeline top hands wheel upward to outer card');
  assert.deepEqual(await viewport(), initialViewport, 'Nested scrolling must not pan or zoom canvas');
  check(`${label}: upward handoff works at both levels without moving canvas`);
}

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setAutoRefreshPaused(true);
    window.__ui.getState().setPanelOpen(false);
    const now = Date.now();
    const output = Array.from({ length: 100 }, (_, i) => `Output line ${i + 1}: verification fixture`).join('\n');
    const command = id => ({ id, kind: 'command', status: 'completed', title: '检查输出', command: 'example --check', output, startedAt: now, endedAt: now + 100 });
    const activity = [command('first-command'), ...Array.from({ length: 12 }, (_, i) => ({
      id: `comment-${i}`, kind: 'commentary', status: 'completed', text: `过程 ${i + 1}：${'检查滚动区域中的内容，保持其他区域位置。'.repeat(5)}`, startedAt: now, endedAt: now + 100,
    })), command('last-command')];
    const question = Array.from({ length: 60 }, (_, i) => `问题第 ${i + 1} 行：长内容应先在片段内部滚动。`).join('\n\n');
    const response = Array.from({ length: 60 }, (_, i) => `回答第 ${i + 1} 段：在内层滚动到边界后，继续滚动整个卡片。`).join('\n\n');
    window.__store.getState().setNodes([{ id: 'nested-scroll', type: 'thought', position: { x: 0, y: 0 }, width: 620, height: 740, data: {
      question, response, responses: [response], responseIndex: 0, agentActivities: [activity], detailLevel: 'full',
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      roleMode: 'inherit', isRoot: true, isBranch: false,
    } }]);
    window.__store.getState().setEdges([]);
  });
  const node = page.locator('.react-flow__node[data-id="nested-scroll"]');
  await node.waitFor({ state: 'visible' });
  await page.evaluate(() => window.__rf.setViewport({ x: 110, y: 130, zoom: 1 }, { duration: 0 }));
  await page.waitForTimeout(350);
  const body = node.locator('[data-thought-body]');
  await exerciseActivity(node, body, 'canvas card', true);

  const question = node.locator('.conversation-user-message');
  await setTop(body, 0);
  await setTop(question, 60);
  await wheel(question, 90);
  assert.ok(await top(question) > 60);
  assertClose(await top(body), 0, 'Question scrolls locally first');
  await setTop(question, 'end');
  await wheel(question, 90);
  assert.ok(await top(body) > 20, 'Question bottom hands wheel to card');
  await setTop(question, 0);
  const questionOuter = await top(body);
  await wheel(question, -60);
  assert.ok(await top(body) < questionOuter - 20, 'Question top hands wheel upward');
  check('question fragment scrolls locally and hands off in both directions');

  await setTop(body, 0);
  await setTop(question, 0);
  const boundaryViewport = await viewport();
  await wheel(question, -120);
  assert.deepEqual(await viewport(), boundaryViewport, 'Outer top must not move the canvas');
  await setTop(body, 'end');
  await wheel(body, 120);
  assert.deepEqual(await viewport(), boundaryViewport, 'Outer bottom must not move the canvas');
  check('outer card boundaries keep ordinary wheel away from canvas pan/zoom');

  await setTop(body, 0);
  await page.keyboard.down('Control');
  await wheel(question, -120);
  await page.keyboard.up('Control');
  assert.ok((await viewport()).zoom > boundaryViewport.zoom, 'Ctrl+wheel must still zoom the canvas');
  check('Ctrl+wheel over nested content still zooms canvas');
  await page.evaluate(() => window.__rf.setViewport({ x: 110, y: 130, zoom: 0.75 }, { duration: 0 }));
  await exerciseActivity(node, body, 'canvas card at 75%');
  await page.screenshot({ path: `${outputDir}/canvas.png` });

  await page.evaluate(async () => {
    window.__store.getState().setSelectedNodeId('nested-scroll');
    window.__ui.getState().setPanelWidth(380);
    window.__ui.getState().setPanelOpen(true, 'nested-scroll');
    (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
  });
  const panel = page.locator('[data-focus-panel]');
  await panel.waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
  const panelBody = panel.locator('.focus-panel-content');
  await exerciseActivity(panel, panelBody, 'focus panel');
  await page.screenshot({ path: `${outputDir}/focus-panel.png` });
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(writes, [], 'No API mutation during fixtures or scrolling');
  check('no runtime errors or API writes');
  await writeFile(`${outputDir}/result.json`, JSON.stringify({ checks, errors, writes }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${outputDir}/failure.png` });
  await writeFile(`${outputDir}/failure.json`, JSON.stringify({ checks, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
