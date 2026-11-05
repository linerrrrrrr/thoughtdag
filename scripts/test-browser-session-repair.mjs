// Browser transport integration, executed in Node: keep the entire import
// pipeline real and mock only browser/persistence boundaries. No private logs,
// inference, network requests, or browser automation are used.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setImmediate as nextTick } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'td-browser-session-repair-'));
const output = join(temporary, 'integration.mjs');
const parentId = 'synthetic-parent-session';
const reviewId = 'synthetic-guardian-session';
const parentRel = `2026\\01\\01\\rollout-${parentId}.jsonl`;
const reviewRel = `2026\\01\\01\\rollout-${reviewId}.jsonl`;
const promptSentinel = 'SYNTHETIC_INTERNAL_REVIEW_PROMPT_MUST_NOT_BECOME_CONVERSATION';
const message = (role, text, timestamp) => ({ type: 'response_item', timestamp,
  payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
const parentLines = [{ type: 'session_meta', payload: { id: parentId, thread_source: 'user', source: 'vscode', cwd: 'D:/synthetic' } }];
for (let i = 1; i <= 5; i++) {
  parentLines.push({ type: 'turn_context', payload: { turn_id: `turn-${i}` } });
  parentLines.push(message('user', `Question ${i}`, `2026-01-01T10:0${i}:00Z`));
  parentLines.push(message('assistant', `Answer ${i}`, `2026-01-01T10:0${i}:01Z`));
}
const reviewLines = [{ type: 'session_meta', payload: { id: reviewId, parent_thread_id: parentId,
  thread_source: 'guardian_review', source: { subagent: { other: 'guardian' } } } }];
for (const [index, outcome] of [[2, 'allow'], [4, 'deny']]) {
  reviewLines.push({ type: 'event_msg', payload: { type: 'task_started', turn_id: `review-turn-${index}`,
    turn_attribution: { parent_turn_id: `turn-${index}` } } });
  reviewLines.push(message('user', promptSentinel));
  reviewLines.push(message('assistant', JSON.stringify({ outcome, risk_level: outcome === 'allow' ? 'low' : 'high',
    user_authorization: 'medium', rationale: `Synthetic ${outcome} result` })));
}
const jsonl = (lines) => lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
const texts = new Map([[parentRel, jsonl(parentLines)], [reviewRel, jsonl(reviewLines)]]);
const files = [...texts].map(([rel, text], index) => ({ rel, size: Buffer.byteLength(text), mtime: 100 + index }));
const markKey = 'thoughtdag.atlas.sweepmark';
const matchingMark = JSON.stringify(Object.fromEntries(files.map((file) => [`codex-sessions|${file.rel}`, `${file.mtime}|${file.size}`])));

const waitFor = async (predicate, description) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`Timed out: ${description}`);
    await nextTick();
  }
};
const flush = async () => { for (let i = 0; i < 10; i++) await nextTick(); };
const stubs = {
  store: `
    export const useStore = {
      getState: () => globalThis.__sessionRepair.store,
      setState: (update) => {
        const state = globalThis.__sessionRepair;
        state.store = { ...state.store, ...(typeof update === 'function' ? update(state.store) : update) };
      },
    };
    export const stripTransient = (nodes) => nodes;
  `,
  projects: `
    const fixture = () => globalThis.__sessionRepair;
    const update = (patch) => {
      const state = fixture(), before = state.projects;
      state.projects = { ...before, ...patch };
      for (const listener of state.projectListeners) listener(state.projects, before);
    };
    export const useProjects = {
      getState: () => fixture().projects,
      setState: (patch) => update(typeof patch === 'function' ? patch(fixture().projects) : patch),
      subscribe: (listener) => { fixture().projectListeners.add(listener); return () => fixture().projectListeners.delete(listener); },
    };
    export const bootProjects = async () => {};
    export const switchProject = async (id) => { if (id !== fixture().projects.activeId) update({ activeId: id }); };
    export const projectStorageKey = (id) => 'project:' + id;
    export const subscribedSessionIds = (project) => {
      const source = project.sourceSession;
      return source ? [source.sessionId, ...(source.chapters ?? []).map(c => c.sessionId), ...(source.branches ?? []).map(c => c.sessionId)].filter(Boolean) : [];
    };
    export const patchLedgerEntry = async (projectId, sessionId, patch) => {
      fixture().ledgerWrites++;
      update({ projects: fixture().projects.projects.map(project => {
        if (project.id !== projectId || !project.sourceSession) return project;
        const source = project.sourceSession;
        if (source.sessionId === sessionId) return { ...project, sourceSession: { ...source, ...patch } };
        return { ...project, sourceSession: { ...source,
          chapters: source.chapters?.map(entry => entry.sessionId === sessionId ? { ...entry, ...patch } : entry),
          branches: source.branches?.map(entry => entry.sessionId === sessionId ? { ...entry, ...patch } : entry),
        } };
      }) });
    };
    export const registerLedgerEntry = async (projectId, kind, entry) => {
      fixture().ledgerWrites++;
      update({ projects: fixture().projects.projects.map(project => project.id !== projectId ? project : {
        ...project, sourceSession: {
          ...(project.sourceSession ?? { sessionId: '', runner: '', importedCount: 0, tailNodeId: '' }),
          [kind === 'branch' ? 'branches' : 'chapters']: [entry],
        },
      }) });
    };
    export const adoptImportedProject = async () => { throw new Error('repair must not create a new canvas'); };
    export const createProject = adoptImportedProject;
    export const removeLedgerEntry = async () => { throw new Error('repair must not remove the subscription'); };
  `,
  ui: `
    export const toast = (...args) => { globalThis.__sessionRepair.toasts.push(args); };
    export const useUiStore = { getState: () => ({ setArrivalFocusNodeId: (id) => globalThis.__sessionRepair.focus.push(id) }) };
  `,
  i18n: 'export const t = (key) => key; export const fmt = (text) => text;',
  idb: 'export const set = async () => { throw new Error("repair must not persist a new project"); }; export const get = async () => null;',
  anchor: 'export const parseAnchor = () => null;',
};

try {
  await build({
    stdin: { contents: `
      export { startLiveMirror, sweepRecentSessions } from './src/lib/atlas/live-mirror.ts';
      export { CodexSessionCollector } from './src/lib/adapters/codex-session.ts';
      export { scanSessions, internalCodexChildren } from './src/lib/atlas/discover.ts';
    `, resolveDir: root },
    bundle: true, format: 'esm', platform: 'node', outfile: output, logLevel: 'silent', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'persistence-boundaries', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)store(?:\/index)?$/ }, () => ({ path: 'store', namespace: 'fixture' }));
      builder.onResolve({ filter: /\/store\/projects$/ }, () => ({ path: 'projects', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)ui-store$/ }, () => ({ path: 'ui', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)i18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
      builder.onResolve({ filter: /^idb-keyval$/ }, () => ({ path: 'idb', namespace: 'fixture' }));
      builder.onResolve({ filter: /experiment-loop$/ }, () => ({ path: 'anchor', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });

  for (const hasLedger of [true, false]) {
    const storage = new Map([[markKey, matchingMark]]);
    const state = {
      store: null, projects: null, projectListeners: new Set(),
      watchStarts: 0, listenerRegistrations: 0, markWrites: 0, ledgerWrites: 0,
      reads: [], heads: [], toasts: [], focus: [], historyWrites: 0, stalenessRuns: 0,
    };
    globalThis.__sessionRepair = state;
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); if (key === markKey) state.markWrites++; },
    };
    globalThis.CustomEvent ??= class CustomEvent extends Event {};
    globalThis.window = new EventTarget();
    const { startLiveMirror, sweepRecentSessions, CodexSessionCollector, scanSessions, internalCodexChildren } =
      await import(`${pathToFileURL(output).href}?ledger=${hasLedger}`);
    const collector = new CodexSessionCollector();
    for (const line of parentLines) collector.feedLine(JSON.stringify(line));
    const clean = collector.toConversation().build();
    assert.equal(clean.nodes.length, 5, 'fixture contains five real source turns');
    clean.nodes.forEach((node, index) => {
      node.position = { x: 730 + index * 17, y: 110 + index * 410 };
      node.width = 610 + index * 2;
      node.height = 340 + index * 3;
    });
    const beforeReal = structuredClone(clean.nodes);
    const bad = structuredClone(clean.nodes[1]);
    bad.id = 'old-misclassified-guardian';
    bad.position = { x: 10, y: 300 };
    bad.data.question = promptSentinel;
    bad.data.response = '{"outcome":"deny"}';
    bad.data.responses = [bad.data.response];
    bad.data.source = { question: bad.data.question, response: bad.data.response };
    bad.data.importSource = { runner: 'codex', sessionId: parentId, itemIds: [reviewId], subagent: { agent: 'codex', of: 'turn-2' } };
    bad.data.isBranch = true;
    state.store = {
      nodes: [...clean.nodes.slice(0, 2), bad, ...clean.nodes.slice(2)],
      edges: [...clean.edges,
        { id: 'bad-in', source: clean.nodes[1].id, target: bad.id },
        { id: 'bad-out', source: bad.id, target: clean.nodes[2].id },
      ],
      selectedNodeId: bad.id, selectedNodeIds: [bad.id],
      pushHistory() { state.historyWrites++; }, recomputeStaleness() { state.stalenessRuns++; },
    };
    state.projects = { activeId: 'existing-project', projects: [{ id: 'existing-project', name: 'Persisted synthetic canvas',
      ...(hasLedger ? { sourceSession: { sessionId: parentId, runner: 'codex', importedCount: 6, tailNodeId: clean.nodes.at(-1).id } } : {}),
    }] };
    const bridge = {
      watchStart: async () => { state.watchStarts++; return true; },
      onSessionsChanged: () => { state.listenerRegistrations++; },
      roots: async () => [{ key: 'codex-sessions', exists: true, path: 'synthetic', builtin: true }],
      list: async () => files.map((file) => ({ ...file })),
      head: async (_root, rel, bytes) => { state.heads.push(rel); return (texts.get(rel) ?? '').slice(0, bytes); },
      readRange: async (_root, rel, start, length) => {
        state.reads.push({ rel, start });
        const text = texts.get(rel) ?? '';
        const wanted = Math.min(text.length, start + Math.min(length, 450));
        let end = wanted < text.length ? text.lastIndexOf('\n', wanted) + 1 : text.length;
        if (end <= start) end = text.indexOf('\n', start) + 1 || text.length;
        return { text: text.slice(start, end), nextStart: end, eof: end >= text.length };
      },
    };

    startLiveMirror();
    startLiveMirror();
    await flush();
    assert.equal(state.store.nodes.length, 6);
    assert.equal(state.watchStarts, 0);
    assert.equal(state.markWrites, 0);
    window.desktopSessions = bridge;
    window.dispatchEvent(new Event('td:agents-ready'));
    window.dispatchEvent(new Event('td:agents-ready'));
    await waitFor(() => state.markWrites === 1, 'late bridge must run the complete unchanged-source repair pipeline');
    await flush();

    assert.equal(state.store.nodes.length, 5, 'the previously persisted guardian branch disappears without source growth');
    assert.equal(state.store.edges.length, clean.edges.length);
    assert.ok(state.store.edges.every((edge) => edge.source !== bad.id && edge.target !== bad.id));
    assert.deepEqual(state.store.nodes.map((node) => node.id), beforeReal.map((node) => node.id));
    for (const original of beforeReal) {
      const current = state.store.nodes.find((node) => node.id === original.id);
      assert.deepEqual(current.position, original.position, 'existing placement is untouched');
      assert.equal(current.width, original.width);
      assert.equal(current.height, original.height);
      assert.equal(current.data.question, original.data.question);
      assert.equal(current.data.response, original.data.response);
    }
    const source = state.projects.projects[0].sourceSession;
    const entry = source.sessionId === parentId ? source : source.chapters.find((chapter) => chapter.sessionId === parentId);
    assert.equal(entry.importedCount, 5);
    assert.equal(entry.tailNodeId, clean.nodes.at(-1).id);
    const audits = state.store.nodes.flatMap((node) => node.data.attachments
      .filter((attachment) => attachment.name === 'tool: autoApprovalReview')
      .map((attachment) => ({ node, attachment })));
    assert.equal(audits.length, 2, 'both allow and deny verdicts survive as audit attachments');
    assert.ok(audits.every(({ node, attachment }) => node.data.excludedAttachmentIds.includes(attachment.id)));
    assert.match(audits[0].attachment.content, /"outcome":"allow"/);
    assert.match(audits[1].attachment.content, /"outcome":"deny"/);
    assert.equal(audits[0].node.data.importSource.itemIds[0], 'turn-2');
    assert.equal(audits[1].node.data.importSource.itemIds[0], 'turn-4');
    assert.ok(!JSON.stringify(state.store.nodes).includes(promptSentinel), 'the reviewer prompt is absent from every remaining field');
    assert.equal(state.store.selectedNodeId, null);
    assert.deepEqual(state.store.selectedNodeIds, []);
    assert.equal(state.watchStarts, 1);
    assert.equal(state.listenerRegistrations, 1);
    assert.deepEqual(state.focus, [], 'background migration does not move the camera');
    assert.deepEqual(state.toasts, []);
    assert.ok(state.reads.some((read) => read.rel === parentRel));
    assert.ok(state.reads.some((read) => read.rel === reviewRel));
    assert.ok(state.reads.some((read) => read.start > 0), 'streaming readers really process multiple chunks');
    assert.deepEqual(internalCodexChildren(parentId), [reviewId]);
    const cards = await scanSessions();
    assert.deepEqual(cards.map((card) => card.sessionId), [parentId], 'review sessions never become atlas cards');
    const snapshot = JSON.stringify({ nodes: state.store.nodes, edges: state.store.edges, projects: state.projects });
    const readsBefore = state.reads.length, writesBefore = state.ledgerWrites;
    window.dispatchEvent(new Event('td:agents-ready'));
    startLiveMirror();
    sweepRecentSessions();
    await waitFor(() => state.markWrites === 2, 'second sweep completes');
    await flush();
    assert.equal(state.reads.length, readsBefore, 'unchanged, repaired projections are not re-imported');
    assert.equal(state.ledgerWrites, writesBefore);
    assert.equal(state.watchStarts, 1);
    assert.equal(JSON.stringify({ nodes: state.store.nodes, edges: state.store.edges, projects: state.projects }), snapshot);
    console.log(`PASS: complete browser repair pipeline with ${hasLedger ? 'persisted ledger' : 'provenance-only canvas'}; 6 nodes -> 5; excluded allow/deny audits; stable layout and repeated-ready/sweep idempotence`);
  }
} finally {
  delete globalThis.__sessionRepair;
  delete globalThis.window;
  delete globalThis.localStorage;
  rmSync(temporary, { recursive: true, force: true });
}
