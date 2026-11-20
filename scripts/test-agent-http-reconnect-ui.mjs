import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { openModelConnection } from './fixtures/canvas-model-picker.mjs';
import { initNodePickerFixture } from './fixtures/node-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5185');
const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });

async function checkConnection(startOffline, apiFails = false) {
  const page = await browser.newPage({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  const writes = [], errors = [];
  let hostOnline = !startOffline;
  let discoveryCount = 0, codexCatalogCount = 0;
  let releaseProbe;
  const probeGate = new Promise(resolve => { releaseProbe = resolve; });
  let releaseApi;
  const apiGate = new Promise(resolve => { releaseApi = resolve; });
  let apiRequests = 0;
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
    // Startup, reconnect and the settings panel can prepare canvas folders.
    if (url.pathname === '/api/agents/canvas-workspace' && request.method() === 'POST') {
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
      apiRequests++;
      if (!hostOnline) return route.abort('connectionrefused');
      if (!startOffline) await apiGate;
      if (apiFails) return route.fulfill({ status: 503, headers, json: { error: 'API catalog unavailable' } });
      return route.fulfill({ headers, json: { default: 'fixture-api', models: [
        { id: 'fixture-api', name: 'API fixture', provider: 'fixture', vision: false },
      ] } });
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
    const startupProbe = page.waitForRequest(req => new URL(req.url()).pathname === '/api/agents/available', { timeout: 90000 });
    await page.goto(appUrl.href, { waitUntil: 'domcontentloaded' });
    await startupProbe;
    await page.waitForFunction(() => window.__projects?.getState().activeId && window.__ui, undefined, { timeout: 90000 });
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
      await page.evaluate(() => window.__projects.setState(s => ({
        projects: [...s.projects, { id: 'offline-archived', name: 'Offline', archived: true, createdAt: 1, updatedAt: 1 }],
      })));
      const archivedWorkspace = page.waitForRequest(r => new URL(r.url()).pathname === '/api/agents/canvas-workspace'
        && r.method() === 'POST' && r.postDataJSON().canvasId === 'offline-archived');
      hostOnline = true;
      releaseProbe();
      await page.locator('[data-agent-connect]').click();
      await page.locator('[data-agent-connection-status="connected"]').waitFor();
      assert.ok((await archivedWorkspace).postDataJSON().namespace, 'Reconnection prepares the archived canvas without opening it');
      assert.ok(discoveryCount > previous, 'Connect must probe the recovered HTTP host');
    } else {
      releaseProbe();
      await page.locator('[data-agent-connection-status="connected"]').waitFor();
      assert.ok(apiRequests > 0, 'Agent connected while the API catalog request was still pending');
      if (!apiFails) {
        await page.evaluate(() => {
          // Keep the post-turn memory judge outside this transport test.
          window.__ui.setState({ memoryEnabled: false });
          const bridge = window.desktopAgents;
          let onEvent;
          bridge.onEvent = callback => { onEvent = callback; };
          bridge.guardWrite = async () => true;
          bridge.run = async ({ runtime, model }) => {
            window.fixtureDispatch = { runtime, modelId: model.id };
            const runId = 'local-catalog-fixture';
            setTimeout(() => onEvent({ runId, event: { type: 'run_end', how: 'end', text: 'Fixture answer' } }), 0);
            return runId;
          };
          void window.__store.getState().addQuestion('Fixture question', { execution: { executionKind: 'codex' } });
        });
        await page.waitForFunction(() => window.__store.getState().nodes.some(node => node.data.response === 'Fixture answer'));
        assert.deepEqual(await page.evaluate(() => window.fixtureDispatch), { runtime: 'codex', modelId: 'fixture' });
      }
      releaseApi();
      const catalog = await page.evaluate(async () => {
        const { getModelsOnce, availableExecutionModels } = await window.__importLive('/src/lib/use-models.ts');
        const data = await getModelsOnce();
        return {
          api: availableExecutionModels(data, 'api').map(model => model.id),
          agent: availableExecutionModels(data, 'codex').map(model => model.id),
          installed: data?.runtimes?.codex?.installed,
          selectedDefault: data?.default,
        };
      });
      assert.deepEqual(catalog, {
        api: apiFails ? [] : ['fixture-api'], agent: ['codex/codex/fixture'],
        installed: true, selectedDefault: apiFails ? null : 'fixture-api',
      }, 'Settling the API request preserves the verified Agent catalog');
    }
    assert.ok(codexCatalogCount > 0, 'The HTTP Codex catalog established readiness');
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    if (startOffline) console.log('PASS Connect recovers after the host was offline at startup');
    else console.log('PASS Agent connects before the API catalog settles and remains available after', apiFails ? 'HTTP 503' : 'a late API catalog');
  } finally {
    releaseProbe();
    releaseApi();
    await page.close();
  }
}

try {
  await checkConnection(true);
  await checkConnection(false);
  await checkConnection(false, true);
} finally {
  await browser.close();
}
