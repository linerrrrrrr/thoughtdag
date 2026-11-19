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
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__thoughtdag_storage')) return route.abort();
      return route.continue();
    });
    await context.addInitScript(() => {
      localStorage.setItem('thoughtdag.seeded', 'yes');
      localStorage.setItem('thoughtdag.tutorialDone', '1');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?lang=' + lang);
    await page.waitForFunction(() => window.__store?.persist.hasHydrated() && !!window.__rf && !!window.__ui);
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
    const card = id => page.locator('.react-flow__node[data-id="' + id + '"]');
    const label = id => card(id).locator('[data-node-number]');
    for (const [level, zoom] of [['full', 1], ['summary', 0.65], ['compact', 0.35]]) {
      await page.evaluate(async ([level, zoom]) => {
        window.__ui.getState().setCanvasDetail(level);
        await window.__rf.setViewport({ x: 20, y: 15, zoom }, { duration: 0 });
      }, [level, zoom]);
      await card('file-a').locator('[data-node-detail-level="' + level + '"]').waitFor();
      for (const [id, number] of [['file-a', 3], ['file-b', 12], ['question', 13]]) {
        assert.equal(await label(id).innerText(), '#' + number);
        const hint = await label(id).getAttribute('data-tooltip');
        assert.ok(hint.includes('#' + number) && hint.includes(lang === 'zh' ? '提问' : 'question'));
        assert.ok(await label(id).evaluate(el => {
          const b = el.getBoundingClientRect(), p = el.closest('.react-flow__node').getBoundingClientRect();
          return b.width > 5 && b.height > 4 && b.left >= p.left && b.right <= p.right + 1;
        }), id + ' label fits in ' + level);
      }
      assert.equal(await label('frame').count(), 0);
      await page.screenshot({ path: out + '/' + lang + '-' + level + '.png' });
    }
    assert.deepEqual(errors, []);
    console.log('PASS distinct file and conversation numbers, frame exclusion and label fit in three detail levels (' + lang + ', ' + colorScheme + ')');
    await context.close();
  }
} finally {
  await browser.close();
}
