// Canvas semantics regression: real role items, edits, merges, images and restart checkpoints.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(join(tmpdir(), 'td-native-canvas-'));
try {
  const file = join(temp, 'compiler.mjs');
  await build({ entryPoints: [resolve('src/lib/agents/codex-history.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  const { compileCodexHistory, selectCodexBase, scopeNativeItems, historyFingerprint, toolAttachmentsFingerprint } = await import(pathToFileURL(file));
  const msg = (role, content, nodeId, part) => ({ role, content, ...(nodeId ? { canvasSource: { layer: 'chain', nodeId, part } } : {}) });
  const raw = (q, a) => [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: q }] },
    { type: 'function_call', call_id: 'same-call', name: 'exec_command', arguments: '{"cmd":"echo evidence"}' },
    { type: 'function_call_output', call_id: 'same-call', output: 'evidence\n' + 'x'.repeat(150000) },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: a }] },
  ];
  const node = (id, question, response) => ({ id, data: { question, response, responses: [response], responseIndex: 0, isLoading: false, attachments: [], agentSession: { runtime: 'codex', cwd: 'D:/test', sessionId: id, sessionFile: `D:/test/${id}.jsonl`, nativeHistory: {
    version: 1, threadId: id, turnId: `turn-${id}`, capture: 'complete', checkpoint: `checkpoint-${id}`, items: raw(question, response), mappings: [], question, response,
  } } } });
  const b = node('B', 'B question', 'B answer');
  b.data.agentSession.nativeHistory.toolAttachmentsFingerprint = await toolAttachmentsFingerprint(b);
  const messages = [msg('user', 'API A question', 'A', 'question'), msg('assistant', 'API A answer', 'A', 'response'), msg('user', b.data.question, 'B', 'question'), msg('assistant', b.data.response, 'B', 'response'), msg('user', 'D question')];
  const result = await compileCodexHistory(messages, [b], 'D');
  assert.equal(result.question, 'D question');
  assert.equal(result.history.items.length, 6);
  assert.deepEqual(result.history.items.slice(0, 2).map(item => item.role), ['user', 'assistant']);
  assert.equal(result.history.items[4].output.length, 150009, 'raw tool output remains untruncated');
  assert.equal(result.history.items[3].call_id, result.history.items[4].call_id);
  assert.equal(result.history.mappings.at(-1).nodeId, 'B');
  assert.equal(result.history.mappings.at(-1).representation, 'native');

  const saved = b.data.agentSession.nativeHistory;
  saved.itemCount = 6; saved.outputFingerprint = result.history.fingerprint;
  const afterRestart = JSON.parse(JSON.stringify(b));
  await selectCodexBase(result.history, '', [afterRestart], 'd:\\test');
  assert.equal(result.history.base.threadId, 'B', 'persistent mapping survives JSON/IndexedDB roundtrip');
  const edited = await compileCodexHistory(messages.map(m => m.content === 'API A answer' ? { ...m, content: 'Edited API answer' } : m), [afterRestart], 'D');
  await selectCodexBase(edited.history, '', [afterRestart], 'D:/test');
  assert.equal(edited.history.base, undefined, 'upstream edits invalidate native resume');
  const removed = await compileCodexHistory(messages.slice(2), [afterRestart], 'D');
  await selectCodexBase(removed.history, '', [afterRestart], 'D:/test');
  assert.equal(removed.history.base, undefined, 'rewiring cannot retain hidden native ancestors');
  const changedInstructions = await compileCodexHistory([msg('system', 'New role'), ...messages], [afterRestart], 'D');
  await selectCodexBase(changedInstructions.history, changedInstructions.instructions, [afterRestart], 'D:/test');
  assert.equal(changedInstructions.history.base, undefined);
  assert.equal(changedInstructions.history.items.some(item => item.role === 'system'), false);

  const c = node('C', 'C question', 'C answer');
  c.data.agentSession.nativeHistory.toolAttachmentsFingerprint = await toolAttachmentsFingerprint(c);
  const merged = await compileCodexHistory([...messages.slice(0, -1), msg('user', c.data.question, 'C', 'question'), msg('assistant', c.data.response, 'C', 'response'), msg('user', 'merge')], [b, c], 'D');
  const calls = merged.history.items.filter(item => item.type === 'function_call').map(item => item.call_id);
  assert.equal(new Set(calls).size, 2, 'tool IDs from independent sessions never collide');
  b.data.question = 'edited B question';
  const changedNode = await compileCodexHistory(messages.map(m => m.canvasSource?.nodeId === 'B' && m.role === 'user' ? { ...m, content: b.data.question } : m), [b], 'D');
  assert.equal(changedNode.history.items.some(item => item.type === 'function_call'), false, 'editing a turn does not restore stale raw text');
  const images = [{ data: 'aGVsbG8=', mimeType: 'image/png', canvasSource: { nodeId: 'A', attachmentId: 'img-a' } }, { data: 'bmV3', mimeType: 'image/png', canvasSource: { nodeId: 'D', attachmentId: 'img-d' } }];
  const withImages = await compileCodexHistory(messages, [], 'D', images);
  assert.equal(withImages.history.items[0].content[0].type, 'input_image');
  assert.equal(withImages.images.length, 1, 'historical images are not reattached to the current turn');
  assert.equal(await historyFingerprint(await scopeNativeItems(raw('q', 'a'), 'B'), ''), await historyFingerprint(await scopeNativeItems(raw('q', 'a'), 'B'), ''), 'compilation is deterministic');

  const copy = (value) => JSON.parse(JSON.stringify(value));
  const ownMessages = (n) => [
    ...(n.data.attachments ?? []).filter((att) => att.op || att.name.startsWith('tool: ')).map((att) => ({
      role: 'user', content: att.content, canvasSource: { layer: 'chain', nodeId: n.id, part: 'attachment', attachmentId: att.id },
    })),
    msg('user', n.data.question, n.id, 'question'), msg('assistant', n.data.response, n.id, 'response'), msg('user', 'next question'),
  ];
  const nativeCalls = (compiled) => compiled.history.items.filter((item) => item.type === 'function_call');
  const imageUrls = (compiled) => compiled.history.items.flatMap((item) => (item.content ?? []).filter((part) => part.type === 'input_image').map((part) => part.image_url));

  // Editing the image channel must invalidate the captured input, even when
  // the displayed question and answer are byte-for-byte unchanged.
  const pictured = node('pictured', 'inspect image', 'original image answer');
  pictured.data.agentSession.nativeHistory.toolAttachmentsFingerprint = await toolAttachmentsFingerprint(pictured);
  const originalImage = { data: 'b3JpZ2luYWw=', mimeType: 'image/png', canvasSource: { nodeId: pictured.id, attachmentId: 'picture' } };
  const originalUrl = `data:${originalImage.mimeType};base64,${originalImage.data}`;
  pictured.data.agentSession.nativeHistory.items[0].content.push({ type: 'input_image', image_url: originalUrl, detail: 'auto' });
  const unchangedImage = await compileCodexHistory(ownMessages(pictured), [pictured], 'D', [originalImage]);
  assert.equal(nativeCalls(unchangedImage).length, 1, 'the unchanged image keeps the native turn');
  assert.deepEqual(imageUrls(unchangedImage), [originalUrl], 'an unchanged image is included once');
  const deletedImage = await compileCodexHistory(ownMessages(pictured), [pictured], 'D', []);
  assert.equal(nativeCalls(deletedImage).length, 0, 'deleting or excluding an image invalidates native reuse');
  assert.deepEqual(imageUrls(deletedImage), [], 'deleted pixels never reappear from captured native input');
  const replacementImage = { ...originalImage, data: 'cmVwbGFjZW1lbnQ=' };
  const replacementUrl = `data:${replacementImage.mimeType};base64,${replacementImage.data}`;
  const replacedImage = await compileCodexHistory(ownMessages(pictured), [pictured], 'D', [replacementImage]);
  assert.equal(nativeCalls(replacedImage).length, 0, 'replacing pixels invalidates the prior native input');
  assert.deepEqual(imageUrls(replacedImage), [replacementUrl], 'the replacement survives and the old image does not');
  const addedImage = await compileCodexHistory(ownMessages(pictured), [pictured], 'D', [originalImage, { ...replacementImage, canvasSource: { nodeId: pictured.id, attachmentId: 'picture-2' } }]);
  assert.equal(nativeCalls(addedImage).length, 0, 'adding an image cannot reuse an incomplete captured input');
  assert.deepEqual(imageUrls(addedImage), [originalUrl, replacementUrl], 'new images are never swallowed by native deduplication');

  // A native turn replaces tool display records only while their exact set
  // and contents still match the completion snapshot.
  const tooled = node('tooled', 'run command', 'command finished');
  tooled.data.attachments = [{ id: 'tool-original', name: 'tool: exec_command', type: 'text/plain', size: 25, op: 'run', content: '[call] original\n[result] original' }];
  tooled.data.agentSession.nativeHistory.toolAttachmentsFingerprint = await toolAttachmentsFingerprint(tooled);
  const unchangedTool = await compileCodexHistory(ownMessages(tooled), [tooled], 'D');
  assert.equal(nativeCalls(unchangedTool).length, 1, 'the original included tool record uses raw native items');
  assert.ok(!JSON.stringify(unchangedTool.history.items).includes('[call] original'), 'the display projection is not duplicated alongside raw items');
  const editedToolNode = copy(tooled);
  editedToolNode.data.attachments[0].content = '[call] edited\n[result] corrected by user';
  const editedTool = await compileCodexHistory(ownMessages(editedToolNode), [editedToolNode], 'D');
  assert.equal(nativeCalls(editedTool).length, 0, 'edited tool text invalidates the old raw records');
  assert.ok(JSON.stringify(editedTool.history.items).includes('corrected by user'), 'the user-edited tool text remains authoritative');
  const deletedToolNode = copy(tooled);
  deletedToolNode.data.attachments = [];
  const deletedTool = await compileCodexHistory(ownMessages(deletedToolNode), [deletedToolNode], 'D');
  assert.equal(nativeCalls(deletedTool).length, 0, 'deleted tool records are not resurrected from native storage');
  assert.ok(!JSON.stringify(deletedTool.history.items).includes('echo evidence'), 'deleted call arguments are absent as well');
  const addedToolNode = copy(tooled);
  addedToolNode.data.attachments.push({ id: 'tool-added', name: 'tool: supplied_result', type: 'text/plain', size: 30, content: 'New tool record supplied by user' });
  const addedTool = await compileCodexHistory(ownMessages(addedToolNode), [addedToolNode], 'D');
  assert.equal(nativeCalls(addedTool).length, 0, 'adding a tool record invalidates the prior native snapshot');
  assert.ok(JSON.stringify(addedTool.history.items).includes('New tool record supplied by user'), 'an added tool record is never dropped as a native display duplicate');
  const excludedTool = await compileCodexHistory(ownMessages(tooled).filter((m) => m.canvasSource?.part !== 'attachment'), [tooled], 'D');
  assert.equal(nativeCalls(excludedTool).length, 0, 'excluding a still-present tool record also prevents native replay');

  const missingCwd = copy(afterRestart);
  delete missingCwd.data.agentSession.cwd;
  const compiled = await compileCodexHistory(messages, [missingCwd], 'D');
  await selectCodexBase(compiled.history, '', [missingCwd], 'D:/test');
  assert.equal(compiled.history.base, undefined, 'older sessions without a known directory cannot redirect or break a new run');

  for (const empty of [null, undefined]) {
    const emptyVersion = copy(afterRestart);
    emptyVersion.data.codexHistories = [empty];
    const compiled = await compileCodexHistory(messages, [emptyVersion], 'D');
    assert.equal(nativeCalls(compiled).length, 0, 'an empty selected version must not borrow the same-text session capture');
    await selectCodexBase(compiled.history, '', [emptyVersion], 'D:/test');
    assert.equal(compiled.history.base, undefined, 'an empty version never supplies a continuation checkpoint');
  }
  const futureVersion = copy(afterRestart);
  futureVersion.data.codexHistories = [{ ...futureVersion.data.agentSession.nativeHistory, version: 2 }];
  assert.equal(nativeCalls(await compileCodexHistory(messages, [futureVersion], 'D')).length, 0, 'an unknown capture format cannot be treated as version 1');

  // The same words do not establish thread ownership: an unrelated native
  // conversation must not lend its checkpoint or session-scoped approvals.
  const unrelated = node('unrelated', 'same question', 'same answer');
  unrelated.data.agentSession.nativeHistory.items = [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'same question' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'same answer' }] },
  ];
  unrelated.data.agentSession.nativeHistory.toolAttachmentsFingerprint = await toolAttachmentsFingerprint(unrelated);
  const apiOnly = await compileCodexHistory([msg('user', 'same question', 'actual-api', 'question'), msg('assistant', 'same answer', 'actual-api', 'response'), msg('user', 'continue')], [unrelated], 'D');
  unrelated.data.agentSession.nativeHistory.itemCount = apiOnly.history.items.length;
  unrelated.data.agentSession.nativeHistory.outputFingerprint = await historyFingerprint(unrelated.data.agentSession.nativeHistory.items, '');
  assert.equal(apiOnly.history.fingerprint, unrelated.data.agentSession.nativeHistory.outputFingerprint, 'the fixture has genuinely identical structured history');
  await selectCodexBase(apiOnly.history, '', [unrelated], 'D:/test');
  assert.equal(apiOnly.history.base, undefined, 'identical text in an unrelated node cannot select its native thread');

  console.log('PASS: structured roles, raw tools, source mappings, restart persistence, edits, rewiring, instructions, merge IDs, image deletion/replacement/addition, tool edits/deletion/addition/exclusion, strict versions, unrelated thread isolation.');
} finally { await rm(temp, { recursive: true, force: true }); }
