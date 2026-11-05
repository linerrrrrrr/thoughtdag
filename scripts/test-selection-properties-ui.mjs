// One typed selection inspector: scope, drafts, previews, and explicit actions.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const output = 'local-tests/selection-properties';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
await context.routeWebSocket(/.*/, socket => socket.close());
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], writes = [], checks = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
  writes.push(`${route.request().method()} ${route.request().url()}`);
  return route.abort();
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
  localStorage.setItem('thoughtdag.lang', 'zh');
});
const panel = () => page.locator('[data-selection-properties]');
const section = type => page.locator(`[data-selection-section="${type}"]`);
const close = () => page.locator('[data-selection-properties-close]').click();
const choose = type => page.locator(`[data-selection-target="${type}"]`).click();
const edgeLabel = () => page.locator('[data-edge-label], [data-batch-edge-label]');
const edgeApply = () => page.locator('[data-edge-apply], [data-batch-edge-apply]');
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const readSelection = () => page.evaluate(() => ({
  nodes: [...window.__store.getState().selectedNodeIds].sort(),
  edges: window.__store.getState().edges.filter(edge => edge.selected).map(edge => edge.id).sort(),
}));
const readEdges = () => page.evaluate(() => window.__store.getState().edges.map(({ selected: _selected, ...edge }) => edge));
const readGeometry = () => page.evaluate(() => window.__store.getState().nodes.map(({ id, position, width, height }) => ({ id, position, width, height })));
const reopen = () => page.evaluate(() => window.__canvasEditing.getState().requestProperties());
const undo = () => page.evaluate(() => window.__store.getState().undo());
async function selected(nodes, edges) {
  const expected = { nodes: [...nodes].sort(), edges: [...edges].sort() };
  await page.waitForFunction(expected => JSON.stringify({
    nodes: [...window.__store.getState().selectedNodeIds].sort(),
    edges: window.__store.getState().edges.filter(edge => edge.selected).map(edge => edge.id).sort(),
  }) === JSON.stringify(expected), expected);
  assert.deepEqual(await readSelection(), expected);
}
async function select(nodes, edges = []) {
  await page.evaluate(({ nodes, edges }) => {
    window.__canvasEditing.getState().setSelectionRegion(null);
    window.__store.setState(state => ({ selectedNodeIds: nodes, selectedNodeId: nodes.length === 1 ? nodes[0] : null,
      nodes: state.nodes.map(node => ({ ...node, selected: nodes.includes(node.id) })),
      edges: state.edges.map(edge => ({ ...edge, selected: edges.includes(edge.id) })) }));
    window.__canvasEditing.getState().requestProperties();
  }, { nodes, edges });
  await selected(nodes, edges);
  await panel().waitFor();
}
async function fixture() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.mouse.click(1150, 900);
  await page.evaluate(() => {
    const data = id => ({ question: `研究对象 ${id}`, displayName: `研究对象 ${id}`,
      response: 'Stable content for selection property tests.', responses: ['Stable content for selection property tests.'], responseIndex: 0,
      isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
      isRoot: id === 'a', isBranch: false, highlights: [], attachments: [],
      excludedAttachmentIds: [], includedAttachmentIds: [], tokenCount: 10, roleMode: 'inherit' });
    const nodes = [
      { id: 'f', type: 'thought', position: { x: 200, y: 180 }, width: 1400, height: 1000, zIndex: -1,
        dragHandle: '.drag-handle', data: { ...data('f'), stepKind: 'frame', frameCarry: false, frameColor: 'violet' } },
      ...[{ id: 'a', x: 300, y: 300 }, { id: 'b', x: 300, y: 800 }, { id: 'c', x: 2000, y: 300 }]
        .map(({ id, x, y }) => ({ id, type: 'thought', dragHandle: '.drag-handle', position: { x, y }, width: 400, height: 240, data: data(id) })),
    ];
    const edges = [
      { id: 'ab', source: 'a', target: 'b', data: { label: 'first', route: 'curve' } },
      { id: 'bc', source: 'b', target: 'c', data: { label: 'second', route: 'orthogonal', isCrossLink: true } },
    ].map(edge => ({ ...edge, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top' }));
    window.__canvasEditing.getState().reset();
    window.__store.setState({ nodes, edges, selectedNodeIds: [], selectedNodeId: null, history: [{ nodes, edges }], historyIndex: 0 });
    window.__ui.setState({ panelOpen: false, panelNodeId: null, tutorialOpen: false, releaseNotesOpen: false, autoRefreshPaused: true, drafts: {} });
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__rf.setViewport({ x: 80, y: 30, zoom: 0.55 }, { duration: 0 }));
  await page.waitForFunction(() => window.__store.getState().nodes.every(node => node.measured?.width && node.measured?.height));
  await page.waitForTimeout(180);
}
async function linePoint(id, fraction = 0.5) {
  return page.locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`).evaluate((path, fraction) => {
    const p = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM());
    return { x: p.x, y: p.y };
  }, fraction);
}
async function draw(rect) {
  const toolbarBefore = await page.locator('[data-top-toolbar]').boundingBox();
  await page.mouse.move(rect.x, rect.y); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width, rect.y + rect.height, { steps: 12 });
  assert.equal(await page.locator('[data-selection-target-control]').count(), 0);
  await page.mouse.up();
  await page.locator('[data-selection-region]').waitFor();
  await page.locator('[data-selection-target-control]').waitFor();
  const toolbarAfter = await page.locator('[data-top-toolbar]').boundingBox();
  assert.deepEqual(toolbarAfter, toolbarBefore, 'selection choices do not move the top toolbar');
}
async function frameMarquee() {
  const box = await node('f').boundingBox(); assert.ok(box);
  await draw({ x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 });
}
async function probe(name, run) {
  if (process.env.CHECK_MATCH && !name.includes(process.env.CHECK_MATCH)) return;
  try { await run(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) {
    failures.push({ name, error: String(error) }); console.error(`FAIL ${name}: ${error}`);
    await page.screenshot({ path: `${output}/failure-${failures.length}.png` }).catch(() => {});
  } finally { await page.keyboard.up('Control'); await page.keyboard.up('Shift'); await page.mouse.up(); }
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5198', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__canvasEditing && window.__ui);
  await probe('marquee classifies frames separately and retains the same three candidate sets', async () => {
    await fixture(); await frameMarquee();
    await selected(['a', 'b'], []);
    const scope = await page.evaluate(() => window.__canvasEditing.getState().selectionRegion);
    assert.deepEqual([...scope.nodeIds].sort(), ['a', 'b']); assert.deepEqual(scope.frameIds, ['f']);
    assert.deepEqual([...scope.edgeIds].sort(), ['ab', 'bc']);
    await page.waitForFunction(() => ['nodes', 'edges', 'frames'].every(type => {
      const button = document.querySelector(`[data-selection-target="${type}"]`);
      return button && getComputedStyle(button).visibility === 'visible' && button.innerText.trim();
    }));
    assert.match(await page.locator('[data-selection-target="nodes"]').innerText(), /2/);
    assert.match(await page.locator('[data-selection-target="edges"]').innerText(), /2/);
    assert.match(await page.locator('[data-selection-target="frames"]').innerText(), /1/);
    for (const [type, nodes, edges] of [['frames', ['f'], []], ['edges', [], ['ab', 'bc']], ['nodes', ['a', 'b'], []]]) {
      await choose(type); await selected(nodes, edges);
      assert.equal(await panel().count(), 1);
      assert.match(await panel().innerText(), /选区属性/);
      assert.deepEqual(await page.evaluate(() => window.__canvasEditing.getState().selectionRegion), scope);
    }
    await page.screenshot({ path: `${output}/three-types.png` });
  });
  await probe('one connection has the same inspector and draft after click or marquee selection', async () => {
    await fixture();
    const p = await linePoint('ab', 0.4); await page.mouse.click(p.x, p.y);
    await selected([], ['ab']); await page.locator('[data-connection-properties]').waitFor();
    assert.match(await panel().innerText(), /选区属性/);
    await edgeLabel().fill('one shared draft');
    await close(); await selected([], ['ab']);
    assert.equal(await panel().count(), 0);
    assert.equal((await readEdges())[0].data.label, 'first');
    assert.equal(await page.evaluate(() => window.__canvasEditing.getState().edgePreviews?.length ?? 0), 0);
    await page.mouse.click(1150, 900);
    const middle = await linePoint('ab');
    await draw({ x: middle.x - 38, y: middle.y - 10, width: 76, height: 20 });
    await choose('edges'); await selected([], ['ab']);
    assert.equal(await edgeLabel().inputValue(), 'one shared draft');
    await page.keyboard.press('Escape');
    assert.equal(await edgeLabel().inputValue(), 'first');
    await selected([], ['ab']);
    await page.keyboard.press('Escape');
    assert.equal(await panel().count(), 0); await selected([], ['ab']);
  });
  await probe('replacement closes properties without restoring them or discarding selection and empty drafts', async () => {
    await fixture(); await select([], ['ab']);
    await edgeLabel().fill('');
    await page.locator('[data-toolbar-more]').click();
    await page.locator('[data-toolbar-more-panel]').waitFor();
    await selected([], ['ab']); assert.equal(await panel().count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await panel().count(), 0);
    await reopen(); await panel().waitFor(); assert.equal(await edgeLabel().inputValue(), '');
    assert.equal((await readEdges())[0].data.label, 'first');
    await edgeApply().click(); assert.equal((await readEdges())[0].data.label, undefined);
    await undo(); assert.equal((await readEdges())[0].data.label, 'first');
  });
  await probe('single and multiple connections preview patches without mutating values and apply as one undo step', async () => {
    for (const ids of [['ab'], ['ab', 'bc']]) {
      await fixture(); await select([], ids);
      const before = await readEdges(), geometry = await readGeometry();
      const label = edgeLabel();
      if (ids.length === 2) {
        assert.equal(await label.inputValue(), '');
        assert.match(await page.locator('[data-connection-properties]').innerText(), /多个值/);
      }
      await label.fill('shared label');
      await page.waitForFunction(ids => ids.every(id => window.__canvasEditing.getState().edgePreviews?.some(edge => edge.id === id && edge.data?.label === 'shared label')), ids);
      assert.deepEqual(await readEdges(), before, 'preview is not persisted');
      await edgeApply().click();
      const after = await readEdges();
      for (let i = 0; i < after.length; i++) {
        assert.equal(after[i].data.label, ids.includes(after[i].id) ? 'shared label' : before[i].data.label);
        assert.equal(after[i].data.route, before[i].data.route);
        assert.equal(after[i].data.isCrossLink, before[i].data.isCrossLink);
      }
      assert.deepEqual(await readGeometry(), geometry);
      await undo(); assert.deepEqual(await readEdges(), before);
    }
  });
  await probe('geometry drafts survive closure and mixed-type edits target only their labeled group', async () => {
    await fixture(); await select(['a', 'f'], ['ab']);
    for (const type of ['nodes', 'frames', 'edges']) await section(type).waitFor();
    const before = await readGeometry(), originalEdges = await readEdges();
    const width = section('nodes').locator('[data-node-format-field="width"]');
    await width.fill('520'); await close();
    assert.deepEqual(await readGeometry(), before, 'closing properties never applies geometry');
    await selected(['a', 'f'], ['ab']);
    await reopen(); await panel().waitFor();
    assert.equal(await width.inputValue(), '520');
    await section('nodes').locator('[data-node-format-apply]').click();
    const after = await readGeometry();
    assert.equal(after.find(node => node.id === 'a').width, 520);
    assert.deepEqual(after.filter(node => node.id !== 'a'), before.filter(node => node.id !== 'a'));
    assert.deepEqual(await readEdges(), originalEdges);
    await selected(['a', 'f'], ['ab']);
  });
  await probe('editing or deleting a frame preserves its content and connections and has one undo step', async () => {
    await fixture(); await select(['f']);
    const before = await readGeometry(), originalEdges = await readEdges();
    await section('frames').locator('[data-node-format-field="width"]').fill('1550');
    await section('frames').locator('[data-node-format-apply]').click();
    const resized = await readGeometry();
    assert.equal(resized.find(node => node.id === 'f').width, 1550);
    assert.deepEqual(resized.filter(node => node.id !== 'f'), before.filter(node => node.id !== 'f'));
    assert.deepEqual(await readEdges(), originalEdges);
    await undo(); assert.deepEqual(await readGeometry(), before);
    await page.locator('[data-frame-delete]').click();
    await page.getByRole('alertdialog').waitFor(); await page.keyboard.press('Enter');
    assert.deepEqual(await readGeometry(), before, 'confirmation defaults to cancel');
    await page.locator('[data-frame-delete]').click();
    await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
    assert.deepEqual(await readGeometry(), before.filter(node => node.id !== 'f'));
    assert.deepEqual(await readEdges(), originalEdges);
    await undo(); assert.deepEqual(await readGeometry(), before);
  });
  await probe('single and multiple connection deletion share explicit confirmation and retain nodes', async () => {
    for (const ids of [['ab'], ['ab', 'bc']]) {
      await fixture(); await select([], ids);
      const geometry = await readGeometry(), before = await readEdges();
      const remove = page.locator('[data-connection-properties]').getByRole('button', { name: '删除', exact: true });
      await remove.click(); await page.getByRole('alertdialog').waitFor(); await page.keyboard.press('Enter');
      assert.deepEqual(await readEdges(), before);
      await remove.click(); await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
      assert.deepEqual(await readEdges(), before.filter(edge => !ids.includes(edge.id)));
      assert.deepEqual(await readGeometry(), geometry);
      await undo(); assert.deepEqual(await readEdges(), before);
    }
  });
  await probe('mixed pointer boundary preserves additive selection and deletes its typed scope atomically', async () => {
    await fixture();
    const geometry = await readGeometry(), edges = await readEdges();
    await node('a').locator('[data-node-token-usage]').click();
    await selected(['a'], []);
    await page.keyboard.down('Control');
    await node('f').locator('[data-frame-header]').click({ position: { x: 10, y: 10 } });
    await selected(['a', 'f'], []);
    const p = await page.locator('.react-flow__edge[data-id="bc"] .react-flow__edge-path').evaluate(path => {
      for (const fraction of [0.85, 0.75, 0.65, 0.55, 0.4, 0.2]) {
        const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM());
        if (document.elementFromPoint(point.x, point.y)?.closest('.react-flow__edge')?.getAttribute('data-id') === 'bc') {
          return { x: point.x, y: point.y };
        }
      }
      return null;
    });
    assert.ok(p, 'a visible connection segment remains available for an additive click');
    await page.mouse.click(p.x, p.y); await page.keyboard.up('Control');
    await selected(['a', 'f'], ['bc']);
    for (const type of ['nodes', 'frames', 'edges']) await section(type).waitFor();
    await page.keyboard.press('Delete');
    const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
    const message = await dialog.innerText();
    assert.match(message, /1 个节点/); assert.match(message, /1 条连线/); assert.match(message, /1 个分区/);
    await page.keyboard.press('Enter');
    assert.deepEqual(await readGeometry(), geometry); assert.deepEqual(await readEdges(), edges);
    await selected(['a', 'f'], ['bc']);
    await page.keyboard.press('Delete'); await dialog.waitFor();
    await dialog.getByRole('button', { name: '删除', exact: true }).click();
    assert.deepEqual(await readGeometry(), geometry.filter(node => node.id !== 'a' && node.id !== 'f'),
      'unselected frame content remains in place');
    assert.deepEqual(await readEdges(), [], 'the explicit connection and deleted node incident connection are removed');
    await undo(); assert.deepEqual(await readGeometry(), geometry); assert.deepEqual(await readEdges(), edges);
  });
  await probe('focused node keyboard boundary cancels restored geometry draft before closing properties and clearing selection', async () => {
    await fixture(); await select(['a']);
    const geometry = await readGeometry();
    const width = section('nodes').locator('[data-node-format-field="width"]');
    await width.fill('520'); await close();
    await reopen(); await panel().waitFor(); assert.equal(await width.inputValue(), '520');
    const token = node('a').locator('[data-node-token-usage]'); await token.focus();
    assert.equal(await token.evaluate(element => document.activeElement === element && element.tagName === 'SPAN'), true);
    await page.keyboard.press('Escape');
    await selected(['a'], []); assert.equal(await panel().count(), 1);
    assert.equal(await width.inputValue(), '400'); assert.deepEqual(await readGeometry(), geometry);
    await page.keyboard.press('Escape');
    assert.equal(await panel().count(), 0); await selected(['a'], []);
    await page.keyboard.press('Escape'); await selected([], []);
    assert.deepEqual(await readGeometry(), geometry);
  });
  await probe('frame keyboard boundary keeps select-all in the frame type and ignores node generation and collapse shortcuts', async () => {
    await fixture();
    await node('f').locator('[data-frame-header]').click({ position: { x: 10, y: 10 } });
    await selected(['f'], []);
    assert.equal(await page.evaluate(() => window.__canvasEditing.getState().selectionRegion), null);
    await node('f').focus();
    assert.equal(await node('f').evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Control+a'); await selected(['f'], []);
    const before = await page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'f').data);
    await node('f').focus(); await page.keyboard.press('r'); await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => window.__store.getState().nodes.find(node => node.id === 'f').data);
    assert.equal(after.isLoading, false); assert.equal(after.isCollapsed, before.isCollapsed);
    assert.deepEqual(after, before, 'frame shortcuts never mutate node conversation state');
    await selected(['f'], []); assert.deepEqual(writes, []);
  });
  await probe('three type choices and the shared card stay reachable at narrow widths in both languages and themes', async () => {
    await fixture(); await frameMarquee(); await choose('edges');
    for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
      await page.evaluate(async ({ lang, theme }) => {
        const live = path => import([...performance.getEntriesByType('resource')].reverse()
          .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
        (await live('/src/i18n/index.ts')).useI18n.getState().setLang(lang);
        (await live('/src/lib/appearance.ts')).useAppearance.getState().setLighting(theme);
      }, { lang, theme });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(220);
        const control = await page.locator('[data-selection-target-control]').boundingBox();
        const card = await panel().boundingBox(); assert.ok(control && card);
        assert.ok(control.x >= 15 && control.x + control.width <= width - 15);
        assert.ok(card.x >= 15 && card.x + card.width <= width - 15);
        assert.ok(Math.abs(card.y - control.y - control.height - 16) < 1.5);
        for (const type of ['nodes', 'edges', 'frames']) {
          assert.equal(await page.locator(`[data-selection-target="${type}"]`).evaluate(el => {
            const rect = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          }), true);
        }
        await edgeApply().scrollIntoViewIfNeeded();
        assert.equal(await edgeApply().evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight
            && el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }), true, 'property actions remain reachable by scrolling inside the card');
        await page.locator('[data-selection-properties-scroll]').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: `${output}/${lang}-${theme}-${width}.png` });
      }
    }
  });
  assert.deepEqual(errors, [], 'No browser errors'); assert.deepEqual(writes, [], 'No API writes');
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, failures, errors, writes }, null, 2));
  console.log(`${checks.length} selection property checks passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, failures, errors, writes, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
