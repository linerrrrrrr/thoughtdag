// Local fixtures verify static status metadata remains a drag surface without popups.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = 'local-tests/node-status';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = [], errors = [], writes = [], narrowGeometry = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
await page.route('**/api/**', route => {
  const request = route.request(), url = new URL(request.url());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ method: request.method(), path: url.pathname });
  if (url.pathname === '/api/models') return route.fulfill({ json: {
    models: [{ id: 'test/status', name: 'Local fixture', provider: 'test', vision: false }], default: 'test/status',
  } });
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [], items: [], hits: [] } });
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lighting', 'light');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

// Fixed ASCII lengths have an unambiguous estimate: 10 + 20 + 80 + 40 = 150.
// The unrelated attachment and stale tokenCount must not inflate this total.
const fixture = {
  displayName: '交付前核查', displaySummary: '核对需求、验证交互，再检查清晰度与边界情况。',
  question: 'What should we inspect before shipping?'.padEnd(40),
  response: 'Check the scope, verify the interaction, and inspect every supported viewport.'.padEnd(80),
  reasonings: ['Inspect the behavior before judging its appearance.'.padEnd(160)],
  tokenCount: 9999,
  generatedBy: ['test/long-model-name-for-header-overflow-checks'],
  attachments: [
    { id: 'read', name: 'tool: Read', type: 'text/plain', size: 120, content: 'Read the interaction contract.'.padEnd(120) },
    { id: 'shell', name: 'tool: Bash', type: 'text/plain', size: 200, content: 'The build and UI checks passed.'.padEnd(200) },
    { id: 'ordinary', name: 'notes.txt', type: 'text/plain', size: 4000, content: 'Ordinary attachment outside the turn estimate.'.padEnd(4000) },
  ],
  excludedAttachmentIds: ['shell'],
};
const node = () => page.locator('.react-flow__node[data-id="status-a"]');
const usage = () => node().locator('[data-node-token-usage]');
const bar = () => usage().locator('[data-comp-bar]');
const tip = () => page.getByRole('tooltip');
const check = label => { checks.push(label); console.log('PASS', label); };
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const patch = async values => {
  await page.evaluate(values => window.__store.setState(state => ({
    nodes: state.nodes.map(item => item.id === 'status-a'
      ? { ...item, ...values.node, data: { ...item.data, ...values.data } } : item),
  })), values);
  await settle();
};
const snapshotData = () => page.evaluate(() => JSON.stringify(window.__store.getState().nodes[0].data));
const screenshot = async name => { await settle(); await page.screenshot({ path: `${output}/${name}.png` }); };
const lighting = value => page.evaluate(async value => (await import('/src/lib/appearance.ts')).useAppearance.getState().setLighting(value), value);
const language = async value => {
  // Drive the actual UI store; a bare dynamic import can create a second
  // module instance when Vite has timestamped the live i18n module for HMR.
  await page.locator('[data-toolbar-more]').click();
  await page.locator('[data-toolbar-more-panel]').getByRole('button', { name: value === 'en' ? 'English' : '中文', exact: true }).click();
  if (await page.locator('[data-toolbar-more-panel]').count()) await page.keyboard.press('Escape');
  await settle();
};
const reset = async () => {
  await page.mouse.move(1300, 850);
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.__store.setState(state => ({
      nodes: state.nodes.map(item => ({ ...item, selected: false, position: { x: 0, y: 0 } })),
      selectedNodeId: null, selectedNodeIds: [],
    }));
    window.__rf.setViewport({ x: 120, y: 160, zoom: 1 }, { duration: 0 });
  });
  await settle();
};
const center = async locator => {
  const rect = await locator.boundingBox();
  assert.ok(rect, 'Drag target must be visible');
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};
const drag = async (label, point) => {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(400);
  assert.equal(await tip().count(), 0, `${label} has no hover window`);
  await page.mouse.down();
  await tip().waitFor({ state: 'detached' });
  await page.mouse.move(point.x + 72, point.y + 36, { steps: 12 });
  await page.mouse.up();
  await settle();
  const position = await page.evaluate(() => window.__store.getState().nodes[0].position);
  // React Flow starts after its drag threshold; the first sampled movement
  // can be consumed before the node receives the remaining displacement.
  assert.ok(position.x >= 64 && position.x <= 74 && position.y >= 31 && position.y <= 38,
    `${label} should drag by 72,36; received ${JSON.stringify(position)}`);
  check(`${label} starts header drag without opening a tooltip or consuming the gesture`);
};
const within = async (child, parent, label) => {
  const c = await child.boundingBox(), p = await parent.boundingBox();
  assert.ok(c && p && c.x >= p.x - 1 && c.x + c.width <= p.x + p.width + 1,
    `${label} extends outside its parent: ${JSON.stringify({ child: c, parent: p })}`);
};
const assertNarrow = async label => {
  const dimensions = await node().locator('.thought-node').evaluate(element => {
    const item = window.__store.getState().nodes.find(item => item.id === 'status-a');
    const rect = element.getBoundingClientRect();
    return { storedWidth: item.width, measuredWidth: item.measured?.width, screenWidth: rect.width,
      zoom: window.__rf.getZoom(), inlineWidth: element.style.width, computedWidth: getComputedStyle(element).width };
  });
  assert.equal(dimensions.storedWidth, 360, `${label}: ${JSON.stringify(dimensions)}`);
  assert.ok(Math.abs(dimensions.zoom - 1) < .001, `${label}: ${JSON.stringify(dimensions)}`);
  assert.ok(Math.abs(dimensions.screenWidth - 360) <= 3, `${label}: ${JSON.stringify(dimensions)}`);
  narrowGeometry.push({ label, ...dimensions });
};
const assertStatusLayout = async () => {
  const total = await usage().locator('[data-node-token-total]').boundingBox();
  const tools = await usage().locator('[data-tool-marks]').boundingBox();
  const composition = await bar().boundingBox();
  assert.ok(total && tools && composition);
  assert.ok(Math.abs(total.y + total.height / 2 - tools.y - tools.height / 2) <= 2, 'Tokens and tool count share one row');
  assert.ok(tools.x >= total.x + total.width && tools.x - total.x - total.width <= 16, 'Tool count directly follows tokens');
  assert.ok(composition.y >= Math.max(total.y + total.height, tools.y + tools.height), 'Composition bar sits below both labels');
  assert.ok(composition.x <= total.x + 1 && composition.x + composition.width >= tools.x + tools.width - 1, 'Composition bar spans the label group');
};
const assertGradient = async (label, boundaries) => {
  const image = await bar().evaluate(element => getComputedStyle(element).backgroundImage);
  assert.match(image, /^linear-gradient\(/, `${label}: the composition uses one valid painted background`);
  assert.equal(await bar().locator(':scope > *').count(), 0, `${label}: no independently painted segments`);
  // Browsers may serialize each two-position color stop as one entry or as
  // two repeated colors. Normalize both forms before checking hard edges.
  const stops = [...image.matchAll(/(rgba?\([^)]*\))\s+([\d.]+)%(?:\s+([\d.]+)%)?/g)]
    .flatMap(match => [match[2], match[3]].filter(value => value !== undefined)
      .map(value => ({ color: match[1], position: Number(value) })));
  const expected = boundaries.slice(0, -1).flatMap((start, index) => [start, boundaries[index + 1]]);
  assert.equal(stops.length, expected.length, `${label}: ${image}`);
  for (let index = 0; index < stops.length; index++) {
    assert.ok(Math.abs(stops[index].position - expected[index]) < .002,
      `${label}: stop ${index} must use the shared cumulative denominator: ${image}`);
    if (index % 2 === 1) assert.equal(stops[index].color, stops[index - 1].color, `${label}: each part is solid, without blending`);
  }
  assert.equal(new Set(stops.map(stop => stop.color)).size, boundaries.length - 1, `${label}: only nonzero parts receive colors`);
};

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5201', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  assert.equal(await page.evaluate(() => window.__store.getState().nodes.length), 0);
  await page.evaluate(fixture => {
    window.__ui.getState().setTutorialOpen(false);
    window.__ui.getState().setReleaseNotesOpen(false);
    window.__ui.getState().setPanelOpen(false);
    window.__ui.getState().setCanvasDetail('full');
    const nodes = [{ id: 'status-a', type: 'thought', dragHandle: '.drag-handle', width: 650, height: 650,
      position: { x: 0, y: 0 }, data: {
        ...fixture, responses: [fixture.response], responseIndex: 0, detailLevel: 'full', isCollapsed: false,
        isEditing: false, isEditingResponse: false, isLoading: false, highlights: [], highlightMode: 'tag',
        includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false,
      } }];
    window.__store.setState({ nodes, edges: [], selectedNodeId: null, selectedNodeIds: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
  }, fixture);
  await usage().waitFor();
  await page.waitForTimeout(400);
  await reset();
  await node().locator('.thought-node-header').screenshot({ path: `${output}/light-status-header.png` });
  assert.match(await usage().innerText(), /150\s+tokens/);
  await assertStatusLayout();
  await assertGradient('Four-part turn', [0, 10 / 150 * 100, 30 / 150 * 100, 110 / 150 * 100, 100]);
  assert.doesNotMatch(await node().locator('.thought-node-header').innerText(), /\btok\b/);
  const beforeHover = await snapshotData();
  await usage().hover();
  await page.waitForTimeout(450);
  assert.equal(await tip().count(), 0, 'Token estimate has no details popup');
  assert.equal((await usage().locator('[data-tool-marks]').innerText()).trim(), '2');
  for (const target of [usage(), usage().locator('[data-node-token-total]'), usage().locator('[data-tool-marks] svg'), usage().locator('[data-tool-marks]'), bar()]) {
    await target.hover();
    await page.waitForTimeout(400);
    assert.equal(await tip().count(), 0, 'Every part of the token group stays quiet');
    assert.equal(await target.getAttribute('title'), null);
    assert.equal(await target.getAttribute('data-tooltip'), null);
  }
  assert.equal(await usage().getAttribute('tabindex'), null, 'Static metadata is not an extra focus stop');
  assert.equal(await snapshotData(), beforeHover, 'Hover must not mutate node data');
  assert.deepEqual(writes, [], 'Hover must not issue writes');
  await screenshot('light-status-no-popup');
  check('Total, tool count and composition remain visible without a floating details window');

  await reset();
  const emptyPoint = await node().locator('.thought-node-header').evaluate(header => {
    const rect = header.getBoundingClientRect();
    for (let x = rect.right - 90; x > rect.left + 40; x -= 4) {
      const y = rect.top + rect.height / 2, hit = document.elementFromPoint(x, y);
      if (hit === header || hit?.classList.contains('node-header-status')) return { x, y };
    }
    return null;
  });
  assert.ok(emptyPoint, 'The status header retains blank drag space');
  await drag('Header blank space', emptyPoint);
  await reset();
  await drag('Token total', await center(usage().locator('[data-node-token-total]')));
  await reset();
  await drag('Token composition bar', await center(bar()));
  await reset();
  await drag('Tool-call label', await center(node().locator('[data-tool-marks]')));

  await reset();
  await node().locator('.thought-node-header button').first().focus();
  await page.keyboard.press('Tab');
  assert.equal(await usage().evaluate(element => document.activeElement === element), false);
  check('Keyboard navigation skips the static token estimate');

  await reset();
  await node().locator('[data-node-metadata-toggle]').click();
  const metadata = node().locator('[data-node-metadata]');
  await metadata.locator('.node-metadata-fields').waitFor();
  const geometry = await metadata.evaluate(element => {
    const style = getComputedStyle(element), fields = getComputedStyle(element.querySelector('.node-metadata-fields'));
    const section = element.getBoundingClientRect(), card = element.parentElement.getBoundingClientRect();
    return {
      bottom: parseFloat(style.borderBottomWidth), gapLeft: section.left - card.left, gapRight: card.right - section.right,
      innerBorder: fields.borderTopWidth, innerRadius: fields.borderTopLeftRadius, innerBackground: fields.backgroundColor,
    };
  });
  assert.ok(geometry.bottom >= 1 && geometry.gapLeft <= 4 && geometry.gapRight <= 4, JSON.stringify(geometry));
  assert.equal(geometry.innerBorder, '0px');
  assert.equal(geometry.innerRadius, '0px');
  assert.equal(geometry.innerBackground, 'rgba(0, 0, 0, 0)');
  await screenshot('light-metadata-section');
  await node().locator('[data-node-metadata-cancel]').click();
  check('Metadata occupies a full-width divided section without a nested card');

  for (const lang of ['zh', 'en']) {
    await language(lang);
    for (const theme of ['light', 'dark']) {
      await lighting(theme);
      // Use the same geometry action as the format panel, then wait for
      // React Flow measurement before asserting the actual rendered size.
      await page.evaluate(() => window.__store.getState().setSelectionGeometry(['status-a'], { width: 360, height: 480 }));
      await settle();
      await assertNarrow(`${lang}/${theme} before hover`);
      await assertStatusLayout();
      const header = node().locator('.thought-node-header');
      assert.equal(await header.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `${lang}/${theme} narrow header overflow`);
      await within(usage(), header, 'Token usage');
      await within(node().locator('[data-tool-marks]'), header, 'Tool calls');
      await within(node().locator('[data-node-details]'), header, 'Details button');
      await usage().hover();
      await page.waitForTimeout(400);
      assert.equal(await tip().count(), 0, 'Narrow cards have no token popup');
      assert.ok((await usage().getAttribute('aria-label')).includes(lang === 'en' ? 'Turn content estimate' : '本轮内容估算'));
      assert.equal((await node().locator('[data-tool-marks]').innerText()).trim(), '2');
      await assertNarrow(`${lang}/${theme} at capture`);
      await screenshot(`${theme}-${lang}-narrow`);
      await page.mouse.move(1300, 850);
    }
  }
  check('Chinese/English and light/dark narrow cards retain visible status and actions without overflow');

  await language('zh');
  await lighting('light');
  await patch({ data: { attachments: [], excludedAttachmentIds: [], reasonings: undefined, reasoningTokens: undefined } });
  assert.match(await usage().innerText(), /30\s+tokens/);
  assert.equal(await node().locator('[data-tool-marks]').count(), 0);
  await assertGradient('Ordinary question and answer', [0, 10 / 30 * 100, 100]);
  await usage().hover();
  await page.waitForTimeout(400);
  assert.equal(await tip().count(), 0);
  await screenshot('ordinary-turn-no-tools');
  check('Ordinary turns retain the question/answer composition without inventing a thinking segment');

  await page.mouse.move(1300, 850);
  await patch({ data: { response: '', responses: [''], tokenCount: 10 } });
  assert.match(await usage().innerText(), /10\s+tokens/);
  await assertGradient('Question-only turn', [0, 100]);
  await usage().hover();
  await page.waitForTimeout(400);
  assert.equal(await tip().count(), 0);
  await screenshot('single-part-turn');
  check('A single nonzero part remains a valid solid gradient spanning 0 to 100 percent');

  await page.mouse.move(1300, 850);
  await patch({ data: { question: '', response: '', responses: [''], tokenCount: 0 } });
  assert.match(await usage().innerText(), /0\s+tokens/);
  await usage().hover();
  await page.waitForTimeout(400);
  assert.equal(await tip().count(), 0);
  assert.equal(await bar().evaluate(element => getComputedStyle(element).backgroundImage), 'none', 'Empty content must not invent occupied color segments');
  assert.equal(await bar().locator(':scope > *').count(), 0);
  await screenshot('empty-turn');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  check('Empty content has a zero total with no invented segments, runtime errors, or write requests');
} catch (error) {
  await screenshot('failure');
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, writes, narrowGeometry }, null, 2));
  await context.close();
  await browser.close();
}
