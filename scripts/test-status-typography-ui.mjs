import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const browser = await chromium.launch({ executablePath, headless: true });
let proxy;
try {
  const page = await browser.newPage();
  const statusPage = name => new URL('../runtime/status-pages/' + name, import.meta.url).href;
  const font = selector => page.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  async function checkNativeCursor() {
    const cursors = await page.evaluate(() => {
      const control = document.createElement('button');
      document.body.append(control);
      const enabled = getComputedStyle(control).cursor;
      control.disabled = true;
      const disabled = getComputedStyle(control).cursor;
      control.remove();
      return [enabled, disabled];
    });
    assert.deepEqual(cursors, ['pointer', 'default']);
  }
  await page.goto(statusPage('splash.html'));
  await checkNativeCursor();
  assert.equal(await font('h1'), 22);
  assert.equal(await font('p'), 12.5);
  await page.goto(statusPage('startup-error.html?port=3100'));
  await checkNativeCursor();
  assert.match(await page.locator('pre').innerText(), /port 3100/);

  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  proxy = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), THOUGHTDAG_DISK_STORAGE: '0' },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 20000;
  while (!(await fetch(origin + '/oauth/typography.css').catch(() => null))?.ok) {
    assert.ok(proxy.exitCode === null && Date.now() < deadline, 'The isolated OAuth callback server must serve its stylesheet');
    await delay(100);
  }
  for (const route of ['/oauth/openrouter', '/oauth/openrouter/']) {
    const response = await page.goto(origin + route + '?code=local-test');
    assert.equal(response.status(), 200);
    await checkNativeCursor();
    assert.equal(await font('.status-icon'), 40);
    assert.equal(await font('h2'), 24);
    assert.equal(await font('p'), 16);
    assert.deepEqual(await (await fetch(origin + '/oauth/openrouter/code')).json(), { code: 'local-test' });
    assert.deepEqual(await (await fetch(origin + '/oauth/openrouter/code')).json(), { code: null });
  }
  console.log('PASS desktop startup and error pages, authorization callback typography and one-time readback');
} finally {
  proxy?.kill();
  await browser.close();
}
