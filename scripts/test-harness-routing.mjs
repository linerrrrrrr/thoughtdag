#!/usr/bin/env node
// Native harness turns keep their own identity without a session-map ledger.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'td-harness-route-'));
try {
  const outfile = join(temp, 'harness.mjs');
  await build({
    entryPoints: [join(root, 'src/lib/agents/harness-bridge.ts')], outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'state-fixtures', setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (!args.importer.endsWith('harness-bridge.ts')) return;
        if (args.path === '../../store') return { path: 'store', namespace: 'fixture' };
        if (args.path === '../../store/projects') return { path: 'projects', namespace: 'fixture' };
        if (args.path === '../ui-store') return { path: 'ui', namespace: 'fixture' };
      });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        contents: path === 'store' ? 'export const useStore={getState:()=>globalThis.graph};'
          : path === 'projects' ? 'export const useProjects={getState:()=>globalThis.projects};'
            : 'export const useUiStore={getState:()=>({})};', loader: 'js',
      }));
    } }],
  });
  globalThis.window = { desktopSessions: {}, desktopAgents: { workspace: async () => 'D:/canvas' } };
  globalThis.projects = { activeId: 'canvas', projects: [{ id: 'canvas' }] };
  const original = { id: 'first', data: { question: 'q', response: 'a', source: { question: 'q', response: 'a' },
    importSource: { runner: 'dsh', sessionId: 'session-1', itemIds: ['turn-1'], cwd: 'D:/work' } } };
  const next = { id: 'next', data: {} };
  globalThis.graph = { nodes: [original, next], edges: [{ source: 'first', target: 'next' }] };
  const { harnessOutbound, markHarnessTurn, stampHarnessTurn } = await import(pathToFileURL(outfile).href);
  assert.deepEqual(await harnessOutbound('next', 'harness/agent'), { cwd: 'D:/work', session: 'session-1' });
  assert.equal(await harnessOutbound('next', 'api/model'), undefined);

  const later = { id: 'later', data: { importSource: { runner: 'dsh', sessionId: 'session-1', itemIds: ['turn-2'], cwd: 'D:/work' } } };
  graph.nodes.push(later); graph.edges.push({ source: 'first', target: 'later' });
  assert.deepEqual(await harnessOutbound('next', 'harness/agent'), { cwd: 'D:/work', forkSession: 'session-1', forkAnchor: 'turn-1' });
  original.data.response = 'edited';
  assert.deepEqual(await harnessOutbound('next', 'harness/agent'), { cwd: 'D:/work' });
  original.data.response = 'a';
  projects.projects[0].agentCwd = 'D:/other';
  assert.deepEqual(await harnessOutbound('next', 'harness/agent'), { cwd: 'D:/other' });

  const set = (fn) => Object.assign(graph, fn(graph));
  const route = { cwd: 'D:/work', session: 'session-1' };
  markHarnessTurn(set, 'next', route, { session: 'session-1', turn: 2, userMessageId: 'turn-2', seq: 5 });
  stampHarnessTurn(set, 'next', { question: 'new q', response: 'new a' }, route, undefined, { session: 'session-1', turn: 2, userMessageId: 'turn-2', seq: 5 });
  assert.equal(graph.nodes.find((n) => n.id === 'next').data.importSource.itemIds[0], 'turn-2');
  assert.deepEqual(graph.nodes.find((n) => n.id === 'next').data.source, { question: 'new q', response: 'new a' });
  console.log('PASS: native harness continuation, branching, edited context and turn provenance without map subscriptions.');
} finally {
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('td-harness-route-')) throw new Error('Unexpected test cleanup path');
  rmSync(temp, { recursive: true, force: true });
}
