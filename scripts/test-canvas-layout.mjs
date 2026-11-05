// Selectable graph layouts and future-node direction invariants.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'tdag-canvas-layout-'));
const bundle = join(temporary, 'layout.mjs');
const placementBundle = join(temporary, 'placement.mjs');
const framesBundle = join(temporary, 'frames.mjs');
let failures = 0;
const test = async (name, run) => {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
const node = (id, x = 0, y = 0, width = 200, height = 120, data = {}) => ({
  id, type: 'thought', position: { x, y }, width, height, measured: { width, height },
  data: { question: id, response: 'Answer', isCollapsed: false, ...data },
});
const edge = (source, target, data = {}) => ({ id: `${source}-${target}`, source, target, data });
const defaults = { direction: 'vertical', method: 'chains', density: 'standard', route: 'auto' };
const get = (nodes, id) => nodes.find((n) => n.id === id);
const widthOf = (n) => Math.max(n.width ?? n.measured?.width ?? 520, n.measured?.width ?? 0);
const assertClear = (nodes, heightOf = (n) => n.height ?? n.measured?.height ?? 120) => {
  const cards = nodes.filter((n) => n.data.stepKind !== 'frame');
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    assert.ok(a.position.x + widthOf(a) <= b.position.x + 0.001 || b.position.x + widthOf(b) <= a.position.x + 0.001
      || a.position.y + heightOf(a) <= b.position.y + 0.001 || b.position.y + heightOf(b) <= a.position.y + 0.001,
    `${a.id} overlaps ${b.id}`);
  }
};
const assertOrder = (nodes, edges, direction, heightOf = (n) => n.height) => {
  const axis = direction === 'horizontal' ? 'x' : 'y';
  for (const e of edges.filter((e) => !e.data?.isWatch && !e.data?.isCrossLink)) {
    const source = get(nodes, e.source), target = get(nodes, e.target);
    if (!source || !target || source.data.stepKind === 'frame' || target.data.stepKind === 'frame') continue;
    assert.ok(target.position[axis] + 0.001 >= source.position[axis] + (direction === 'horizontal' ? widthOf(source) : heightOf(source)),
      `${e.source} must precede ${e.target}`);
  }
};
// Dragging may move the selection's origin; only its recovered structure must
// be identical. Round fractional estimated heights for translation arithmetic.
const normalized = (nodes) => {
  const cards = nodes.filter((n) => n.data.stepKind !== 'frame');
  const x = Math.min(...cards.map((n) => n.position.x)), y = Math.min(...cards.map((n) => n.position.y));
  return cards.map((n) => ({ id: n.id, x: Math.round((n.position.x - x) * 1e6), y: Math.round((n.position.y - y) * 1e6) }))
    .sort((a, b) => a.id.localeCompare(b.id));
};
const random = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const shuffled = (items, next) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const scattered = (nodes, next) => shuffled(nodes.map((n) => ({ ...n,
  position: { x: Math.floor(next() * 12000) - 6000, y: Math.floor(next() * 10000) - 5000 },
})), next);
const assertContains = (frame, member) => {
  assert.ok(frame.position.x <= member.position.x && frame.position.y <= member.position.y
    && frame.position.x + frame.width >= member.position.x + member.width
    && frame.position.y + frame.height >= member.position.y + member.height, `${frame.id} does not contain ${member.id}`);
};
try {
  const compile = (entry, outfile) => buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  compile('src/lib/canvas-layout.ts', bundle); compile('src/lib/layout.ts', placementBundle); compile('src/lib/frames.ts', framesBundle);
  const { planCanvasLayout, canvasLayoutInputKey } = await import(pathToFileURL(bundle).href);
  const { placeNewNodes, nodeHeight } = await import(pathToFileURL(placementBundle).href);
  const { frameMembers, fittedFrameRect, fitFrameNodes } = await import(pathToFileURL(framesBundle).href);
  const assertTightFrame = (nodes, id) => {
    const frame = get(nodes, id), fit = fittedFrameRect(frame, nodes);
    assert.ok(fit, `${id} has no content to fit`);
    for (const key of ['width', 'height']) {
      assert.ok(Math.abs(frame[key] - fit[key]) < 0.002, `${id}.${key}: automatic ${frame[key]}, content fit ${fit[key]}`);
    }
    // Minimum size and a locked ratio can leave free space on either side.
    // A safe fit may retain that slack inside the solved rectangle.
    for (const member of frameMembers(frame, nodes)) {
      const height = member.data.stepKind === 'frame' ? member.height : nodeHeight(member);
      assert.ok(member.position.x >= frame.position.x + 32 - 0.002
        && member.position.y >= frame.position.y + 80 - 0.002
        && member.position.x + member.width <= frame.position.x + frame.width - 32 + 0.002
        && member.position.y + height <= frame.position.y + frame.height - 32 + 0.002,
      `${id} clips the content padding around ${member.id}`);
    }
    const manual = get(fitFrameNodes(nodes, [id]), id);
    assert.ok(Math.abs(manual.position.x - frame.position.x) < 0.01 && Math.abs(manual.position.y - frame.position.y) < 0.01
      && Math.abs(manual.width - frame.width) < 0.01 && Math.abs(manual.height - frame.height) < 0.01,
    `${id}: manual fitting changes the automatic fit`);
  };
  const plan = async (nodes, edges, options = {}, ids) => {
    const result = await planCanvasLayout(nodes, edges, { ...defaults, ...options }, ids);
    if (!result.error && options.method !== 'manual') {
      const scope = ids && new Set(ids);
      for (const frame of nodes.filter((n) => n.data.stepKind === 'frame' && (!scope || scope.has(n.id)))) {
        const before = frameMembers(frame, nodes).map((n) => n.id).sort();
        const after = frameMembers(get(result.nodes, frame.id), result.nodes).map((n) => n.id).sort();
        assert.deepEqual(after, before, `${frame.id}: automatic layout changed region membership`);
      }
    }
    return result;
  };
  for (const direction of ['vertical', 'horizontal']) {
    await test(`${direction} chains align continuations, order merges and clear resized cards`, async () => {
      const nodes = [node('a', 0, 0, 900, 400), node('b', 20, 10, 300, 800), node('c', 30, 50, 700, 300),
        node('merge', 40, 40, 500, 300), node('root', 700, 300, 400, 650)];
      const edges = [edge('a', 'b'), edge('a', 'c', { isBranchFromSelection: true }), edge('b', 'merge'), edge('c', 'merge')];
      const original = JSON.stringify(nodes);
      const result = (await plan(nodes, edges, { direction }));
      assert.equal(result.error, undefined);
      assert.equal(JSON.stringify(nodes), original, 'input must remain unchanged');
      const cross = direction === 'horizontal' ? 'y' : 'x', primary = direction === 'horizontal' ? 'x' : 'y';
      assert.equal(get(result.nodes, 'a').position[cross], get(result.nodes, 'b').position[cross]);
      assert.equal(get(result.nodes, 'b').position[cross], get(result.nodes, 'merge').position[cross]);
      for (const e of edges) {
        const a = get(result.nodes, e.source), b = get(result.nodes, e.target);
        assert.ok(b.position[primary] >= a.position[primary] + (direction === 'horizontal' ? a.width : a.height));
      }
      assertClear(result.nodes);
      assert.ok(result.nodes.every((n) => n.data.layoutDirection === direction));
      const reversed = (await plan([...nodes].reverse(), edges, { direction }));
      for (const n of result.nodes) assert.deepEqual(n.position, get(reversed.nodes, n.id).position);
    });
    await test(`${direction} layer layout uses one coordinate for each dependency rank`, async () => {
      const nodes = [node('a'), node('b', 20, 30, 400, 700), node('c', 400, 30, 800, 200), node('d'), node('e')];
      const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'e')];
      const result = (await plan(nodes, edges, { direction, method: 'layers' }));
      assert.equal(result.error, undefined);
      const axis = direction === 'horizontal' ? 'x' : 'y';
      assert.equal(get(result.nodes, 'b').position[axis], get(result.nodes, 'c').position[axis]);
      assert.equal(get(result.nodes, 'd').position[axis], get(result.nodes, 'e').position[axis]);
      assertClear(result.nodes);
    });
    for (const method of ['chains', 'layers']) {
      await test(`${direction} ${method} restores the same structure after repeated arbitrary dragging`, async () => {
        const nodes = [node('root', 0, 0, 600, 300), node('continue', 0, 500, 250, 700),
          node('branch', 900, 500, 700, 200), node('branch-next', 900, 900, 400, 500),
          node('merge', 0, 1500, 350, 250), node('other-root', 1800, 0, 280, 160),
          node('other-next', 1800, 400, 300, 400), node('isolated', 2400, 0)];
        const edges = [edge('root', 'continue'), edge('root', 'branch', { isBranchFromSelection: true }),
          edge('branch', 'branch-next'), edge('continue', 'merge', { createdAt: '2026-01-01T00:00:00Z' }),
          edge('branch-next', 'merge', { createdAt: '2026-01-02T00:00:00Z' }), edge('other-root', 'other-next')];
        const expected = (await plan(nodes, edges, { direction, method }));
        assert.equal(expected.error, undefined);
        const next = random(20261104);
        let previous = expected.nodes;
        for (let iteration = 0; iteration < 16; iteration++) {
          const dragged = scattered(previous, next), reordered = shuffled(edges, next);
          const input = JSON.stringify({ nodes: dragged, edges: reordered });
          const result = (await plan(dragged, reordered, { direction, method }, dragged.map((n) => n.id).reverse()));
          assert.equal(result.error, undefined, `shuffle ${iteration}`);
          assert.equal(JSON.stringify({ nodes: dragged, edges: reordered }), input, 'plan mutated its inputs');
          assert.deepEqual(normalized(result.nodes), normalized(expected.nodes), `shuffle ${iteration} changed structure`);
          assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
          const cross = direction === 'horizontal' ? 'y' : 'x';
          for (const [a, b] of [['root', 'continue'], ['continue', 'merge'], ['branch', 'branch-next'], ['other-root', 'other-next']]) {
            assert.equal(get(result.nodes, a).position[cross], get(result.nodes, b).position[cross], `${a}/${b} lost its chain`);
          }
          const again = (await plan(result.nodes, reordered, { direction, method }, result.nodes.map((n) => n.id)));
          assert.equal(again.error, undefined);
          assert.deepEqual(again.nodes.map((n) => n.position), result.nodes.map((n) => n.position), 'repeated layout must not drift');
          previous = result.nodes;
        }
      });
    }
    await test(`${direction} includes selected documents, notes and links in their context chains`, async () => {
      const nodes = [node('file', 400, 1200, 800, 600, { stepKind: 'file' }),
        node('note', -1000, 900, 500, 350, { stepKind: 'note' }), node('link', 1400, -1000, 400, 200, { stepKind: 'link' }),
        node('question', -400, -600), node('follow-up', 800, 400), node('frame', -2000, -2000, 8000, 8000, { stepKind: 'frame' })];
      const edges = [edge('file', 'question'), edge('question', 'follow-up'), edge('note', 'link')];
      const result = (await plan(nodes, edges, { direction }, nodes.map((n) => n.id)));
      assert.equal(result.error, undefined);
      for (const member of result.nodes.filter((n) => n.id !== 'frame')) assertContains(get(result.nodes, 'frame'), member);
      assertClear(result.nodes); assertOrder(result.nodes, edges, direction);
      const cross = direction === 'horizontal' ? 'y' : 'x';
      assert.equal(get(result.nodes, 'file').position[cross], get(result.nodes, 'question').position[cross]);
      assert.equal(get(result.nodes, 'question').position[cross], get(result.nodes, 'follow-up').position[cross]);
      assert.equal(get(result.nodes, 'note').position[cross], get(result.nodes, 'link').position[cross]);
      // Frame membership is intentionally geometric; check arbitrary material
      // dragging separately from the frame's current containment snapshot.
      const cards = nodes.filter((n) => n.data.stepKind !== 'frame');
      const expected = (await plan(cards, edges, { direction }));
      const next = random(11);
      const reordered = (await plan(scattered(cards, next), shuffled(edges, next), { direction }));
      assert.equal(reordered.error, undefined); assert.deepEqual(normalized(reordered.nodes), normalized(expected.nodes));
    });
  }
  await test('retired metadata does not affect layout snapshots or geometry', async () => {
    const nodes = [node('a', 600, 900), node('b', 0, 0)], edges = [edge('a', 'b')];
    const imported = nodes.map(n => ({ ...n, data: { ...n.data, canvasGroupId: 'retired', previousCanvasGroupId: 'older' } }));
    assert.equal(canvasLayoutInputKey(imported, edges), canvasLayoutInputKey(nodes, edges));
    const expected = await plan(nodes, edges);
    const actual = await plan(imported, edges);
    assert.equal(actual.error, undefined);
    assert.deepEqual(normalized(actual.nodes), normalized(expected.nodes));
  });
  await test('density changes spacing without changing context or lane ownership', async () => {
    const nodes = [node('a'), node('b')], edges = [edge('a', 'b')];
    const positions = [];
    for (const density of ['compact', 'standard', 'relaxed']) positions.push(get((await plan(nodes, edges, { density })).nodes, 'b').position.y);
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
  });
  await test('manual keeps every position intact while saving selected defaults', async () => {
    const nodes = [node('a', 200, 100, 200, 100, {}), node('b', 400, 120, 200, 100, {}), node('c')];
    const result = (await plan(nodes, [], { method: 'manual', direction: 'horizontal', route: 'orthogonal' }, ['a', 'b']));
    assert.equal(result.error, undefined);
    assert.deepEqual(result.nodes.map((n) => n.position), nodes.map((n) => n.position));
    assert.equal(result.nodes[0].data.edgeRouteDefault, 'orthogonal');
    assert.equal(result.nodes[2], nodes[2]);
  });
  await test('automatic layouts reorder selected nodes while retaining context order', async () => {
    const nodes = [node('a', 500, 800, 200, 100, {}),
      node('b', 300, 100, 200, 100, {}),
      node('branch', 900, -500, 200, 100, { stepKind: 'note' })];
    const edges = [edge('a', 'b'), edge('a', 'branch', { isBranchFromSelection: true })];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      for (const ids of [undefined, ['a', 'b', 'branch']]) {
        const result = (await plan(nodes, edges, { direction, method }, ids));
        assert.equal(result.error, undefined); assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
        const cross = direction === 'horizontal' ? 'y' : 'x';
        assert.equal(result.nodes[0].position[cross], result.nodes[1].position[cross]);
        const again = (await plan(result.nodes, edges, { direction, method }, ids));
        assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes);
      }
    }
  });
  await test('a single selected material arranges independently and preserves unselected cards', async () => {
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const horizontal = direction === 'horizontal';
      const nodes = [node('a', 80, 80, 200, 120, {}),
        node('b', 400, 400, 200, 120, { stepKind: 'note' }),
        node('c', horizontal ? 1600 : 80, horizontal ? 80 : 1600, 200, 120, {})];
      const edges = [edge('a', 'b'), edge('b', 'c')];
      const original = JSON.stringify(nodes);
      const result = (await plan(nodes, edges, { direction, method }, ['b']));
      assert.equal(result.error, undefined); assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
      assert.equal(JSON.stringify(nodes), original, 'partial layout mutated its input');
      assert.equal(get(result.nodes, 'a'), nodes[0]); assert.equal(get(result.nodes, 'c'), nodes[2]);
      assert.equal(get(result.nodes, 'b').position[horizontal ? 'y' : 'x'], 80);
      const again = (await plan(result.nodes, edges, { direction, method }, ['b']));
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes);
    }
  });
  await test('partial layouts reject impossible fixed boundaries without changing nodes', async () => {
    const nodes = [node('a', 0, 0, 200, 120, {}),
      node('b', 0, 150, 200, 120, {}),
      node('c', 0, 300, 200, 120, {})];
    const result = (await plan(nodes, [edge('a', 'b'), edge('b', 'c')], {}, ['b']));
    assert.equal(result.error, 'boundary-conflict'); assert.equal(result.nodes, nodes);
  });
  await test('selected middle turn respects fixed upstream/downstream and chain column', async () => {
    const nodes = [node('a', 80, 0), node('b', 20, 400), node('c', 80, 1000)];
    const result = (await plan(nodes, [edge('a', 'b'), edge('b', 'c')], {}, ['b']));
    assert.equal(result.error, undefined);
    assert.equal(result.nodes[0], nodes[0]); assert.equal(result.nodes[2], nodes[2]);
    assert.equal(result.nodes[1].position.x, 80);
    assert.ok(result.nodes[1].position.y >= 120 && result.nodes[1].position.y + 120 < 1000);
  });
  await test('a selected middle turn uses the free slot after a fixed obstacle without moving its neighbors', async () => {
    const nodes = [node('a', 80, 0), node('b', 20, 400), node('c', 80, 1000), node('blocker', 0, 200, 600, 400)];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    const original = JSON.stringify(nodes);
    const result = await plan(nodes, edges, { density: 'standard' }, ['b']);
    assert.equal(result.error, undefined);
    assert.equal(JSON.stringify(nodes), original, 'the planner must not mutate the input');
    for (const id of ['a', 'c', 'blocker']) assert.equal(get(result.nodes, id), get(nodes, id), `${id} must remain the original fixed object`);
    const moved = get(result.nodes, 'b');
    assert.equal(moved.position.x, 80, 'the fixed continuation column must be preserved');
    assert.ok(moved.position.y >= 600 + 80 - 0.001, 'the middle turn must clear the obstacle plus standard spacing');
    assert.ok(moved.position.y + moved.height + 80 <= 1000 + 0.001, 'the middle turn must still precede its fixed child');
    assertClear(result.nodes); assertOrder(result.nodes, edges, 'vertical');
  });
  await test('insufficient boundary space refuses without moving any node', async () => {
    const nodes = [node('a', 0, 0), node('b', 0, 150), node('c', 0, 300)];
    const result = (await plan(nodes, [edge('a', 'b'), edge('b', 'c')], {}, ['b']));
    assert.equal(result.error, 'boundary-conflict'); assert.equal(result.nodes, nodes);
  });
  await test('horizontal selected turns keep their fixed parent and child row', async () => {
    const nodes = [node('a', 0, 80), node('b', 400, 20), node('c', 1400, 80)];
    const result = (await plan(nodes, [edge('a', 'b'), edge('b', 'c')], { direction: 'horizontal' }, ['b']));
    assert.equal(result.error, undefined);
    assert.equal(result.nodes[0], nodes[0]); assert.equal(result.nodes[2], nodes[2]);
    assert.equal(result.nodes[1].position.y, 80);
    assert.ok(result.nodes[1].position.x >= 200 && result.nodes[1].position.x + 200 < 1400);
  });
  await test('unselected materials and background frames stay fixed when arranging their selected children', async () => {
    const nodes = [node('file', 100, 100, 700, 400, { stepKind: 'file' }), node('frame', -100, -100, 2000, 2000, { stepKind: 'frame' }), node('a', 100, 50), node('b', 100, 200)];
    const result = (await plan(nodes, [edge('file', 'a'), edge('a', 'b')], {}, ['a', 'b']));
    assert.equal(result.error, undefined);
    assert.equal(result.nodes[0], nodes[0]); assert.equal(result.nodes[1], nodes[1]);
    assert.ok(result.nodes[2].position.y >= 500); assertClear(result.nodes);
  });
  await test('a materials-only selection can be arranged', async () => {
    const nodes = [node('file', 0, 800, 400, 500, { stepKind: 'file' }), node('note', 0, -400, 600, 250, { stepKind: 'note' }),
      node('link', 0, 0, 300, 200, { stepKind: 'link' }), node('frame', 0, 0, 2000, 2000, { stepKind: 'frame' })];
    const edges = [edge('file', 'note'), edge('note', 'link')];
    const result = (await plan(nodes, edges, {}, ['file', 'note', 'link']));
    assert.equal(result.error, undefined); assertClear(result.nodes); assertOrder(result.nodes, edges, 'vertical');
    assert.equal(result.nodes[3], nodes[3]);
  });
  await test('a selected region arranges its contents without moving outside cards', async () => {
    const nodes = [node('frame', 0, 0, 2200, 2200, { stepKind: 'frame' }),
      node('a', 1500, 1500, 200, 120, {}),
      node('b', 5000, 5000, 200, 120, { stepKind: 'note' }), node('c', 100, 100)];
    const edges = [edge('a', 'c')];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const result = (await plan(nodes, edges, { direction, method }, ['frame']));
      assert.equal(result.error, undefined); assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
      assert.equal(get(result.nodes, 'b'), nodes[2], 'a region must not pull an outside card into its layout');
      assertContains(get(result.nodes, 'frame'), get(result.nodes, 'a'));
      assertContains(get(result.nodes, 'frame'), get(result.nodes, 'c'));
      assert.deepEqual(frameMembers(get(result.nodes, 'frame'), result.nodes).map(n => n.id).sort(), ['a', 'c']);
      const again = (await plan(result.nodes, edges, { direction, method }, ['frame']));
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes);
    }
  });
  await test('selecting a frame arranges its current contents and fits its new bounds', async () => {
    const nodes = [node('frame', 0, 0, 2000, 2000, { stepKind: 'frame' }), node('a', 1400, 1400), node('b', 400, 400),
      node('outside', 5000, 5000)];
    const edges = [edge('a', 'b')];
    const original = JSON.stringify(nodes);
    for (const direction of ['vertical', 'horizontal']) {
      const result = (await plan(nodes, edges, { direction }, ['frame']));
      assert.equal(result.error, undefined); assert.equal(JSON.stringify(nodes), original);
      assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
      assertContains(get(result.nodes, 'frame'), get(result.nodes, 'a'));
      assertContains(get(result.nodes, 'frame'), get(result.nodes, 'b'));
      assert.equal(get(result.nodes, 'outside'), get(nodes, 'outside'));
      assertTightFrame(result.nodes, 'frame');
      const again = (await plan(result.nodes, edges, { direction }, ['frame']));
      assert.equal(again.error, undefined);
      assert.deepEqual(again.nodes, result.nodes, 'repeated frame layout must not move or resize its contents');
    }
  });
  await test('large empty margins and long titles never determine a populated region size', async () => {
    const cards = [node('a', 400, 400, 360, 240), node('b', 400, 800, 360, 240)];
    const edges = [edge('a', 'b')];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const small = [node('frame', 0, 0, 1200, 1600, { stepKind: 'frame' }), ...cards];
      const large = [node('frame', -1000, -1000, 9000, 9000, {
        stepKind: 'frame', question: '很长的分区标题不应该撑开画布 '.repeat(30),
      }), ...cards];
      const compact = await plan(small, edges, { direction, method }, ['frame']);
      const result = await plan(large, edges, { direction, method }, ['frame']);
      assert.equal(compact.error, undefined); assert.equal(result.error, undefined);
      const fitted = get(result.nodes, 'frame'), expected = get(compact.nodes, 'frame');
      assert.equal(fitted.width, expected.width); assert.equal(fitted.height, expected.height);
      assertTightFrame(result.nodes, 'frame');
      assert.deepEqual(normalized(result.nodes), normalized(compact.nodes));
      assert.ok(fitted.width * fitted.height < 9000 * 9000 / 50, 'old empty area leaked into the new frame');
    }
  });
  await test('regions shrink after removal and expand when new contained turns are arranged', async () => {
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const options = { direction, method };
      const nodes = [node('frame', 0, 0, 4000, 4000, { stepKind: 'frame' }),
        node('a', 400, 400, 360, 240), node('b', 800, 800, 360, 240)];
      const initial = await plan(nodes, [edge('a', 'b')], options, ['frame']);
      assert.equal(initial.error, undefined);
      const removed = await plan(initial.nodes.filter(n => n.id !== 'b'), [], options, ['frame']);
      assert.equal(removed.error, undefined); assertTightFrame(removed.nodes, 'frame');
      const originalFrame = get(initial.nodes, 'frame'), small = get(removed.nodes, 'frame');
      const primarySize = direction === 'horizontal' ? 'width' : 'height';
      assert.ok(small[primarySize] < originalFrame[primarySize], 'removing a turn must shrink the region');
      const a = get(removed.nodes, 'a');
      // A newly duplicated card is still in the current region before layout.
      const added = node('added', a.position.x, a.position.y, a.width, a.height);
      const expanded = await plan([...removed.nodes, added], [edge('a', 'added')], options, ['frame']);
      assert.equal(expanded.error, undefined); assertTightFrame(expanded.nodes, 'frame');
      assert.ok(get(expanded.nodes, 'frame')[primarySize] > small[primarySize], 'a new turn must expand the region');
      assertOrder(expanded.nodes, [edge('a', 'added')], direction); assertClear(expanded.nodes);
      const again = await plan(expanded.nodes, [edge('a', 'added')], options, ['frame']);
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, expanded.nodes);
    }
  });
  await test('thumbnail measurements do not clip the working card or change manual fit after layout', async () => {
    const a = { ...node('a', 400, 400, 520, 640), measured: { width: 120, height: 80 } };
    const nodes = [node('frame', 0, 0, 6000, 6000, { stepKind: 'frame' }), a];
    for (const direction of ['vertical', 'horizontal']) {
      const result = await plan(nodes, [], { direction }, ['frame']);
      assert.equal(result.error, undefined);
      const frame = get(result.nodes, 'frame');
      assert.equal(frame.width, 584); assert.equal(frame.height, 752);
      assertContains(frame, get(result.nodes, 'a'));
      assertTightFrame(result.nodes, 'frame');
    }
  });
  await test('nested frames fit inside out after arranging the full selection', async () => {
    const nodes = [node('outer', -100, -100, 4000, 4000, { stepKind: 'frame' }),
      node('inner', 0, 0, 2000, 2000, { stepKind: 'frame' }), node('a', 1500, 1500), node('b', 500, 500),
      node('c', 2800, 3000), node('empty', 8000, 8000, 600, 600, { stepKind: 'frame' })];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    for (const direction of ['vertical', 'horizontal']) {
      for (const ids of [nodes.map((n) => n.id), ['outer']]) {
        const result = (await plan(nodes, edges, { direction }, ids));
        assert.equal(result.error, undefined); assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
        assertContains(get(result.nodes, 'inner'), get(result.nodes, 'a'));
        assertContains(get(result.nodes, 'inner'), get(result.nodes, 'b'));
        assertContains(get(result.nodes, 'outer'), get(result.nodes, 'inner'));
        assertContains(get(result.nodes, 'outer'), get(result.nodes, 'c'));
        assertTightFrame(result.nodes, 'inner'); assertTightFrame(result.nodes, 'outer');
        if (!ids.includes('empty')) assert.equal(get(result.nodes, 'empty'), get(nodes, 'empty'));
        assert.equal(get(result.nodes, 'empty').width, 600);
        assert.equal(get(result.nodes, 'empty').height, 600);
      }
    }
    const emptyOnly = (await plan(nodes, edges, {}, ['empty']));
    assert.equal(emptyOnly.error, 'empty-selection');
    assert.deepEqual(emptyOnly.nodes, nodes);
  });
  await test('selected empty regions retain their dimensions and never absorb arranged cards', async () => {
    const nodes = [node('a', 0, 1000), node('b', 1000, 0),
      node('empty', -32, -208, 400, 400, { stepKind: 'frame' })];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const result = await plan(nodes, [], { direction, method });
      assert.equal(result.error, undefined);
      const empty = get(result.nodes, 'empty');
      assert.equal(empty.width, 400); assert.equal(empty.height, 400);
      assert.deepEqual(frameMembers(empty, result.nodes), []);
      for (const card of result.nodes.filter(n => n.id !== 'empty')) {
        assert.ok(empty.position.x + empty.width <= card.position.x || card.position.x + card.width <= empty.position.x
          || empty.position.y + empty.height <= card.position.y || card.position.y + card.height <= empty.position.y,
        'empty region overlaps an arranged card');
      }
      const again = await plan(result.nodes, [], { direction, method });
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes);
    }
  });
  await test('nested empty regions move with the selected outer region without acquiring members', async () => {
    const nodes = [node('outer', -100, -100, 2500, 2500, { stepKind: 'frame' }),
      node('empty', 0, 0, 400, 400, { stepKind: 'frame' }), node('a', 1000, 1000), node('b', 1500, 500), node('outside', 5000, 5000)];
    const edges = [edge('a', 'b')];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const result = await plan(nodes, edges, { direction, method }, ['outer']);
      assert.equal(result.error, undefined);
      const empty = get(result.nodes, 'empty');
      assert.equal(empty.width, 400); assert.equal(empty.height, 400);
      assertContains(get(result.nodes, 'outer'), empty);
      assert.deepEqual(frameMembers(empty, result.nodes), []);
      assert.equal(get(result.nodes, 'outside'), get(nodes, 'outside'));
      const again = await plan(result.nodes, edges, { direction, method }, ['outer']);
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes);
    }
  });
  await test('separate regions keep their roots and branches together without overlapping or drifting', async () => {
    const nodes = [node('region-a', 0, 0, 2500, 2000, { stepKind: 'frame' }),
      node('region-b', 4000, 0, 2500, 2000, { stepKind: 'frame' }),
      node('a-root', 100, 100), node('z-root', 1500, 100), node('a-next', 100, 900), node('m-a-branch', 1000, 900),
      node('b-root', 4100, 100), node('y-root', 5500, 100), node('b-next', 4100, 900), node('m-b-branch', 5000, 900)];
    const edges = [edge('a-root', 'a-next'), edge('a-root', 'm-a-branch', { isBranchFromSelection: true }),
      edge('b-root', 'b-next'), edge('b-root', 'm-b-branch', { isBranchFromSelection: true })];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const result = (await plan(nodes, edges, { direction, method }, nodes.map((n) => n.id)));
      assert.equal(result.error, undefined); assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
      const a = get(result.nodes, 'region-a'), b = get(result.nodes, 'region-b');
      for (const id of ['a-root', 'z-root', 'a-next', 'm-a-branch']) assertContains(a, get(result.nodes, id));
      for (const id of ['b-root', 'y-root', 'b-next', 'm-b-branch']) assertContains(b, get(result.nodes, id));
      assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x
        || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y, 'independent regions overlap');
      const again = (await plan(result.nodes, edges, { direction, method }, result.nodes.map((n) => n.id)));
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes, 'region membership or placement drifted');
    }
  });
  await test('a continuation across regions keeps region membership stable', async () => {
    const nodes = [node('region-a', 0, 0, 2000, 2000, { stepKind: 'frame' }),
      node('region-b', 4000, 0, 2000, 2000, { stepKind: 'frame' }),
      node('a', 100, 100, 200, 120, {}), node('z', 1000, 100),
      node('b', 4100, 100, 200, 120, {}), node('y', 5100, 100), node('b-next', 4100, 900)];
    const edges = [edge('a', 'b'), edge('b', 'b-next')];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const result = (await plan(nodes, edges, { direction, method }));
      assert.equal(result.error, undefined); assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
      const a = get(result.nodes, 'region-a'), b = get(result.nodes, 'region-b');
      for (const id of ['a', 'z']) assertContains(a, get(result.nodes, id));
      for (const id of ['b', 'y', 'b-next']) assertContains(b, get(result.nodes, id));
      assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x
        || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y, 'connected regions overlap');
      const cross = direction === 'horizontal' ? 'y' : 'x';
      assert.equal(get(result.nodes, 'a').position[cross], get(result.nodes, 'b').position[cross], 'cross-region chain lost alignment');
      const again = (await plan(result.nodes, edges, { direction, method }));
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes, 'a region absorbed another region on the next layout');
    }
  });
  await test('a region with upstream and downstream turns does not absorb an unrelated outside node', async () => {
    const nodes = [node('region', 0, 0, 2200, 2200, { stepKind: 'frame' }),
      node('a-root', 100, 100), node('z-next', 100, 1400), node('m-branch', 1400, 1400), node('b-outside', 5000, 100)];
    const edges = [edge('a-root', 'z-next'), edge('a-root', 'm-branch', { isBranchFromSelection: true })];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const result = (await plan(nodes, edges, { direction, method }));
      assert.equal(result.error, undefined); assertOrder(result.nodes, edges, direction); assertClear(result.nodes);
      const frame = get(result.nodes, 'region'), outside = get(result.nodes, 'b-outside');
      for (const id of ['a-root', 'z-next', 'm-branch']) assertContains(frame, get(result.nodes, id));
      assert.ok(frame.position.x + frame.width <= outside.position.x || outside.position.x + outside.width <= frame.position.x
        || frame.position.y + frame.height <= outside.position.y || outside.position.y + outside.height <= frame.position.y,
      'outside node moved inside the region');
      const again = (await plan(result.nodes, edges, { direction, method }));
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes, 'outside node changed region membership');
    }
  });
  await test('aspect-ratio-locked regions clear their neighbors using their fitted size without drifting', async () => {
    const nodes = [node('fa', -40, -40, 1000, 200, { stepKind: 'frame', lockAspectRatio: true }), node('a', 0, 0),
      node('fb', 1460, -40, 300, 200, { stepKind: 'frame' }), node('b', 1500, 0)];
    for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
      const result = (await plan(nodes, [], { direction, method }));
      assert.equal(result.error, undefined); assertClear(result.nodes);
      const a = get(result.nodes, 'fa'), b = get(result.nodes, 'fb');
      assertContains(a, get(result.nodes, 'a')); assertContains(b, get(result.nodes, 'b'));
      assert.equal(a.width / a.height, 5);
      assertTightFrame(result.nodes, 'fa'); assertTightFrame(result.nodes, 'fb');
      assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x
        || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y, 'fitted locked frame overlaps its neighbor');
      const again = (await plan(result.nodes, [], { direction, method }));
      assert.equal(again.error, undefined); assert.deepEqual(again.nodes, result.nodes, 'locked frame bounds drifted');
    }
  });
  await test('fitted regions between fixed context turns stay stable across repeated layouts', async () => {
    for (const direction of ['vertical', 'horizontal']) for (const ratio of [undefined, 2, 0.5]) {
      const horizontal = direction === 'horizontal';
      const frame = node('frame', 0, 0, 2000, ratio ? 2000 / ratio : 2000,
        { stepKind: 'frame', lockAspectRatio: !!ratio });
      const nodes = [node('upstream', 2500, 2500), frame, node('first', 100, 200), node('last', 500, 600),
        node('downstream', horizontal ? 6000 : 2500, horizontal ? 2500 : 6000)];
      const edges = [edge('upstream', 'first'), edge('first', 'last'), edge('last', 'downstream')];
      let previous = await plan(nodes, edges, { direction }, ['frame']);
      assert.equal(previous.error, undefined); assertOrder(previous.nodes, edges, direction);
      assertTightFrame(previous.nodes, 'frame');
      for (let repeat = 0; repeat < 3; repeat++) {
        const result = await plan(previous.nodes, edges, { direction }, ['frame']);
        assert.equal(result.error, undefined);
        assert.deepEqual(result.nodes, previous.nodes, `${direction} ratio ${ratio}: repeated fit drifted`);
        for (const id of ['upstream', 'downstream']) assert.equal(get(result.nodes, id), get(nodes, id));
        previous = result;
      }
    }
  });
  await test('interleaved region dependencies refuse atomically instead of absorbing a sibling region', async () => {
    const base = [node('fa', 0, 0, 2000, 2000, { stepKind: 'frame' }),
      node('fb', 4000, 0, 2000, 2000, { stepKind: 'frame' }), node('a', 100, 100), node('c', 1000, 100), node('b', 4100, 100)];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    for (const nodes of [base, [...base, node('y', 5100, 100)]]) {
      for (const direction of ['vertical', 'horizontal']) for (const method of ['chains', 'layers']) {
        const result = (await plan(nodes, edges, { direction, method }));
        assert.equal(result.error, 'frame-conflict');
        assert.equal(result.nodes, nodes, 'failed region constraints must not partially move nodes or resize frames');
      }
    }
  });
  await test('edge handle geometry never changes continuation or branch semantics', async () => {
    const nodes = [node('root'), node('main'), node('branch'), node('next')];
    const edges = [edge('root', 'main'), edge('root', 'branch', { isBranchFromSelection: true }), edge('main', 'next')];
    for (const direction of ['vertical', 'horizontal']) {
      const expected = (await plan(nodes, edges, { direction }));
      const changed = (await plan(nodes, edges.map((e, i) => ({ ...e, sourceHandle: i % 2 ? 'left' : 'bottom', targetHandle: i % 2 ? 'right' : 'top' })), { direction }));
      assert.equal(changed.error, undefined); assert.deepEqual(normalized(changed.nodes), normalized(expected.nodes));
    }
  });
  await test('sole-reference parent adoption is stable when cross-links are reordered', async () => {
    const nodes = [node('a'), node('b'), node('child'), node('next')];
    const edges = [edge('a', 'child', { isCrossLink: true, createdAt: '2026-01-01T00:00:00Z' }),
      edge('b', 'child', { isCrossLink: true, createdAt: '2026-01-02T00:00:00Z' }), edge('child', 'next'),
      edge('next', 'a', { isWatch: true })];
    const expected = (await plan(nodes, edges));
    const reversed = (await plan([...nodes].reverse(), [...edges].reverse()));
    assert.equal(expected.error, undefined); assert.equal(reversed.error, undefined);
    assert.deepEqual(normalized(reversed.nodes), normalized(expected.nodes));
    assert.equal(get(expected.nodes, 'a').position.x, get(expected.nodes, 'child').position.x);
    assert.ok(get(expected.nodes, 'child').position.y >= get(expected.nodes, 'a').position.y + 120);
  });
  await test('selection avoids unselected obstacles without moving them', async () => {
    const nodes = [node('a'), node('b'), node('fixed', 0, 400, 400, 400)];
    const result = (await plan(nodes, [edge('a', 'b')], {}, ['a', 'b']));
    assert.equal(result.error, undefined); assert.equal(result.nodes[2], nodes[2]); assertClear(result.nodes);
  });
  await test('cycles and empty scopes produce explicit failures', async () => {
    const nodes = [node('a'), node('b')];
    assert.equal((await plan(nodes, [edge('a', 'b'), edge('b', 'a')])).error, 'cycle');
    assert.equal((await plan(nodes, [], {}, [])).error, 'empty-selection');
  });
  await test('new horizontal turns inherit direction and route across a batch', async () => {
    const parent = node('p', 100, 200, 600, 300, { layoutDirection: 'horizontal', edgeRouteDefault: 'orthogonal' });
    const result = placeNewNodes([parent, node('a'), node('b')], [edge('p', 'a'), edge('a', 'b')], ['a', 'b']);
    assert.equal(result[0], parent);
    for (const id of ['a', 'b']) {
      const n = get(result, id); assert.equal(n.position.y, 200);
      assert.equal(n.data.layoutDirection, 'horizontal'); assert.equal(n.data.edgeRouteDefault, 'orthogonal');
    }
    assert.ok(get(result, 'a').position.x >= 700); assertClear(result);
  });
  await test('horizontal merge advances past every parent and keeps its owner row', async () => {
    const a = node('a', 0, 0, 200, 120, { layoutDirection: 'horizontal' }), b = node('b', 1000, 500, 800, 200);
    const result = placeNewNodes([a, b, node('m')], [edge('a', 'm'), edge('b', 'm')], ['m']);
    assert.equal(result[0], a); assert.equal(result[1], b);
    assert.equal(result[2].position.y, 0); assert.ok(result[2].position.x >= 1800); assertClear(result);
  });
  await test('horizontal continuation skips occupied space without drifting off its row', async () => {
    const p = node('p', 0, 0, 200, 120, { layoutDirection: 'horizontal' }), blocker = node('blocker', 280, 0, 400, 400);
    const result = placeNewNodes([p, blocker, node('new')], [edge('p', 'new')], ['new']);
    assert.equal(result[0], p); assert.equal(result[1], blocker);
    assert.equal(result[2].position.y, 0); assert.ok(result[2].position.x >= 680); assertClear(result);
  });
  await test('vertical continuation skips occupied space without drifting off its column', async () => {
    const p = node('p', 0, 0), blocker = node('blocker', 0, 180, 400, 400);
    const result = placeNewNodes([p, blocker, node('new')], [edge('p', 'new')], ['new']);
    assert.equal(result[2].position.x, 0); assert.ok(result[2].position.y >= 580); assertClear(result);
  });
  await test('horizontal sibling branches use separate rows', async () => {
    const p = node('p', 0, 0, 200, 200, { layoutDirection: 'horizontal' });
    const siblings = [node('a', 0, 0, 400, 300), node('b', 0, 0, 700, 600)];
    const result = placeNewNodes([p, ...siblings], siblings.map((n) => edge('p', n.id, { isBranchFromSelection: true })), ['a', 'b']);
    assertClear(result); assert.ok(result[1].position.x >= 200 && result[2].position.x >= 200);
    assert.notEqual(result[1].position.y, result[2].position.y);
  });
  await test('benchmark canvases retain topology and restore layout after dragging every node', async () => {
    const directory = new URL('../benchmark/canvases/inputs/', import.meta.url);
    const files = readdirSync(directory).filter((name) => name.endsWith('.thoughtdag.json'));
    assert.ok(files.length > 0, 'no benchmark canvases found');
    const next = random(412);
    for (const file of files) {
      const canvas = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
      for (const direction of ['vertical', 'horizontal']) {
        const expected = (await plan(canvas.nodes, canvas.edges, { direction }));
        assert.equal(expected.error, undefined, `${file} ${direction}`);
        const input = scattered(canvas.nodes, next);
        const result = (await plan(input, shuffled(canvas.edges, next), { direction }, input.map((n) => n.id)));
        assert.equal(result.error, undefined, `${file} ${direction} shuffled`);
        assert.deepEqual(normalized(result.nodes), normalized(expected.nodes), `${file} ${direction} changed structure`);
        assertClear(result.nodes, nodeHeight); assertOrder(result.nodes, canvas.edges, direction, nodeHeight);
      }
    }
  });
} finally {
  unlinkSync(bundle); unlinkSync(placementBundle); unlinkSync(framesBundle); rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
