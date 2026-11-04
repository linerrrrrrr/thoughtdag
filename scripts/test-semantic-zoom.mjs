#!/usr/bin/env node
// Canvas-wide hysteresis must survive node culling and asynchronous ladder mounts.
// Run: node scripts/test-semantic-zoom.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-semantic-zoom-'));
const bundle = join(temporary, 'semantic-zoom.mjs');
let failures = 0;

function test(name, run) {
  try { run(); console.log(`  ok   ${name}`); }
  catch (error) { failures++; console.error(`  FAIL ${name}\n       ${error.message}`); }
}

function canvas(initialZoom = 1) {
  let transform = [0, 0, initialZoom];
  const listeners = new Set();
  const getState = () => ({ transform });
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const move = (zoom, x = transform[0], y = transform[1]) => {
    transform = [x, y, zoom];
    for (const listener of listeners) listener();
  };
  // React Flow returns a separate useStoreApi facade for each hook instance.
  return { api: () => ({ getState, subscribe }), move, listeners };
}

try {
  buildSync({ entryPoints: [join(root, 'src/lib/semantic-zoom-state.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { semanticZoomStateFor } = await import(pathToFileURL(bundle).href);

  for (const { name, path, expected } of [
    { name: 'map/work hysteresis at 0.85', path: [0.8, 0.85], expected: { tier: 'map', level: 3 } },
    { name: 'summary detail hysteresis at 0.52', path: [0.4, 0.52], expected: { tier: 'map', level: 1 } },
    { name: 'glyph/map hysteresis at 0.36', path: [0.3, 0.36], expected: { tier: 'glyph', level: 1 } },
  ]) {
    test(`new and existing nodes share ${name}`, () => {
      const flow = canvas();
      const existing = semanticZoomStateFor(flow.api());
      const stopExisting = existing.subscribe(() => {});
      for (const zoom of path) flow.move(zoom);
      const newlyMounted = semanticZoomStateFor(flow.api());
      const stopNew = newlyMounted.subscribe(() => {});
      assert.equal(newlyMounted, existing, 'API facades must resolve to one canvas state');
      assert.equal(newlyMounted.getSnapshot().tier, expected.tier);
      assert.equal(newlyMounted.getSnapshot().level, expected.level);
      assert.equal(flow.listeners.size, 1, 'all nodes share one React Flow subscription');
      stopNew(); stopExisting();
    });
  }

  test('the permanent canvas tag tracks zoom while every node is culled', () => {
    const flow = canvas();
    const state = semanticZoomStateFor(flow.api());
    const stopTag = state.subscribe(() => {});
    const stopNode = state.subscribe(() => {});
    stopNode();
    flow.move(0.3); flow.move(0.36);
    assert.equal(semanticZoomStateFor(flow.api()).getSnapshot().tier, 'glyph');
    flow.move(0.4);
    assert.equal(state.getSnapshot().tier, 'map');
    flow.move(0.9);
    assert.equal(state.getSnapshot().tier, 'work');
    stopTag();
  });

  test('pan-only movement and zoom within a detail band do not notify nodes', () => {
    const flow = canvas();
    const state = semanticZoomStateFor(flow.api());
    let notices = 0;
    const stop = state.subscribe(() => { notices++; });
    flow.move(0.8);
    assert.equal(notices, 1);
    const beforePan = state.getSnapshot();
    flow.move(0.8, 500, -300);
    assert.equal(state.getSnapshot(), beforePan);
    flow.move(0.79);
    assert.equal(notices, 1);
    stop();
  });

  test('different canvases retain independent hysteresis histories', () => {
    const a = canvas(), b = canvas(0.85);
    const first = semanticZoomStateFor(a.api()), second = semanticZoomStateFor(b.api());
    const stopA = first.subscribe(() => {}), stopB = second.subscribe(() => {});
    a.move(0.8); a.move(0.85);
    assert.notEqual(first, second);
    assert.equal(first.getSnapshot().tier, 'map');
    assert.equal(second.getSnapshot().tier, 'work');
    stopA(); stopB();
  });

  test('the last unsubscribe releases React Flow and remount reconnects once', () => {
    const flow = canvas();
    const state = semanticZoomStateFor(flow.api());
    const stopA = state.subscribe(() => {}), stopB = state.subscribe(() => {});
    stopA(); assert.equal(flow.listeners.size, 1);
    stopB(); assert.equal(flow.listeners.size, 0);
    const stopAgain = state.subscribe(() => {});
    assert.equal(flow.listeners.size, 1);
    flow.move(0.8);
    assert.equal(state.getSnapshot().tier, 'map');
    stopAgain(); assert.equal(flow.listeners.size, 0);
  });

  test('an earlier React Flow subscriber reading a snapshot cannot swallow notification', () => {
    const flow = canvas();
    const state = semanticZoomStateFor(flow.api());
    const stopReader = flow.api().subscribe(() => state.getSnapshot());
    let notices = 0;
    const stop = state.subscribe(() => { notices++; });
    flow.move(0.8);
    assert.equal(notices, 1);
    stop(); stopReader();
  });
} finally {
  // Remove only this script's known file and its now-empty temporary directory.
  if (existsSync(bundle)) unlinkSync(bundle);
  rmdirSync(temporary);
}

if (failures) process.exitCode = 1;
else console.log('Shared semantic zoom checks passed.');
