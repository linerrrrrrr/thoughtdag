// Isolated browser coverage for file ingestion and legacy canvas migration.
// Run with APP_URL=http://127.0.0.1:5188 node scripts/test-single-file-node-ui.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
const writes = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket('**', socket => socket.close());
await context.route('**/api/**', route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(route.request().url());
  return route.fulfill({ json: { models: [], providers: [], sessions: [], topics: [] } });
});
await context.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
});

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5188', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__ui);

  const migrated = await page.evaluate(async () => {
    const { splitLegacyFileNodes } = await import('/src/lib/single-file-nodes.ts');
    const { buildContext, upstreamFingerprint } = await import('/src/store/context-builder.ts');
    const base = (id, stepKind, attachments = []) => ({ id, type: 'thought', position: { x: 0, y: 0 }, width: 400,
      data: { stepKind, question: '', response: '', responses: [], responseIndex: -1, tokenCount: 0,
        highlights: [], highlightMode: 'off', attachments, excludedAttachmentIds: [], includedAttachmentIds: [] } });
    const attachments = [
      { id: 'a', name: 'first.txt', type: 'text/plain', size: 5, content: 'first text' },
      { id: 'b', name: 'second.pdf', type: 'application/pdf', size: 5, content: '', contentInVault: true,
        editedText: 'second highlighted text', pdfAnnotations: [{ id: 'mark', page: 2, comment: 'margin note' }] },
      { id: 'c', name: 'third.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 5,
        content: '', contentInVault: true, editedDocxRevision: 'revision-1', editedText: 'third document' },
    ];
    const material = base('old', 'file', attachments);
    material.data.displayName = 'My old collection';
    material.data.question = 'Notes saved with the files';
    material.data.tokenCount = 5;
    material.data.highlights = [{ id: 'h', text: 'second highlighted text' }, { id: 'unmatched', text: 'kept even if unmatched' }];
    const question = base('question');
    question.data.question = 'What do these documents say?';
    question.data.anchor = { page: 2, attId: 'b' };
    question.data.detailLevel = 'full';
    const collision = base('old~file~2', 'note');
    collision.position = { x: 460, y: 0 };
    const graph = { nodes: [material, collision, question], edges: [
      { id: 'forward', source: 'old', target: 'question', data: { contextOrder: 2, label: 'kept' } },
    ] };
    question.data.response = 'An existing answer';
    question.data.lastContextHash = upstreamFingerprint('question', graph.nodes, graph.edges);
    const before = buildContext('question', graph.nodes, graph.edges).messages;
    const split = splitLegacyFileNodes(graph);
    const after = buildContext('question', split.nodes, split.edges).messages;
    const currentHash = upstreamFingerprint('question', split.nodes, split.edges);
    const splitAgain = splitLegacyFileNodes(split);
    const staleQuestion = { ...question, data: { ...question.data, lastContextHash: 'already-stale' } };
    const staleSplit = splitLegacyFileNodes({ ...graph, nodes: [material, collision, staleQuestion] });
    const reference = base('reference');
    reference.data.question = 'Reference question'; reference.data.response = 'Reference answer';
    const descendant = base('descendant');
    descendant.data.question = 'Continue'; descendant.data.response = 'Existing answer';
    const referenceGraph = { nodes: [material, reference, descendant], edges: [
      { id: 'cross', source: 'old', target: 'reference', data: { isCrossLink: true } },
      { id: 'continued', source: 'reference', target: 'descendant', data: {} },
    ] };
    reference.data.lastContextHash = upstreamFingerprint('reference', referenceGraph.nodes, referenceGraph.edges);
    descendant.data.lastContextHash = upstreamFingerprint('descendant', referenceGraph.nodes, referenceGraph.edges);
    const referenceSplit = splitLegacyFileNodes(referenceGraph);
    const referencesRemainCurrent = ['reference', 'descendant'].every(id =>
      referenceSplit.nodes.find(node => node.id === id).data.lastContextHash === upstreamFingerprint(id, referenceSplit.nodes, referenceSplit.edges));
    const { buildViewerLink, decodeViewerHash } = await import('/src/lib/viewer.ts');
    const viewer = await decodeViewerHash(new URL(await buildViewerLink(graph.nodes, graph.edges)).hash);

    const store = window.__store;
    const options = store.persist.getOptions();
    store.persist.setOptions({ name: 'test-legacy-file-migration', storage: {
      getItem: async () => ({ state: graph, version: 1 }), setItem: () => {}, removeItem: () => {},
    } });
    await store.persist.rehydrate();
    const restored = { nodes: store.getState().nodes, edges: store.getState().edges };
    store.persist.setOptions(options);
    return { before, after, split, splitAgain, restored, viewer, currentHash, referencesRemainCurrent,
      staleHash: staleSplit.nodes.find(node => node.id === 'question').data.lastContextHash };
  });
  const files = migrated.split.nodes.filter(node => node.data.stepKind === 'file');
  assert.deepEqual(files.map(node => node.data.attachments.map(att => att.id)), [['a'], ['b'], ['c']]);
  assert.equal(files[0].id, 'old');
  assert.notEqual(files[1].id, 'old~file~2', 'migration avoids existing node IDs');
  assert.equal(files[1].data.attachments[0].pdfAnnotations[0].comment, 'margin note');
  assert.equal(files[2].data.attachments[0].editedDocxRevision, 'revision-1');
  assert.ok(files[0].data.highlights.some(mark => mark.id === 'unmatched'));
  assert.ok(files[1].data.highlights.some(mark => mark.text === 'second highlighted text'));
  assert.equal(migrated.split.edges.length, 3);
  assert.ok(migrated.split.edges.every(edge => edge.target === 'question' && edge.data.contextOrder === 2 && edge.data.label === 'kept'));
  const contentOnly = messages => messages.map(({ role, content }) => ({ role, content }));
  assert.deepEqual(contentOnly(migrated.after), contentOnly(migrated.before), 'downstream context retains the same materials and ordering');
  assert.equal(migrated.split.nodes.find(node => node.id === 'question').data.lastContextHash, migrated.currentHash);
  assert.equal(migrated.staleHash, 'already-stale', 'an already stale answer remains stale');
  assert.equal(migrated.referencesRemainCurrent, true, 'reference edges and structural descendants remain current');
  assert.deepEqual(migrated.splitAgain, migrated.split, 'migration is idempotent');
  assert.deepEqual(migrated.restored.nodes.filter(node => node.data.stepKind === 'file').map(node => node.data.attachments[0].id), ['a', 'b', 'c']);
  assert.equal(migrated.restored.edges.length, 3);
  assert.deepEqual(migrated.viewer.nodes.filter(node => node.data.stepKind === 'file').map(node => node.data.attachments[0].id), ['a', 'b', 'c']);
  assert.equal(migrated.viewer.edges.length, 3);
  console.log('PASS legacy hydration preserves files, revisions, marks, context and outgoing connections');

  await page.evaluate(() => {
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false); ui.setReaderMode('full');
  });
  const anchor = page.locator('.react-flow__node[data-id="question"] button').filter({ hasText: /^p\.2$/ });
  await anchor.waitFor({ state: 'attached' });
  await anchor.evaluate(button => button.click());
  await page.waitForFunction(expected => window.__ui.getState().readerNodeId === expected && window.__ui.getState().readerAttachmentId === 'b', files[1].id);
  console.log('PASS anchored question opens the document that owns its attachment');

  await page.evaluate(async () => {
    const { buildContentNode } = await import('/src/lib/content.ts');
    const empty = { ...buildContentNode('file', { x: 80, y: 80 }), id: 'empty' };
    empty.data.detailLevel = 'full';
    const question = { ...buildContentNode('note', { x: 50, y: 850 }, { question: 'A question' }), id: 'question' };
    delete question.data.stepKind;
    const edges = [{ id: 'existing', source: 'empty', target: 'question', data: { isCrossLink: false, label: 'existing connection' } }];
    window.__store.setState({ nodes: [empty, question], edges, selectedNodeId: null, selectedNodeIds: [],
      history: [{ nodes: [empty, question], edges }], historyIndex: 0 });
    const ui = window.__ui.getState();
    ui.setTutorialOpen(false); ui.setReleaseNotesOpen(false); ui.setPanelOpen(false);
    ui.setReaderNodeId(null);
  });
  await page.waitForSelector('.react-flow__node[data-id="empty"] .material-upload');
  const initial = page.locator('.react-flow__node[data-id="empty"]');
  assert.match(await initial.locator('.material-upload').textContent(), /每个节点/);
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH });
  await initial.locator('input[type=file]').setInputFiles([
    { name: 'one.txt', mimeType: 'text/plain', buffer: Buffer.from('First file content') },
    { name: 'two.txt', mimeType: 'text/plain', buffer: Buffer.from('Second file content') },
    { name: 'three.txt', mimeType: 'text/plain', buffer: Buffer.from('Third file content') },
  ]);
  await page.waitForFunction(() => window.__store.getState().nodes.filter(node => node.data.stepKind === 'file' && node.data.attachments.length).length === 3);
  assert.equal(await initial.locator('.material-upload').count(), 0, 'filled node has no add-another-file button');
  let state = await page.evaluate(() => window.__store.getState().nodes.filter(node => node.data.stepKind === 'file')
    .map(node => ({ id: node.id, names: node.data.attachments.map(att => att.name), position: node.position })));
  assert.deepEqual(state.flatMap(node => node.names).sort(), ['one.txt', 'three.txt', 'two.txt']);
  assert.ok(state.every(node => node.names.length === 1));
  assert.equal(new Set(state.map(node => `${node.position.x},${node.position.y}`)).size, 3);
  assert.equal(await page.evaluate(() => window.__store.getState().edges.filter(edge => edge.target === 'question').length), 3);
  console.log('PASS multiple file selections create separately positioned file nodes');

  await initial.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Fourth file content'], 'four.txt', { type: 'text/plain' }));
    element.querySelector('.content-card').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForFunction(() => window.__store.getState().nodes.some(node => node.data.attachments?.some(att => att.name === 'four.txt')));
  state = await page.evaluate(() => window.__store.getState().nodes.filter(node => node.data.stepKind === 'file')
    .map(node => ({ id: node.id, names: node.data.attachments.map(att => att.name) })));
  assert.deepEqual(state.find(node => node.id === 'empty').names, ['one.txt']);
  assert.ok(state.some(node => node.id !== 'empty' && node.names[0] === 'four.txt'));
  const importedId = state.find(node => node.names[0] === 'four.txt').id;
  assert.equal(await page.evaluate(id => window.__store.getState().edges.some(edge => edge.source === id && edge.target === 'question' && edge.data.label === 'existing connection'), importedId), true);
  await page.evaluate(() => window.__store.getState().undo());
  assert.equal(await page.evaluate(id => window.__store.getState().nodes.some(node => node.id === id), importedId), false);
  assert.equal(await page.evaluate(id => window.__store.getState().edges.some(edge => edge.source === id), importedId), false);
  await page.evaluate(() => window.__store.getState().redo());
  assert.deepEqual(await page.evaluate(id => window.__store.getState().nodes.find(node => node.id === id)?.data.attachments.map(att => att.name), importedId), ['four.txt']);
  assert.equal(await page.evaluate(id => window.__store.getState().edges.some(edge => edge.source === id && edge.target === 'question'), importedId), true);

  const guarded = await page.evaluate(async () => {
    const { ingestFiles, buildContentNode } = await import('/src/lib/content.ts');
    const store = window.__store;
    const extra = { id: 'direct', name: 'direct.txt', type: 'text/plain', size: 1, content: 'x' };
    store.getState().addAttachment('empty', extra);
    const emptyCount = store.getState().nodes.find(node => node.id === 'empty').data.attachments.length;
    const chat = { ...buildContentNode('note', { x: 0, y: 0 }), id: 'chat' };
    delete chat.data.stepKind;
    store.setState(state => ({ nodes: [...state.nodes, chat] }));
    store.getState().addAttachment('chat', extra);
    store.getState().addAttachment('chat', { ...extra, id: 'direct2', name: 'direct2.txt', content: 'y' });
    const chatCount = store.getState().nodes.find(node => node.id === 'chat').data.attachments.length;
    const concurrent = { ...buildContentNode('file', { x: 100, y: 1700 }), id: 'concurrent' };
    store.setState(state => ({ nodes: [...state.nodes, concurrent] }));
    await Promise.all([
      ingestFiles('concurrent', [new File(['Alpha'], 'alpha.txt', { type: 'text/plain' })]),
      ingestFiles('concurrent', [new File(['Beta'], 'beta.txt', { type: 'text/plain' })]),
    ]);
    await ingestFiles('concurrent', [
      new File(['<html><body><p>First HTML body</p></body></html>'], 'first.html', { type: 'text/html' }),
      new File(['<html><body><p>Second HTML body</p></body></html>'], 'second.html', { type: 'text/html' }),
    ]);
    return { emptyCount, chatCount, fileNodes: store.getState().nodes.filter(node => node.data.stepKind === 'file')
      .map(node => node.data.attachments.map(att => att.name)),
      html: store.getState().nodes.flatMap(node => node.data.attachments ?? [])
        .filter(att => att.name.endsWith('.html')).map(att => ({ name: att.name, text: att.extractedText, isExtracting: att.isExtracting })) };
  });
  assert.equal(guarded.emptyCount, 1, 'store refuses an additional attachment on a file node');
  assert.equal(guarded.chatCount, 2, 'conversation attachments remain unrestricted');
  assert.ok(guarded.fileNodes.every(names => names.length === 1));
  assert.ok(guarded.fileNodes.some(names => names[0] === 'alpha.txt') && guarded.fileNodes.some(names => names[0] === 'beta.txt'));
  assert.deepEqual(guarded.html.map(att => att.name).sort(), ['first.html', 'second.html']);
  assert.ok(guarded.html.find(att => att.name === 'first.html').text.includes('First HTML body'));
  assert.ok(guarded.html.find(att => att.name === 'second.html').text.includes('Second HTML body'));
  assert.ok(guarded.html.every(att => att.isExtracting === false));
  console.log('PASS dropping on a filled node, concurrent imports, and store guard');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} finally {
  await context.close();
  await browser.close();
}
