// Edge editing must preserve context semantics while changing appearance.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'tdag-edge-edit-'));
const bundle = join(temporary, 'edge-edit.mjs');
let failures = 0;
const test = (name, run) => {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
const node = (id, extra = {}) => ({
  id, type: 'thought', position: { x: 0, y: 0 }, data: {
    question: `Question ${id}`, response: `Answer ${id}`, responses: [`Answer ${id}`], responseIndex: 0,
    isCollapsed: false, isLoading: false, isRoot: id === 'a', isBranch: false,
    highlights: [], highlightMode: 'off', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
    roleMode: 'inherit', ...extra,
  },
});
const edge = (source, target, data = {}) => ({
  id: `${source}-${target}`, source, target, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top',
  animated: false, style: { stroke: '#6B5CE7', strokeWidth: 2 }, data,
});
try {
  await build({
    stdin: { contents: `export * from './lib/edge-edit'; export { buildContext, upstreamFingerprint } from './store/context-builder';`, resolveDir: join(process.cwd(), 'src'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent', define: { 'import.meta.env': '{}' },
    // The context compiler uses only this pure attachment helper; the
    // attachment upload pipeline itself requires a browser session.
    plugins: [{ name: 'attachment-fingerprint', setup(builder) {
      builder.onResolve({ filter: /\/attachments$/ }, () => ({ path: 'attachments', namespace: 'test-stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-stub' }, () => ({
        contents: 'export const attachmentFingerprint = a => `${a.name}|${a.size}|${a.content?.substring(0,100)}`;', loader: 'js',
      }));
    } }],
  });
  const { applyEdgeSettings, readEdgeSettings, edgeEditRestriction, buildContext, upstreamFingerprint } = await import(pathToFileURL(bundle).href);
  const nodes = [node('a'), node('b', { attachments: [{ id: 'att', name: 'evidence.txt', type: 'text/plain', size: 20, content: 'ATTACHMENT EVIDENCE' }] }), node('c')];
  const parent = edge('a', 'b');
  const reference = edge('b', 'c', { isCrossLink: true, createdAt: '2026-11-04', contextOrder: 2 });
  const edges = [parent, reference];
  const change = (selected, patch, ns = nodes, es = edges) => applyEdgeSettings(selected, ns, es, { ...readEdgeSettings(selected), ...patch });
  const replace = (selected, es = edges) => es.map((item) => item.id === selected.id ? selected : item);

  test('route and label edits preserve the exact upstream content fingerprint', () => {
    const before = structuredClone(reference);
    const result = change(reference, { route: 'orthogonal', label: '  Background evidence  ' });
    assert.equal(result.ok, true);
    assert.equal(result.semanticChanged, false);
    assert.equal(result.edge.data.label, 'Background evidence');
    assert.equal(result.edge.data.route, 'orthogonal');
    assert.equal(upstreamFingerprint('c', nodes, edges), upstreamFingerprint('c', nodes, replace(result.edge)));
    assert.deepEqual(reference, before, 'the original edge remains immutable');
    assert.deepEqual(result.edge.style, reference.style);
    assert.equal(result.edge.sourceHandle, reference.sourceHandle);
  });
  test('single-node reference sends only the source Q&A, without an upstream trail or attachments', () => {
    const ctx = buildContext('c', nodes, edges).messages.map((message) => message.content).join('\n');
    assert.ok(ctx.includes('Question b') && ctx.includes('Answer b'));
    assert.ok(!ctx.includes('Question a') && !ctx.includes('Answer a') && !ctx.includes('ATTACHMENT EVIDENCE'));
  });
  test('legacy reference depth stays stored on visual edits but cannot expand ordinary references', () => {
    const legacy = { ...reference, data: { ...reference.data, contextDepth: 'full' } };
    const legacyEdges = [parent, legacy];
    const result = change(legacy, { route: 'curve', label: 'Legacy reference' }, nodes, legacyEdges);
    assert.equal(result.ok, true);
    assert.equal(result.semanticChanged, false);
    assert.equal(result.edge.data.contextDepth, 'full', 'appearance edits do not migrate stored fields');
    assert.equal(upstreamFingerprint('c', nodes, legacyEdges), upstreamFingerprint('c', nodes, replace(result.edge)));
    const ctx = buildContext('c', nodes, replace(result.edge)).messages.map((message) => message.content).join('\n');
    assert.ok(ctx.includes('Question b') && ctx.includes('Answer b'));
    assert.ok(!ctx.includes('Question a') && !ctx.includes('Answer a') && !ctx.includes('ATTACHMENT EVIDENCE'));
  });
  test('semantic changes invalidate recorded upstream content while cancellation preserves it', () => {
    const recorded = upstreamFingerprint('c', nodes, edges);
    const continued = change(reference, { relation: 'continue' });
    assert.equal(continued.ok, true);
    assert.notEqual(upstreamFingerprint('c', nodes, replace(continued.edge)), recorded);
    assert.equal(upstreamFingerprint('c', nodes, edges), recorded, 'a preview never mutates the live graph');
  });
  test('continuing context inherits actual upstream material and preserves edge metadata', () => {
    const result = change(reference, { relation: 'continue', route: 'curve', label: 'Evidence' });
    assert.equal(result.ok, true);
    assert.equal(result.semanticChanged, true);
    assert.equal(result.edge.data.isCrossLink, undefined);
    assert.equal(result.edge.data.contextDepth, undefined);
    assert.equal(result.edge.data.contextOrder, 2);
    assert.equal(result.edge.data.createdAt, reference.data.createdAt);
    const ctx = buildContext('c', nodes, replace(result.edge)).messages.map((message) => message.content).join('\n');
    assert.ok(ctx.includes('Answer a') && ctx.includes('ATTACHMENT EVIDENCE'));
  });
  test('switching to a single-node reference clears obsolete depth without losing visual choices', () => {
    const continued = edge('b', 'c', { contextDepth: 'full', route: 'orthogonal', label: 'Existing note', contextOrder: 4 });
    const result = change(continued, { relation: 'reference' }, nodes, [parent, continued]);
    assert.equal(result.ok, true);
    assert.equal(result.edge.data.isCrossLink, true);
    assert.equal(result.edge.data.contextDepth, undefined);
    assert.equal(result.edge.data.route, 'orthogonal');
    assert.equal(result.edge.data.contextOrder, 4);
    assert.equal(result.edge.data.label, 'Existing note');
    assert.equal(result.edge.style.strokeDasharray, '8 4');
  });
  test('new structural cycles, including long paths, are rejected', () => {
    const backward = edge('c', 'a', { isCrossLink: true });
    const result = change(backward, { relation: 'continue' }, nodes, [parent, edge('b', 'c'), backward]);
    assert.deepEqual(result, { ok: false, error: 'cycle' });
    assert.deepEqual(change(edge('a', 'a', { isCrossLink: true }), { relation: 'continue' }), { ok: false, error: 'self-loop' });
  });
  test('reference feedback loops remain editable without becoming structural', () => {
    const backward = edge('c', 'a', { isCrossLink: true });
    const result = change(backward, { label: 'Feedback' }, nodes, [parent, edge('b', 'c'), backward]);
    assert.equal(result.ok, true);
    assert.equal(result.edge.data.isCrossLink, true);
  });
  test('watch edges retain their purpose and follow-tip metadata', () => {
    const watch = edge('b', 'c', { isCrossLink: true, isWatch: true, followsTip: true, contextDepth: 'full' });
    assert.equal(edgeEditRestriction(watch, nodes), 'watch');
    assert.deepEqual(change(watch, { relation: 'continue' }), { ok: false, error: 'restricted' });
    const visual = change(watch, { route: 'curve', label: 'Observation' });
    assert.equal(visual.ok, true);
    assert.equal(visual.semanticChanged, false);
    assert.equal(visual.edge.data.isWatch, true);
    assert.equal(visual.edge.data.followsTip, true);
    assert.equal(visual.edge.data.contextDepth, 'full');
  });
  test('exploration links preserve selected-passage semantics and handles', () => {
    const branch = { ...edge('b', 'c', { isBranchFromSelection: true, branchYRatio: .3 }), sourceHandle: 'branch', targetHandle: 'left' };
    assert.deepEqual(change(branch, { relation: 'reference' }), { ok: false, error: 'restricted' });
    const visual = change(branch, { label: 'Exploration' });
    assert.equal(visual.ok, true);
    assert.equal(visual.edge.data.branchYRatio, .3);
    assert.equal(visual.edge.sourceHandle, 'branch');
    assert.equal(visual.edge.targetHandle, 'left');
  });
  test('material and frame links permit appearance edits but no role conversions', () => {
    for (const stepKind of ['file', 'note', 'link', 'frame']) {
      const specialNodes = [node('a'), node('b', { stepKind }), node('c')];
      const materialEdge = edge('b', 'c');
      assert.deepEqual(change(materialEdge, { relation: 'reference' }, specialNodes), { ok: false, error: 'restricted' });
      const visual = change(materialEdge, { route: 'orthogonal' }, specialNodes);
      assert.equal(visual.ok, true);
      assert.equal(visual.semanticChanged, false);
    }
  });
  test('inherited route and empty notes clear only their own optional fields', () => {
    const customized = edge('b', 'c', { isCrossLink: true, route: 'curve', label: 'Note', followsTip: true });
    const result = change(customized, { route: 'inherit', label: '  ' });
    assert.equal(result.ok, true);
    assert.equal(result.edge.data.route, undefined);
    assert.equal(result.edge.data.label, undefined);
    assert.equal(result.edge.data.followsTip, true);
    assert.equal(result.edge.data.isCrossLink, true);
  });
  test('missing endpoints and invalid drafts fail without touching the graph', () => {
    assert.deepEqual(change(reference, { label: 'Edit' }, nodes.slice(0, 2)), { ok: false, error: 'missing-node' });
    assert.deepEqual(change(reference, { route: 'zigzag' }), { ok: false, error: 'invalid-settings' });
    assert.deepEqual(change(reference, { label: 'x'.repeat(121) }), { ok: false, error: 'invalid-settings' });
  });
} finally {
  unlinkSync(bundle);
  rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
