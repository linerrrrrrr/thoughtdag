// Run against a development server with THOUGHTDAG_DISK_STORAGE=0.
// The browser uses a temporary profile, a simulated local Agent and an intercepted API.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { initNodePickerFixture } from './fixtures/node-picker.mjs';

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173');
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath });
const apiName = 'fixture-api';
const apiSources = [
  { id: 'fixture-work', label: 'Work connection', exclusive: 'only-work' },
  { id: 'fixture-team', label: 'Team connection', exclusive: 'only-team' },
];
const apiModel = 'api-connection:fixture-team:' + apiName;
const catalog = {
  default: 'api-connection:fixture-work:' + apiName,
  models: apiSources.flatMap(source => [apiName, source.exclusive].map(modelId => ({
    id: 'api-connection:' + source.id + ':' + modelId, sourceId: source.id,
    provider: 'Test API', sourceLabel: source.label, modelId, name: modelId, vision: false,
  }))),
};
const agentModel = 'codex/codex/codex-fixture-agent';

async function checkFirstQuestion(kind, width, lang) {
  const page = await browser.newPage({
    viewport: { width, height: 900 }, locale: lang === 'zh' ? 'zh-CN' : 'en-US',
    serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(20000);
  const apiSends = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(initNodePickerFixture);
  await page.addInitScript(providers => {
    localStorage.setItem('thoughtdag.providers', JSON.stringify(providers));
  }, apiSources.map(source => ({
    id: source.id, preset: 'custom', name: 'Test API', baseURL: 'https://' + source.id + '.invalid/v1',
    apiKey: '', models: [{ id: apiName }, { id: source.exclusive }],
  })));
  await page.addInitScript(() => {
    window.fixtureAgentOnline = false;
    window.fixtureAgentSends = [];
    window.desktopWhy = {};
    let listener;
    window.desktopAgents = {
      models: async runtime => {
        if (window.fixtureAgentOnline && runtime === 'claude-code') {
          return { installed: true, models: [{ provider: 'anthropic', id: 'sonnet', name: 'Sonnet', vision: true }], default: 'anthropic/sonnet' };
        }
        const installed = window.fixtureAgentOnline && runtime === 'codex';
        const models = installed ? ['codex-fixture-agent', 'codex-mini'].map(id => ({
          provider: 'codex', id, name: id, efforts: ['low', 'high', 'xhigh', 'ultra'], defaultEffort: 'low', supportsFast: true,
        })) : [];
        return { installed, models, default: installed ? 'codex/codex-fixture-agent' : null };
      },
      canvasWorkspace: async () => 'D:/fixture-workspace',
      guardWrite: async () => true,
      onEvent(fn) { listener = fn; },
      run: async request => {
        window.fixtureAgentSends.push(request);
        const runId = 'landing-fixture';
        setTimeout(() => listener({ runId, event: { type: 'run_end', how: 'end', text: 'Fixture answer' } }), 0);
        return runId;
      },
    };
  });
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/__thoughtdag_storage') return route.fulfill({ status: 404 });
    if (url.pathname === '/api/models' || url.pathname === '/api/runtime-providers') return route.fulfill({ json: catalog });
    if (url.pathname === '/api/stream' && request.method() === 'POST') {
      apiSends.push(request.postDataJSON());
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"Fixture answer"}\n\ndata: [DONE]\n\n' });
    }
    if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) return route.abort();
    return route.continue();
  });

  try {
    await page.goto(appUrl.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__projects?.getState().activeId, undefined, { timeout: 90000 });
    const defaultModel = kind === 'api' ? agentModel : apiModel;
    await page.evaluate(async ({ lang, defaultModel }) => {
      const ui = window.__ui.getState();
      ui.setTutorialOpen(false);
      ui.setReleaseNotesOpen(false);
      ui.setSelectedModel(defaultModel);
      (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang(lang);
      (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting(lang === 'zh' ? 'dark' : 'light');
    }, { lang, defaultModel });
    const landing = page.locator('[data-landing-page]');
    const picker = landing.locator('[data-landing-execution]');
    const option = kind => picker.locator('[data-node-execution-option="' + kind + '"]');
    const question = 'First question using ' + kind;
    const input = landing.getByRole('textbox');
    const send = landing.locator('.landing-send');
    const panel = page.locator('[data-model-picker-panel]');
    const trigger = picker.locator('[data-model-picker-trigger]');
    const scale = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')));
    const checkMenuSide = async (opener, menu, expectedGap) => {
      const anchor = await opener.boundingBox();
      const popup = await menu.boundingBox();
      const opensBelow = page.viewportSize().height - anchor.y - anchor.height >= anchor.y;
      const gap = opensBelow ? popup.y - anchor.y - anchor.height : anchor.y - popup.y - popup.height;
      assert.ok(Math.abs(gap - expectedGap * scale) < 1, 'The menu stays attached to the opening button on the side with more space.');
    };
    await input.fill(question);
    const recall = landing.locator('[data-recall-toggle]');
    await recall.click();
    await checkMenuSide(recall, page.locator('[data-recall-menu]'), 8);
    await page.keyboard.press('Escape');
    const beforeDiscovery = await send.isDisabled();
    await option('codex').click();
    await panel.waitFor();
    assert.equal(await send.isDisabled(), beforeDiscovery, 'Browsing disconnected Agents preserves the current draft target.');
    assert.equal(await input.inputValue(), question);
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      window.fixtureAgentOnline = true;
      await (await window.__importLive('/src/lib/use-models.ts')).recheckAgents();
    });

    await option(kind).click();
    await checkMenuSide(option(kind), panel, 6);
    if (kind === 'codex') {
      await panel.getByRole('button', { name: /Claude Code/i }).click();
      await panel.getByRole('button', { name: 'Sonnet', exact: true }).waitFor();
      assert.equal(await panel.getByRole('slider').count(), 0);
      assert.equal(await panel.getByRole('switch').count(), 0);
      await panel.locator('[data-draft-source-back]').click();
    }
    const sourceName = kind === 'api' ? 'Team connection' : 'Codex';
    const source = panel.getByRole('button', { name: new RegExp(sourceName, 'i') });
    await source.click();
    await checkMenuSide(option(kind), panel, 6);
    assert.equal(await option(kind).getAttribute('aria-pressed'), 'true');
    const modelOption = panel.getByRole('button', { name: kind === 'api' ? apiName : 'fixture-agent', exact: true });
    if (kind === 'api') {
      assert.equal(await panel.getByRole('button', { name: 'only-work', exact: true }).count(), 0);
      await panel.getByRole('button', { name: 'only-team', exact: true }).waitFor();
      const back = panel.locator('[data-draft-source-back]');
      for (const target of ['label', 'arrow', 'keyboard']) {
        if (target === 'label') await back.getByText('API', { exact: true }).click();
        else if (target === 'arrow') await back.locator('svg').click();
        else await back.press('Enter');
        await source.waitFor();
        await source.click();
      }
    }
    if (kind === 'codex') {
      assert.equal(await panel.getByRole('slider').getAttribute('aria-valuetext'), 'Low');
      const popup = await panel.boundingBox();
      assert.equal(await panel.getByRole('switch').getAttribute('aria-checked'), 'false');
      const listBox = await panel.locator('[data-agent-model-list]').boundingBox();
      const sliderBox = await panel.getByRole('slider').boundingBox();
      assert.ok(listBox.x + listBox.width <= sliderBox.x, 'Models and reasoning occupy separate columns at every width.');
      assert.ok(popup.x >= 0 && popup.x + popup.width <= width + 1, 'The complete picker fits on screen.');
    }
    await modelOption.waitFor();
    await page.keyboard.press('Escape');
    await source.waitFor();
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await input.inputValue(), question);
    await trigger.click();
    await modelOption.click();
    if (kind === 'codex') {
      const panelLeft = () => panel.evaluate(async el => {
        await new Promise(requestAnimationFrame);
        return el.getBoundingClientRect().left;
      });
      const openedLeft = await panelLeft();
      const originalWidth = (await trigger.boundingBox()).width;
      await panel.getByRole('button', { name: 'mini', exact: true }).click();
      assert.ok((await trigger.boundingBox()).width < originalWidth, 'The shorter model changes the trigger width.');
      assert.equal(await panelLeft(), openedLeft, 'Changing models keeps the open panel in place.');
      await modelOption.click();
      const slider = panel.getByRole('slider');
      await panel.getByRole('button', { name: 'XHigh', exact: true }).click();
      assert.equal(await slider.getAttribute('aria-valuetext'), 'XHigh');
      assert.equal(await panelLeft(), openedLeft, 'Changing the thinking effort keeps the open panel in place.');
      assert.equal(await panel.locator('[data-agent-effort-label]').innerText(), 'XHigh');
      assert.equal(await panel.getByText(/^(Low|Ultra)$/).count(), 0, 'The range has no endpoint captions.');
      await slider.press('End');
      assert.equal(await slider.getAttribute('aria-valuetext'), 'Ultra');
      await panel.locator('[data-agent-effort-reset]').click();
      assert.equal(await slider.getAttribute('aria-valuetext'), 'Low');
      await slider.press('ArrowRight');
      assert.equal(await slider.getAttribute('aria-valuetext'), 'High');
      const fast = panel.locator('[data-agent-fast]');
      await fast.press('Space');
      assert.equal(await fast.getAttribute('aria-checked'), 'true');
      assert.equal(await panelLeft(), openedLeft, 'Adding the Fast icon keeps the open panel in place.');
      if (width === 1440) {
        await page.setViewportSize({ width: 960, height: 900 });
        const resizedLeft = await panelLeft();
        await page.keyboard.press('Escape');
        await trigger.click();
        assert.equal(await panelLeft(), resizedLeft, 'Resizing aligns the panel as a fresh opening would.');
        await page.setViewportSize({ width, height: 900 });
      }
      if (process.env.LANDING_SCREENSHOT_DIR) {
        await page.screenshot({ path: process.env.LANDING_SCREENSHOT_DIR + '/agent-options-' + width + '.png' });
      }
      await page.keyboard.press('Escape');
      assert.match(await trigger.getAttribute('aria-label'), /fixture-agent · High/);
      assert.doesNotMatch(await trigger.innerText(), /codex-/i);
    } else {
      assert.equal((await trigger.innerText()).trim(), apiName);
      const switchCatalog = next => page.evaluate(async data => {
        (await window.__importLive('/src/lib/use-models.ts')).setModelsCache(data);
      }, next);
      await switchCatalog({ ...catalog, models: catalog.models.filter(model => model.sourceId !== 'fixture-team') });
      assert.equal(await send.isDisabled(), true, 'An identically named model on another connection cannot replace the chosen route.');
      await input.press('Enter');
      assert.deepEqual(apiSends, []);
      await switchCatalog(catalog);
      assert.equal(await send.isEnabled(), true);
    }
    const composer = await landing.locator('.landing-composer').boundingBox();
    const execution = await picker.boundingBox();
    const modeBox = await picker.getByRole('group').boundingBox();
    const modelBox = await trigger.boundingBox();
    assert.ok(Math.abs(modeBox.height - modelBox.height) <= 0.5, 'The execution switch and model picker have the same height.');
    if (modelBox.x >= modeBox.x + modeBox.width) {
      assert.ok(Math.abs(modeBox.y - modelBox.y) <= 0.5, 'The execution switch and model picker align on the same row.');
    } else {
      assert.ok(modelBox.y >= modeBox.y + modeBox.height, 'The model picker wraps below the execution switch on narrow screens.');
    }
    for (const tool of [landing.locator('.question-attach-button'), landing.locator('[data-recall-toggle]')]) {
      const box = await tool.boundingBox();
      assert.ok(box.y + box.height <= execution.y, 'Attachments and Recall sit above the execution options.');
    }
    const sendBox = await send.boundingBox();
    const rightInset = composer.x + composer.width - sendBox.x - sendBox.width;
    const bottomInset = composer.y + composer.height - sendBox.y - sendBox.height;
    assert.ok(rightInset > 0 && Math.abs(rightInset - bottomInset) <= 1, 'Send stays in the lower-right corner.');
    assert.ok(execution.x + execution.width <= sendBox.x, 'Execution options and Send do not overlap.');
    const before = await page.evaluate(() => ({
      nodes: window.__store.getState().nodes.length,
      global: window.__ui.getState().selectedModel, agentSends: window.fixtureAgentSends.length,
    }));
    assert.deepEqual(before, { nodes: 0, global: defaultModel, agentSends: 0 });
    assert.equal(apiSends.length, 0);
    for (const control of [option('api'), option('codex'), trigger, send]) {
      const box = await control.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'Controls must fit the viewport.');
      await control.click({ trial: true });
    }
    if (process.env.LANDING_SCREENSHOT_DIR) {
      await page.screenshot({ path: process.env.LANDING_SCREENSHOT_DIR + '/' + kind + '-' + width + '.png' });
    }
    if (kind === 'api') await input.press('Enter');
    else await send.click();
    await page.waitForFunction(() => window.__store.getState().nodes[0]?.data.response === 'Fixture answer');
    const sent = await page.evaluate(() => {
      const { nodes } = window.__store.getState();
      return {
        count: nodes.length, question: nodes[0].data.question,
        kind: nodes[0].data.executionKind, model: nodes[0].data.model,
        global: window.__ui.getState().selectedModel,
        agentSends: window.fixtureAgentSends.map(({ runtime, model, effort, fast }) => ({ runtime, model: model.id, effort, fast })),
      };
    });
    assert.deepEqual(sent, {
      count: 1, question, kind, model: kind === 'api' ? apiModel : agentModel, global: defaultModel,
      agentSends: kind === 'api' ? [] : [{ runtime: 'codex', model: 'codex-fixture-agent', effort: 'high', fast: true }],
    });
    assert.deepEqual(apiSends.map(request => request.model), kind === 'api' ? [apiModel] : []);
    if (kind === 'api') {
      assert.deepEqual(apiSends[0].providers.map(provider => provider.id), apiSources.map(source => source.id));
    }
    assert.deepEqual(errors, []);
    console.log('PASS', kind, width, lang, 'first-question selection, draft, layout and dispatch');
  } catch (error) {
    console.error('Browser state on failure:', errors, await page.locator('body').innerText({ timeout: 2000 }).catch(() => ''));
    throw error;
  } finally { await page.close(); }
}

try {
  await checkFirstQuestion('codex', 1440, 'zh');
  await checkFirstQuestion('api', 390, 'en');
  await checkFirstQuestion('codex', 320, 'zh');
} finally { await browser.close(); }
