// A changed import policy must repair an unchanged subscribed source once
// per app launch. Synthetic stores exercise the real live-mirror control flow.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as nextTick } from 'node:timers/promises';

const dir = mkdtempSync(join(tmpdir(), 'td-live-import-'));
const state = {
  activeId: 'project-a',
  projects: [
    { id: 'project-a', sourceSession: { sessionId: 'session-old-a' } },
    { id: 'project-b', sourceSession: { sessionId: 'session-old-b' } },
    { id: 'project-c' },
  ],
  imports: [], heads: [], reads: [], toasts: [], markWrites: 0, anchorCalls: 0,
  nodes: [], projectListeners: new Set(), watchStarts: 0, sessionRegistrations: 0,
  changed: null,
};
const waitFor = async (predicate, description) => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`Timed out: ${description}`);
    await nextTick();
  }
};
const flush = async () => { for (let i = 0; i < 8; i++) await nextTick(); };
const files = [
  { rel: '2026\\01\\01\\rollout-session-old-a.jsonl', size: 900, mtime: 100 },
  { rel: '2026\\01\\01\\rollout-session-old-b.jsonl', size: 800, mtime: 90 },
  { rel: '2026\\01\\01\\rollout-session-old-c.jsonl', size: 750, mtime: 85 },
  { rel: '2026\\01\\01\\rollout-guardian-session.jsonl', size: 700, mtime: 80 },
];
const metadata = new Map(files.map((file, i) => [file.rel, JSON.stringify({
  type: 'session_meta', payload: i < 3
    ? { id: `session-old-${['a', 'b', 'c'][i]}`, thread_source: 'user' }
    : { id: 'guardian-session', parent_thread_id: 'session-old-a', thread_source: 'guardian_review' },
}) + '\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[[thoughtdag:anchor project=project-a node=anchor mode=branch]]' }] } })]));
const markKey = 'thoughtdag.atlas.sweepmark';
const storage = new Map([[markKey, JSON.stringify(Object.fromEntries(files.map((f) => [`codex-sessions|${f.rel}`, `${f.mtime}|${f.size}`])))]]);

try {
  globalThis.__liveImportTest = state;
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); if (key === markKey) state.markWrites++; },
  };
  globalThis.CustomEvent ??= class CustomEvent extends Event {};
  // Browser transport installs this bridge asynchronously after startup.
  // Real EventTarget semantics catch missing and repeated readiness hooks.
  globalThis.window = new EventTarget();
  const bridge = {
    watchStart: async () => { state.watchStarts++; },
    roots: async () => [{ key: 'codex-sessions', exists: true }],
    list: async () => files.map((f) => ({ ...f })),
    head: async (root, rel) => { state.heads.push(rel); return metadata.get(rel) ?? ''; },
    onSessionsChanged: (fn) => { state.sessionRegistrations++; state.changed = fn; },
  };
  const stubs = {
    '../ui-store': `export const toast = (...args) => globalThis.__liveImportTest.toasts.push(args);
      export const useUiStore = { getState: () => ({ setArrivalFocusNodeId() {} }) };`,
    '../../i18n': 'export const t = (key) => key; export const fmt = (text) => text;',
    './subagents': 'export const withSubagents = async (conv) => conv;',
    '../../store/projects': `
      export const useProjects = {
        getState: () => globalThis.__liveImportTest,
        subscribe: (listener) => {
          const s = globalThis.__liveImportTest; s.projectListeners.add(listener);
          return () => s.projectListeners.delete(listener);
        },
      };
      export const bootProjects = async () => {};
      export const subscribedSessionIds = (p) => p.sourceSession ? [p.sourceSession.sessionId] : [];
      export const switchProject = async (id) => { globalThis.__liveImportTest.activeId = id; };`,
    '../../store': 'export const useStore = { getState: () => ({ nodes: globalThis.__liveImportTest.nodes }) };',
    '../experiment-loop': `export const parseAnchor = () => {
      const s = globalThis.__liveImportTest; s.anchorCalls++; return { project: s.activeId, node: 'anchor', mode: 'branch' };
    };`,
    '../adapters': 'export const streamRunnerConversation = async (read) => read();',
    './canonical': `
      export const shellSessionReader = (rootKey, rel) => async () => {
        globalThis.__liveImportTest.reads.push(rel); return { rel, rootKey };
      };
      export const importOrAppendConversation = async (conv, opts) => {
        if (!conv) return null;
        globalThis.__liveImportTest.imports.push({ ...conv, opts }); return { kind: 'opened' };
      };`,
  };
  const out = join(dir, 'live.mjs');
  await build({
    entryPoints: [resolve('src/lib/atlas/live-mirror.ts')], outfile: out,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'live-mirror-stores', setup(b) {
      b.onResolve({ filter: /^\./ }, (args) => /[\\/]atlas[\\/]live-mirror\.ts$/.test(args.importer) && stubs[args.path]
        ? { path: args.path, namespace: 'test' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'test' }, (args) => ({ contents: stubs[args.path] }));
    } }],
  });
  const { startLiveMirror, sweepRecentSessions, pickSessionFile } = await import(pathToFileURL(out).href);

  const candidates = [{ rel: 'parent-id\\subagents\\agent-child-id.jsonl' }, { rel: 'root\\parent-id.jsonl' }];
  assert.equal(pickSessionFile(candidates, 'parent-id'), candidates[1], 'Windows parent directory must not claim a child file');
  assert.equal(pickSessionFile(candidates, 'child-id'), candidates[0]);
  assert.equal(pickSessionFile([{ rel: 'parent-id/subagents/agent-child-id.jsonl' }], 'parent-id'), undefined, 'POSIX paths retain the same basename rule');

  startLiveMirror();
  startLiveMirror();
  await flush();
  assert.equal(state.watchStarts, 0, 'startup waits when the async bridge is absent');
  assert.equal(state.markWrites, 0, 'startup cannot mark sources before the bridge exists');
  window.desktopSessions = bridge;
  window.dispatchEvent(new Event('td:agents-ready'));
  window.dispatchEvent(new Event('td:agents-ready'));
  await waitFor(() => state.markWrites === 1, 'late bridge readiness starts the initial sweep');
  await flush();
  assert.equal(state.watchStarts, 1, 'repeated ready events start only one watcher');
  assert.equal(state.sessionRegistrations, 1, 'repeated ready events register only one file listener');
  assert.equal(state.projectListeners.size, 1, 'one project listener handles later canvas arrivals');
  window.dispatchEvent(new Event('td:agents-ready'));
  startLiveMirror();
  await flush();
  assert.equal(state.watchStarts, 1, 'ready events after startup do not restart watching');
  assert.equal(state.sessionRegistrations, 1);
  assert.equal(state.markWrites, 1, 'ready events after startup do not repeat the sweep');
  assert.deepEqual(state.reads, [files[0].rel], 'unchanged active subscription is imported once despite a matching persisted watermark');
  assert.deepEqual(state.imports[0].opts, { focusOnRefresh: false }, 'repair must not move the camera');
  assert.equal(state.toasts.length, 0, 'an unchanged opened projection is quiet');

  sweepRecentSessions();
  await waitFor(() => state.markWrites === 2, 'second sweep');
  assert.equal(state.imports.length, 1, 'a checked subscription is not repeatedly imported');

  const changeProject = (id, nodes = []) => {
    const previous = { ...state };
    state.activeId = id;
    state.nodes = nodes;
    for (const listener of state.projectListeners) listener(state, previous);
  };
  changeProject('project-b');
  await waitFor(() => state.markWrites === 3, 'switched project sweep');
  assert.deepEqual(state.reads, [files[0].rel, files[1].rel], 'a newly active project repairs its own unchanged subscription');

  changeProject('project-c', [{ id: 'legacy-node', data: { importSource: { runner: 'codex', sessionId: 'session-old-c', itemIds: ['turn-c'] } } }]);
  await waitFor(() => state.markWrites === 4, 'provenance-only project sweep');
  assert.deepEqual(state.reads, [files[0].rel, files[1].rel, files[2].rel], 'a lost ledger does not prevent repairing a source named by active node provenance');

  changeProject('project-a');
  await waitFor(() => state.markWrites === 5, 'returning project sweep');
  assert.equal(state.imports.length, 3, 'switching back does not repeat a completed projection');

  files[0].mtime++;
  sweepRecentSessions();
  await waitFor(() => state.markWrites === 6, 'changed source sweep');
  assert.equal(state.imports.length, 4, 'normal source growth still refreshes a checked projection');

  const before = { imports: state.imports.length, reads: state.reads.length, heads: state.heads.length };
  state.changed({ rootKey: 'codex-sessions', rel: files[3].rel });
  await waitFor(() => state.heads.length > before.heads, 'internal worker header');
  await flush();
  assert.equal(state.anchorCalls, 0, 'a guardian prompt cannot trigger anchor parsing');
  assert.equal(state.reads.length, before.reads, 'an internal worker does not enter the conversation reader');
  assert.equal(state.imports.length, before.imports, 'an internal worker cannot auto-mount a canvas');
  console.log('PASS: delayed bridge startup, idempotent ready hooks, automatic project repair, lost-ledger provenance, once-only refresh, normal growth, Windows basenames, guardian isolation');
} finally {
  delete globalThis.__liveImportTest;
  delete globalThis.window;
  delete globalThis.localStorage;
  rmSync(dir, { recursive: true, force: true });
}
