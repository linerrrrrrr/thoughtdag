import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const output = 'local-tests/file-links';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/api/**', route => route.fulfill({ json: {} }));
await page.addInitScript(() => { localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1'); localStorage.setItem('thoughtdag.lang', 'zh'); });
try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const React = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = client.createRoot ?? client.default.createRoot;
    const { Markdown } = await import('/src/components/Markdown.tsx');
    window.__fileCalls = []; window.__fileCopies = []; window.__outerContext = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => window.__fileCopies.push(value) } });
    window.desktopLocal = {
      read: async path => { window.__fileCalls.push(['read', path]); if (path.includes('missing')) return { ok: false, reason: 'missing' }; if (/\.(pdf|zip)$/i.test(path)) return { ok: false, reason: 'not-text' }; return { ok: true, text: Array.from({ length: 50 }, (_, i) => `const value${i + 1} = ${i + 1};`).join('\n') }; },
      open: async path => { window.__fileCalls.push(['open', path]); return { ok: true }; },
      reveal: async path => { window.__fileCalls.push(['reveal', path]); return { ok: true }; }, image: async () => null,
    };
    const fixture = document.createElement('section');
    fixture.id = 'file-fixture'; fixture.className = 'prose'; fixture.style.cssText = 'position:fixed;inset:100px 150px;background:var(--color-card);color:var(--color-ink);padding:32px;z-index:80;overflow:auto';
    document.body.append(fixture);
    const text = '[windows](C:/work/app/file.ts:12:4)\n\n[uri](file:///C:/work/app/file.ts#L8)\n\n[relative](src/hello.ts#L3)\n\n[unicode](</C:/work/中文 文件.ts:9>)\n\n[web](https://example.com)\n\n[unsafe](javascript:alert(1))\n\n[missing](C:/work/missing.ts)\n\n[archive](C:/work/论文_章节分割_9份.zip)\n\n摘要 :codex-file-citation{path="C:/work/00_Abstract.pdf" purpose="output"}\n\n示例 `:codex-file-citation{path="C:/work/example.pdf" purpose="output"}`';
    const h = React.createElement ?? React.default.createElement;
    window.__fileFixtureRoot = createRoot(fixture);
    window.__fileFixtureRoot.render(h('div', { onContextMenu: () => window.__outerContext++ }, h(Markdown, { base: 'C:\\work\\app' }, text)));
  });
  const link = name => page.locator('#file-fixture a').filter({ hasText: new RegExp(`^${name}$`) });
  await link('windows').waitFor();
  assert.equal(await link('windows').getAttribute('data-local-path'), 'C:/work/app/file.ts');
  assert.equal(await link('windows').getAttribute('data-file-line-ref'), '12');
  assert.equal(await link('uri').getAttribute('data-file-line-ref'), '8');
  assert.equal(await link('relative').getAttribute('data-local-path'), 'C:/work/app/src/hello.ts');
  assert.equal(await link('unicode').getAttribute('data-local-path'), 'C:/work/中文 文件.ts');
  assert.ok(!(await link('unsafe').getAttribute('href')));
  assert.equal(await link('web').getAttribute('target'), '_blank');
  assert.deepEqual(await page.evaluate(() => window.__fileCalls), []);
  assert.match(await link('archive').getAttribute('href'), /^file:\/\/\/C:\//);
  assert.equal(await link('00_Abstract.pdf').getAttribute('data-local-path'), 'C:/work/00_Abstract.pdf');
  assert.match(await page.locator('#file-fixture code').textContent(), /codex-file-citation/);
  console.log('PASS Markdown preserves file URLs and relative cwd without reading files on render');
  await link('windows').click();
  const preview = page.locator('[data-file-preview]');
  await preview.waitFor();
  assert.equal(await preview.locator('[data-file-line="12"]').getAttribute('data-selected'), 'true');
  assert.equal(await preview.locator('[data-file-line="12"] code').textContent(), 'const value12 = 12;');
  await page.screenshot({ path: `${output}/file-preview.png` });
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'detached' });
  assert.equal(await link('windows').evaluate(el => el === document.activeElement), true);
  console.log('PASS file click opens text preview at referenced line and Escape restores focus');
  await link('relative').click({ button: 'right' });
  const menu = page.locator('[data-file-menu]');
  await menu.waitFor();
  assert.equal(await page.evaluate(() => window.__outerContext), 0);
  await page.screenshot({ path: `${output}/file-menu.png` });
  await menu.getByRole('menuitem', { name: '复制路径', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__fileCopies), ['C:/work/app/src/hello.ts']);
  await link('relative').focus();
  await page.keyboard.press('Shift+F10');
  await menu.waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.deepEqual((await page.evaluate(() => window.__fileCalls)).at(-1), ['reveal', 'C:/work/app/src/hello.ts']);
  const count = await page.evaluate(() => window.__fileCalls.length);
  await link('windows').click({ button: 'right' });
  await page.mouse.click(20, 700);
  await menu.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__fileCalls.length), count);
  console.log('PASS link context menu owns right-click, supports keyboard/copy/reveal, outside dismiss has no side effects');
  await link('missing').click();
  await page.getByText('找不到这个路径：C:/work/missing.ts', { exact: true }).waitFor();
  assert.equal(await preview.count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS missing files show a visible failure; no page errors');
  for (const [name, path] of [['archive', 'C:/work/论文_章节分割_9份.zip'], ['00_Abstract.pdf', 'C:/work/00_Abstract.pdf']]) {
    await link(name).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(path => window.__fileCalls.at(-1)?.[0] === 'open' && window.__fileCalls.at(-1)?.[1] === path, path);
    assert.equal(await preview.count(), 0);
  }
  assert.equal(page.url().replace(/\/$/, ''), appUrl.replace(/\/$/, ''), 'File clicks never navigate to a frontend route');
  await link('archive').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '复制链接', exact: true }).click();
  assert.match((await page.evaluate(() => window.__fileCopies)).at(-1), /^file:\/\/\/C:\//);
  console.log('PASS citation and ZIP links use the file bridge, keyboard activation and copy preserve local URLs');

  // Verify the same renderer on the actual canvas and narrow reading panel.
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  await page.evaluate(async () => {
    window.__fileFixtureRoot.unmount();
    document.getElementById('file-fixture').remove();
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    useUiStore.setState({ panelOpen: true, panelNodeId: 'file-citations', panelWidth: 380 });
    const response = '已按章节拆成 **9 份 PDF**，并检查内容与页码。\n\n[下载全部分册（ZIP，含章节目录）](C:/work/论文_章节分割_9份.zip)\n\n' + ['00_Abstract', '01_Introduction', '02_Hypotheses_and_Research_Design', '03_Sample_Selection', '04_Results', '05_Robustness_and_Supplementary_Analysis', '06_Conclusion', '07_Appendix', '08_References'].map((name, i) => `${i === 0 ? '摘要与论文信息' : `第 ${i} 部分`}： :codex-file-citation{path="C:/work/${name}.pdf" purpose="output"}`).join('\n\n');
    window.__store.getState().setNodes([{ id: 'file-citations', type: 'thought', dragHandle: '.drag-handle', position: { x: 0, y: 0 }, width: 600, height: 780, data: {
      question: '识别、分割为数个章节 pdf', response, responses: [response], questions: ['识别、分割为数个章节 pdf'], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 300, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: true,
      importSource: { runner: 'codex', sessionId: 'file-fixture', itemIds: [], cwd: 'C:/work' }, detailLevel: 'full',
    } }]);
    window.__store.getState().setEdges([]);
    window.__rf.setViewport({ x: 60, y: 90, zoom: 1 }, { duration: 0 });
  });
  const card = page.locator('.react-flow__node[data-id="file-citations"]');
  const panel = page.locator('[data-focus-panel]');
  for (const surface of [card, panel]) {
    await surface.locator('a[data-local-path$="/08_References.pdf"]').waitFor();
    assert.equal(await surface.locator('a[data-local-path$=".pdf"]').count(), 9);
    assert.ok(!(await surface.textContent()).includes('codex-file-citation'));
    assert.equal(await surface.locator('a[data-local-path$=".zip"]').count(), 1);
  }
  for (const theme of ['dark', 'light']) {
    await page.evaluate(async theme => { const { useAppearance } = await import('/src/lib/appearance.ts'); useAppearance.getState().setLighting(theme); }, theme);
    await page.screenshot({ path: `${output}/citations-${theme}.png` });
    for (const surface of [card, panel]) {
      const overflow = await surface.evaluate(el => [...el.querySelectorAll('.prose')].some(p => p.scrollWidth > p.clientWidth + 1));
      assert.equal(overflow, false, 'Long filenames wrap in the card and the 380px reading panel');
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS nine chapter citations render on canvas and narrow reading panel in both themes without overflow');
  if (process.env.FILE_SERVICE_URL) {
    await page.unroute('**/api/**');
    const result = await page.evaluate(async ({ api, path }) => {
      delete window.desktopLocal;
      const { installLocalFilesBridge } = await import('/src/lib/local-files-bridge.ts');
      installLocalFilesBridge(api);
      return window.desktopLocal.read(path);
    }, { api: process.env.FILE_SERVICE_URL, path: resolve('runtime/local-files.cjs') });
    assert.equal(result.ok, true);
    assert.match(result.text, /function createLocalFiles/);
    console.log('PASS browser HTTP bridge reads the real local service');
    // Opt-in OS handoff: verify the menu against the running service, not a
    // mocked bridge. This catches a backend still caching an older launcher.
    if (process.env.FILE_REVEAL_PATH) {
      const path = process.env.FILE_REVEAL_PATH.replace(/\\/g, '/');
      await page.evaluate(path => {
        const response = `:codex-file-citation{path="${path}" purpose="output"}`;
        const store = window.__store.getState();
        store.setNodes(store.nodes.map(node => node.id !== 'file-citations' ? node : {
          ...node, data: { ...node.data, response, responses: [response] },
        }));
      }, path);
      const fileLink = panel.getByRole('link', { name: path.split('/').at(-1), exact: true });
      await fileLink.click({ button: 'right' });
      const response = page.waitForResponse(r => r.url() === `${process.env.FILE_SERVICE_URL}/local/reveal` && r.request().method() === 'POST');
      await menu.getByRole('menuitem', { name: '在文件夹中显示', exact: true }).click();
      const revealResult = await (await response).json();
      assert.equal(revealResult.ok, true, JSON.stringify(revealResult));
      assert.equal(revealResult.opened, 'finder');
      assert.equal(await page.getByText(`无法打开此文件：${path}`, { exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      console.log('PASS real citation context menu reveals the requested file through the running service');
    }
  }
} finally { await browser.close(); }
