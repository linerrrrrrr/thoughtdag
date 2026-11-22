// Reduced node representations share screen UI density; full cards keep canvas units.
// Isolated browser storage and fixtures. No live project or model writes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { documentBrowser } from './fixtures/original-file-browser.mjs';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/overview-presentation';
await mkdir(output, { recursive: true });
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5201';
const { context, close } = await documentBrowser(appUrl, { executablePath, viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const root = id => page.locator('.react-flow__node[data-id="' + id + '"] > [data-node-detail-level]');
const near = (actual, expected, label, tolerance = .7) => assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
const settle = () => page.waitForTimeout(100);
const zoom = async value => {
  await page.evaluate(value => window.__rf.setViewport({ x: 100, y: 110, zoom: value }, { duration: 0 }), value);
  await page.waitForFunction(value => {
    const canvas = document.querySelector('.react-flow');
    const viewport = document.querySelector('.react-flow__viewport');
    return Math.abs(new DOMMatrix(getComputedStyle(viewport).transform).a - value) < .0001
      && Math.abs(parseFloat(getComputedStyle(canvas).getPropertyValue('--tdag-zoom')) - value) < .0001;
  }, value);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const preference = async value => {
  await page.evaluate(value => window.__ui.getState().setCanvasDetail(value), value);
  await settle();
};
const seed = async (cases, preference = 'compact') => {
  await page.evaluate(({ cases, preference }) => {
    window.__ui.setState({ canvasDetail: preference, panelOpen: false, readerNodeId: null });
    const nodes = cases.map(({ id, data = {}, ...props }) => ({
      id, type: 'thought', position: { x: 0, y: 0 }, width: 520, height: 600, dragHandle: '.drag-handle',
      ...props, data: { ...window.__overviewData, ...data },
    }));
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], staleIds: [],
      history: [{ nodes, edges: [] }], historyIndex: 0 });
  }, { cases, preference });
  await root(cases[0].id).waitFor();
  await settle();
};
const expectDetail = async (id, detail) => {
  await page.waitForFunction(({ id, detail }) => document.querySelector('.react-flow__node[data-id="' + id + '"] > [data-node-detail-level]')?.dataset.nodeDetailLevel === detail, { id, detail });
};
const dataSnapshot = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position, width, height, data }) => ({ id, position, width, height, data })));

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui && window.__projects);
  await page.evaluate(() => {
    window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse()
      .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
    const response = '完整内容保持原样，概览只负责呈现名称和摘要。'.repeat(300);
    window.__overviewData = { question: '中英文混合的长名称 Long label with URL https://example.test/a-long-unbroken-path',
      displayName: '中英文混合的长名称 Long label', displaySummary: '摘要保持可读。Summary with https://example.test/a-long-unbroken-path',
      response, responses: [response], responseIndex: 0, tokenCount: 1000000,
      highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      isLoading: false, isCollapsed: false, isEditing: false, isEditingResponse: false, keepOverviewHeight: true };
    window.__ui.setState({ tutorialOpen: false, releaseNotesOpen: false });
  });
  const cases = [
    { id: 'thought' },
    { id: 'thought-natural', height: undefined },
    { id: 'collapsed', data: { isCollapsed: true } },
    { id: 'archived', data: { archived: true, model: 'research/model-long-name', condensedFrom: ['thought'] } },
    { id: 'panel-editor', data: { isEditing: true, questionEditor: 'panel' } },
    { id: 'note', data: { stepKind: 'note' } },
    { id: 'file', data: { stepKind: 'file', attachments: [
      { id: 'csv', name: 'data.csv', type: 'text/csv', size: 3, content: 'a,b' },
      { id: 'pdf', name: '资料.pdf', type: 'application/pdf', size: 0, content: '' },
    ] } },
    { id: 'native-idle', data: { stepKind: 'file', attachments: [
      { id: 'native', name: '文档.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 0, content: '' },
    ] } },
    { id: 'link', data: { stepKind: 'link', linkTitle: '链接材料', linkUrl: 'https://example.test/article' } },
    { id: 'human', data: { stepKind: 'human' } },
    { id: 'prompt', data: { stepKind: 'prompt' } },
  ];
  await seed(cases);
  await page.waitForTimeout(350);
  let measured = 0;
  for (const lang of ['zh', 'en']) {
    await page.evaluate(async lang => (await window.__importLive('/src/i18n/index.ts')).useI18n.getState().setLang(lang), lang);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async theme => (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme), theme);
      for (const detail of ['compact', 'summary']) {
        await preference(detail);
        for (const width of [280, 520, 960]) {
          await page.evaluate(width => window.__store.setState(s => ({ nodes: s.nodes.map(n => ({ ...n, width })) })), width);
          const snapshot = await dataSnapshot();
          for (const value of [.04, .22, .32, .7, 1.5, 2.5]) {
            await zoom(value);
            const metrics = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node > [data-node-detail-level]')].map(card => {
              const name = card.querySelector('[data-node-name]');
              const box = card.getBoundingClientRect();
              const rf = card.parentElement.getBoundingClientRect();
              const text = name.getBoundingClientRect();
              const action = card.querySelector('[data-node-details]');
              const actionBox = action?.getBoundingClientRect();
              const style = getComputedStyle(card);
              const overflow = [...card.querySelectorAll('button, [data-node-name], [data-node-preview], .node-overview-identity, .node-token-usage')]
                .filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height)
                .filter(e => { const r = e.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; })
                .map(e => e.className);
              return { id: card.parentElement.dataset.id, detail: card.dataset.nodeDetailLevel,
                font: parseFloat(getComputedStyle(name).fontSize) * text.height / name.offsetHeight,
                radius: parseFloat(style.borderTopRightRadius) * window.__rf.getZoom(),
                action: actionBox?.height, icon: action?.querySelector('svg').getBoundingClientRect().width,
                height: box.height, wrapperHeight: rf.height, width: box.width, overflow };
            }));
            assert.equal(metrics.length, cases.length, 'All node dispatch branches are mounted');
            const scale = Math.min(1, value / (detail === 'compact' ? .22 : .32));
            for (const m of metrics) {
              const label = [lang, theme, detail, width, value, m.id].join('/');
              assert.equal(m.detail, detail, label);
              near(m.font, (detail === 'compact' ? 14 : 16) * .75 * scale, label + ' type role');
              near(m.radius, (detail === 'compact' ? 15 : 14) * .75 * scale, label + ' corner');
              near(m.width, width * value, label + ' saved width');
              near(m.height, m.wrapperHeight, label + ' visible geometry');
              assert.deepEqual(m.overflow, [], label + ' content stays within the card');
              if (m.action != null) {
                near(m.action, 32 * .75 * scale, label + ' hit area');
                near(m.icon, 16 * .75 * scale, label + ' icon');
              }
              measured++;
            }
            near(metrics.find(m => m.id === 'thought').height, metrics.find(m => m.id === 'thought-natural').height, 'Saved height never pads an overview');
          }
          assert.deepEqual(await dataSnapshot(), snapshot, 'Appearance and zoom do not mutate stored cards');
        }
      }
    }
  }
  console.log('PASS ' + measured + ' measured overview combinations: kinds, detail, width, zoom, language and theme');

  // Per-node locks override the global preference, with full detail unscaled.
  await seed([{ id: 'locked', data: { detailLevel: 'full', isCollapsed: true } }], 'compact');
  for (const value of [.25, .7, 1.5]) {
    await zoom(value);
    await expectDetail('locked', 'full');
    assert.equal(await root('locked').getAttribute('data-node-overview-surface'), null);
    near((await root('locked').boundingBox()).height, 600 * value, 'Full detail retains its saved height', 2);
  }
  for (const detail of ['compact', 'summary']) {
    await seed([{ id: 'locked', data: { detailLevel: detail } }], 'full');
    await zoom(1.5);
    await expectDetail('locked', detail);
  }
  await seed([{ id: 'auto' }], 'auto');
  for (const [value, detail] of [[.25, 'compact'], [.7, 'summary'], [1, 'full'], [.7, 'summary'], [.25, 'compact']]) {
    await zoom(value);
    await expectDetail('auto', detail);
  }
  await seed([{ id: 'collapsed', data: { isCollapsed: true } }], 'auto');
  await zoom(1.5);
  await expectDetail('collapsed', 'summary');
  console.log('PASS automatic tiers, local/global locks, full geometry and manual collapse');

  const protectedCases = [
    { id: 'question-editor', data: { isEditing: true, questionEditor: 'node', isCollapsed: true } },
    { id: 'answer-editor', data: { isEditingResponse: true, responseEditor: 'node', isCollapsed: true } },
    { id: 'approval', data: { isLoading: true, executionKind: 'codex', pendingApprovals: [
      { id: 'p', kind: 'confirm', toolName: 'codex', name: 'Confirm', query: 'Read fixture', arguments: null, askedAt: new Date().toISOString() },
    ] } },
    { id: 'workflow-human', data: { stepKind: 'human', question: '', response: '', responses: [] } },
    { id: 'workflow-prompt', data: { stepKind: 'prompt', response: '', responses: [] } },
  ];
  for (const fixture of protectedCases) {
    await seed([fixture]);
    await zoom(.25);
    await expectDetail(fixture.id, 'full');
    assert.equal(await root(fixture.id).getAttribute('data-node-overview-surface'), null);
  }
  for (const fixture of [
    { id: 'empty-file', data: { stepKind: 'file', attachments: [] } },
    { id: 'loading-link', data: { stepKind: 'link', question: '', linkUrl: 'https://example.test' } },
    { id: 'failed-link', data: { stepKind: 'link', linkTitle: '⚠ Fetch failed', linkUrl: 'https://example.test' } },
  ]) {
    await seed([fixture], 'summary'); await expectDetail(fixture.id, 'full');
    await preference('compact'); await expectDetail(fixture.id, 'compact');
  }
  await seed([{ id: 'empty-note', data: { stepKind: 'note', question: '' } }]);
  await expectDetail('empty-note', 'full');
  console.log('PASS active editors, approvals, workflow input, empty materials and link retry branches');

  // Metadata edits use their existing draft/explicit save lifecycle.
  await seed([{ id: 'metadata' }], 'summary');
  await zoom(.7);
  await root('metadata').locator('[data-node-metadata-toggle]').click();
  await expectDetail('metadata', 'full');
  await root('metadata').locator('[data-node-title-input]').fill('未提交的名称');
  await zoom(.25);
  await expectDetail('metadata', 'full');
  await page.mouse.click(1100, 700);
  await expectDetail('metadata', 'summary');
  await zoom(.7);
  await root('metadata').locator('[data-node-metadata-toggle]').click();
  assert.equal(await root('metadata').locator('[data-node-title-input]').inputValue(), '未提交的名称');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__store.getState().nodes[0].data.displayName), '中英文混合的长名称 Long label');
  console.log('PASS overview/edit transitions preserve drafts and Escape does not submit');

  // Template cards use the same shell, including saved dimensions and focus protection.
  await page.evaluate(() => window.__projects.setState(s => ({ projects: s.projects.map(p => p.id === s.activeId ? { ...p, kind: 'paradigm' } : p) })));
  await seed([{ id: 'template', data: { stepKind: 'prompt', instruction: '模板说明 '.repeat(20) } }], 'summary');
  await zoom(.7);
  await expectDetail('template', 'summary');
  assert.ok((await root('template').boundingBox()).height < 300, 'Template summary does not inherit 600px height');
  await root('template').locator('.drag-handle').dblclick();
  await expectDetail('template', 'full');
  await zoom(.25);
  await expectDetail('template', 'full');
  await page.mouse.click(1100, 700);
  await expectDetail('template', 'summary');
  await preference('compact');
  await expectDetail('template', 'compact');
  assert.equal(await root('template').evaluate(el => getComputedStyle(el).borderStyle), 'dashed');
  await page.evaluate(() => window.__projects.setState(s => ({ projects: s.projects.map(p => p.id === s.activeId ? { ...p, kind: undefined } : p) })));
  console.log('PASS template overview, single outline and editing protection');

  // Native document idle/active/dirty branches, using a real local DOCX fixture.
  const source = await createSuperdocFixture('OVERVIEW');
  const attachment = { id: 'native-real', name: 'overview.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: source.buffer.length, content: source.buffer.toString('base64'), extractedText: 'OVERVIEW document' };
  await seed([{ id: 'native-real', width: 700, height: 800, data: { stepKind: 'file', attachments: [attachment] } }], 'summary');
  await zoom(.7);
  await expectDetail('native-real', 'summary');
  assert.equal(await page.locator('[data-superdoc-editor]').count(), 0, 'Idle overview does not mount the native editor');
  await preference('full');
  const editor = page.locator('[data-superdoc-editor="native-real"]');
  await page.waitForFunction(() => document.querySelector('[data-superdoc-editor="native-real"]')?.getAttribute('data-superdoc-ready') === 'true', null, { timeout: 60000 });
  await editor.locator('[data-superdoc-scroll]').click({ position: { x: 180, y: 160 } });
  await editor.locator('[data-superdoc-scroll]').evaluate(element => element.__docxSession.instance.focus({ preventScroll: true }));
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Overview draft');
  await page.waitForFunction(() => document.querySelector('[data-superdoc-editor]')?.getAttribute('data-superdoc-dirty') === 'true');
  await preference('compact'); await zoom(.25);
  await expectDetail('native-real', 'full');
  await page.evaluate(async () => (await window.__importLive('/src/lib/docx-session.ts')).activateDocx(null));
  await expectDetail('native-real', 'full');
  await zoom(.7);
  // The floating toolbar may overlap the canvas header at this viewport.
  if (await page.locator('[data-docx-toolbar]').count()) {
    await root('native-real').locator('[data-docx-hide-tools]').click();
  }
  await root('native-real').locator('[data-superdoc-save]').click();
  await expectDetail('native-real', 'compact');
  await preference('summary');
  await expectDetail('native-real', 'summary');
  assert.ok(await page.evaluate(() => !!window.__store.getState().nodes[0].data.attachments[0].editedDocxRevision), 'Only explicit Save persists the native draft');
  console.log('PASS native document idle, active, unsaved, explicit save and return to overview');

  // Reviewable screenshots show the toolbar beside the actual node variants.
  const visualCases = cases.filter(c => !['panel-editor', 'native-idle', 'thought-natural', 'collapsed'].includes(c.id))
    .map((c, i) => ({ ...c, position: { x: (i % 3) * 650, y: Math.floor(i / 3) * 650 }, width: 520 }));
  await seed(visualCases);
  await zoom(.6);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => (await window.__importLive('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme), theme);
    for (const detail of ['compact', 'summary']) {
      await preference(detail);
      await page.screenshot({ path: output + '/' + theme + '-' + detail + '.png' });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await seed([{ id: 'narrow', width: 280 }], 'summary');
  await zoom(.7);
  await page.screenshot({ path: output + '/narrow-summary.png' });
  assert.deepEqual(errors, [], 'No browser errors');
  assert.deepEqual(writes, [], 'No API writes');
} catch (error) {
  await page.screenshot({ path: output + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await close();
}
