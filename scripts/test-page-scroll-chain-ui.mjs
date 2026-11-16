// Real wheel regression for a fixed reading panel at fractional display scales.
// Every run uses an isolated profile and blocks all backend/model requests.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5177');
const output = 'local-tests/page-scroll-chain';
const label = (process.env.SCROLL_TRACE_LABEL ?? 'fixed-panel').replace(/[^a-z0-9_-]/gi, '-');
await mkdir(output, { recursive: true });
const checks = [], failures = [], traces = [], errors = [], writes = [];
const verify = (condition, description, details) => {
  if (condition) checks.push(description);
  else failures.push({ description, details });
};

async function actualPanel(factor) {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: [`--force-device-scale-factor=${factor}`, '--window-size=1800,1300'] });
  // viewport:null preserves browser scrollTop quantization; a fixed emulated
  // deviceScaleFactor alone did not expose the old boundary bug.
  const context = await browser.newContext({ viewport: null, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await context.routeWebSocket('**', socket => socket.close());
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url());
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await context.addInitScript(() => {
      localStorage.setItem('thoughtdag.seeded', 'yes');
      localStorage.setItem('thoughtdag.tutorialDone', '1');
      localStorage.setItem('thoughtdag.lang', 'zh');
    });
    await page.goto(appUrl.href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
    await page.evaluate(async () => {
      const ui = (await import('/src/lib/ui-store.ts')).useUiStore;
      const response = Array.from({ length: 40 }, (_, i) => `回答 ${i + 1}：问答分别阅读，到达边界后停止，外层固定不滚。`).join('\n\n');
      const nodes = [{ id: 'fractional-panel-fixture', type: 'thought', position: { x: 0, y: 0 }, width: 600, height: 600, data: {
        question: Array.from({ length: 60 }, (_, i) => `问题 ${i + 1}：长问题在实际阅读栏中的滚动应当连续。`).join('\n\n'),
        response, responses: [response], responseIndex: 0, questionHeightRatio: .79, detailLevel: 'full',
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 0, roleMode: 'inherit',
      } }];
      window.__store.setState({ nodes, edges: [], selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges: [] }], historyIndex: 0 });
      ui.getState().setTutorialOpen(false);
      ui.getState().setReleaseNotesOpen(false);
      ui.getState().setPanelWidth(580);
      ui.getState().setPanelOpen(true, nodes[0].id);
    });
    const panel = page.locator('[data-focus-panel]');
    await panel.locator('[data-conversation-split-question]').waitFor();
    await page.waitForTimeout(400);
    const sample = () => panel.evaluate(el => {
      const item = selector => { const port = el.querySelector(selector); return { top: port.scrollTop, max: port.scrollHeight - port.clientHeight }; };
      const rect = el.getBoundingClientRect();
      return { question: item('[data-conversation-split-question]'), answer: item('[data-conversation-split-answer]'),
        outer: item('[data-conversation-scroll-page]'), shell: { top: rect.top, bottom: rect.bottom, viewport: innerHeight },
        camera: window.__rf.getViewport() };
    });
    const settle = () => page.waitForTimeout(180);
    for (const name of ['question', 'answer']) {
      const selector = `[data-conversation-split-${name}]`;
      await panel.evaluate((el, selector) => {
        el.querySelector('[data-conversation-split-question]').scrollTop = 0;
        el.querySelector('[data-conversation-split-answer]').scrollTop = 0;
        el.querySelector(selector).scrollTop = 1e7;
      }, selector);
      await settle();
      const box = await panel.locator(selector).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(20, box.height / 2));
      const steps = [{ deltaY: 0, ...await sample() }];
      for (const deltaY of [120, 120, 120, -120]) {
        await page.mouse.wheel(0, deltaY);
        await settle();
        steps.push({ deltaY, ...await sample() });
      }
      const other = name === 'question' ? 'answer' : 'question';
      traces.push({ factor, pane: name, pointerMoves: 1, steps });
      verify(steps[0][name].max > 200, `${factor}/${name}: fixture genuinely overflows`, steps);
      verify(steps.every(step => step.outer.top === 0 && step.outer.max <= 1), `${factor}/${name}: outer container has no scrolling`, steps);
      verify(steps.slice(0, 4).every(step => Math.abs(step[name].top - steps[0][name].top) <= 1 / factor),
        `${factor}/${name}: repeated downward input stops at the true lower edge`, steps);
      verify(steps[4][name].top < steps[3][name].top - 30,
        `${factor}/${name}: the first reverse wheel responds immediately`, steps);
      verify(steps.every(step => step[other].top === 0), `${factor}/${name}: sibling pane remains still`, steps);
      verify(steps.every(step => JSON.stringify(step.camera) === JSON.stringify(steps[0].camera)),
        `${factor}/${name}: canvas remains still`, steps);
      verify(steps.every(step => Math.abs(step.shell.top) < 1 && Math.abs(step.shell.bottom - step.shell.viewport) < 1),
        `${factor}/${name}: panel stays attached to both viewport edges`, steps);

      await panel.locator(selector).evaluate(el => { el.scrollTop = 0; });
      await settle();
      for (const deltaY of [-120, -120, 120]) { await page.mouse.wheel(0, deltaY); await settle(); }
      const reversedFromTop = await sample();
      verify(reversedFromTop[name].top > 30 && reversedFromTop.outer.top === 0 && reversedFromTop[other].top === 0,
        `${factor}/${name}: the first downward wheel after upper-boundary input responds locally`, reversedFromTop);
    }
    if (factor === 1.25) await page.screenshot({ path: `${output}/actual-panel-${label}.png` });
  } finally {
    await browser.close();
  }
}

try {
  for (const factor of [.67, .75, .8, 1, 1.25, 1.5, 2]) await actualPanel(factor);
  verify(errors.length === 0, 'No browser runtime errors', errors);
  verify(writes.length === 0, 'No mutating API requests', writes);
} finally {
  await writeFile(`${output}/results-${label}.json`, JSON.stringify({ checks, failures, traces, errors, writes }, null, 2));
}
console.log(`${checks.length} checks passed; ${failures.length} failed. Evidence: ${output}/results-${label}.json`);
assert.equal(failures.length, 0, failures.map(item => item.description).join('\n'));
