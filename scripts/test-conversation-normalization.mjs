import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'thoughtdag-normalization-'));
try {
  const bundle = join(temporary, 'normalization.mjs');
  await build({
    stdin: { contents: `export * from './lib/normalize-graph';
      export { isConversationStart } from './lib/graph';
      export { buildContext } from './store/context-builder';`,
    resolveDir: join(process.cwd(), 'src'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    plugins: [{ name: 'attachment-io', setup(builder) {
      builder.onResolve({ filter: /\/attachments$/ }, () => ({ path: 'attachments', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const attachmentFingerprint = a => a.id;', loader: 'js',
      }));
    } }],
  });
  const { normalizeConversationGraph, isConversationStart, buildContext } = await import(pathToFileURL(bundle).href);
  const node = (id, extra = {}) => ({ id, type: 'thought', position: { x: 0, y: 0 }, data: {
    question: `Question ${id}`, response: `Answer ${id}`, responses: [`Answer ${id}`], responseIndex: 0,
    highlights: [], attachments: [], ...extra,
  } });
  const saved = {
    nodes: [node('opening', { isRoot: false, rolePrompt: 'Old inherited role', roleMode: 'set-next' }), node('source', { isBranch: true }), node('target', {
      isRoot: true, isEvaluator: true, autoRerun: true, autoRerunRounds: 5, evaluatorTrigger: 'auto',
      rolePrompt: 'Old own role', roleMode: 'reset', roleSourceId: 'opening', roleSourceNodeId: 'opening', appliedRole: 'Old saved role',
      stepKind: 'review', fanoutRoles: [{ name: 'Old role', prompt: 'Old instruction' }],
      branchContext: 'Selected evidence\nsecond line', questions: ['First question', 'Second question'],
    })],
    edges: [
      { id: 'a', source: 'opening', target: 'source', data: { isBranchFromSelection: true, branchYRatio: .6 } },
      { id: 'b', source: 'source', target: 'target', animated: true,
        style: { stroke: '#ff0000', strokeDasharray: '4 4' },
        data: { isCrossLink: true, isWatch: true, followsTip: true, contextDepth: 'full', label: 'Evidence', route: 'curve' } },
    ],
  };
  const original = JSON.stringify(saved);
  const cleaned = normalizeConversationGraph(saved);
  assert.equal(JSON.stringify(saved), original, 'loading does not mutate the source backup');
  assert.deepEqual(normalizeConversationGraph(cleaned), cleaned, 'reload and export cannot duplicate the selected quote');
  assert.equal(cleaned.nodes[2].data.response, 'Answer target', 'saved answers survive cleanup');
  assert.deepEqual(cleaned.nodes[2].data.responses, ['Answer target']);
  assert.ok(cleaned.nodes[2].data.questions.every(q => q.startsWith('> Selected evidence\n> second line\n\n')));
  assert.equal(cleaned.nodes[2].data.stepKind, undefined, 'retired steps become ordinary turns, never automatic prompts');
  assert.doesNotMatch(JSON.stringify(cleaned), /"(?:isRoot|isBranch|isEvaluator|autoRerun|autoRerunRounds|evaluatorTrigger|branchContext|fanoutRoles|rolePrompt|roleMode|roleSourceId|roleSourceNodeId|appliedRole|isWatch|followsTip|isBranchFromSelection|branchYRatio|contextDepth)":/);
  assert.equal(cleaned.edges[1].source, 'source', 'the explicit connection is retained');
  assert.equal(cleaned.edges[1].animated, false);
  assert.equal(cleaned.edges[1].data.label, 'Evidence');
  assert.equal(cleaned.edges[1].data.route, 'curve');
  const text = buildContext('target', cleaned.nodes, cleaned.edges).messages.map(m => m.content).join('\n');
  assert.ok(text.includes('Selected evidence') && text.includes('Answer source'));
  assert.ok(!text.includes('Answer opening'), 'a normalized reference carries only its source turn');
  assert.doesNotMatch(text, /Old (?:inherited|own|saved) role/, 'retired roles are never reintroduced after loading');
  assert.equal(isConversationStart('source', cleaned.edges), false);
  assert.equal(isConversationStart('opening', cleaned.edges), true);
  assert.equal(isConversationStart('source', []), true, 'removing the incoming conversation changes the start immediately');
  assert.equal(isConversationStart('target', cleaned.edges), true, 'references do not create conversation ancestry');
  assert.equal(isConversationStart('target', [...cleaned.edges, { source: 'source', target: 'target' }]), false);
  console.log('PASS legacy canvas and role cleanup, visible quotations, reference scope, and dynamic conversation starts');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
