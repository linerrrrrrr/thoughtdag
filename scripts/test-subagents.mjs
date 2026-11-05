#!/usr/bin/env node
// Subagent fan-out on the canvas: a Pi turn whose `subagent` tool ran three agents becomes one turn
// node with three branch children; a Claude Code turn that launched an Agent gets a child too, and
// adopting the agent's own sidechain file gives that child its tool footprint. A child never takes
// the main column: the next turn still continues the chain.
//
// Run: node scripts/test-subagents.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'td-subagents-'));
const entry = join(dir, 'entry.mjs');
const root = process.cwd().replace(/\\/g, '/');
writeFileSync(entry, `
  export { PiSessionCollector } from '${root}/src/lib/adapters/pi-session.ts';
  export { ClaudeSessionCollector } from '${root}/src/lib/adapters/claude-code-session.ts';
  export { adoptSubagentSessions } from '${root}/src/lib/adapters/shared.ts';
`);
const out = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', define: { 'import.meta.env.DEV': 'false', 'import.meta.env': '{}' } });
const { PiSessionCollector, ClaudeSessionCollector, adoptSubagentSessions } = await import(pathToFileURL(out).href);

// ── Pi: three parallel runs in one tool result, details carried whole ──
const pi = new PiSessionCollector();
const L = (o) => pi.feedLine(JSON.stringify(o));
L({ type: 'session', version: 3, id: 'pi-1', timestamp: '2026-09-29T10:00:00.000Z', cwd: '/w' });
L({ type: 'message', id: 'u1', parentId: null, timestamp: 1, message: { role: 'user', content: [{ type: 'text', text: '把三块的调查分给三个人' }] } });
L({ type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: '分头去查。' }, { type: 'toolCall', id: 'call-1', name: 'subagent', arguments: { tasks: [{ agent: 'scout', task: '查 A' }, { agent: 'scout', task: '查 B' }, { agent: 'reviewer', task: '看 C' }] } }] } });
L({ type: 'message', id: 'r1', parentId: 'a1', message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'subagent', content: [{ type: 'text', text: '(3 results)' }],
  details: { mode: 'parallel', results: [
    { agent: 'scout', task: '查 A', messages: [{ role: 'user', content: [{ type: 'text', text: '查 A' }] }, { role: 'assistant', content: [{ type: 'text', text: 'A 是这样' }] }] },
    { agent: 'scout', task: '查 B', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'B 是那样' }] }] },
    { agent: 'reviewer', task: '看 C', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'C 没问题' }] }] },
  ] } } });
L({ type: 'message', id: 'a2', parentId: 'r1', message: { role: 'assistant', content: [{ type: 'text', text: '汇总：A 这样，B 那样，C 没问题。' }] } });
L({ type: 'message', id: 'u2', parentId: 'a2', message: { role: 'user', content: [{ type: 'text', text: '那下一步呢' }] } });
L({ type: 'message', id: 'a3', parentId: 'u2', message: { role: 'assistant', content: [{ type: 'text', text: '先做 A。' }] } });
const g = pi.toConversation().build();
const turns = g.nodes.filter((n) => n.data.importSource && !n.data.importSource.subagent);
const kids = g.nodes.filter((n) => n.data.importSource?.subagent);
assert.equal(turns.length, 2, 'two turns');
assert.equal(kids.length, 3, 'three subagent children');
assert.deepEqual(kids.map((k) => k.data.question), ['[scout] 查 A', '[scout] 查 B', '[reviewer] 看 C']);
assert.deepEqual(kids.map((k) => k.data.response), ['A 是这样', 'B 是那样', 'C 没问题']);
assert.ok(kids.every((k) => k.data.isBranch), 'children are branch nodes');
const t1 = turns[0], t2 = turns[1];
assert.ok(kids.every((k) => k.data.importSource.subagent.of === t1.data.importSource.itemIds[0]), 'children name their turn');
assert.ok(kids.every((k) => g.edges.some((e) => e.source === t1.id && e.target === k.id && e.data?.isBranchFromSelection)), 'branch edges from the turn');
assert.ok(g.edges.some((e) => e.source === t1.id && e.target === t2.id && !e.data?.isBranchFromSelection), 'the next turn continues the chain');
assert.equal(t2.position.x, t1.position.x, 'the next turn keeps the main column');
assert.ok(kids.every((k) => k.position.x > t1.position.x), 'children sit beside, not below');
assert.equal(new Set(kids.map((k) => k.data.importSource.itemIds[0])).size, 3, 'each child has its own id');
assert.equal(t1.data.response, '分头去查。\n\n汇总：A 这样，B 那样，C 没问题。', 'the parent keeps its whole answer');
console.log('pi: 3 subagent runs → 3 branch children, chain intact');

// ── Pi without details: one run, the result text is its answer ──
const pi2 = new PiSessionCollector();
const L2 = (o) => pi2.feedLine(JSON.stringify(o));
L2({ type: 'session', version: 3, id: 'pi-2', timestamp: '2026-09-29T10:00:00.000Z', cwd: '/w' });
L2({ type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: '让 scout 看看' }] } });
L2({ type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'subagent', arguments: { agent: 'scout', task: '看看仓库' } }] } });
L2({ type: 'message', id: 'r1', parentId: 'a1', message: { role: 'toolResult', toolCallId: 'c', toolName: 'subagent', content: [{ type: 'text', text: '仓库有三个包' }] } });
L2({ type: 'message', id: 'a2', parentId: 'r1', message: { role: 'assistant', content: [{ type: 'text', text: '三个包。' }] } });
const g2 = pi2.toConversation().build();
const k2 = g2.nodes.filter((n) => n.data.importSource?.subagent);
assert.equal(k2.length, 1); assert.equal(k2[0].data.question, '[scout] 看看仓库'); assert.equal(k2[0].data.response, '仓库有三个包');
console.log('pi: a single run without details reads the result text');

// ── Claude Code: an Agent call, then its sidechain file adopted ──
const cc = new ClaudeSessionCollector();
const C = (o) => cc.feedLine(JSON.stringify(o));
C({ type: 'user', uuid: 'u1', parentUuid: null, sessionId: 'cc-1', cwd: '/w', timestamp: '2026-09-29T10:00:00.000Z', message: { role: 'user', content: '摸清目录' } });
C({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: 'cc-1', message: { role: 'assistant', content: [{ type: 'text', text: '派一个探索代理。' }, { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'Explore', description: '摸清目录', prompt: '在 /w 下列出所有包' } }] } });
C({ type: 'user', uuid: 'u1b', parentUuid: 'a1', sessionId: 'cc-1', timestamp: '2026-09-29T10:00:30.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '三个包：a、b、c' }] } });
C({ type: 'assistant', uuid: 'a2', parentUuid: 'u1b', sessionId: 'cc-1', message: { role: 'assistant', content: [{ type: 'text', text: '有三个包。' }] } });
C({ type: 'user', uuid: 'u2', parentUuid: 'a2', sessionId: 'cc-1', timestamp: '2026-09-29T10:01:00.000Z', message: { role: 'user', content: '先看 a' } });
C({ type: 'assistant', uuid: 'a3', parentUuid: 'u2', sessionId: 'cc-1', message: { role: 'assistant', content: [{ type: 'text', text: 'a 是入口。' }] } });
const conv = cc.toConversation();
// the child's own file: sidechain top to bottom
const side = new ClaudeSessionCollector();
const S = (o) => side.feedLine(JSON.stringify(o));
S({ type: 'user', uuid: 's1', parentUuid: null, isSidechain: true, agentId: 'agent-x', sessionId: 'cc-1', cwd: '/w', timestamp: '2026-09-29T10:00:05.000Z', message: { role: 'user', content: '在 /w 下列出所有包' } });
S({ type: 'assistant', uuid: 's2', parentUuid: 's1', isSidechain: true, agentId: 'agent-x', sessionId: 'cc-1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_s', name: 'Bash', input: { command: 'ls /w' } }] } });
S({ type: 'user', uuid: 's3', parentUuid: 's2', isSidechain: true, agentId: 'agent-x', sessionId: 'cc-1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_s', content: 'a b c' }] } });
S({ type: 'assistant', uuid: 's4', parentUuid: 's3', isSidechain: true, agentId: 'agent-x', sessionId: 'cc-1', message: { role: 'assistant', content: [{ type: 'text', text: '三个包：a、b、c' }] } });
const sub = side.toSubagentSession();
assert.ok(sub && sub.sessionId === 'agent-x' && sub.firstQuestion === '在 /w 下列出所有包', 'the sidechain file reads as a subagent session');
conv.adopt([sub]);
const g3 = conv.build();
const ccTurns = g3.nodes.filter((n) => n.data.importSource && !n.data.importSource.subagent);
const ccKids = g3.nodes.filter((n) => n.data.importSource?.subagent);
assert.equal(ccTurns.length, 2); assert.equal(ccKids.length, 1);
assert.equal(ccKids[0].data.question, '[Explore] 摸清目录');
assert.equal(ccKids[0].data.response, '三个包：a、b、c');
assert.deepEqual(ccKids[0].data.importSource.itemIds, ['toolu_1', 'agent-x'], 'call id first, the child session id once adopted');
assert.ok((ccKids[0].data.attachments ?? []).length >= 1, 'the child carries the sidechain tool footprint');
assert.equal(ccTurns[1].position.x, ccTurns[0].position.x, 'the next turn keeps the main column');
console.log('claude-code: Agent call → child; sidechain adopted with its tools');

// ── Codex: the parent never names the child; a child is paired by time with the turn it started under ──
const turnsByTime = [
  { question: 'q1', response: 'r1', itemIds: ['t1'], tools: [], at: '2026-09-29T10:00:00.000Z' },
  { question: 'q2', response: 'r2', itemIds: ['t2'], tools: [], at: '2026-09-29T10:05:00.000Z' },
];
adoptSubagentSessions(turnsByTime, [
  { runner: 'codex', sessionId: 'child-1', firstQuestion: '查依赖', at: '2026-09-29T10:02:00.000Z', turns: [{ question: '查依赖', response: '十二个依赖', itemIds: ['c1'], tools: [{ name: 'exec_command', call: 'npm ls', result: '…', truncated: false, op: 'run' }] }] },
  { runner: 'codex', sessionId: 'child-2', firstQuestion: '跑测试', at: '2026-09-29T10:06:00.000Z', turns: [{ question: '跑测试', response: '全过', itemIds: ['c2'], tools: [] }] },
]);
assert.equal(turnsByTime[0].subagents?.length, 1); assert.equal(turnsByTime[0].subagents[0].output, '十二个依赖'); assert.equal(turnsByTime[0].subagents[0].tools?.length, 1);
assert.equal(turnsByTime[1].subagents?.length, 1); assert.equal(turnsByTime[1].subagents[0].task, '跑测试');
console.log('codex: children paired by time with the turn they started under');

rmSync(dir, { recursive: true, force: true });
console.log('ok');
