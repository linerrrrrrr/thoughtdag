// Run against Vite in --mode test (isolated browser storage).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1520, height: 960 }, locale: 'zh-CN' });
try {
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('thoughtdag.tutorialDone', '1');
    localStorage.setItem('thoughtdag.seeded', 'yes');
    localStorage.setItem('thoughtdag.lang', 'zh');
  });
  await page.route('**/api/**', route => route.fulfill({ json: { models: [], providers: [], items: [], sessions: [] } }));
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5197', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(async () => {
    const modules = performance.getEntriesByType('resource').map(entry => entry.name);
    const load = path => import(modules.find(url => new URL(url).pathname === path) ?? path);
    const { bootProjects } = await load('/src/store/projects.ts');
    await bootProjects();
    const { useUiStore } = await load('/src/lib/ui-store.ts');
    const { useAppearance } = await load('/src/lib/appearance.ts');
    window.visualUi = useUiStore;
    window.visualTheme = useAppearance;
    useUiStore.setState({ tutorialOpen: false, releaseNotesOpen: false, panelWidth: 510 });
    const path = 'D:/example/sliders.html';
    const reference = '\uE200visualize\uE202' + JSON.stringify({ path, title: 'Controls' }) + '\uE201';
    const response = ['[Design][doc]', reference, 'Change the value.', '', '[doc]: https://example.com/design'].join('\n');
    const html = `<!doctype html><html><body><label>Intensity<input style="display:block;width:110px" type="range" value="2" min="1" max="5"></label><output>2</output>
      <script>
      const slider = document.querySelector('input'), value = document.querySelector('output');
      function report() {
        const r = slider.getBoundingClientRect();
        let isolated = false;
        try { void parent.document; } catch { isolated = true; }
        parent.parent.postMessage({ fixture: { value: value.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2,
          isolated, dark: getComputedStyle(document.documentElement).colorScheme === 'dark', hasBridge: !!window.desktopLocal } }, '*');
      }
      slider.oninput = () => { value.textContent = slider.value; report(); };
      new ResizeObserver(report).observe(document.documentElement);
      new MutationObserver(report).observe(document.documentElement, { attributes: true });
      report();
      </script></body></html>`;
    window.addEventListener('message', event => {
      if (event.origin !== 'null' || !event.data?.fixture) return;
      const frame = [...document.querySelectorAll('[data-codex-visual]')].find(el => el.contentWindow?.[0] === event.source);
      if (frame) {
        frame.dataset.fixtureReport = JSON.stringify(event.data.fixture);
        frame.dataset.fixtureValue = event.data.fixture.value;
        frame.dataset.fixtureTheme = event.data.fixture.dark ? 'dark' : 'light';
      }
    });
    window.__store.getState().setNodes([{ id: 'visual-fixture', type: 'thought', position: { x: 0, y: 0 }, width: 630, data: {
      question: 'Adjust the intensity.', response, responses: [response], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      tokenCount: 20, highlights: [], attachments: [], roleMode: 'inherit', detailLevel: 'full',
      generatedBy: ['codex/fixture'], codexVisuals: [[null, { path, html }]],
    } }]);
    window.__store.getState().setEdges([]);
    window.__store.getState().setSelectedNodeId('visual-fixture');
    useUiStore.getState().setPanelOpen(false);
    window.__rf.setViewport({ x: 50, y: 110, zoom: 1 }, { duration: 0 });
  });
  const node = page.locator('.react-flow__node[data-id="visual-fixture"]');
  const details = page.locator('[data-focus-panel]');
  const reader = page.locator('[data-material-reader]');
  const exercise = async scope => {
    const frame = scope.locator('[data-codex-visual][data-fixture-report]');
    await frame.scrollIntoViewIfNeeded();
    const point = await frame.evaluate(el => {
      const report = JSON.parse(el.dataset.fixtureReport), rect = el.getBoundingClientRect();
      return { x: report.x * rect.width / el.clientWidth, y: report.y * rect.height / el.clientHeight,
        isolated: report.isolated, hasBridge: report.hasBridge };
    });
    assert.ok(point.isolated && !point.hasBridge);
    await frame.click({ position: { x: point.x, y: point.y } });
    await page.keyboard.press('End');
    await scope.locator('[data-fixture-value="5"]').waitFor();
    await page.keyboard.press('Home');
    await scope.locator('[data-fixture-value="1"]').waitFor();
  };
  await exercise(node);
  console.log('PASS canvas slider with pointer and keyboard');
  assert.equal(await node.locator('a').filter({ hasText: 'Design' }).getAttribute('href'), 'https://example.com/design');
  assert.equal(await node.locator('[data-codex-visual]').evaluate(el =>
    el.previousElementSibling?.textContent === 'Design' && el.nextElementSibling?.textContent === 'Change the value.'), true);
  assert.ok(await node.locator('[data-codex-visual]').evaluate(el => el.clientHeight >= 64 && el.clientHeight < 120));
  await page.evaluate(() => window.visualUi.getState().setPanelOpen(true, 'visual-fixture'));
  await exercise(details);
  await page.evaluate(async () => {
    window.visualTheme.getState().setLighting('dark');
    await window.__rf.zoomTo(.8, { duration: 0 });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await node.locator('[data-codex-visual]').evaluate(el => el.style.colorScheme), 'dark');
  await node.locator('[data-fixture-theme="dark"]').waitFor();
  assert.equal(await page.evaluate(() => window.__rf.getZoom()), .8);
  console.log('PASS original controls, keyboard, placement, Markdown references, sizing, zoom and dark mode');
  // Apply the exact outer and inner policies together on a test page. All
  // resource responses here are fixtures, independent of CDN connectivity.
  const policies = await node.locator('[data-codex-visual]').evaluate(frame => {
    const outer = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
    const inner = new DOMParser().parseFromString(outer.querySelector('iframe').srcdoc, 'text/html');
    return [outer, inner].map(doc => doc.querySelector('meta[http-equiv="Content-Security-Policy"]').outerHTML);
  });
  const policyPage = await browser.newPage();
  await policyPage.route('https://cdn.jsdelivr.net/npm/fixture/controls.js', route => route.fulfill({
    contentType: 'text/javascript', body: 'window.loadedFixture = true',
  }));
  await policyPage.setContent(policies.join('') + '<script src="https://cdn.jsdelivr.net/npm/fixture/controls.js"></script>');
  assert.equal(await policyPage.evaluate(() => window.loadedFixture), true);
  assert.equal(await policyPage.evaluate(() => fetch('data:,fixture').then(() => true, () => false)), false);
  await policyPage.close();
  console.log('PASS both frame policies permit static library scripts and block data requests');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.visualUi.getState().setReaderNodeId('visual-fixture', { conversationTurn: 'response' }));
    await exercise(reader);
    await reader.locator('[data-material-reader-close]').click();
  }
  console.log('PASS isolated frame and interactive reading after closing and reopening');
  await page.evaluate(() => window.__store.setState(state => ({
    nodes: state.nodes.map(node => ({ ...node, data: { ...node.data, codexVisuals: undefined } })),
  })));
  await node.locator('[data-codex-visual-missing]').waitFor();
  assert.match(await node.locator('[data-codex-visual-missing]').textContent(), /Controls/);
  await page.evaluate(() => window.__store.setState(state => ({
    nodes: state.nodes.map(node => ({ ...node, data: { ...node.data, generatedBy: ['api/fixture'] } })),
  })));
  await node.locator('[data-codex-visual-missing]').waitFor({ state: 'detached' });
  assert.equal(await node.locator('[data-codex-visual]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS missing originals and plain API answers');
} catch (error) {
  await mkdir('local-tests/codex-visual', { recursive: true });
  await page.screenshot({ path: 'local-tests/codex-visual/failure.png' });
  console.error(await page.evaluate(() => ({
    nodes: window.__store?.getState().nodes.map(n => n.id),
    body: document.body.innerText.slice(0, 800),
    previews: document.querySelectorAll('[data-codex-visual]').length,
  })));
  throw error;
} finally {
  await browser.close();
}
