// Exercise the real canvas and context compiler in isolated browser storage.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
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
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const output = 'local-tests/context-focus';
await mkdir(output, { recursive: true });
const settle = () => page.waitForTimeout(350);
const select = async ids => {
  await page.evaluate(ids => window.__store.getState().setSelectedNodeIds(ids), ids);
  await settle();
};
const read = () => page.evaluate(() => ({
  edges: Object.fromEntries(window.__rf.getEdges().map(edge => [edge.id, {
    stroke: edge.style?.stroke, opacity: edge.style?.opacity, dash: edge.style?.strokeDasharray,
    role: edge.data?.focusRole,
    renderedStroke: getComputedStyle(document.querySelector(`.react-flow__edge[data-id="${edge.id}"] .react-flow__edge-path`)).stroke,
  }])),
  nodes: Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map(node => [node.dataset.id, {
    classes: node.className, opacity: getComputedStyle(node).opacity,
  }])),
  accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
}));
const theme = async value => {
  await page.evaluate(async value => {
    const path = '/src/lib/appearance.ts';
    const url = [...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path)?.name ?? path;
    (await import(url)).useAppearance.getState().setLighting(value);
  }, value);
  await settle();
};
const capture = async name => {
  await page.evaluate(() => window.__rf.setViewport({ x: 80, y: 120, zoom: 0.7 }, { duration: 0 }));
  await settle();
  await page.screenshot({ path: `${output}/${name}.png` });
};

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5187');
  await page.waitForFunction(() => window.__rf && window.__ui && window.__store?.persist.hasHydrated() && window.__buildContext);
  await page.evaluate(() => {
    const node = (id, x, y, extra = {}) => ({ id, type: 'thought', position: { x, y }, width: 360, height: 210,
      measured: { width: 360, height: 210 }, data: { displayName: id, question: `QUESTION_${id}`, response: `ANSWER_${id}`,
        responses: [`ANSWER_${id}`], responseIndex: 0, isCollapsed: false, isEditing: false, isLoading: false,
        tokenCount: 10, highlights: [], highlightMode: 'off', attachments: [], ...extra } });
    const nodes = [node('ancestor', 40, 20), node('reference', 40, 300), node('target', 510, 300),
      node('child', 980, 300), node('material', 510, 20, { stepKind: 'note' }),
      node('archived', 510, 600, { archived: true }), node('external', 40, 600)];
    const edge = (source, target, reference = false) => ({ id: `${source}-${target}`, source, target, type: 'smoothstep',
      data: reference ? { isCrossLink: true } : {},
      style: { stroke: reference ? '#E08A3C' : '#6B5CE7', strokeWidth: 2, ...(reference ? { strokeDasharray: '8 4' } : {}) },
      markerEnd: { type: 'arrowclosed', color: reference ? '#E08A3C' : '#6B5CE7' } });
    const edges = [edge('ancestor', 'reference'), edge('reference', 'target', true), edge('target', 'child'),
      edge('material', 'target', true), edge('archived', 'target')];
    window.__canvasEditing.getState().reset();
    window.__contextInspection.getState().close();
    window.__store.setState({ nodes, edges, selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges }], historyIndex: 0 });
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__rf.setViewport({ x: 20, y: 80, zoom: 0.76 }, { duration: 0 });
  });
  await settle();
  const before = await page.evaluate(() => ({ edges: window.__store.getState().edges, historyIndex: window.__store.getState().historyIndex }));
  const context = await page.evaluate(() => {
    const { nodes, edges } = window.__store.getState();
    return window.__buildContext('target', nodes, edges).messages.map(message => message.content).join('\n');
  });
  assert.ok(context.includes('QUESTION_reference') && context.includes('QUESTION_material'));
  assert.ok(!context.includes('QUESTION_ancestor') && !context.includes('QUESTION_archived'));

  for (const lighting of ['light', 'dark']) {
    await theme(lighting);
    await select(['target']);
    const single = await read();
    assert.equal(single.edges['reference-target'].role, 'ref');
    assert.equal(single.edges['material-target'].role, 'ref');
    assert.equal(single.edges['reference-target'].stroke, single.accent);
    assert.equal(single.edges['material-target'].stroke, single.accent);
    assert.equal(single.edges['reference-target'].dash, '8 4');
    assert.equal(single.edges['ancestor-reference'].opacity, 0.2);
    assert.equal(single.edges['archived-target'].opacity, 0.2);
    assert.match(single.nodes.reference.classes, /focus-ctx/);
    assert.match(single.nodes.ancestor.classes, /focus-dim/);
    await capture(`${lighting}-single`);

    await select(['target', 'child']);
    const multi = await read();
    assert.equal(multi.edges['target-child'].role, 'path');
    assert.equal(multi.edges['target-child'].stroke, multi.accent);
    assert.equal(multi.edges['reference-target'].role, 'ref');
    assert.equal(multi.edges['reference-target'].stroke, multi.accent);
    assert.equal(multi.edges['reference-target'].renderedStroke, single.edges['reference-target'].renderedStroke);
    assert.equal(multi.edges['material-target'].role, 'ref');
    assert.equal(multi.edges['ancestor-reference'].opacity, 0.2, 'a reference must not forward its own upstream path');
    assert.equal(multi.edges['archived-target'].opacity, 0.2);
    assert.match(multi.nodes.ancestor.classes, /focus-dim/);
    assert.match(multi.nodes.target.classes, /focus-target/);
    assert.match(multi.nodes.child.classes, /focus-target/);
    await capture(`${lighting}-multi`);

    await select(['target', 'reference']);
    const separatelySelected = await read();
    assert.equal(separatelySelected.edges['ancestor-reference'].role, 'path', 'a separately selected reference has its own context');
    assert.equal(separatelySelected.edges['ancestor-reference'].stroke, separatelySelected.accent);
    console.log(`PASS ${lighting}: single and multiple selection share context and purple highlighting`);
  }

  await page.evaluate(() => {
    const state = window.__store.getState();
    const edge = { id: 'external-archived', source: 'external', target: 'archived', type: 'smoothstep',
      data: { isCrossLink: true }, style: { stroke: '#6B5CE7', strokeDasharray: '8 4', strokeWidth: 2 } };
    window.__store.setState({ edges: [...state.edges, edge] });
  });
  await select(['target', 'child']);
  const throughArchived = await read();
  assert.equal(throughArchived.edges['external-archived'].role, 'ref');
  assert.equal(throughArchived.edges['archived-target'].role, 'path');
  const archivedContext = await page.evaluate(() => {
    const { nodes, edges } = window.__store.getState();
    return window.__buildContext('target', nodes, edges).messages.map(message => message.content).join('\n');
  });
  assert.ok(archivedContext.includes('QUESTION_external') && !archivedContext.includes('QUESTION_archived'));
  console.log('PASS live references can flow through archived structural nodes');

  await page.evaluate(() => window.__store.setState({ edges: window.__store.getState().edges.filter(edge => edge.id !== 'external-archived') }));
  await select([]);
  const reset = await read();
  assert.notEqual(reset.edges['reference-target'].stroke, reset.accent, 'clearing selection restores a legacy saved edge color');
  await page.evaluate(() => {
    const state = window.__store.getState();
    state.setEdges(state.edges.map(edge => edge.id === 'target-child' ? { ...edge, selected: true } : edge));
  });
  await settle();
  const selectedLine = await read();
  assert.equal(selectedLine.edges['target-child'].stroke, selectedLine.accent, 'selecting a normal connection keeps its purple color');
  assert.equal(selectedLine.edges['target-child'].renderedStroke, 'rgb(167, 159, 244)');
  await page.evaluate(() => {
    const state = window.__store.getState();
    state.setEdges(state.edges.map(edge => {
      if (edge.id !== 'target-child') return edge;
      const { selected, ...rest } = edge;
      return rest;
    }));
  });
  const after = await page.evaluate(() => ({ edges: window.__store.getState().edges, historyIndex: window.__store.getState().historyIndex }));
  assert.deepEqual(after, before, 'focus must not change stored edges or canvas history');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log('PASS clearing focus restores saved styles without writes or history changes');
} finally {
  await browser.close();
}
