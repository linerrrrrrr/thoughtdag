// Compact approval evidence belongs to the exact originating turn, never
// to a guessed timestamp or a conversation node containing the audit prompt.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'td-codex-approval-'));
try {
  const out = join(dir, 'approval.mjs');
  await build({ entryPoints: [resolve('src/lib/adapters/codex-approval.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  const { CodexApprovalCollector, adoptCodexApprovals } = await import(pathToFileURL(out).href);
  const collect = (lines) => {
    const c = new CodexApprovalCollector();
    for (const line of lines) c.feedLine(typeof line === 'string' ? line : JSON.stringify(line));
    return c;
  };
  const meta = (extra = {}) => ({ type: 'session_meta', payload: { id: 'review-session', parent_thread_id: 'parent', thread_source: 'guardian_review', ...extra } });
  const start = (id, parentTurnId, extra = {}) => ({ type: 'event_msg', payload: { type: 'task_started', turn_id: id, root_turn_id: parentTurnId, ...extra } });
  const message = (text, extra = {}) => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }], ...extra } });
  const allow = message('{"outcome":"allow"}');
  const deny = message(JSON.stringify({ outcome: 'deny', risk_level: 'high', user_authorization: 'medium', rationale: 'Deletion was not authorized.', copied_history: 'PRIVATE_PROMPT_MUST_NOT_SURVIVE' }));
  const c = collect([
    meta(), start('review-1', 'root-1', { turn_attribution: { parent_turn_id: 'turn-1' } }),
    { type: 'turn_context', payload: { turn_id: 'review-1', root_turn_id: 'root-1' } },
    message('PRIVATE_PROMPT_MUST_NOT_SURVIVE', { role: 'user' }),
    { type: 'response_item', payload: { type: 'reasoning', summary: 'PRIVATE_REASONING' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: 'PRIVATE_COMMAND' } },
    allow, allow,
    start('review-2', 'turn-2'), deny,
    start('review-3', undefined), allow,
    'not json', 'null', '[]',
  ]);
  const result = c.finish();
  assert.equal(result.reviews.length, 2, 'duplicate verdicts are idempotent; missing parent is skipped');
  assert.deepEqual(result.reviews.map((r) => [r.id, r.parentTurnId]), [['review-1', 'turn-1'], ['review-2', 'turn-2']]);
  assert.deepEqual(JSON.parse(result.reviews[1].result), { outcome: 'deny', risk_level: 'high', user_authorization: 'medium', rationale: 'Deletion was not authorized.' });
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'), 'prompts, tools, reasoning and unknown verdict fields are excluded');
  assert.deepEqual(c.finish(), result, 'finish is repeatable');

  for (const extra of [{ thread_source: 'user' }, { thread_source: undefined }, { parent_thread_id: '' }, { id: '' }]) {
    assert.equal(collect([meta(extra), start('r', 'turn'), allow]).finish(), null, 'only identified internal sessions are accepted');
  }
  assert.equal(collect([meta({ thread_source: undefined, source: { subagent: { other: 'guardian' } } }), start('r', 'turn'), allow]).finish().reviews.length, 1, 'structured fallback identifies historical workers');
  assert.equal(collect([start('r', 'turn'), allow]).finish(), null, 'no metadata is not evidence');
  assert.equal(collect([meta(), start('r', 'turn'), message('```json\n{"outcome":"allow"}\n```'), message('{"outcome":"maybe"}'), message('null')]).finish().reviews.length, 0, 'only strict verdict JSON is admitted');
  const bounded = collect([meta(), start('r', 'turn'), message(JSON.stringify({ outcome: 'allow', risk_level: 'made-up', user_authorization: 'invented', rationale: 'x'.repeat(3000) }))]).finish().reviews[0];
  assert.deepEqual(Object.keys(JSON.parse(bounded.result)), ['outcome', 'rationale']);
  assert.equal(JSON.parse(bounded.result).rationale.length, 2001, 'long rationales are visibly clipped');
  assert.equal(collect([meta(), start('r', 'turn'), message(JSON.stringify({ outcome: 'allow', rationale: 'x'.repeat(70000) }))]).finish().reviews.length, 0, 'oversized assistant data is rejected');
  assert.equal(collect([meta(), { type: 'turn_context', payload: { turn_id: 'r', root_turn_id: 'turn' } }, allow]).finish().reviews[0].parentTurnId, 'turn', 'turn_context alone supplies exact lineage');

  const turns = ['turn-1', 'turn-2'].map((id) => ({ question: `q-${id}`, response: `a-${id}`, itemIds: [id], tools: [], subagents: [] }));
  const before = turns.map(({ tools, ...turn }) => turn);
  adoptCodexApprovals(turns, [result], 'wrong-parent');
  assert.ok(turns.every((t) => t.tools.length === 0), 'a mismatched parent cannot inject evidence');
  adoptCodexApprovals(turns, [result, { ...result, reviews: [{ id: 'unknown', parentTurnId: 'unknown-turn', result: '{"outcome":"allow"}' }] }], 'parent');
  adoptCodexApprovals(turns, [result], 'parent');
  assert.deepEqual(turns.map((t) => t.tools.length), [1, 1], 'exact turn attribution and repeated adoption remain stable');
  assert.deepEqual(turns.map(({ tools, ...turn }) => turn), before, 'questions, answers and branches are untouched');
  assert.equal(turns[0].tools[0].nativeCallId, 'approval:review-session:review-1');
  assert.deepEqual(JSON.parse(turns[1].tools[0].call), { reviewSessionId: 'review-session', reviewId: 'review-2', parentTurnId: 'turn-2' });
  console.log('PASS: structured approval summaries, exact lineage, bounded content, no prompt leakage, idempotent adoption');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
