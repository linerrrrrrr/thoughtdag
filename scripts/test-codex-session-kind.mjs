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
  export { identityFromHead, scanSessions, internalCodexChildren, knownSessionIds } from ${source('src/lib/atlas/discover.ts')};
  export { withSubagents } from ${source('src/lib/atlas/subagents.ts')};
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
    // Only the shell reader is needed here, not the browser's project stores.
    plugins: [{
      name: 'shell-reader-only',
      setup(b) {
        b.onResolve({ filter: /^\.\/canonical$/ }, (args) =>
          /[\\/]atlas[\\/]subagents\.ts$/.test(args.importer)
            ? { path: 'shell-reader', namespace: 'test' } : undefined);
        b.onLoad({ filter: /^shell-reader$/, namespace: 'test' }, () => ({ contents: `
          export function shellSessionReader(rootKey, rel) {
            let start = 0, done = false;
            return async () => {
              if (done) return null;
              const r = await window.desktopSessions.readRange(rootKey, rel, start, 8388608);
              start = r.nextStart; done = r.eof; return r.text;
            };
          }
        ` }));
      },
    }],
  });
  const api = await import(pathToFileURL(out).href);
  const anchor = { id: 'anchor', x: 0, y: 0 };
  const at = '2026-01-01T00:00:00.000Z';
  const childAt = '2026-01-01T00:01:00.000Z';
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
        assert.equal(api.identityFromHead(text), null, 'live-mirror identity must not expose internal threads');
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
      assert.equal(api.identityFromHead(text), 'session');
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

  const files = new Map([
    ['parent.jsonl', rollout({ id: 'parent', thread_source: 'user' }, 'Inspect the project.', 'Delegating a check.')],
    ['child.jsonl', rollout({ id: 'child', parent_thread_id: 'parent', thread_source: 'subagent', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }, 'Check the imports.', 'The imports are valid.', childAt)],
    ['review.jsonl', rollout({ id: 'review', parent_thread_id: 'parent', thread_source: 'guardian_review' }, 'Synthetic approval evidence.', '{"outcome":"deny","copied_history":"UNTRUSTED_AUDIT_HISTORY"}', childAt, 'parent-turn')],
    ['review-long.jsonl', rollout({ id: 'review-long', parent_thread_id: 'parent', base_instructions: 'x'.repeat(20000), source: { subagent: { other: 'guardian' } } }, 'Synthetic approval evidence.', '{"outcome":"allow"}', childAt, 'parent-turn')],
    ['other-review.jsonl', rollout({ id: 'other-review', parent_thread_id: 'other-parent', thread_source: 'guardian_review' })],
  ]);
  const readRanges = [];
  const headReads = [];
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.window = { desktopSessions: {
    roots: async () => [{ key: 'test-sessions', exists: true, path: '/workspace' }],
    list: async () => [...files].map(([rel, text]) => ({ rel, size: text.length, mtime: 1 })),
    head: async (_rootKey, rel, bytes) => { headReads.push({ rel, bytes }); return files.get(rel).slice(0, bytes); },
    readRange: async (_rootKey, rel, start) => {
      readRanges.push(rel);
      const text = files.get(rel);
      const nextStart = Math.min(start + 53, text.length);
      return { text: text.slice(start, nextStart), nextStart, eof: nextStart === text.length };
    },
  } };

  await check('atlas excludes internal cards but retains trusted child IDs for old-canvas repair', async () => {
    const cards = await api.scanSessions();
    assert.deepEqual(cards.map((c) => c.sessionId).sort(), ['child', 'parent']);
    assert.equal(cards.find((c) => c.sessionId === 'child').subagent, true);
    assert.deepEqual(api.internalCodexChildren('parent').sort(), ['review', 'review-long']);
    assert.deepEqual(api.internalCodexChildren('other-parent'), ['other-review']);
    assert.deepEqual([...api.knownSessionIds].sort(), ['child', 'parent']);
    assert.ok(headReads.some((r) => r.rel === 'review-long.jsonl' && r.bytes > 20000), 'large header is retried before classification');
    const reads = headReads.length;
    await api.scanSessions();
    assert.equal(headReads.length, reads, 'unchanged metadata remains cached');
  });

  await check('refresh without atlas cards adopts real children and only structured approval attachments', async () => {
    const conv = api.codexSessionConversation(files.get('parent.jsonl'));
    const adopted = await api.withSubagents(conv, 'test-sessions', 'parent.jsonl');
    assert.deepEqual(adopted.excludedSessionIds.sort(), ['review', 'review-long']);
    const graph = adopted.build();
    const kids = graph.nodes.filter((n) => n.data.importSource?.subagent);
    assert.equal(graph.nodes.length, 2);
    assert.equal(kids.length, 1);
    assert.deepEqual(kids[0].data.importSource.itemIds, ['child']);
    assert.equal(kids[0].data.response, 'The imports are valid.');
    const parent = graph.nodes.find((n) => !n.data.importSource?.subagent);
    const approvals = parent.data.attachments.filter((a) => a.name === 'tool: autoApprovalReview');
    assert.equal(approvals.length, 2, 'each structured verdict stays on its exact parent turn');
    assert.ok(approvals.every((a) => parent.data.excludedAttachmentIds.includes(a.id)), 'approval attachments are excluded from context by default');
    assert.ok(approvals.some((a) => a.content.includes('"outcome":"deny"')));
    assert.ok(approvals.some((a) => a.content.includes('"outcome":"allow"')));
    assert.ok(!JSON.stringify(graph).includes('Synthetic approval evidence.'));
    assert.ok(!JSON.stringify(graph).includes('UNTRUSTED_AUDIT_HISTORY'), 'unknown verdict fields cannot copy the internal history');
    assert.deepEqual([...new Set(readRanges)].sort(), ['child.jsonl', 'review-long.jsonl', 'review.jsonl'], 'only this parent\'s internal records are inspected');
  });

  await check('removed files do not leave stale internal exclusions in the discovery cache', async () => {
    files.delete('review.jsonl');
    await api.scanSessions();
    assert.deepEqual(api.internalCodexChildren('parent'), ['review-long']);
  });
  console.log(`PASS: ${checks} Codex session-kind regressions`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
