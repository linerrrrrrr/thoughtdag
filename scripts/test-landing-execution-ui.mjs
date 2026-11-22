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
const apiModel = 'fixture-api';
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
  await page.addInitScript(() => {
    window.fixtureAgentOnline = false;
    window.fixtureAgentSends = [];
    window.desktopWhy = {};
    let listener;
    window.desktopAgents = {
      models: async runtime => {
        const installed = window.fixtureAgentOnline && runtime === 'codex';
        const models = installed ? [{ provider: 'codex', id: 'codex-fixture-agent', name: 'codex-fixture-agent', efforts: ['low', 'high', 'ultra'], defaultEffort: 'low', supportsFast: true }] : [];
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
    if (url.pathname === '/api/models') return route.fulfill({ json: {
      default: apiModel, models: [{ id: apiModel, name: apiModel, provider: 'Test API', vision: false }],
    } });
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
    await input.fill(question);
    await option('codex').click();
    assert.equal(await send.isDisabled(), true, 'An offline Agent cannot send the first question.');
    assert.equal(await input.inputValue(), question);
    await page.evaluate(async () => {
      window.fixtureAgentOnline = true;
      await (await window.__importLive('/src/lib/use-models.ts')).recheckAgents();
    });

    await option(kind).click();
    assert.equal(await option(kind).getAttribute('aria-pressed'), 'true');
    const trigger = picker.locator('[data-model-picker-trigger]');
    await trigger.click();
    const panel = page.locator('[data-model-picker-panel]');
    const modelOption = panel.getByRole('button', { name: kind === 'api' ? apiModel : 'fixture-agent', exact: true });
    const modelList = panel.locator('[data-agent-model-list]');
    if (kind === 'codex') {
      assert.equal(await panel.getByRole('slider').getAttribute('aria-valuetext'), 'Low');
      const popup = await panel.boundingBox();
      const anchor = await trigger.boundingBox();
      assert.ok(popup.y + popup.height < anchor.y, 'The options open above the composer when they fit.');
      assert.equal(await panel.locator('[data-agent-fast]').getAttribute('aria-pressed'), 'false');
      await modelList.click();
      await modelOption.waitFor();
      await page.keyboard.press('Escape');
      await modelList.waitFor();
    } else {
      await modelOption.waitFor();
    }
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await input.inputValue(), question);
    await trigger.click();
    if (kind === 'codex') await modelList.click();
    await modelOption.click();
    if (kind === 'codex') {
      const slider = panel.getByRole('slider');
      await slider.press('End');
      assert.equal(await slider.getAttribute('aria-valuetext'), 'Ultra');
      await panel.locator('[data-agent-effort-reset]').click();
      assert.equal(await slider.getAttribute('aria-valuetext'), 'Low');
      await slider.press('ArrowRight');
      assert.equal(await slider.getAttribute('aria-valuetext'), 'High');
      const fast = panel.locator('[data-agent-fast]');
      await fast.press('Space');
      assert.equal(await fast.getAttribute('aria-pressed'), 'true');
      if (process.env.LANDING_SCREENSHOT_DIR) {
        await page.screenshot({ path: process.env.LANDING_SCREENSHOT_DIR + '/agent-options-' + width + '.png' });
      }
      await page.keyboard.press('Escape');
      assert.match(await trigger.getAttribute('aria-label'), /fixture-agent · High/);
      assert.doesNotMatch(await trigger.innerText(), /codex-/i);
    } else {
      assert.equal((await trigger.innerText()).trim(), apiModel);
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
