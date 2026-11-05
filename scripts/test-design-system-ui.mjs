// Independent acceptance of the isolated design reference, not the application.
// Use local browser storage and fixtures; unexpected API requests are blocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173');
const sampleUrl = new URL('/design-system.html', appUrl);
const output = 'local-tests/design-system';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 },
  locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const checks = [], measurements = [], errors = [], requests = [], dialogs = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); void dialog.dismiss(); });
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/') || url.origin !== appUrl.origin) {
    requests.push({ method: route.request().method(), url: url.href });
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
await context.addInitScript(() => {
  const audit = { storageWrites: [], databaseOpens: [], databaseWrites: [], disabledClicks: 0 };
  window.__designAudit = audit;
  for (const name of ['setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[name];
    Storage.prototype[name] = function (...args) {
      audit.storageWrites.push({ name, storage: this === localStorage ? 'localStorage' : 'sessionStorage', key: args[0], stack: new Error().stack });
      return original.apply(this, args);
    };
  }
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    audit.databaseOpens.push(String(args[0]));
    return open.apply(this, args);
  };
  const deleteDatabase = IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.deleteDatabase = function (...args) {
    audit.databaseWrites.push({ method: 'deleteDatabase', name: args[0] });
    return deleteDatabase.apply(this, args);
  };
  for (const method of ['add', 'put', 'delete', 'clear']) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
      audit.databaseWrites.push({ method, store: this.name });
      return original.apply(this, args);
    };
  }
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('button:disabled')) audit.disabledClicks++;
  }, true);
});

const specimen = name => page.locator(`[data-specimen="${name}"]`);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const check = label => { checks.push(label); console.log('PASS', label); };
const choose = async (name, value) => {
  const input = page.locator(`[data-choice="${name}"] input[value="${value}"]`);
  await input.locator('..').click();
  assert.equal(await input.isChecked(), true, `${name}=${value} can be selected`);
  await settle();
};
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= .15, `${label}: expected ${expected}, received ${actual}`);
const font = async (locator, size, lineHeight, label) => {
  const result = await locator.first().evaluate(element => {
    const css = getComputedStyle(element);
    return { size: parseFloat(css.fontSize), lineHeight: parseFloat(css.lineHeight), weight: css.fontWeight };
  });
  near(result.size, size, `${label} font size`);
  near(result.lineHeight, lineHeight, `${label} line height`);
  return result;
};
const layout = async label => {
  const result = await page.evaluate(() => {
    const bounds = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, right: box.right, width: box.width, height: box.height,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    };
    return { viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      samples: [...document.querySelectorAll('[data-specimen]')].map(element => ({ name: element.dataset.specimen, ...bounds(element) })),
      choices: [...document.querySelectorAll('.ds-controls .canvas-layout-choices')].map(bounds) };
  });
  assert.ok(result.scrollWidth <= result.viewport + 1, `${label}: page overflow ${JSON.stringify(result)}`);
  for (const item of [...result.samples, ...result.choices]) {
    assert.ok(item.x >= -1 && item.right <= result.viewport + 1 && item.width > 0,
      `${label}: element outside viewport ${JSON.stringify(item)}`);
    assert.ok(item.scrollWidth <= item.clientWidth + 1, `${label}: local overflow ${JSON.stringify(item)}`);
  }
  return result;
};
const screenshot = async name => {
  await page.evaluate(() => { document.body.scrollTop = 0; scrollTo(0, document.scrollingElement.scrollHeight); });
  await settle();
  const end = await page.locator('.ds-radius-grid figure').last().evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = Math.min(innerWidth - 1, Math.max(1, box.x + box.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(1, box.y + box.height / 2));
    return { top: box.top, bottom: box.bottom, viewportHeight: innerHeight, scrollY,
      visible: element.contains(document.elementFromPoint(x, y)), bodyScroll: document.body.scrollTop };
  });
  assert.ok(end.scrollY > 0 && end.top >= 0 && end.bottom <= end.viewportHeight + 1 && end.visible,
    `${name}: document scrolling must reveal the final geometry specimen without a clipped body ${JSON.stringify(end)}`);
  await page.evaluate(() => { document.body.scrollTop = 0; scrollTo(0, 0); });
  await settle();
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
};

try {
  await page.goto(sampleUrl.href, { waitUntil: 'networkidle' });
  await page.locator('[data-design-system]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('[data-specimen]').count(), 4, 'Four independent surface specimens render');
  const colors = new Map();

  for (const language of ['zh', 'en']) {
    await choose('language', language);
    for (const theme of ['light', 'dark']) {
      await choose('theme', theme);
      for (const width of ['320', '380', '520']) {
        await choose('preview-width', width);
        const label = `${language}/${theme}/${width}`;
        const result = await layout(label);
        for (const item of result.samples) near(item.width, Number(width), `${label} ${item.name} preview width`);
        await font(specimen('conversation').locator('.conversation-user-message'), 16, 28, `${label} card question`);
        await font(specimen('conversation').locator('.conversation-answer'), 16, 28, `${label} card answer`);
        await font(specimen('reader').locator('.focus-assistant-message'), 16, 28, `${label} reader answer`);
        await font(specimen('editing').locator('textarea'), 16, 28, `${label} body input`);
        await font(specimen('tools').locator('.canvas-toolbar-button'), 14, 21, `${label} control`);
        await font(specimen('reader').locator('.focus-panel-title'), 16, 24, `${label} title`);
        await font(specimen('conversation').locator('.node-token-total'), 12, 18, `${label} metadata`);
        const surfaces = await page.evaluate(() => {
          const css = selector => getComputedStyle(document.querySelector(selector));
          const card = css('[data-specimen="conversation"]'), reader = css('[data-specimen="reader"]');
          const body = css('[data-thought-body]'), reading = css('.focus-response-section');
          return { cardBackground: card.backgroundColor, readerBackground: reader.backgroundColor,
            referenceBackground: css('.ds-editor').backgroundColor, cardRadius: card.borderTopLeftRadius,
            readerRadius: reader.borderTopLeftRadius, bodyPadding: [body.paddingTop, body.paddingRight, body.paddingBottom, body.paddingLeft],
            readingInset: [reading.paddingLeft, reading.paddingRight] };
        });
        assert.equal(surfaces.cardBackground, surfaces.readerBackground, `${label}: reading surfaces share the card palette`);
        assert.equal(surfaces.cardBackground, surfaces.referenceBackground, `${label}: reading surface follows the shared card role`);
        assert.equal(surfaces.cardRadius, '14px', `${label}: node corner baseline`);
        assert.equal(surfaces.readerRadius, '14px', `${label}: reader corner baseline`);
        assert.deepEqual(surfaces.bodyPadding, ['16px', '16px', '16px', '16px'], `${label}: node content inset`);
        assert.deepEqual(surfaces.readingInset, ['16px', '16px'], `${label}: reader inline inset`);
        colors.set(theme, surfaces.cardBackground);
        measurements.push({ label, layout: result, surfaces });
      }
    }
  }
  assert.notEqual(colors.get('light'), colors.get('dark'), 'Theme selection actually changes shared surface colors');
  for (const [role, size, line] of [['meta', 12, 18], ['control', 14, 21], ['body', 16, 28], ['title', 16, 24],
    ['heading', 18, 27], ['section', 20, 28], ['page', 24, 32]]) {
    await font(page.locator(`[data-type-role="${role}"]`), size, line, `reference ${role}`);
  }
  check('12 language/theme/preview-width combinations preserve typography, shared surfaces, 14px corners, and 16px content insets');

  await choose('language', 'zh');
  await choose('theme', 'light');
  await choose('preview-width', '380');
  await screenshot('desktop-light');
  await choose('theme', 'dark');
  await screenshot('desktop-dark');

  const input = page.locator('[data-sample-input]');
  const preview = page.locator('.ds-input-preview');
  const firstDraft = '保留会话草稿 / Preserve this draft\n\nSecond paragraph.';
  const secondDraft = `${firstDraft}\n\nOnly explicit preview updates this text.`;
  const emptyPreview = await preview.innerText();
  await input.fill(firstDraft);
  await page.locator('.ds-page-header h1').click();
  assert.equal(await preview.innerText(), emptyPreview, 'Blur does not publish a preview');
  await choose('language', 'en');
  await choose('theme', 'light');
  await choose('preview-width', '520');
  assert.equal(await input.inputValue(), firstDraft, 'Controls retain the input draft');
  assert.equal((await preview.innerText()).includes('Preserve this draft'), false, 'Theme/language changes do not publish a preview');
  await page.locator('[data-sample-preview]').click();
  assert.ok((await preview.innerText()).includes('Preserve this draft'), 'Explicit preview renders the draft');
  const savedPreview = await preview.innerText();
  await input.fill(secondDraft);
  await choose('theme', 'dark');
  await choose('language', 'zh');
  assert.equal(await input.inputValue(), secondDraft, 'Theme and language retain the newer draft');
  assert.equal(await preview.innerText(), savedPreview, 'Changing a draft never implicitly replaces its preview');
  await page.locator('[data-sample-preview]').click();
  assert.ok((await preview.innerText()).includes('Only explicit preview'), 'Explicit action replaces the prior preview');
  check('Drafts survive theme/language/width changes; only the explicit preview action updates rendered content');

  const editing = specimen('editing');
  const preservedPreview = await preview.innerText();
  await editing.getByRole('button', { name: '删除样本', exact: true }).click();
  assert.match(await editing.locator('[role="status"]').innerText(), /没有写入画布/);
  assert.equal(await page.locator('[data-specimen]').count(), 4, 'The danger sample does not delete a specimen');
  assert.equal(await input.inputValue(), secondDraft, 'The danger sample does not delete the draft');
  assert.equal(await preview.innerText(), preservedPreview, 'The danger sample does not delete the preview');
  const disabled = editing.locator('button:disabled');
  assert.equal(await disabled.count(), 2, 'Disabled and busy examples use native disabled buttons');
  const statusBefore = await editing.locator('[role="status"]').innerText();
  for (const button of await disabled.all()) {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await button.evaluate(element => element.click());
  }
  assert.equal(await page.evaluate(() => window.__designAudit.disabledClicks), 0, 'Native disabled buttons emit no click');
  assert.equal(await editing.locator('[role="status"]').innerText(), statusBefore, 'Disabled examples leave status untouched');
  check('Danger is a status-only sample; disabled and busy buttons cannot dispatch clicks');

  await input.click();
  await page.keyboard.press('Tab');
  const focus = await page.locator('[data-sample-preview]').evaluate(element => {
    const css = getComputedStyle(element);
    return { focused: document.activeElement === element, visible: element.matches(':focus-visible'),
      style: css.outlineStyle, width: parseFloat(css.outlineWidth), color: css.outlineColor };
  });
  assert.equal(focus.focused, true, 'Tab from the input reaches the explicit preview action');
  assert.equal(focus.visible, true, 'Keyboard focus matches :focus-visible');
  assert.ok(focus.width >= 2 && focus.style !== 'none' && focus.color !== 'rgba(0, 0, 0, 0)', JSON.stringify(focus));
  await page.locator('[data-choice="language"] input[value="zh"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-choice="language"] input[value="en"]').isChecked(), true, 'Radio choices support arrow-key navigation');
  const radioFocus = await page.locator('[data-choice="language"] input[value="en"]').evaluate(element => {
    const css = getComputedStyle(element.nextElementSibling);
    return { focused: document.activeElement === element, width: parseFloat(css.outlineWidth), style: css.outlineStyle };
  });
  assert.ok(radioFocus.focused && radioFocus.width >= 2 && radioFocus.style !== 'none', JSON.stringify(radioFocus));
  check('Keyboard navigation exposes a visible button focus ring and a visible segmented-choice focus boundary');

  for (const windowWidth of [320, 390]) {
    await page.setViewportSize({ width: windowWidth, height: 1000 });
    for (const language of ['zh', 'en']) {
      await choose('language', language);
      for (const theme of ['light', 'dark']) {
        await choose('theme', theme);
        for (const width of ['320', '380', '520']) {
          await choose('preview-width', width);
          measurements.push({ label: `viewport-${windowWidth}/${language}/${theme}/${width}`, layout: await layout(`viewport-${windowWidth}/${language}/${theme}/${width}`) });
        }
      }
    }
    assert.equal(await input.inputValue(), secondDraft, 'Resizing retains input');
    await screenshot(`narrow-english-${windowWidth}`);
  }
  check('Real 320px and 390px windows fit all preview settings in both languages/themes, with usable controls and retained drafts');
  check('Desktop and narrow document scrolling reveals the final geometry specimen, including in full-page captures');

  const audit = await page.evaluate(async () => ({ ...window.__designAudit,
    localStorageKeys: Object.keys(localStorage), sessionStorageKeys: Object.keys(sessionStorage),
    databases: await indexedDB.databases() }));
  assert.deepEqual(audit.storageWrites, [], 'The sample never writes browser storage');
  assert.deepEqual(audit.databaseOpens, [], 'The sample never initializes an application database');
  assert.deepEqual(audit.databaseWrites, [], 'The sample never writes IndexedDB');
  assert.deepEqual(audit.localStorageKeys, []);
  assert.deepEqual(audit.sessionStorageKeys, []);
  assert.deepEqual(audit.databases, []);
  assert.deepEqual(requests, [], 'No API or external requests originate from the reference');
  assert.deepEqual(dialogs, [], 'No native confirmation or destructive dialog opens');
  assert.deepEqual(errors, [], 'The sample has no page errors');
  check('The isolated sample issues no API requests, opens no app database, writes no browser storage, and raises no page errors');
  await writeFile(`${output}/results.json`, JSON.stringify({ url: sampleUrl.href, checks, measurements, focus, radioFocus, audit, requests, dialogs, errors }, null, 2));
  console.log(`PASS ${checks.length} design reference groups; screenshots and measurements in ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  const audit = await page.evaluate(() => window.__designAudit).catch(() => null);
  await writeFile(`${output}/results.json`, JSON.stringify({ url: sampleUrl.href, checks, measurements, audit, requests, dialogs, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
