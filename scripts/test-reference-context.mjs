// Exercise the real context compiler; only browser attachment I/O is stubbed.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-reference-context-'));
const bundle = join(temporary, 'context.mjs');
const attachmentBundle = join(temporary, 'attachments.mjs');
const llmBundle = join(temporary, 'llm.mjs');
const source = readFileSync(join(root, 'src/store/context-builder.ts'), 'utf8').replace(
  "import { attachmentFingerprint } from '../lib/attachments';",
  'const attachmentFingerprint = (a: { id: string; content: string }) => `${a.id}:${a.content}`;',
);
let failures = 0;
const test = (name, run) => {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
const asyncTest = async (name, run) => {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
const node = (id, data = {}) => ({ id, type: 'thought', position: { x: 0, y: 0 },
  data: { question: `QUESTION_${id}_SENTINEL`, response: `ANSWER_${id}_SENTINEL`, attachments: [],
    highlights: [], highlightMode: 'off', isCollapsed: false, ...data } });
const textAttachment = (id) => ({ id, name: `${id}.txt`, type: 'text/plain', content: `ATTACHMENT_${id}_SENTINEL` });
const imageAttachment = (id) => ({ id, name: `${id}.png`, type: 'image/png', content: `IMAGE_${id}_SENTINEL` });
const edge = (source, target, data = {}) => ({ id: `${source}-${target}`, source, target, data });
const fixture = () => ({
  nodes: [node('material', { stepKind: 'note', attachments: [textAttachment('material')] }),
    node('ancestor', { rolePrompt: 'ANCESTOR_ROLE_SENTINEL', attachments: [textAttachment('ancestor')] }),
    node('source', { attachments: [textAttachment('source'), imageAttachment('source-image')] }),
    node('target', { response: '' })],
  edges: [edge('material', 'ancestor'), edge('ancestor', 'source')],
});
const textOf = (result) => result.messages.map((message) => message.content).join('\n');

try {
  buildSync({ stdin: { contents: `${source}\nexport { partitionContext } from '../lib/graph';`,
    resolveDir: join(root, 'src/store'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: bundle,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { buildContext, buildIncomingContext, referenceBlockContent, upstreamFingerprint, partitionContext } = await import(pathToFileURL(bundle).href);

  for (const depth of [undefined, 'full']) test(`ordinary ${depth ?? 'default'} reference sends only the source turn without mutating saved edges`, () => {
    const graph = fixture();
    graph.edges.push(edge('source', 'target', { isCrossLink: true, ...(depth ? { contextDepth: depth } : {}) }));
    const before = JSON.stringify(graph);
    const result = buildContext('target', graph.nodes, graph.edges);
    const text = textOf(result);
    assert.ok(text.includes('QUESTION_source_SENTINEL') && text.includes('ANSWER_source_SENTINEL'));
    for (const excluded of ['QUESTION_ancestor_SENTINEL', 'ANSWER_ancestor_SENTINEL', 'QUESTION_material_SENTINEL',
      'ATTACHMENT_', 'IMAGE_', 'ANCESTOR_ROLE_SENTINEL', 'Trail (upstream questions)']) assert.ok(!text.includes(excluded), excluded);
    assert.deepEqual(result.images, []);
    assert.equal(JSON.stringify(graph), before);
    const reference = partitionContext('target', graph.nodes, graph.edges).references[0];
    assert.equal(reference.depth, 'quote'); assert.deepEqual(reference.chain, []);
  });

  test('direct reference pricing ignores supplied ancestor chains and legacy full metadata', () => {
    const { nodes } = fixture();
    const content = referenceBlockContent({ source: nodes[2], edge: edge('source', 'target', { isCrossLink: true, contextDepth: 'full' }),
      depth: 'full', chain: [nodes[1]] });
    assert.ok(content.includes('ANSWER_source_SENTINEL'));
    assert.ok(!content.includes('ancestor'));
  });

  test('continuation retains ancestor turns, inherited role, materials and attachments', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target'));
    const result = buildContext('target', graph.nodes, graph.edges), text = textOf(result);
    for (const expected of ['QUESTION_ancestor_SENTINEL', 'ANSWER_ancestor_SENTINEL', 'QUESTION_material_SENTINEL',
      'ATTACHMENT_material_SENTINEL', 'ATTACHMENT_ancestor_SENTINEL', 'ATTACHMENT_source_SENTINEL', 'ANCESTOR_ROLE_SENTINEL']) {
      assert.ok(text.includes(expected), expected);
    }
    assert.equal(result.images.length, 1);
  });

  test('a single-node reference continues downstream without reopening its source ancestry', () => {
    const graph = fixture(); graph.nodes.push(node('child', { response: '' }));
    graph.edges.push(edge('source', 'target', { isCrossLink: true }), edge('target', 'child'));
    const text = textOf(buildContext('child', graph.nodes, graph.edges));
    assert.ok(text.includes('ANSWER_source_SENTINEL'));
    assert.ok(!text.includes('QUESTION_ancestor_SENTINEL') && !text.includes('ANSWER_ancestor_SENTINEL') && !text.includes('ATTACHMENT_'));
  });

  test('ordinary reference never forwards another reference attached to its source', () => {
    const graph = fixture(); graph.nodes.push(node('external'));
    graph.edges.push(edge('external', 'source', { isCrossLink: true }), edge('source', 'target', { isCrossLink: true }));
    assert.ok(!textOf(buildContext('target', graph.nodes, graph.edges)).includes('external_SENTINEL'));
  });

  test('source changes affect reference fingerprints but excluded ancestors and attachments do not', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink: true, contextDepth: 'full' }));
    const initial = upstreamFingerprint('target', graph.nodes, graph.edges);
    graph.nodes[1].data.question = 'Changed ancestor'; graph.nodes[1].data.response = 'Changed answer';
    graph.nodes[2].data.attachments[0].content = 'Changed attachment';
    assert.equal(upstreamFingerprint('target', graph.nodes, graph.edges), initial);
    graph.nodes[2].data.response = 'Changed source answer';
    assert.notEqual(upstreamFingerprint('target', graph.nodes, graph.edges), initial);
  });

  test('a separately continued ancestor still reaches the target and is not hidden by a reference', () => {
    const graph = fixture();
    graph.edges.push(edge('ancestor', 'target'), edge('source', 'target', { isCrossLink: true }));
    const text = textOf(buildContext('target', graph.nodes, graph.edges));
    assert.ok(text.includes('ANSWER_ancestor_SENTINEL') && text.includes('ANSWER_source_SENTINEL'));
    assert.ok(text.includes('ATTACHMENT_ancestor_SENTINEL') && !text.includes('ATTACHMENT_source_SENTINEL'));
  });

  test('direct material references keep the existing material intake behavior', () => {
    const graph = fixture(); graph.edges.push(edge('material', 'target', { isCrossLink: true }));
    const text = textOf(buildContext('target', graph.nodes, graph.edges));
    assert.ok(text.includes('[Note]') && text.includes('QUESTION_material_SENTINEL') && text.includes('ATTACHMENT_material_SENTINEL'));
  });

  for (const depth of [undefined, 'full']) test(`watch ${depth ?? 'default'} references preserve their established input scope`, () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink: true, isWatch: true, followsTip: true,
      ...(depth ? { contextDepth: depth } : {}) }));
    const text = textOf(buildContext('target', graph.nodes, graph.edges));
    assert.ok(text.includes('QUESTION_ancestor_SENTINEL') && text.includes('ANSWER_source_SENTINEL'));
    assert.equal(text.includes('ANSWER_ancestor_SENTINEL'), depth === 'full');
    assert.ok(!text.includes('ATTACHMENT_'));
  });

  test('structural exploration keeps its parent context and selected passage', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isBranchFromSelection: true }));
    const text = textOf(buildContext('target', graph.nodes, graph.edges, 'SELECTED_PASSAGE_SENTINEL'));
    assert.ok(text.includes('ANSWER_ancestor_SENTINEL') && text.includes('ATTACHMENT_source_SENTINEL') && text.includes('SELECTED_PASSAGE_SENTINEL'));
  });

  test('legacy crosslinked exploration preserves its specialized full context', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink: true, isBranchFromSelection: true, contextDepth: 'full' }));
    const text = textOf(buildContext('target', graph.nodes, graph.edges));
    assert.ok(text.includes('ANSWER_ancestor_SENTINEL') && text.includes('ANSWER_source_SENTINEL'));
  });

  test('archived source stays excluded and response highlighting remains effective', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink: true }));
    graph.nodes[2].data.highlightMode = 'filter'; graph.nodes[2].data.highlights = [{ id: 'h', text: 'EXCERPT_SENTINEL' }];
    let text = textOf(buildContext('target', graph.nodes, graph.edges));
    assert.ok(text.includes('EXCERPT_SENTINEL') && !text.includes('ANSWER_source_SENTINEL'));
    graph.nodes[2].data.archived = true;
    text = textOf(buildContext('target', graph.nodes, graph.edges));
    assert.ok(!text.includes('EXCERPT_SENTINEL') && !text.includes('QUESTION_source_SENTINEL'));
  });

  test('incoming context honors attachment exclusions and explicit inclusions without importing referenced files', () => {
    const graph = fixture();
    graph.nodes[2].data.excludedAttachmentIds = ['ancestor'];
    graph.nodes.push(node('other', { attachments: [textAttachment('other')] }));
    graph.edges.push(edge('source', 'target'), edge('other', 'target', { isCrossLink: true }));
    let result = buildIncomingContext('target', graph.nodes, graph.edges);
    assert.ok(!textOf(result).includes('ATTACHMENT_ancestor_SENTINEL'));
    result = buildIncomingContext('target', graph.nodes, graph.edges, undefined, [], ['ancestor', 'other']);
    assert.ok(textOf(result).includes('ATTACHMENT_ancestor_SENTINEL'));
    assert.ok(!textOf(result).includes('ATTACHMENT_other_SENTINEL'));
    assert.ok(!textOf(result).includes('QUESTION_target_SENTINEL'));
  });

  // Use the real store actions, replacing only networking, UI side effects
  // and placement so the exact first-generation payload can be inspected.
  const attachmentSource = readFileSync(join(root, 'src/store/slices/attachments.ts'), 'utf8').replace(
    "import { attachmentFingerprint } from '../../lib/attachments';",
    'const attachmentFingerprint = (a: { id: string; content: string }) => `${a.id}:${a.content}`;',
  );
  buildSync({ stdin: { contents: attachmentSource, resolveDir: join(root, 'src/store/slices'), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: attachmentBundle, logLevel: 'silent' });
  const { createAttachmentSlice } = await import(pathToFileURL(attachmentBundle).href);
  const contextUrl = pathToFileURL(bundle).href;
  const llmSource = readFileSync(join(root, 'src/store/slices/llm.ts'), 'utf8')
    .replace("import { generateId } from '../../utils';", 'const generateId = () => "new-turn";')
    .replace("import { placeNewNodes } from '../../lib/layout';", 'const placeNewNodes = (nodes: unknown[]) => nodes;')
    .replace("import { COLORS } from '../../lib/constants';", 'const COLORS = { accent: "purple", warm: "orange" };')
    .replace("from '../context-builder';", `from '${contextUrl}';`)
    .replace(/import \{[^\n]+\} from '\.\.\/streaming';/, 'const activeAbortControllers = new Map(); const autoRunCounts = new Map(); const triggerParadigmCascade = () => {}; const runNodeGeneration = async (_set: unknown, _get: unknown, _id: string, opts: unknown) => { globalThis.__capturedGeneration = opts; };')
    .replace(/import \{[^\n]+\} from '\.\.\/\.\.\/lib\/ui-store';/, 'const useUiStore = { getState: () => ({ webSearchEnabled: false, scholarSearchEnabled: false }) }; const toast = () => {}; const recallSnapshot = () => ({});')
    .replace("import { shownStaleIds } from '../../lib/stale-judge';", 'const shownStaleIds = () => [];')
    .replace("import { t, fmt } from '../../i18n';", 'const t = (key: string) => key; const fmt = (key: string) => key;')
    .replace("import { condenseGuard } from '../../lib/condense-guard';", 'const condenseGuard = () => false;');
  buildSync({ stdin: { contents: llmSource, resolveDir: join(root, 'src/store/slices'), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: llmBundle, external: [contextUrl], logLevel: 'silent' });
  const { createLlmSlice } = await import(pathToFileURL(llmBundle).href);
  const makeStore = (graph) => {
    let state = { ...graph, pushHistory() {}, logEvent() {} };
    const get = () => state;
    const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = { ...state, ...createAttachmentSlice(set, get), ...createLlmSlice(set, get) };
    return { get };
  };

  test('inherited attachment list matches material/continuation layers and excludes reference files', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink: true, contextDepth: 'full' }));
    const state = makeStore(graph).get();
    assert.deepEqual(state.getInheritedAttachments('target'), []);
    graph.edges.push(edge('material', 'target', { isCrossLink: true }));
    assert.deepEqual(state.getInheritedAttachments('target').map((item) => item.attachment.id), ['material']);
  });

  for (const hasParent of [false, true]) await asyncTest(`first-generation @mention with ${hasParent ? 'a continuation parent' : 'no parent'} includes the referenced turn and each own item once`, async () => {
    const graph = fixture();
    if (hasParent) graph.nodes.push(node('parent', { rolePrompt: 'PARENT_ROLE_SENTINEL', attachments: [textAttachment('parent'), imageAttachment('parent-image')] }));
    const store = makeStore(graph);
    await store.get().addQuestion('OWN_QUESTION_SENTINEL', { parentId: hasParent ? 'parent' : undefined, mentions: ['source'],
      initialAttachments: [textAttachment('own'), imageAttachment('own-image')] });
    const captured = globalThis.__capturedGeneration;
    const text = textOf(captured);
    assert.ok(text.includes('QUESTION_source_SENTINEL') && text.includes('ANSWER_source_SENTINEL'));
    assert.ok(!text.includes('QUESTION_ancestor_SENTINEL') && !text.includes('ANSWER_ancestor_SENTINEL') && !text.includes('ATTACHMENT_source_SENTINEL'));
    assert.equal(captured.messages.filter((message) => message.content === 'OWN_QUESTION_SENTINEL').length, 1);
    assert.equal(captured.messages.filter((message) => message.content.includes('ATTACHMENT_own_SENTINEL')).length, 1);
    assert.equal(captured.images.filter((image) => image.data === 'IMAGE_own-image_SENTINEL').length, 1);
    assert.ok(!captured.images.some((image) => image.data === 'IMAGE_source-image_SENTINEL'));
    assert.equal(captured.messages.some((message) => message.role === 'system' && message.content === 'PARENT_ROLE_SENTINEL'), hasParent);
    assert.equal(text.includes('ATTACHMENT_parent_SENTINEL'), hasParent);
    assert.equal(captured.images.length, hasParent ? 2 : 1);
  });

  await asyncTest('first-generation continuation respects attachment exclusion and explicit role reset', async () => {
    const graph = fixture();
    const store = makeStore(graph);
    await store.get().addQuestion('OWN_QUESTION_SENTINEL', { parentId: 'source', excludeAllInheritedAttachments: true,
      inheritRole: false, rolePrompt: 'RESET_ROLE_SENTINEL', initialAttachments: [textAttachment('own'), imageAttachment('own-image')] });
    const captured = globalThis.__capturedGeneration, text = textOf(captured);
    assert.ok(text.includes('ANSWER_ancestor_SENTINEL') && !text.includes('ATTACHMENT_ancestor_SENTINEL') && !text.includes('ATTACHMENT_source_SENTINEL'));
    assert.equal(captured.images.length, 1);
    assert.equal(captured.messages.filter((message) => message.role === 'system').length, 1);
    assert.equal(captured.messages.find((message) => message.role === 'system').content, 'RESET_ROLE_SENTINEL');
    assert.equal(captured.messages.filter((message) => message.content.includes('ATTACHMENT_own_SENTINEL')).length, 1);
  });
} finally {
  for (const path of [bundle, attachmentBundle, llmBundle]) {
    try { unlinkSync(path); } catch { /* A failed build may not create the bundle. */ }
  }
  rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
