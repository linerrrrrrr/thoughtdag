// Isolated connection UI acceptance: discovery and guard writes use an in-memory bridge.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { openModelConnection } from './fixtures/canvas-model-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5185');
const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
assert.ok(executablePath);
const out = 'local-tests/agent-api-connections';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
page.setDefaultTimeout(10000);
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname === '/api/models') return route.fulfill({ json: { models: [], default: null } });
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(url.pathname);
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
  window.__connectionCalls = [];
  window.__codexAvailable = false;
  window.desktopAgents = {
    capabilities: { nativePicker: false },
    models: async runtime => {
      window.__connectionCalls.push({ type: 'models', runtime });
      return runtime === 'codex' && window.__codexAvailable
        ? { installed: true, models: [{ provider: 'codex', id: 'fixture', name: 'fixture', vision: false }], default: 'codex/fixture' }
        : { installed: false, models: [], default: null };
    },
    workspace: async () => 'D:/fixture-workspace',
    guardWrite: async (cwd, config) => { window.__connectionCalls.push({ type: 'guard', cwd, config }); return true; },
    run: async () => { window.__connectionCalls.push({ type: 'run' }); throw new Error('No model may run in this fixture'); },
  };
});
const item = name => page.locator(`[data-${name}]`);
const modelPicker = item('project-switcher').locator('[data-model-picker-trigger]');
const activeProject = () => page.evaluate(() => {
  const state = window.__projects.getState();
  return state.projects.find(project => project.id === state.activeId);
});
const pass = name => { checks.push(name); console.log('PASS', name); };
async function checkModelCatalog() {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.evaluate(async () => {
    (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('zh');
    const api = 'Research API';
    const models = [
      { id: 'flash', name: 'Flash (Research API)', provider: api, vision: true },
      { id: 'standard', name: 'Standard', provider: api, vision: false },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `codex/test/agent-${i}`, name: `Codex · Agent ${i}`, provider: '__agent__', vision: true,
        efforts: ['low', 'high'], defaultEffort: 'low',
      })),
    ];
    (await window.__importLive('/src/lib/use-models.ts')).setModelsCache({
      models, default: 'flash', agentsPending: false,
      capabilities: { webSearch: true, searchEngine: 'default', scholarSearch: true, vision: true },
    });
    window.__ui.getState().setSelectedModel(null);
  });
  const api = page.locator('[data-model-source="Research API"]');
  const agent = page.locator('[data-model-source="Codex"]');
  const catalog = item('model-catalog');
  const model = page.locator('[data-model-option="codex/test/agent-9"]');
  await modelPicker.click();
  await catalog.waitFor();
  assert.equal(await item('model-source').count(), 2);
  assert.equal(await api.getAttribute('aria-expanded'), 'true');
  assert.equal(await agent.getAttribute('aria-expanded'), 'false');
  assert.equal(await item('model-option').count(), 2);
  assert.equal(await page.locator('[data-model-option="flash"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-model-option="flash"]').getByText('Flash', { exact: true }).isVisible(), true);
  assert.equal(await catalog.locator('[data-model-option] [data-model-vision="model"]').count(), 1);
  assert.equal(await item('picker-agent').isVisible(), false);
  await item('model-picker-panel').screenshot({ path: `${out}/catalog-zh-dark.png`, animations: 'disabled' });
  await agent.press('Enter');
  assert.equal(await api.getAttribute('aria-expanded'), 'false');
  assert.equal(await item('model-option').count(), 10);
  assert.equal(await agent.locator('[data-model-vision="source"]').count(), 1);
  assert.equal(await catalog.locator('[data-model-option] [data-model-vision]').count(), 0);
  assert.equal(await model.innerText(), 'Agent 9');
  await agent.press('Space');
  assert.equal(await item('model-option').count(), 0);
  await agent.press('Enter');
  await model.click();
  await item('agent-effort-select').selectOption('high');
  await item('agent-effort-ok').click();
  const choice = await page.evaluate(() => {
    const { selectedModel, agentEffort } = window.__ui.getState();
    return { selectedModel, agentEffort };
  });
  assert.deepEqual(choice, { selectedModel: 'codex/test/agent-9', agentEffort: 'high' });
  await modelPicker.click();
  assert.equal(await agent.getAttribute('aria-expanded'), 'true');
  assert.equal(await model.getAttribute('aria-pressed'), 'true');
  await page.locator('[data-picker-view="models"]').press('ArrowRight');
  assert.equal(await page.locator('[data-picker-view="settings"]').getAttribute('aria-selected'), 'true');
  assert.equal(await catalog.isVisible(), false);
  assert.ok(await item('picker-agent').isVisible() && await item('picker-apikey').isVisible());
  await item('model-picker-panel').screenshot({ path: `${out}/model-settings-zh-dark.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await modelPicker.click();
  await catalog.waitFor();
  assert.equal(await item('picker-apikey').isVisible(), false);
  const before = await page.evaluate(() => window.__connectionCalls.filter(call => call.type === 'models' && call.runtime === 'codex').length);
  await item('model-refresh').click();
  await api.waitFor({ state: 'detached' });
  await page.waitForFunction(n => window.__connectionCalls.filter(call => call.type === 'models' && call.runtime === 'codex').length > n, before);
  await page.locator('[data-model-option="codex/codex/fixture"]').waitFor();
  await page.keyboard.press('Escape');
  pass('The catalog groups available sources, summarizes vision support, retains the chosen model and effort, and refreshes API and Agent catalogs together');
}
try {
  await page.goto(appUrl.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__ui && window.__rf && window.__projects?.getState().activeId);
  await page.evaluate(() => {
    window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
  });
  await page.evaluate(() => { window.__ui.getState().setTutorialOpen(false); window.__ui.getState().setReleaseNotesOpen(false); });
  await modelPicker.waitFor();
  assert.equal(await item('connection-entry').count(), 0);
  assert.equal(await page.evaluate(() => window.__connectionCalls.length), 0);
  await openModelConnection(page, 'api');
  assert.equal(await item('agent-connection-settings').count(), 0);
  assert.equal(await page.evaluate(() => window.__connectionCalls.filter(call => call.type !== 'models').length), 0);
  await page.keyboard.press('Escape');
  await item('model-connection-panel').waitFor({ state: 'detached' });
  assert.equal(await modelPicker.evaluate(element => element === document.activeElement), true);
  pass('Empty installs reach API setup from the model picker and Escape restores focus to the model button');

  await openModelConnection(page, 'agents');
  await page.locator('[data-agent-connection-status="disconnected"]').waitFor();
  assert.equal(await item('agent-connection-settings').count(), 0);
  await page.evaluate(() => { window.__codexAvailable = true; });
  await item('agent-connect').click();
  await page.locator('[data-agent-connection-status="connected"]').waitFor();
  await item('agent-cwd').waitFor();
  assert.equal(await item('canvas-header').locator('[data-agent-cwd], [data-agent-permission-chip]').count(), 0);
  assert.equal(await item('provider-add').count(), 0);
  assert.equal(await page.evaluate(() => window.__connectionCalls.filter(call => call.type !== 'models').length), 0);
  pass('Codex connection reveals canvas settings only inside the Agent page, without starting a run or changing permissions');

  await item('agent-cwd').click();
  await item('agent-cwd-input').fill('relative/path');
  await item('agent-cwd-input').press('Enter');
  assert.equal(await item('agent-cwd-input').getAttribute('aria-invalid'), 'true');
  assert.equal((await activeProject()).agentCwd, undefined);
  await item('agent-cwd-input').fill('D:/connection-draft');
  await item('agent-cwd-input').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true })));
  assert.equal((await activeProject()).agentCwd, undefined);
  await item('agent-cwd-input').press('Escape');
  assert.equal(await item('agent-connection-page').isVisible(), true);
  assert.equal(await item('agent-cwd').evaluate(element => element === document.activeElement), true);
  await openModelConnection(page, 'api');
  assert.equal(await item('agent-cwd').count(), 0);
  assert.ok(!(await item('model-connection-panel').innerText()).includes('Codex'));
  await openModelConnection(page, 'agents');
  await item('agent-cwd').click();
  assert.equal(await item('agent-cwd-input').inputValue(), 'D:/connection-draft');
  await item('agent-cwd-input').fill('');
  await page.mouse.click(1100, 750);
  await item('model-connection-panel').waitFor({ state: 'detached' });
  await openModelConnection(page, 'agents');
  await item('agent-cwd').click();
  assert.equal(await item('agent-cwd-input').inputValue(), '');
  assert.equal((await activeProject()).agentCwd, undefined);
  await item('agent-cwd-input').fill('D:/explicit-workspace');
  await item('agent-cwd-menu').getByRole('button', { name: '使用', exact: true }).click();
  assert.equal((await activeProject()).agentCwd, 'D:/explicit-workspace');
  pass('Directory validation, IME, nested Escape, outside close, page switching and empty drafts preserve explicit-submit semantics');

  await item('agent-permission-chip').click();
  await page.locator('[data-agent-permission="auto"]').click();
  await page.waitForFunction(() => window.__connectionCalls.some(call => call.type === 'guard'));
  assert.equal((await activeProject()).agentGuard.mode, 'auto');
  const guard = await page.evaluate(() => window.__connectionCalls.filter(call => call.type === 'guard'));
  assert.deepEqual(guard, [{ type: 'guard', cwd: 'D:/explicit-workspace', config: { mode: 'auto', allow: [] } }]);
  await item('project-switcher').screenshot({ path: `${out}/project-toolbar.png`, animations: 'disabled' });
  await item('model-connection-panel').screenshot({ path: `${out}/agent-connected-zh.png`, animations: 'disabled' });
  await openModelConnection(page, 'api');
  await item('provider-add').click();
  await page.locator('[data-preset="custom"]').click();
  await item('provider-url').fill('https://example.invalid/v1');
  await openModelConnection(page, 'agents');
  assert.equal(await item('provider-save').count(), 0);
  assert.equal(await item('agent-permission-chip').getAttribute('data-agent-permission-chip'), 'auto');
  await openModelConnection(page, 'api');
  assert.equal(await item('provider-url').inputValue(), 'https://example.invalid/v1');
  await item('model-connection-panel').screenshot({ path: `${out}/api-config-zh.png`, animations: 'disabled' });
  pass('An explicit approval choice updates the active canvas; API drafts survive switching and Agent controls never enter the API page');

  await openModelConnection(page, 'agents');
  await page.evaluate(async () => {
    (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang('en');
    (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting('dark');
  });
  await page.setViewportSize({ width: 820, height: 650 });
  await item('agent-permission-chip').click();
  await item('agent-permission-menu').waitFor();
  await page.screenshot({ path: `${out}/agent-dark-en-narrow.png`, animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.keyboard.press('Escape');
  assert.equal(await item('agent-connection-page').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await item('model-connection-panel').count(), 0);
  assert.equal(await page.evaluate(() => window.__connectionCalls.filter(call => call.type === 'run').length), 0);
  assert.equal(await page.evaluate(() => window.__connectionCalls.filter(call => call.type === 'guard').length), 1);
  await checkModelCatalog();
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  pass('Light/Chinese and dark/English narrow layouts render with no overflow, implicit writes, model runs or page errors');
  await writeFile(`${out}/result.json`, JSON.stringify({ checks, errors, writes }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, animations: 'disabled' }).catch(() => {});
  throw error;
} finally { await browser.close(); }
