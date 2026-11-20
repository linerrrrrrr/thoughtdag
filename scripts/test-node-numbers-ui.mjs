// Run against an isolated development server with disk storage disabled.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5293').origin;
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const out = 'local-tests/node-numbers';
  await mkdir(out, { recursive: true });
  for (const [lang, colorScheme] of [['zh', 'light'], ['en', 'dark']]) {
    const context = await browser.newContext({ locale: lang, colorScheme, viewport: { width: 1380, height: 800 } });
    await context.routeWebSocket('**', socket => socket.close());
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__thoughtdag_storage')) return route.abort();
      return route.continue();
    });
    await context.addInitScript(lighting => {
      localStorage.setItem('thoughtdag.seeded', 'yes');
      localStorage.setItem('thoughtdag.tutorialDone', '1');
      localStorage.setItem('thoughtdag.lighting', lighting);
      window.numberCopies = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async text => { window.numberCopies.push(text); } },
      });
    }, colorScheme);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?lang=' + lang);
    await page.waitForFunction(() => window.__store?.persist.hasHydrated() && !!window.__rf && !!window.__ui);
    assert.equal(await page.locator('html').getAttribute('data-theme'), colorScheme);
    await page.evaluate(() => {
      const data = { question: '', response: '', responses: [], responseIndex: -1, isLoading: false, isEditing: false,
        isEditingResponse: false, isCollapsed: false, tokenCount: 0, highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [] };
      const nodes = ['file-a', 'file-b', 'question', 'frame'].map((id, i) => ({
        id, type: 'thought', position: { x: 95 + (i % 2) * 470, y: 120 + Math.floor(i / 2) * 310 }, width: 430,
        data: id.startsWith('file') ? { ...data, nodeNumber: i ? 12 : 3, stepKind: 'file', attachments: [
          { id: 'attachment-' + id, name: 'plan.txt', type: 'text/plain', size: 4, content: 'text' }] }
          : { ...data, stepKind: id === 'frame' ? 'frame' : undefined, question: id === 'frame' ? 'Group' : 'Review plan' },
      }));
      window.__store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
      window.__ui.getState().setTutorialOpen(false);
      window.__ui.getState().setReleaseNotesOpen(false);
      window.__ui.getState().setPanelOpen(false);
    });
    // Adding the fixture schedules a 400ms camera animation to its last node.
    await page.waitForFunction(() => window.__store.getState().nodes[0]?.measured?.height);
    await page.waitForTimeout(600);
    const card = id => page.locator('.react-flow__node[data-id="' + id + '"]');
    const menu = page.locator('body > [data-selection-menu]');
    const action = menu.getByRole('button', { name: lang === 'zh' ? /复制节点编号/ : /Copy node number/i });
    const copies = () => page.evaluate(() => window.numberCopies);
    const expectedCopies = [];
    const levels = [['full', 1], ['summary', 0.65], ['compact', 0.35]];
    async function setLevel(level, zoom) {
      await page.evaluate(async ([level, zoom]) => {
        window.__ui.getState().setCanvasDetail(level);
        await window.__rf.setViewport({ x: 20, y: 15, zoom }, { duration: 0 });
      }, [level, zoom]);
    }
    async function checkNumber(id, number, level) {
      const surface = card(id).locator('[data-node-detail-level="' + level + '"]');
      await surface.waitFor();
      assert.doesNotMatch(await surface.innerText(), /#\d+/, id + ' in ' + level);
      await surface.click({ button: 'right', position: { x: 16, y: 10 } });
      await action.waitFor();
      assert.ok((await action.innerText()).includes('#' + number));
      assert.deepEqual(await copies(), expectedCopies, 'Opening the menu leaves the clipboard alone');
      if (!expectedCopies.length) await page.screenshot({ path: out + '/' + lang + '-menu.png', animations: 'disabled' });
      await action.click();
      await menu.waitFor({ state: 'hidden' });
      expectedCopies.push('#' + number);
      assert.deepEqual(await copies(), expectedCopies);
    }
    for (const [level, zoom] of levels) {
      await setLevel(level, zoom);
      for (const [id, number] of [['file-a', 3], ['file-b', 12], ['question', 13]]) {
        await checkNumber(id, number, level);
      }
      await page.screenshot({ path: out + '/' + lang + '-' + level + '.png' });
    }
    await card('file-a').locator('[data-node-detail-level="compact"]').click({ button: 'right', position: { x: 16, y: 10 } });
    await action.waitFor();
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await card('file-b').locator('[data-node-detail-level="compact"]').click({ button: 'right', position: { x: 16, y: 10 } });
    await action.waitFor();
    await page.mouse.click(1250, 700);
    await menu.waitFor({ state: 'hidden' });
    assert.deepEqual(await copies(), expectedCopies, 'Dismissing a menu never copies');
    const frame = card('frame').locator('[data-frame-header]');
    assert.doesNotMatch(await frame.innerText(), /#\d+/);
    await frame.click({ button: 'right' });
    await menu.waitFor();
    assert.equal(await action.count(), 0, 'Frames have no node number');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__projects.setState(s => ({
      projects: s.projects.map(p => p.id === s.activeId ? { ...p, kind: 'paradigm' } : p),
    })));
    await card('question').locator('[data-node-paradigm]').waitFor();
    for (const [level, zoom] of levels) {
      await setLevel(level, zoom);
      await checkNumber('question', 13, level);
    }
    assert.deepEqual(errors, []);
    console.log('PASS hidden numbers, copy from file/conversation/paradigm menus at all detail levels, frame exclusion and dismissal (' + lang + ', ' + colorScheme + ')');
    await context.close();
  }
} finally {
  await browser.close();
}
