import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { openModelConnection } from './fixtures/canvas-model-picker.mjs';
import { initNodePickerFixture } from './fixtures/node-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5185');
const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });

async function checkConnection(startOffline) {
  const page = await browser.newPage({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  const writes = [], errors = [];
  let hostOnline = !startOffline;
  let discoveryCount = 0, codexCatalogCount = 0;
  let releaseProbe;
  const probeGate = new Promise(resolve => { releaseProbe = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(initNodePickerFixture);
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/__thoughtdag_storage') return route.fulfill({ status: 404 });
    if (!url.pathname.startsWith('/api/')) {
      return url.origin === appUrl.origin ? route.continue() : route.abort('blockedbyclient');
    }
    const headers = { 'access-control-allow-origin': appUrl.origin, 'access-control-allow-headers': 'content-type' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    // The connected directory chip asks the host for the canvas workspace.
    if (url.pathname === '/api/agents/workspace' && request.method() === 'POST') {
      return route.fulfill({ headers, json: { dir: 'D:/fixture-workspace' } });
    }
    if (request.method() !== 'GET') {
      writes.push(url.pathname);
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/api/agents/available') {
      discoveryCount++;
      if (!hostOnline) return route.abort('connectionrefused');
      await probeGate;
      return route.fulfill({ headers, json: { pi: null, codex: 'fixture-cli', 'claude-code': null } });
    }
    if (url.pathname === '/api/models') {
      return hostOnline ? route.fulfill({ headers, json: { models: [], default: null } }) : route.abort('connectionrefused');
    }
    if (url.pathname === '/api/agents/models') {
      const isCodex = url.searchParams.get('runtime') === 'codex';
      if (isCodex) codexCatalogCount++;
      const models = isCodex ? [{ provider: 'codex', id: 'fixture', name: 'fixture', vision: false }] : [];
      return route.fulfill({ headers, json: { installed: isCodex, models, default: isCodex ? 'codex/fixture' : null } });
    }
    return route.fulfill({ status: 404 });
  });
  try {
    const startupProbe = page.waitForRequest(req => new URL(req.url()).pathname === '/api/agents/available');
    await page.goto(appUrl.href, { waitUntil: 'domcontentloaded' });
    await startupProbe;
    await page.waitForFunction(() => window.__projects?.getState().activeId && window.__ui);
    await page.evaluate(() => {
      window.__ui.getState().setTutorialOpen(false);
      window.__ui.getState().setReleaseNotesOpen(false);
    });
    await openModelConnection(page, 'agents');
    assert.equal(await page.evaluate(() => !!window.desktopAgents), false);
    assert.equal(codexCatalogCount, 0);
    if (startOffline) {
      await page.locator('[data-agent-connection-status="disconnected"]').waitFor();
      const previous = discoveryCount;
      hostOnline = true;
      releaseProbe();
      await page.locator('[data-agent-connect]').click();
      await page.locator('[data-agent-connection-status="connected"]').waitFor();
      assert.ok(discoveryCount > previous, 'Connect must probe the recovered HTTP host');
    } else {
      releaseProbe();
      await page.locator('[data-agent-connection-status="connected"]').waitFor();
    }
    assert.ok(codexCatalogCount > 0, 'The HTTP Codex catalog established readiness');
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log('PASS', startOffline ? 'Connect recovers after the host was offline at startup' : 'The open panel discovers Codex when the startup HTTP probe finishes');
  } finally {
    releaseProbe();
    await page.close();
  }
}

try {
  await checkConnection(true);
  await checkConnection(false);
} finally {
  await browser.close();
}
