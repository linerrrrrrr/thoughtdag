// Public transcript fixtures only; never read private sessions or invoke models.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'td-codex-activity-'));
let checks = 0;
const check = (name, fn) => { fn(); console.log(`ok ${++checks} - ${name}`); };
try {
  const out = join(dir, 'fixture.mjs');
  await build({ stdin: { contents: `
    export * from './src/lib/adapters/codex-session';
    export * from './src/lib/adapters/codex-appserver';
    export * from './src/lib/atlas/codex-activity-repair';
  `, resolveDir: resolve('.'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: out,
  define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { CodexSessionCollector, codexSessionConversation, codexSessionAsBranch, threadToTurns, appServerThreadConversation, repairCodexActivity } = await import(pathToFileURL(out).href);
  const at = '2026-01-01T00:00:00.000Z';
  const ri = (payload, timestamp = at) => ({ type: 'response_item', timestamp, payload });
  const msg = (role, text, phase) => ri({ type: 'message', role, phase, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] });
  const lines = [
    { type: 'session_meta', payload: { id: 'codex-session', cwd: 'D:/work' } },
    { type: 'turn_context', payload: { turn_id: 'turn-one' } },
    msg('user', 'Fix the parser.'),
    msg('assistant', 'I will inspect [parser.ts](D:/work/parser.ts:42).', 'commentary'),
    ri({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Check the input boundary.' }], content: [{ text: 'RAW PRIVATE' }], encrypted_content: 'ENCRYPTED' }),
    ri({ type: 'function_call', call_id: 'cmd', name: 'functions.exec_command', arguments: JSON.stringify({ cmd: 'npm test', workdir: 'D:/work' }) }),
    msg('assistant', 'The tests are running.', 'commentary'),
    ri({ type: 'function_call_output', call_id: 'cmd', output: 'Process exited with code 0\n' + 'x'.repeat(5000) }),
    ri({ type: 'function_call', call_id: 'plan', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Run tests', status: 'completed' }] }) }),
    ri({ type: 'function_call_output', call_id: 'plan', output: 'Plan updated' }),
    ri({ type: 'custom_tool_call', call_id: 'patch', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/parser.ts\n@@\n-old\n+new\n*** End Patch' }),
    ri({ type: 'custom_tool_call_output', call_id: 'patch', output: [{ text: 'Success' }] }),
    msg('assistant', 'Fixed the parser.', 'final_answer'),
  ];
  const text = lines.map(JSON.stringify).join('\n');
  const collector = new CodexSessionCollector();
  for (const line of text.split('\n')) collector.feedLine(line);
  const turn = collector.finish().turns[0];
  check('commentary is separate from answer with original markup and ordering', () => {
    assert.equal(turn.response, 'Fixed the parser.');
    assert.deepEqual(turn.activity.map(e => e.kind), ['commentary', 'reasoning', 'command', 'commentary', 'plan', 'file', 'message']);
    assert.equal(turn.activity[0].text, 'I will inspect [parser.ts](D:/work/parser.ts:42).');
    assert.equal(turn.activity[2].id, 'cmd');
    assert.equal(turn.activity[2].startedAt, Date.parse(at));
  });
  check('readable summaries survive while raw/encrypted reasoning never does', () => {
    assert.equal(turn.activity[1].text, 'Check the input boundary.');
    assert.ok(!JSON.stringify(turn).includes('RAW PRIVATE'));
    assert.ok(!JSON.stringify(turn).includes('ENCRYPTED'));
  });
  check('tool output retains more than the small context attachment preview', () => {
    const command = turn.activity[2];
    assert.equal(command.command, 'npm test');
    assert.equal(command.cwd, 'D:/work');
    assert.equal(command.exitCode, 0);
    assert.equal(command.status, 'completed');
    assert.ok(command.output.length > 5000);
    assert.ok(turn.tools[0].result.length < command.output.length);
  });
  check('plan steps and actual file diff are structured', () => {
    assert.equal(turn.activity[4].details.plan[0].step, 'Run tests');
    assert.equal(turn.activity[5].details.changes[0].path, 'src/parser.ts');
    assert.match(turn.activity[5].details.changes[0].diff, /-old\n\+new/);
  });
  const graph = codexSessionConversation(text).build();
  const fresh = graph.nodes.find(n => n.data.source);
  check('normal import and harvested branches both persist the transcript', () => {
    assert.equal(fresh.data.agentActivities[0].length, 7);
    const branch = codexSessionAsBranch(text, { id: 'anchor', x: 0, y: 0 });
    assert.equal(branch.nodes.find(n => n.data.source).data.agentActivities[0].length, 7);
  });
  check('commentary-only incomplete answers are retained as real turns', () => {
    const partial = codexSessionConversation(lines.slice(0, 4).map(JSON.stringify).join('\n')).build().nodes.find(n => n.data.source);
    assert.equal(partial.data.response, '');
    assert.equal(partial.data.agentActivities[0][0].kind, 'commentary');
  });
  check('same-turn steering keeps one answer with a chronological user message', () => {
    const steered = [...lines.slice(0, 4),
      { type: 'turn_context', payload: { turn_id: 'turn-one' } },
      msg('user', 'Also keep the public API.'),
      ...lines.slice(4)];
    const c = new CodexSessionCollector();
    for (const line of steered) c.feedLine(JSON.stringify(line));
    const turns = c.finish().turns;
    assert.equal(turns.length, 1);
    assert.equal(turns[0].question, 'Fix the parser.\n\nAlso keep the public API.');
    assert.equal(turns[0].activity[1].kind, 'user');
    assert.equal(turns[0].activity[1].text, 'Also keep the public API.');
    assert.equal(turns[0].response, 'Fixed the parser.');
  });
  const thread = { sessionId: 'codex-session', cwd: 'D:/work', turns: [{ id: 'turn-one', items: [
    { id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'Fix the parser.' }] },
    { id: 'c', type: 'agentMessage', phase: 'commentary', text: 'Inspecting.' },
    { id: 'r', type: 'reasoning', summary: ['A public summary.'], content: ['RAW PRIVATE'] },
    { id: 'cmd', type: 'commandExecution', command: 'npm test', cwd: 'D:/work', aggregatedOutput: 'failed', exitCode: 1, status: 'failed' },
    { id: 'f', type: 'agentMessage', phase: 'final_answer', text: 'Fixed.' },
  ] }] };
  check('thread/read uses the same phase separation and working directory', () => {
    const t = threadToTurns(thread)[0];
    assert.equal(t.response, 'Fixed.');
    assert.deepEqual(t.activity.map(e => e.kind), ['commentary', 'reasoning', 'command', 'message']);
    assert.equal(t.activity[2].status, 'failed');
    assert.equal(appServerThreadConversation(thread).build().nodes.find(n => n.data.source).data.importSource.cwd, 'D:/work');
    assert.equal(appServerThreadConversation({ ...thread, sessionId: undefined, id: 'native-id', cwd: null }).sessionId, 'native-id');
  });
  check('thread/read retains a supplemental user message in its original turn', () => {
    const steered = structuredClone(thread);
    steered.turns[0].items.splice(2, 0, { id: 'steer-user', type: 'userMessage', content: [{ type: 'text', text: 'Keep the API.' }] });
    const turns = threadToTurns(steered);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].question, 'Fix the parser.\n\nKeep the API.');
    assert.equal(turns[0].activity[1].kind, 'user');
  });
  const oldText = 'I will inspect the parser.\n\nFixed the parser.';
  const old = { ...fresh, position: { x: 123, y: 456 }, data: { ...fresh.data, displayName: 'My title', displaySummary: '', response: oldText, responses: [oldText, 'Other version'], responseIndex: 0, source: { question: fresh.data.question, response: oldText }, agentActivities: undefined } };
  check('lazy repair updates the original projection while preserving other versions and layout', () => {
    const repaired = repairCodexActivity([old], [fresh])[0];
    assert.equal(repaired.data.response, 'Fixed the parser.');
    assert.deepEqual(repaired.data.responses, ['Fixed the parser.', 'Other version']);
    assert.equal(repaired.data.responseIndex, 0);
    assert.equal(repaired.data.displayName, 'My title');
    assert.equal(repaired.data.displaySummary, '');
    assert.deepEqual(repaired.position, old.position);
    assert.equal(repaired.data.attachments, old.data.attachments);
    const nodes = [repaired];
    assert.equal(repairCodexActivity(nodes, [fresh]), nodes);
  });
  check('edited imported prose stays untouched but receives its source transcript', () => {
    const edited = { ...old, data: { ...old.data, response: 'My edited answer', responses: ['My edited answer'] } };
    const repaired = repairCodexActivity([edited], [fresh])[0];
    assert.equal(repaired.data.response, 'My edited answer');
    assert.deepEqual(repaired.data.responses, ['My edited answer']);
    assert.equal(repaired.data.agentActivities[0].length, 7);
    assert.equal(repaired.data.source.response, 'Fixed the parser.');
  });
  check('unknown version provenance, unrelated sessions and live runs are not rewritten', () => {
    for (const node of [
      { ...old, data: { ...old.data, responses: ['mine', 'other'], response: 'mine' } },
      { ...old, data: { ...old.data, importSource: { ...old.data.importSource, sessionId: 'another' } } },
      { ...old, data: { ...old.data, isLoading: true } },
    ]) assert.equal(repairCodexActivity([node], [fresh])[0], node);
  });
  console.log(`${checks} Codex activity import checks passed.`);
} finally { rmSync(dir, { recursive: true, force: true }); }
