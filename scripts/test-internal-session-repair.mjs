// Confirmed internal session IDs repair legacy mirrors without interpreting
// user text, overwriting edits, or leaving the append ledger one turn ahead.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'td-internal-repair-'));
const output = join(temporary, 'repair.mjs');
const stubs = {
  store: 'export const useStore = { getState: () => globalThis.__state, setState: (v) => Object.assign(globalThis.__state, typeof v === "function" ? v(globalThis.__state) : v) }; export const stripTransient = (v) => v;',
  projects: `
    export const useProjects = { getState: () => globalThis.__projects };
    export const switchProject = async () => {};
    export const patchLedgerEntry = async (projectId, sessionId, patch) => Object.assign(globalThis.__projects.projects.find(p => p.id === projectId).sourceSession, patch);
    export const projectStorageKey = (id) => id;
    export const subscribedSessionIds = () => [];
    export const adoptImportedProject = async () => { throw new Error('unexpected new project'); };
    export const createProject = adoptImportedProject, registerLedgerEntry = adoptImportedProject, removeLedgerEntry = adoptImportedProject;
  `,
  ui: 'export const useUiStore = { getState: () => ({ setArrivalFocusNodeId: () => {} }) }; export const toast = () => {};',
  i18n: 'export const t = (v) => v; export const fmt = (v) => v;',
  idb: 'export const set = async () => {}; export const get = async () => null;',
  anchor: 'export const parseAnchor = () => null;',
  adapters: 'export const anyRunnerSessionConversation = async () => null;',
};
try {
  await build({
    stdin: { contents: `export { repairInternalSessionNodes, syncApprovalAttachments } from './src/lib/atlas/internal-session-repair.ts'; export { importOrAppendConversation } from './src/lib/atlas/canonical.ts';`, resolveDir: root },
    bundle: true, format: 'esm', platform: 'node', outfile: output, logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'store-fixtures', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)store(?:\/index)?$/ }, () => ({ path: 'store', namespace: 'fixture' }));
      builder.onResolve({ filter: /\/store\/projects$/ }, () => ({ path: 'projects', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)ui-store$/ }, () => ({ path: 'ui', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)i18n$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
      builder.onResolve({ filter: /^idb-keyval$/ }, () => ({ path: 'idb', namespace: 'fixture' }));
      builder.onResolve({ filter: /experiment-loop$/ }, () => ({ path: 'anchor', namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\.\/adapters$/ }, () => ({ path: 'adapters', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const { repairInternalSessionNodes: repair, syncApprovalAttachments, importOrAppendConversation } = await import(pathToFileURL(output).href);
  const node = (id, item, patch = {}) => ({
    id, type: 'thought', position: { x: 10, y: 20 },
    data: { question: item, response: 'answer', responses: ['answer'], responseIndex: 0,
      isCollapsed: true, isEditing: false, isEditingResponse: false, isLoading: false,
      highlights: [], attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit',
      source: { question: item, response: 'answer' },
      importSource: { runner: 'codex', sessionId: 'parent', itemIds: [item] }, ...patch },
  });
  const child = (id = 'bad') => node(id, 'review', {
    importSource: { runner: 'codex', sessionId: 'parent', itemIds: ['review'], subagent: { agent: 'codex', of: 'turn-1' } },
  });
  const first = node('first', 'turn-1'), last = node('last', 'turn-2'), next = node('new', 'turn-3');
  const clean = [first, last], fresh = [node('fresh-first', 'turn-1'), node('fresh-last', 'turn-2'), next];
  const edges = [
    { id: 'main', source: 'first', target: 'last' },
    { id: 'review-in', source: 'first', target: 'bad' },
    { id: 'review-out', source: 'bad', target: 'last' },
  ];
  const ledger = { importedCount: 3, tailNodeId: 'last' };
  let result = repair([first, child(), last], edges, 'parent', ['review'], fresh, ledger);
  assert.deepEqual(result.nodes, clean);
  assert.deepEqual(result.edges, [edges[0]], 'do not invent replacement context edges');
  assert.deepEqual(result.ledger, { importedCount: 2, tailNodeId: 'last' });
  assert.equal(repair(result.nodes, result.edges, 'parent', ['review'], fresh, result.ledger).changed, false);

  const edited = child(); edited.data.question = 'My revised explanation';
  result = repair([first, edited, last], edges, 'parent', ['review'], fresh, ledger);
  assert.equal(result.nodes[1].data.question, 'My revised explanation');
  assert.equal(result.nodes[1].data.archived, true);
  assert.deepEqual(result.nodes[1].position, edited.position);
  assert.deepEqual(result.edges, [edges[0]]);
  assert.equal(repair(result.nodes, result.edges, 'parent', ['review'], fresh, result.ledger).changed, false);
  const renamed = child(); renamed.data.displayName = 'My annotation';
  assert.equal(repair([first, renamed, last], edges, 'parent', ['review'], fresh, ledger).nodes[1].data.displayName, 'My annotation');
  const summarized = child(); summarized.data.displaySummary = '';
  assert.equal(repair([first, summarized, last], edges, 'parent', ['review'], fresh, ledger).nodes[1].data.archived, true);
  const unknownSource = child(); delete unknownSource.data.source;
  assert.equal(repair([first, unknownSource, last], edges, 'parent', ['review'], fresh, ledger).nodes[1].data.archived, true);
  const attachment = { id: 'personal', name: 'notes.txt', type: 'text/plain', size: 8, content: 'my notes' };
  const annotated = child(); annotated.data.attachments = [attachment];
  assert.deepEqual(repair([first, annotated, last], edges, 'parent', ['review'], fresh, ledger).nodes[1].data.attachments, [attachment]);

  result = repair(clean, [edges[0]], 'parent', ['review'], fresh, ledger);
  assert.equal(result.ledger.importedCount, 2, 'a manually deleted bad child must not keep the ledger ahead');
  result = repair([first, child()], edges.slice(1, 2), 'parent', ['review'], fresh,
    { importedCount: 2, tailNodeId: 'bad' });
  assert.deepEqual(result.ledger, { importedCount: 1, tailNodeId: 'first' }, 'a bad tail returns to the last known real turn');

  const discussion = node('discussion', 'review');
  discussion.data.question = 'RETAINED USER INSTRUCTIONS {"risk_level":"high"}';
  const otherParent = child('other'); otherParent.data.importSource.sessionId = 'other-parent';
  const otherRunner = child('runner'); otherRunner.data.importSource.runner = 'claude-code';
  const unrelated = [discussion, otherParent, otherRunner];
  result = repair(unrelated, [], 'parent', ['review'], [], { importedCount: 0, tailNodeId: '' });
  assert.equal(result.changed, false, 'text, item IDs without subagent provenance, other parents and runners are not evidence');
  assert.deepEqual(result.nodes, unrelated);

  const audit = { id: 'audit', name: 'tool: autoApprovalReview', type: 'text/plain', size: 80,
    content: '{"reviewSessionId":"review","reviewId":"verdict-1","outcome":"deny"}' };
  const auditedFresh = structuredClone(fresh);
  auditedFresh[0].data.attachments = [audit, { ...audit, id: 'duplicate' }];
  const annotatedParent = structuredClone(first);
  annotatedParent.data.question = 'User revised parent';
  annotatedParent.data.attachments = [attachment];
  const synced = syncApprovalAttachments([annotatedParent, last], auditedFresh, 'parent');
  assert.equal(synced[0].data.question, 'User revised parent');
  assert.deepEqual(synced[0].data.attachments, [attachment, audit]);
  assert.deepEqual(synced[0].data.excludedAttachmentIds, ['audit']);
  assert.equal(synced[1], last, 'unaffected turns retain their object identity');
  assert.equal(syncApprovalAttachments(synced, auditedFresh, 'parent'), synced, 'verdict attachment sync is idempotent');
  synced[0].data.excludedAttachmentIds = [];
  assert.equal(syncApprovalAttachments(synced, auditedFresh, 'parent'), synced, 'an existing attachment inclusion is a user choice');

  // Exercise the real canonical entry point through repair, append and repeat.
  const setup = (nodes) => {
    const live = new Set(nodes.map((node) => node.id));
    globalThis.__state = { nodes, edges: edges.filter((edge) => live.has(edge.source) && live.has(edge.target)), selectedNodeId: 'bad', selectedNodeIds: ['bad'],
      pushHistory() {}, recomputeStaleness() {} };
    globalThis.__projects = { activeId: 'project', projects: [{ id: 'project', sourceSession: {
      sessionId: 'parent', runner: 'codex', importedCount: 3, tailNodeId: 'last',
    } }] };
  };
  const conversation = { title: 'fixture', source: 'codex', sessionId: 'parent', excludedSessionIds: ['review'],
    messageCount: 3, build: () => ({ nodes: structuredClone(auditedFresh), edges: [
      { id: 'fresh-main', source: 'fresh-first', target: 'fresh-last' },
      { id: 'fresh-next', source: 'fresh-last', target: 'new' },
    ] }) };
  for (const nodes of [[first, child(), last], clean, [first, edited, last]]) {
    setup(structuredClone(nodes));
    const opened = await importOrAppendConversation(conversation, { focusOnRefresh: false });
    assert.deepEqual(opened, { kind: 'appended', turns: 1 }, 'the first new real turn must append immediately');
    assert.equal(globalThis.__state.nodes.filter((n) => n.id === 'new').length, 1);
    assert.ok(globalThis.__state.edges.some((e) => e.source === 'last' && e.target === 'new'));
    assert.ok(globalThis.__state.edges.every((e) => e.source !== 'bad' && e.target !== 'bad'));
    assert.equal(globalThis.__projects.projects[0].sourceSession.importedCount, 3);
    assert.equal(globalThis.__projects.projects[0].sourceSession.tailNodeId, 'new');
    assert.deepEqual(globalThis.__state.nodes.find((n) => n.id === 'first').data.attachments, [audit], 'audit sync also reaches older turns');
    assert.deepEqual(globalThis.__state.nodes.find((n) => n.id === 'first').data.excludedAttachmentIds, ['audit']);
    assert.deepEqual(await importOrAppendConversation(conversation), { kind: 'opened' });
    assert.equal(globalThis.__state.nodes.filter((n) => n.id === 'new').length, 1);
  }
  // A half-turn refresh reconstructs attachments with new random IDs. The
  // audit's existing ID and inclusion decision must survive that refresh.
  const freshTool = { id: 'fresh-tool', name: 'tool: exec_command', type: 'text/plain', size: 4, content: 'done' };
  for (const includedByUser of [false, true]) {
    const partial = structuredClone(last);
    partial.data.attachments = [structuredClone(audit), structuredClone(attachment)];
    partial.data.excludedAttachmentIds = includedByUser ? [] : ['audit'];
    partial.data.includedAttachmentIds = includedByUser ? ['audit'] : [];
    setup([structuredClone(first), partial]);
    globalThis.__projects.projects[0].sourceSession.importedCount = 2;
    const completed = structuredClone(fresh.slice(0, 2));
    completed[1].data.response = 'answer with the final result';
    completed[1].data.responses = ['answer with the final result'];
    completed[1].data.source.response = 'answer with the final result';
    completed[1].data.attachments = [{ ...audit, id: 'fresh-audit' }, freshTool];
    completed[1].data.excludedAttachmentIds = ['fresh-audit', 'fresh-tool'];
    const refreshing = { ...conversation, messageCount: 2, build: () => ({ nodes: structuredClone(completed), edges: [] }) };
    assert.deepEqual(await importOrAppendConversation(refreshing), { kind: 'opened' });
    const refreshed = globalThis.__state.nodes.find((node) => node.id === 'last');
    assert.equal(refreshed.data.response, 'answer with the final result');
    assert.deepEqual(refreshed.data.attachments.map((attachment) => attachment.id), ['audit', 'fresh-tool', 'personal']);
    assert.deepEqual(refreshed.data.attachments.at(-1), attachment, 'a streamed answer preserves personal files');
    assert.equal(refreshed.data.excludedAttachmentIds.includes('audit'), !includedByUser);
    assert.equal(refreshed.data.excludedAttachmentIds.includes('fresh-tool'), true);
    assert.equal(refreshed.data.excludedAttachmentIds.includes('fresh-audit'), false);
    assert.deepEqual(refreshed.data.includedAttachmentIds, includedByUser ? ['audit'] : []);
    assert.deepEqual(await importOrAppendConversation(refreshing), { kind: 'opened' });
    assert.equal(globalThis.__state.nodes.find((node) => node.id === 'last').data.attachments.length, 3);
  }
  console.log('ok: internal-session repair preserves edits, isolates context, and reconciles legacy append ledgers');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
