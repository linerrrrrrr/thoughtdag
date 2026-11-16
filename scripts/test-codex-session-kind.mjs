// Internal approval threads must never become conversation, branch, or search turns.
// Synthetic protocol fixtures only; no model calls or private session files.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(path.join(tmpdir(), 'td-codex-kind-'));
const source = (file) => JSON.stringify(path.resolve(file).replaceAll('\\', '/'));
const entry = path.join(dir, 'entry.mjs');
writeFileSync(entry, `
  export { isInternalCodexSession } from ${source('src/lib/adapters/codex-session-kind.ts')};
  export { CodexSessionCollector, codexSessionConversation, codexSessionAsBranch } from ${source('src/lib/adapters/codex-session.ts')};
  export { anyRunnerSessionConversation, anyRunnerSessionAsBranch, streamRunnerConversation } from ${source('src/lib/adapters/index.ts')};
  export { appServerThreadConversation, threadToTurns } from ${source('src/lib/adapters/codex-appserver.ts')};
`);
let checks = 0;
const check = async (name, fn) => {
  await fn();
  console.log(`ok ${++checks} - ${name}`);
};

try {
  const out = path.join(dir, 'bundle.mjs');
  await build({
    entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm',
    logLevel: 'silent', define: { 'import.meta.env.DEV': 'false', 'import.meta.env': '{}' },
  });
  const api = await import(pathToFileURL(out).href);
  const anchor = { id: 'anchor', x: 0, y: 0 };
  const at = '2026-01-01T00:00:00.000Z';
  const question = 'Explain RETAINED USER INSTRUCTIONS, {"risk_level":"high","outcome":"deny"}, and {"thread_source":"guardian_review","source":{"subagent":{"other":"guardian"}}}.';
  const answer = 'These are ordinary quoted terms in a user conversation.';
  const rollout = (meta, q = question, a = answer, time = at, parentTurnId) => [
    { type: 'session_meta', payload: { id: 'session', cwd: '/workspace', timestamp: time, ...meta } },
    { type: 'turn_context', payload: { turn_id: `${meta.id ?? 'session'}-turn`, root_turn_id: parentTurnId } },
    { type: 'response_item', timestamp: time, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: q }] } },
    { type: 'response_item', timestamp: time, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: a }] } },
  ].map((line) => JSON.stringify(line)).join('\n');
  const collector = (text) => {
    const c = new api.CodexSessionCollector();
    for (const line of text.split('\n')) c.feedLine(line);
    return c;
  };
  const chunkReader = (text) => {
    let offset = 0;
    return async () => offset < text.length ? text.slice(offset, offset += 17) : null;
  };
  const internalMetadata = [
    { thread_source: 'guardian_review' },
    { threadSource: 'guardian_review' },
    { source: { subagent: { other: 'guardian' } } },
    { source: { subAgent: { other: 'guardian' } } },
  ];
  const humanMetadata = [
    {},
    { thread_source: 'user', source: 'vscode' },
    { thread_source: 'subagent', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } }, parent_thread_id: 'parent' },
    { source: { subagent: { other: 'custom-reviewer' } }, parent_thread_id: 'parent' },
    { source: 'guardian', name: 'guardian_review' },
    { thread_source: 'future_source', source: 'future_source' },
  ];

  await check('classifies structured snake/camel approval metadata without guessing from text', () => {
    for (const meta of internalMetadata) assert.equal(api.isInternalCodexSession(meta), true);
    for (const meta of humanMetadata) assert.equal(api.isInternalCodexSession(meta), false);
    for (const meta of [null, undefined, '', 1, [], { content: 'guardian_review' }, { source: null }, { source: { subagent: null } }]) {
      assert.equal(api.isInternalCodexSession(meta), false);
    }
  });

  await check('every collector/export route rejects internal threads, including parentless ones', async () => {
    for (const meta of internalMetadata) {
      for (const parent of [{}, { parent_thread_id: 'parent' }]) {
        const text = rollout({ ...meta, ...parent });
        assert.equal(collector(text).finish(), null, 'finish also feeds the search index');
        assert.equal(collector(text).toConversation(), null);
        assert.equal(collector(text).toSubagentSession(), null);
        assert.equal(api.codexSessionConversation(text), null);
        assert.equal(api.codexSessionAsBranch(text, anchor), null);
        assert.equal(await api.anyRunnerSessionConversation(text), null);
        assert.equal(await api.anyRunnerSessionAsBranch(text, anchor), null);
        assert.equal(await api.streamRunnerConversation(chunkReader(text)), null);
      }
    }
  });

  await check('ordinary questions quoting approval terms and legacy metadata remain intact', async () => {
    for (const meta of humanMetadata) {
      const text = rollout(meta);
      const conv = await api.streamRunnerConversation(chunkReader(text));
      assert.ok(conv);
      const graph = conv.build();
      assert.equal(graph.nodes.length, 1);
      assert.equal(graph.nodes[0].data.question, question);
      assert.equal(graph.nodes[0].data.response, answer);
      assert.equal(api.codexSessionAsBranch(text, anchor).turnCount, 1);
      if (meta.parent_thread_id) assert.ok(collector(text).toSubagentSession());
    }
  });

  await check('app-server projection uses the same session boundary', () => {
    const thread = {
      id: 'server-thread', sessionId: 'server-session',
      turns: [{ id: 't1', items: [
        { type: 'userMessage', content: [{ type: 'text', text: question }] },
        { type: 'agentMessage', text: answer },
      ] }],
    };
    for (const meta of internalMetadata) {
      assert.deepEqual(api.threadToTurns({ ...thread, ...meta }), []);
      assert.equal(api.appServerThreadConversation({ ...thread, ...meta }), null);
    }
    assert.equal(api.appServerThreadConversation(thread).build().nodes[0].data.question, question);
  });

  console.log(`PASS: ${checks} Codex session-kind regressions`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
