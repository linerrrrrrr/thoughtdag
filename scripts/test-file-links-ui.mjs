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
await page.addInitScript(() => { localStorage.setItem('thoughtdag.seeded', 'yes'); localStorage.setItem('thoughtdag.tutorialDone', '1'); });
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
      read: async path => { window.__fileCalls.push(['read', path]); if (path.includes('missing')) return { ok: false, reason: 'missing' }; return { ok: true, text: Array.from({ length: 50 }, (_, i) => `const value${i + 1} = ${i + 1};`).join('\n') }; },
      open: async path => { window.__fileCalls.push(['open', path]); return { ok: true }; },
      reveal: async path => { window.__fileCalls.push(['reveal', path]); return { ok: true }; }, image: async () => null,
    };
    const fixture = document.createElement('section');
    fixture.id = 'file-fixture'; fixture.className = 'prose'; fixture.style.cssText = 'position:fixed;inset:100px 150px;background:var(--color-card);color:var(--color-ink);padding:32px;z-index:80;overflow:auto';
    document.body.append(fixture);
    const text = '[windows](C:/work/app/file.ts:12:4)\n\n[uri](file:///C:/work/app/file.ts#L8)\n\n[relative](src/hello.ts#L3)\n\n[unicode](</C:/work/中文 文件.ts:9>)\n\n[web](https://example.com)\n\n[unsafe](javascript:alert(1))\n\n[missing](C:/work/missing.ts)';
    const h = React.createElement ?? React.default.createElement;
    createRoot(fixture).render(h('div', { onContextMenu: () => window.__outerContext++ }, h(Markdown, { base: 'C:\\work\\app' }, text)));
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
  }
} finally { await browser.close(); }
