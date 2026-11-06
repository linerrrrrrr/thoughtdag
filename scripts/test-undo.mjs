#!/usr/bin/env node
// Undo invariants. The history slice is bundled for node with the three
// modules it reaches for UI (condense guard, toasts, i18n) stubbed out, and
// driven through the same call patterns the canvas uses: record before and
// after, record before only, record after only, and not record at all.
//
// The rules being checked are about what the person made (text, wiring,
// arrangement), never about what the app writes while it works:
//   1. undo then redo returns to exactly where it was
//   2. each undo takes back one step, nothing riding along with it
//   and a node whose answer is still streaming is never removed or rewritten.
// Undo stays linear: a new step after an undo drops the redo path, and the
// stack lives in memory only (accepted in the #79 discussion; reported, not
// failed).
//
// Run: node scripts/test-undo.mjs
// HISTORY_SRC=<file> runs the same checks against another history slice.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tdag-undo-'));
const bundle = join(tmp, 'undo.mjs');
const historySrc = process.env.HISTORY_SRC ? resolve(process.env.HISTORY_SRC) : join(ROOT, 'src/store/slices/history.ts');
const STUBS = {
  'condense-guard': 'export const condenseGuard = () => false;',
  'ui-store': 'export const toast = (...a) => { (globalThis.__toasts ??= []).push(a); return ""; };',
  i18n: 'export const t = (k) => k; export const fmt = (s) => s;',
};
await build({
  stdin: {
    contents: `
      import { create } from 'zustand';
      import * as h from ${JSON.stringify(historySrc)};
      export const sameGraph = h.sameGraph;
      export const makeStore = () => create((set, get, api) => ({
        ...h.createHistorySlice(set, get, api),
        nodes: [], edges: [], events: [],
        logEvent: () => {},
      }));`,
    resolveDir: join(ROOT, 'src/store/slices'),
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
  define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.DEV': 'false' },
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /(condense-guard|ui-store|i18n)$/ }, (a) => ({ path: a.path.split('/').pop(), namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
    },
  }],
});
const { makeStore, sameGraph } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

// ── canvas fixtures ─────────────────────────────────────────────────────
const q = (id, question, response = '', x = 0, y = 0, extra = {}) => ({
  id, type: 'thought', position: { x, y },
  data: { question, response, responses: response ? [response] : [], responseIndex: response ? 0 : -1, isLoading: false, isEditing: false, isEditingResponse: false, isCollapsed: false, tokenCount: 0, highlights: [], highlightMode: 'off', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false, ...extra },
});
const note = (id, text, x = 600, y = 0) => q(id, text, '', x, y, { stepKind: 'note' });
const edge = (s, t) => ({ id: `e-${s}-${t}`, source: s, target: t, type: 'smoothstep', data: {} });

// What the person made, as one comparable string: no selection, no
// measurements, no flags the app sets while it works.
function assets(st) {
  const nodes = [...st.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n) => ({
    id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height,
    q: n.data.question, r: n.data.response, rs: n.data.responses, ri: n.data.responseIndex, c: n.data.isCollapsed,
    k: n.data.stepKind, fc: n.data.frameColor, split: n.data.questionHeightRatio, att: (n.data.attachments ?? []).map((a) => [a.id, a.name, a.extractedBy === 'manual' ? a.extractedText : '']),
  }));
  const edges = [...st.edges].sort((a, b) => a.id.localeCompare(b.id)).map((e) => [e.id, e.source, e.target]);
  return JSON.stringify({ nodes, edges });
}

function start(nodes = [], edges = []) {
  const store = makeStore();
  store.setState({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
  globalThis.__toasts = [];
  const s = () => store.getState();
  const mutate = (fn) => store.setState((st) => ({ nodes: fn(st.nodes) }));
  const patch = (id, p) => mutate((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)));
  const move = (id, x, y) => mutate((ns) => ns.map((n) => (n.id === id ? { ...n, position: { x, y } } : n)));
  // the call patterns found in the code base
  const ops = {
    both: (fn) => { s().pushHistory(); fn(); s().pushHistory(); },
    before: (fn) => { s().pushHistory(); fn(); },
    after: (fn) => { fn(); s().pushHistory(); },
    none: (fn) => { fn(); },
  };
  const settle = (id, pending) => (s().settleNode ? s().settleNode(id, pending) : s().pushHistory());
  return { store, s, mutate, patch, move, ops, settle, a: () => assets(s()) };
}

const results = [];
const pending = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail && !ok ? `\n     ${detail}` : ''}`);
}

// ── 1 + 2: each recording pattern takes back exactly its own step ───────
for (const [pattern, label] of [['both', 'recorded before and after'], ['before', 'recorded before only (a note committed on blur)'], ['after', 'recorded after only (a node dropped on the canvas)'], ['none', 'not recorded (a drag, a version switch)']]) {
  const c = start([q('a', 'question A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'an earlier note')]));
  const s0 = c.a();
  c.ops[pattern](() => { c.patch('n1', { question: 'the note, rewritten by hand' }); c.move('a', 40, 80); });
  const s1 = c.a();
  c.s().undo();
  const u = c.a();
  c.s().redo();
  const r = c.a();
  check(`${label}: one undo takes back that step and only it`, u === s0, `after undo: ${u}`);
  check(`${label}: redo returns to where it was`, r === s1, `after redo: ${r}`);
}

// ── typed text survives a redo after the node it sits in is undone ──────
{
  const c = start([q('a', 'question A', 'answer A')]);
  c.ops.after(() => c.mutate((ns) => [...ns, note('n1', '')]));
  c.ops.before(() => c.patch('n1', { question: 'words that exist nowhere else' }));
  c.s().undo(); c.s().undo();
  c.s().redo(); c.s().redo();
  check('a note body written after its card was dropped comes back with redo', c.s().nodes.find((n) => n.id === 'n1')?.data.question === 'words that exist nowhere else');
}

// ── an unrecorded change, then a step recorded before and after ─────────
// (a step recorded only after its change cannot tell where an unrecorded
// change before it ended, so call sites record on both sides)
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.before(() => c.patch('a', { question: 'A, typed and committed' }));
  const mid = c.a();
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'dropped next')]));
  c.s().undo();
  check('a change left unrecorded, then the next step: undo takes back only the next step', c.a() === mid, c.a());
}

// ── consecutive moves stay separate steps ───────────────────────────────
{
  const c = start([q('a', 'A', 'answer A'), q('b', 'B', 'answer B', 700, 0)]);
  const drag = (id, x, y) => { c.s().pushHistory(); c.move(id, x, y); c.s().pushHistory(); }; // drag start / stop
  drag('a', 100, 100);
  const afterFirst = c.a();
  drag('b', 900, 300);
  c.s().undo();
  check('two drags are two steps: undo takes back only the second', c.a() === afterFirst);
}

// ── a change made after an undo is kept; there is nothing left to redo ──
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'first')]));
  c.s().undo();
  c.ops.before(() => c.mutate((ns) => [...ns, note('n2', 'typed after the undo')]));
  const kept = c.a();
  c.s().redo();
  check('redo after a new change keeps the new change', c.a() === kept, c.a());
}

// ── selection and measurement are not steps ─────────────────────────────
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'the step to undo')]));
  c.mutate((ns) => ns.map((n) => ({ ...n, selected: n.id === 'a', measured: { width: 520, height: 300 } })));
  c.s().undo();
  check('selecting or measuring nodes adds no step: one undo removes the note', !c.s().nodes.some((n) => n.id === 'n1'));
}

// ── what the app writes after a step does not become a step ─────────────
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, q('b', 'question B', 'answer B', 0, 400)]));
  c.patch('b', { summaries: ['plaque B'], summaryLadders: [{ tokens: [], abstract: 'answer B', sentences: [0], brief: [], takeaway: [], topic: [] }], tokenCount: 42 });
  c.s().undo();
  check('a plaque and ladder written after the answer: one undo removes the node', !c.s().nodes.some((n) => n.id === 'b'));
  c.s().redo();
  check('redo brings the node back with its plaque', c.s().nodes.find((n) => n.id === 'b')?.data.summaries?.[0] === 'plaque B');
}
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'note')]));
  c.patch('a', { summaries: ['plaque A, written late'] });
  c.s().undo();
  check('undoing a later step keeps the plaque of an untouched node', c.s().nodes.find((n) => n.id === 'a')?.data.summaries?.[0] === 'plaque A, written late');
}
{
  const c = start([q('f', '', '', 0, 0, { stepKind: 'file', attachments: [] })]);
  c.ops.both(() => c.patch('f', { attachments: [{ id: 'p1', name: 'paper.pdf', type: 'application/pdf', size: 10, content: '', isExtracting: true }] }));
  c.patch('f', { attachments: [{ id: 'p1', name: 'paper.pdf', type: 'application/pdf', size: 10, content: '', isExtracting: false, extractedText: 'machine text', extractedBy: 'model-x' }] });
  c.s().undo();
  check('extraction finishing is not a step: one undo removes the file', (c.s().nodes[0].data.attachments ?? []).length === 0);
  c.s().redo();
  check('redo brings the file back with its extracted text', c.s().nodes[0].data.attachments?.[0]?.extractedText === 'machine text');
  c.ops.before(() => c.patch('f', { attachments: [{ ...c.s().nodes[0].data.attachments[0], extractedText: 'fixed by hand', extractedBy: 'manual' }] }));
  c.s().undo();
  check('extracted text edited by hand is a step of its own', c.s().nodes[0].data.attachments?.[0]?.extractedText === 'machine text');
}

// ── choices for the next ask are settings, not steps ────────────────────
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'the step to undo')]));
  c.patch('a', { model: 'some-model', webSearch: true });
  c.s().undo();
  const a = c.s().nodes.find((n) => n.id === 'a');
  check('switching a node\'s model or search adds no step and survives the undo', !c.s().nodes.some((n) => n.id === 'n1') && a.data.model === 'some-model' && a.data.webSearch === true);
}

// ── a page fetched into a link card belongs to the step that made it ────
{
  const c = start([q('a', 'A', 'answer A')]);
  const pending = (d) => !d.question && !d.linkTitle;
  c.ops.both(() => c.mutate((ns) => [...ns, { ...note('l1', ''), data: { ...note('l1', '').data, stepKind: 'link', linkUrl: 'https://example.org' } }]));
  c.patch('l1', { question: 'the page, as markdown', linkTitle: 'Example' });
  c.settle('l1', pending);
  c.s().undo();
  check('one undo removes a fetched link card, not just its page', !c.s().nodes.some((n) => n.id === 'l1'));
  c.s().redo();
  check('redo brings it back with its page, not a spinner', c.s().nodes.find((n) => n.id === 'l1')?.data.linkTitle === 'Example');
}

// ── automatic content limits are derived geometry, never dirty undo steps ─
{
  const original = { ...q('a', 'A', 'answer A'), width: 600, height: 800, style: { height: 800 } };
  const c = start([original]);
  c.ops.both(() => c.mutate(ns => [...ns, note('n1', 'the earlier user step')]));
  const earlier = c.s().history[0];
  c.s().normalizeNodeContentHeight('a', 500);
  check('automatic height normalization updates live and active geometry without adding a step', c.s().historyIndex === 1 && c.s().history.length === 2 && c.s().nodes[0].height === 500 && c.s().history[1].nodes[0].height === 500 && sameGraph(c.s().history[1], c.s()));
  check('inactive history stays untouched until its own content is restored', c.s().history[0] === earlier && earlier.nodes[0].height === 800);
  c.s().undo();
  c.s().normalizeNodeContentHeight('a', 500);
  check('one undo after normalization reaches the earlier user step instead of restoring oversized blank space', !c.s().nodes.some(n => n.id === 'n1') && c.s().nodes[0].height === 500 && c.s().historyIndex === 0 && sameGraph(c.s().history[0], c.s()));
  const settled = c.s().nodes;
  c.s().undo();
  check('normalization does not leave a repeated dirty undo loop', c.s().nodes === settled && c.s().historyIndex === 0 && c.s().history.length === 2);
  c.s().redo();
  check('redo still restores the actual user step after derived normalization', c.s().nodes.some(n => n.id === 'n1') && c.s().nodes[0].height === 500);
}
{
  const c = start([{ ...q('a', 'A', 'a much longer earlier answer'), width: 600, height: 800 }]);
  c.patch('a', { response: 'short new answer' });
  const earlier = c.s().history[0];
  c.s().normalizeNodeContentHeight('a', 500);
  check('a short current answer never clips a different historical answer', c.s().nodes[0].height === 500 && c.s().history[0] === earlier && earlier.nodes[0].height === 800);
  c.s().undo();
  c.s().normalizeNodeContentHeight('a', 900);
  check('restoring different prose retains its own valid historical height', c.s().nodes[0].data.response === 'a much longer earlier answer' && c.s().nodes[0].height === 800);
}
{
  const c = start([{ ...q('a', 'A', 'answer A'), width: 600, height: 800 }]);
  c.mutate(ns => ns.map(n => ({ ...n, width: 900 })));
  const earlier = c.s().history[0];
  c.s().normalizeNodeContentHeight('a', 500);
  check('a different historical width is not clipped using current wrapping', c.s().nodes[0].height === 500 && c.s().history[0] === earlier && earlier.nodes[0].width === 600 && earlier.nodes[0].height === 800);
}
{
  const c = start([{ ...q('a', 'A', 'answer A'), height: 800, style: { height: '800px', width: '600px', color: 'blue' } }]);
  c.move('a', 60, -20);
  c.s().normalizeNodeContentHeight('a', 500);
  const live = c.s().nodes[0], saved = c.s().history[0].nodes[0];
  check('legacy pixel style heights normalize both wrapper and node dimensions', live.height === 500 && live.style.height === 500 && saved.height === 500 && saved.style.height === 500);
  check('normalization only changes height fields and preserves uncommitted positions', live.position.x === 60 && live.position.y === -20 && saved.position.x === 0 && saved.style.width === '600px' && live.style.color === 'blue' && live.data.response === 'answer A');
  c.s().undo();
  check('a real unrecorded move remains undoable beside normalized heights', c.s().nodes[0].position.x === 0 && c.s().nodes[0].height === 500);
}
{
  for (const value of ['800px', '800', ' 800.5px ']) {
    const c = start([{ ...q('a', 'A', 'answer A'), style: { height: value } }]);
    c.s().normalizeNodeContentHeight('a', 500);
    check(`legacy height ${JSON.stringify(value)} becomes a bounded explicit size`, c.s().nodes[0].height === 500 && c.s().nodes[0].style.height === 500 && sameGraph(c.s().history[0], c.s()));
  }
  const c = start([{ ...q('a', 'A', 'answer A'), style: { height: '80%' } }]);
  const nodes = c.s().nodes, history = c.s().history;
  c.s().normalizeNodeContentHeight('a', 500);
  check('percentage style heights are never interpreted as canvas pixels', c.s().nodes === nodes && c.s().history === history && c.s().nodes[0].style.height === '80%');
}
{
  const c = start([{ ...q('a', 'A', 'answer A'), width: 600, height: 400 }]);
  const saved = c.s().history[0].nodes[0];
  c.mutate(ns => ns.map(n => ({ ...n, height: 800 })));
  c.s().normalizeNodeContentHeight('a', 500);
  check('a historical height already below the cap stays untouched', c.s().history[0].nodes[0] === saved && saved.height === 400 && c.s().nodes[0].height === 500);
  c.s().undo();
  check('a smaller intentional historical size remains undoable', c.s().nodes[0].height === 400);
}

// ── working flags never come back from a snapshot ───────────────────────
{
  const c = start([q('a', 'A', 'answer A')]);
  c.patch('a', { isEditing: true });
  c.ops.both(() => c.patch('a', { question: 'A, revised', isEditing: false }));
  c.s().undo();
  const a = c.s().nodes.find((n) => n.id === 'a');
  check('undoing an edit restores the text without reopening the editor', a.data.question === 'A' && !a.data.isEditing);
}
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, q('b', 'B', '', 0, 400, { isLoading: true })]));
  c.patch('b', { isLoading: false, response: 'answer B', responses: ['answer B'], responseIndex: 0 }); // a stream that ended without settling
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'note')]));
  c.s().undo(); c.s().undo();
  c.s().redo();
  check('a snapshot taken mid-stream never brings back a spinner', c.s().nodes.find((n) => n.id === 'b')?.data.isLoading === false);
}

// ── reading split changes are steps even while an answer streams ───────
{
  const c = start([q('a', 'A', '', 0, 0, { isLoading: true })]);
  c.ops.both(() => c.patch('a', { questionHeightRatio: 0.7 }));
  const recordedIndex = c.s().historyIndex;
  const activity = [{ id: 'live', kind: 'message', text: 'latest activity' }];
  c.patch('a', { response: 'latest streamed text', reasoning: 'latest reasoning', agentActivity: activity });
  c.s().undo();
  const undone = c.s().nodes[0].data;
  check('a reading split changed during generation is exactly one step', recordedIndex === 1 && c.s().historyIndex === 0 && undone.questionHeightRatio === undefined);
  check('undoing the split preserves live text, reasoning, activity and generation', undone.response === 'latest streamed text' && undone.reasoning === 'latest reasoning' && undone.agentActivity === activity && undone.isLoading && globalThis.__toasts.length === 0);
  c.s().redo();
  const redone = c.s().nodes[0].data;
  check('redoing the split during generation preserves the latest stream', redone.questionHeightRatio === 0.7 && redone.response === 'latest streamed text' && redone.agentActivity === activity && redone.isLoading);
}
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, q('b', 'B', '', 0, 400, { isLoading: true })]));
  c.ops.both(() => c.patch('b', { questionHeightRatio: 0.65 }));
  c.patch('b', { isLoading: false, response: 'complete B', responses: ['complete B'], responseIndex: 0 });
  c.settle('b');
  c.s().undo();
  const b = c.s().nodes.find((n) => n.id === 'b');
  check('stream completion keeps the earlier split snapshot and the complete answer', b?.data.questionHeightRatio === undefined && b.data.response === 'complete B' && !b.data.isLoading);
  c.s().redo();
  check('redo after completion restores only the chosen split', c.s().nodes.find((n) => n.id === 'b')?.data.questionHeightRatio === 0.65 && c.s().nodes.find((n) => n.id === 'b')?.data.response === 'complete B');
  c.s().undo(); c.s().undo();
  check('split undo after completion stays separate from creating the answer node', c.s().nodes.length === 1 && c.s().nodes[0].id === 'a');
}
{
  const c = start([q('a', 'A', '', 0, 0, { isLoading: true })]);
  c.ops.both(() => c.patch('a', { questionHeightRatio: 0.6 }));
  c.s().undo();
  c.patch('a', { isLoading: false, response: 'finished after undo', responses: ['finished after undo'], responseIndex: 0 });
  c.settle('a');
  c.s().redo();
  const a = c.s().nodes[0].data;
  check('finishing a stream after split undo preserves its redo choice', a.questionHeightRatio === 0.6 && a.response === 'finished after undo' && !a.isLoading);
}

// ── a streaming answer is never removed or rewritten by undo ────────────
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'an earlier note')]));
  c.mutate((ns) => [...ns, q('b', 'question B', '', 0, 400, { isLoading: true })]); // addQuestion: recorded when the answer lands
  c.patch('b', { response: 'half an ans' });
  c.s().undo();
  const b = c.s().nodes.find((n) => n.id === 'b');
  check('undo while the asked node streams leaves it streaming', !!b && b.data.isLoading && c.s().nodes.some((n) => n.id === 'n1'));
  check('…and says why', (globalThis.__toasts ?? []).some((x) => x[1] === 'toast.undoWhileGenerating'));
  // a step made while it streams can still be undone around it
  c.ops.both(() => c.patch('n1', { question: 'note edited during the stream' }));
  c.patch('b', { response: 'half an answer, longer' });
  c.s().undo();
  const b2 = c.s().nodes.find((n) => n.id === 'b');
  check('a step made during the stream undoes without touching the stream', c.s().nodes.find((n) => n.id === 'n1')?.data.question === 'an earlier note' && b2?.data.response === 'half an answer, longer' && b2.data.isLoading);
  c.s().redo();
  // the answer lands
  c.patch('b', { isLoading: false, response: 'the whole answer', responses: ['the whole answer'], responseIndex: 0 });
  c.settle('b');
  const done = c.a();
  check('no snapshot keeps the half-written answer once it lands', c.s().history.every((h) => h.nodes.every((n) => n.id !== 'b' || !n.data.isLoading)));
  c.s().undo();
  check('after it lands, undo takes back the note edit and keeps the answer', c.s().nodes.find((n) => n.id === 'n1')?.data.question === 'an earlier note' && c.s().nodes.find((n) => n.id === 'b')?.data.response === 'the whole answer');
  c.s().undo();
  check('the next undo removes the question with its answer', !c.s().nodes.some((n) => n.id === 'b'));
  c.s().redo(); c.s().redo();
  check('redo twice returns the answer and the edit', c.a() === done, c.a());
}
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.patch('a', { question: 'A, asked again', isLoading: true, response: '' })); // editQuestion: rerun starts
  c.s().undo();
  check('undo cannot rewrite the question of an answer still streaming', c.s().nodes[0].data.question === 'A, asked again' && c.s().nodes[0].data.isLoading);
}

// ── round trip over random sequences ────────────────────────────────────
{
  let seed = 7; // mulberry32: an LCG's low bits cycle too fast to mix the patterns
  const rnd = (n) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) % n;
  };
  let fails = 0;
  for (let run = 0; run < 200; run++) {
    const c = start([q('a', 'A', 'answer A')]);
    const states = [c.a()];
    const trail = [];
    for (let step = 0; step < 8; step++) {
      // the call-site convention: after a change left unrecorded, the next
      // step records before it changes anything
      const pattern = step > 0 && trail.at(-1).split(':')[0] !== 'both' ? ['both', 'before'][rnd(2)] : ['both', 'before', 'none'][rnd(3)];
      const kind = rnd(4);
      trail.push(`${pattern}:${kind}`);
      const id = `x${run}-${step}`;
      c.ops[pattern](() => {
        if (kind === 0) c.mutate((ns) => [...ns, note(id, `note ${id}`, rnd(900), rnd(900))]);
        else if (kind === 1) c.move(c.s().nodes[rnd(c.s().nodes.length)].id, rnd(900), rnd(900));
        else if (kind === 2) c.patch(c.s().nodes[rnd(c.s().nodes.length)].id, { question: `text ${id}` });
        else c.store.setState((st) => ({ edges: [...st.edges, edge('a', c.s().nodes[rnd(c.s().nodes.length)].id + id)] }));
      });
      if (c.a() !== states.at(-1)) states.push(c.a());
    }
    for (let i = states.length - 2; i >= 0; i--) { c.s().undo(); if (c.a() !== states[i]) { fails++; if (process.env.DEBUG_UNDO && fails < 3) console.log('   undo broke at', i, trail.join(' ')); break; } }
    if (c.a() !== states[0]) continue;
    for (let i = 1; i < states.length; i++) { c.s().redo(); if (c.a() !== states[i]) { fails++; if (process.env.DEBUG_UNDO && fails < 3) console.log('   redo broke at', i, trail.join(' ')); break; } }
  }
  check('200 random sequences: undo walks back through every state, redo forward again', fails === 0, `${fails} sequences broke`);
}

// ── linear undo: a new step drops the redo path ─────────────────────────
{
  const c = start([q('a', 'A', 'answer A')]);
  c.ops.both(() => c.mutate((ns) => [...ns, q('b', 'question B', 'an answer that exists only here', 0, 400)]));
  c.s().undo();
  c.ops.both(() => c.mutate((ns) => [...ns, note('n1', 'any later step')]));
  const findable = JSON.stringify(c.s()).includes('an answer that exists only here');
  pending.push(`undo, then any new step: the answer it pushed off is ${findable ? 'still in memory' : 'gone (linear undo, accepted)'}`);
}

console.log(pending.map((p) => `ℹ️  ${p}`).join('\n'));
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
