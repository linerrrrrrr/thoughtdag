// Isolated UI checks: no production profile, no API writes or model calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, locale: 'zh-CN' });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const check = name => console.log('PASS', name);
try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5189', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__ui);
  await page.evaluate(() => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
  });
  const trigger = page.locator('[data-toolbar-more]');
  await trigger.click();
  await page.locator('[data-wheel-pans]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[data-wheel-pans]').waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  check('menu Escape restores its trigger even when the trigger is inside its boundary');

  await trigger.click();
  await page.locator('[data-wheel-pans]').waitFor();
  await page.locator('[data-project-switcher] button').first().focus();
  await page.locator('[data-wheel-pans]').waitFor({ state: 'detached' });
  check('focus leaving a menu closes it without stealing the new focus');

  await trigger.focus();
  await page.evaluate(() => window.__ui.getState().setTutorialOpen(true));
  const tutorial = page.getByRole('dialog');
  await tutorial.waitFor();
  assert.ok(await tutorial.evaluate(el => el.contains(document.activeElement)));
  await page.evaluate(() => window.__ui.setState({ confirmRequest: {
    title: 'Nested confirmation', message: 'Only the top layer closes', danger: true,
    resolve: result => { window.__confirmResult = result; },
  } }));
  await page.getByRole('alertdialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__ui.getState().tutorialOpen), true);
  assert.equal(await page.evaluate(() => window.__confirmResult), false);
  await page.keyboard.press('Escape');
  await tutorial.waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  check('nested Escape closes one layer, restores parent focus, then returns to the invoker');

  await page.evaluate(() => window.__ui.getState().setThoughtMapOpen(true));
  const title = page.locator('[data-tmap-title]');
  await title.fill('Retained map draft');
  await page.mouse.click(10, 500);
  await title.waitFor({ state: 'detached' });
  await page.evaluate(() => window.__ui.getState().setThoughtMapOpen(true));
  assert.equal(await title.inputValue(), 'Retained map draft');
  await page.keyboard.press('Escape');
  check('map export form preserves its draft on outside dismissal and reopen');

  await page.evaluate(() => window.__ui.getState().setApiKeyModalOpen(true));
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
  assert.equal(await page.evaluate(() => window.__ui.getState().apiKeyModalOpen), true);
  assert.equal(await dialog.getAttribute('aria-modal'), null);
  assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
  const configBox = await dialog.boundingBox();
  const toolbarBox = await page.locator('[data-canvas-header]').boundingBox();
  assert.equal(configBox.width, 320);
  assert.ok(configBox.y >= toolbarBox.y + toolbarBox.height + 15);
  await page.keyboard.press('Escape');
  check('IME Escape is ignored and model configuration opens as a focused non-modal tool below the toolbar');

  await page.evaluate(() => {
    window.__store.getState().setNodes([{ id: 'layer-reader', type: 'thought', position: { x: 0, y: 0 }, data: {
      question: 'Reader fixture', response: '', responses: [], responseIndex: 0, stepKind: 'file', isRoot: true,
      isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 0, highlights: [],
      attachments: [{ id: 'pdf-fixture', name: 'Fixture.pdf', type: 'application/pdf', content: '', size: 0, extractedText: 'Original extracted text' }],
    } }]);
    window.__store.getState().setEdges([]);
    window.__ui.getState().setReaderMode('full');
    window.__ui.getState().setReaderNodeId('layer-reader');
  });
  const editToggle = page.locator('[data-reader-edit-toggle]');
  const editor = page.locator('[data-reader-text-editor] textarea');
  const extracted = () => page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'layer-reader').data.attachments[0].extractedText);
  await editToggle.click();
  await editor.fill('Suspended OCR draft');
  await page.locator('[data-reader-wholeask]').click();
  await editor.waitFor({ state: 'detached' });
  assert.equal(await extracted(), 'Original extracted text');
  await editToggle.click();
  assert.equal(await editor.inputValue(), 'Suspended OCR draft');
  await editor.press('Escape');
  assert.equal(await page.evaluate(() => window.__ui.getState().readerNodeId), 'layer-reader');
  await editToggle.click();
  assert.equal(await editor.inputValue(), 'Original extracted text');
  await editor.fill('Explicitly saved OCR');
  await editToggle.click();
  await editor.waitFor({ state: 'detached' });
  assert.equal(await extracted(), 'Explicitly saved OCR');
  await page.keyboard.press('Escape');
  check('reader text suspends without saving, Escape cancels only its edit, and toolbar Save survives blur');

  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log('6 layer checks passed; no API writes or page errors.');
} catch (error) {
  await mkdir('local-tests/layer-dismiss', { recursive: true });
  await page.screenshot({ path: 'local-tests/layer-dismiss/failure.png' });
  throw error;
} finally { await browser.close(); }

