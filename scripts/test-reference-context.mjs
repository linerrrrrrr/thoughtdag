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
const streamingSource = readFileSync(join(root, 'src/store/streaming.ts'), 'utf8');
const collectMapLinesSource = streamingSource.match(/export function collectMapLines[\s\S]*?\n}/)?.[0];
assert.ok(collectMapLinesSource, 'the real background-summary collector must be included');
const markdownSource = readFileSync(join(root, 'src/lib/export.ts'), 'utf8');
const markdownChainSource = markdownSource.slice(markdownSource.indexOf('function nodeToMd('), markdownSource.indexOf('// Entry ②:'));
const scopeSource = `
import { getContextPath, isConversationStart } from '../lib/graph';
import { activeSummary } from '../utils';
export { getContextPath } from '../lib/graph';
export { ladderContextFor } from '../lib/ladder-context';
export { compileContextBundle } from '../lib/context-bundle';
let exportGraph;
export const setExportGraph = graph => { exportGraph = graph; };
const useStore = { getState: () => exportGraph };
const activeProjectName = () => 'Context fixture';
const t = key => key;
${collectMapLinesSource}
${markdownChainSource}
`;
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
  buildSync({ stdin: { contents: `${source}\n${scopeSource}\nexport { partitionContext } from '../lib/graph';`,
    resolveDir: join(root, 'src/store'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: bundle,
    define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { buildContext, buildIncomingContext, referenceBlockContent, upstreamFingerprint, partitionContext,
    getContextPath, collectMapLines, ladderContextFor, contextChainMarkdown, setExportGraph, compileContextBundle } = await import(pathToFileURL(bundle).href);

  test('a reference sends only the source turn without mutating saved edges', () => {
    const graph = fixture();
    graph.edges.push(edge('source', 'target', { isCrossLink: true }));
    const before = JSON.stringify(graph);
    const result = buildContext('target', graph.nodes, graph.edges);
    const text = textOf(result);
    assert.ok(text.includes('QUESTION_source_SENTINEL') && text.includes('ANSWER_source_SENTINEL'));
    for (const excluded of ['QUESTION_ancestor_SENTINEL', 'ANSWER_ancestor_SENTINEL', 'QUESTION_material_SENTINEL',
      'ATTACHMENT_', 'IMAGE_', 'ANCESTOR_ROLE_SENTINEL', 'Trail (upstream questions)']) assert.ok(!text.includes(excluded), excluded);
    assert.deepEqual(result.images, []);
    assert.equal(JSON.stringify(graph), before);
    const reference = partitionContext('target', graph.nodes, graph.edges).references[0];
    assert.equal(reference.source.id, 'source');
  });

  test('direct reference pricing uses only the source turn', () => {
    const { nodes } = fixture();
    const content = referenceBlockContent({ source: nodes[2], edge: edge('source', 'target', { isCrossLink: true }) });
    assert.ok(content.includes('ANSWER_source_SENTINEL'));
    assert.ok(!content.includes('ancestor'));
  });

  test('continuation retains ancestor turns, materials and attachments without legacy roles', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target'));
    const result = buildContext('target', graph.nodes, graph.edges), text = textOf(result);
    for (const expected of ['QUESTION_ancestor_SENTINEL', 'ANSWER_ancestor_SENTINEL', 'QUESTION_material_SENTINEL',
      'ATTACHMENT_material_SENTINEL', 'ATTACHMENT_ancestor_SENTINEL', 'ATTACHMENT_source_SENTINEL']) {
      assert.ok(text.includes(expected), expected);
    }
    assert.ok(!text.includes('ANCESTOR_ROLE_SENTINEL'));
    assert.equal(result.images.length, 1);
  });

  test('legacy own, inherited, reset and picked roles do not change generated context or fingerprints', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target'));
    const baseline = buildContext('target', graph.nodes, graph.edges);
    const fingerprint = upstreamFingerprint('target', graph.nodes, graph.edges);
    const source = graph.nodes.find(n => n.id === 'source');
    const target = graph.nodes.find(n => n.id === 'target');
    for (const roleMode of ['inherit', 'reset', 'set-next']) {
      Object.assign(source.data, { rolePrompt: 'UPSTREAM_ROLE_SENTINEL', roleMode });
      Object.assign(target.data, { rolePrompt: 'OWN_ROLE_SENTINEL', roleMode, roleSourceNodeId: 'ancestor', appliedRole: 'SAVED_ROLE_SENTINEL' });
      assert.deepEqual(buildContext('target', graph.nodes, graph.edges), baseline);
      assert.equal(upstreamFingerprint('target', graph.nodes, graph.edges), fingerprint);
    }
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
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink: true }));
    const initial = upstreamFingerprint('target', graph.nodes, graph.edges);
    graph.nodes[1].data.question = 'Changed ancestor'; graph.nodes[1].data.response = 'Changed answer';
    graph.nodes[2].data.attachments[0].content = 'Changed attachment';
    assert.equal(upstreamFingerprint('target', graph.nodes, graph.edges), initial);
    graph.nodes[2].data.response = 'Changed source answer';
    assert.notEqual(upstreamFingerprint('target', graph.nodes, graph.edges), initial);
  });

  test('background summaries and context-chain export keep the single-node reference boundary', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink: true }));
    for (const n of graph.nodes) {
      n.data.summary = `SUMMARY_${n.id}_SENTINEL`;
      n.data.responseIndex = 0;
      n.data.summaryLadders = [{ tokens: [{ t: n.data.summary }], abstract: n.data.summary,
        sentences: [0], brief: [0], takeaway: [0], topic: [0] }];
    }
    assert.deepEqual(getContextPath('target', graph.nodes, graph.edges).map(n => n.id), ['source', 'target']);
    const mapLines = collectMapLines('target', graph.nodes, graph.edges).join('\n');
    assert.ok(mapLines.includes('SUMMARY_source_SENTINEL'));
    assert.ok(!mapLines.includes('ancestor') && !mapLines.includes('material'));
    const ladder = ladderContextFor('target', graph.nodes, graph.edges);
    assert.ok(ladder.thread.includes('QUESTION_source_SENTINEL'));
    assert.ok(!ladder.thread.includes('ancestor') && !ladder.thread.includes('material'));
    assert.equal(ladder.parentAnswer, undefined);
    setExportGraph(graph);
    const markdown = contextChainMarkdown('target');
    assert.ok(markdown.includes('QUESTION_source_SENTINEL') && markdown.includes('QUESTION_target_SENTINEL'));
    assert.ok(!markdown.includes('ancestor') && !markdown.includes('material'));
  });

  test('material roots never become the background summary opening question', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target'));
    const mapLines = collectMapLines('target', graph.nodes, graph.edges).join('\n');
    assert.ok(!mapLines.includes('Opening question of the map: QUESTION_material_SENTINEL'));
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

  test('a quoted question uses ordinary conversation context', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target'));
    graph.nodes[3].data.question = '> SELECTED_PASSAGE_SENTINEL\n\nExplain this passage';
    const text = textOf(buildContext('target', graph.nodes, graph.edges));
    assert.ok(text.includes('ANSWER_ancestor_SENTINEL') && text.includes('ATTACHMENT_source_SENTINEL') && text.includes('SELECTED_PASSAGE_SENTINEL'));
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

  await asyncTest('reading-only highlights leave mainline and reference context, fingerprints and bundles unchanged', async () => {
    for (const isCrossLink of [false, true]) {
      const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink }));
      const source = graph.nodes[2];
      source.data.response = 'Keep the **important passage** and the remaining text.';
      const options = { now: '2026-11-12T00:00:00.000Z' };
      const baseline = buildContext('target', graph.nodes, graph.edges);
      const fingerprint = upstreamFingerprint('target', graph.nodes, graph.edges);
      const bundle = await compileContextBundle('target', graph.nodes, graph.edges, options);
      for (const highlights of [
        [{ id: 'one', text: 'important passage' }],
        [{ id: 'one', text: 'important passage' }, { id: 'two', text: 'remaining text' }],
        [{ id: 'two', text: 'remaining text' }],
        [],
      ]) {
        source.data.highlights = highlights;
        assert.deepEqual(buildContext('target', graph.nodes, graph.edges), baseline);
        assert.equal(upstreamFingerprint('target', graph.nodes, graph.edges), fingerprint);
        assert.deepEqual(await compileContextBundle('target', graph.nodes, graph.edges, options), bundle);
      }
      source.data.highlights = [{ id: 'one', text: 'important passage' }];
      source.data.highlightMode = 'tag';
      assert.match(textOf(buildContext('target', graph.nodes, graph.edges)), /\[Important\]/);
      assert.notEqual((await compileContextBundle('target', graph.nodes, graph.edges, options)).id, bundle.id);
      source.data.highlightMode = 'filter';
      const filtered = textOf(buildContext('target', graph.nodes, graph.edges));
      assert.ok(filtered.includes('important passage') && !filtered.includes('remaining text'));
      source.data.highlightMode = 'off';
      assert.deepEqual(buildContext('target', graph.nodes, graph.edges), baseline);
      assert.equal(upstreamFingerprint('target', graph.nodes, graph.edges), fingerprint);
      assert.deepEqual(await compileContextBundle('target', graph.nodes, graph.edges, options), bundle);
    }
  });

  test('incoming context honors attachment exclusions and explicit inclusions without importing referenced files', () => {
    const graph = fixture();
    graph.nodes[2].data.excludedAttachmentIds = ['ancestor'];
    graph.nodes.push(node('other', { attachments: [textAttachment('other')] }));
    graph.edges.push(edge('source', 'target'), edge('other', 'target', { isCrossLink: true }));
    let result = buildIncomingContext('target', graph.nodes, graph.edges);
    assert.ok(!textOf(result).includes('ATTACHMENT_ancestor_SENTINEL'));
    result = buildIncomingContext('target', graph.nodes, graph.edges, [], ['ancestor', 'other']);
    assert.ok(textOf(result).includes('ATTACHMENT_ancestor_SENTINEL'));
    assert.ok(!textOf(result).includes('ATTACHMENT_other_SENTINEL'));
    assert.ok(!textOf(result).includes('QUESTION_target_SENTINEL'));
  });

  // Use the real store actions, replacing only networking, UI side effects
  // and placement so the exact first-generation payload can be inspected.
  const attachmentSource = readFileSync(join(root, 'src/store/slices/attachments.ts'), 'utf8').replace(
    "import { attachmentFingerprint } from '../../lib/attachments';",
    'const attachmentFingerprint = (a: { id: string; content: string }) => `${a.id}:${a.content}`;',
  )
    .replace("import { toast } from '../../lib/ui-store';", 'const toast = () => {};')
    .replace("import { t } from '../../i18n';", 'const t = (key: string) => key;');
  buildSync({ stdin: { contents: attachmentSource, resolveDir: join(root, 'src/store/slices'), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: attachmentBundle, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { createAttachmentSlice } = await import(pathToFileURL(attachmentBundle).href);
  const contextUrl = pathToFileURL(bundle).href;
  const llmSource = readFileSync(join(root, 'src/store/slices/llm.ts'), 'utf8')
    .replace("import { generateId } from '../../utils';", 'const generateId = () => "new-turn";')
    .replace("import { placeNewNodes } from '../../lib/layout';", 'const placeNewNodes = (nodes: unknown[]) => nodes;')
    .replace("import { COLORS } from '../../lib/constants';", 'const COLORS = { accent: "purple", warm: "orange" };')
    .replace("from '../context-builder';", `from '${contextUrl}';`)
    .replace(/import \{[^\n]+\} from '\.\.\/streaming';/, 'const activeAbortControllers = new Map(); const triggerParadigmCascade = () => {}; const runNodeGeneration = async (_set: unknown, _get: unknown, _id: string, opts: unknown) => { globalThis.__capturedGeneration = opts; };')
    .replace(/import \{[^\n]+\} from '\.\.\/\.\.\/lib\/ui-store';/, 'const useUiStore = { getState: () => ({ webSearchEnabled: false, scholarSearchEnabled: false }) }; const toast = () => {}; const recallSnapshot = () => ({});')
    .replace("import { shownStaleIds } from '../../lib/stale-judge';", 'const shownStaleIds = () => [];')
    .replace(/import \{[^\n]+\} from '\.\.\/\.\.\/lib\/agents\/agent-runtime';/, 'const requestAgentStop = async () => {};')
    .replace("import { t, fmt } from '../../i18n';", 'const t = (key: string) => key; const fmt = (key: string) => key;')
    .replace("import { condenseGuard } from '../../lib/condense-guard';", 'const condenseGuard = () => false;');
  buildSync({ stdin: { contents: llmSource, resolveDir: join(root, 'src/store/slices'), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: llmBundle, external: [contextUrl], define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
  const { createLlmSlice } = await import(pathToFileURL(llmBundle).href);
  const makeStore = (graph) => {
    let state = { ...graph, pushHistory() {}, logEvent() {} };
    const get = () => state;
    const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = { ...state, ...createAttachmentSlice(set, get), ...createLlmSlice(set, get) };
    return { get };
  };

  test('inherited attachment list matches material/continuation layers and excludes reference files', () => {
    const graph = fixture(); graph.edges.push(edge('source', 'target', { isCrossLink: true }));
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
    assert.ok(!text.includes('PARENT_ROLE_SENTINEL'), 'legacy parent roles never enter the generated request');
    assert.equal(text.includes('ATTACHMENT_parent_SENTINEL'), hasParent);
    assert.equal(captured.images.length, hasParent ? 2 : 1);
  });

  await asyncTest('first-generation continuation respects attachment exclusion and ignores retired role options', async () => {
    const graph = fixture();
    const store = makeStore(graph);
    await store.get().addQuestion('OWN_QUESTION_SENTINEL', { parentId: 'source', excludeAllInheritedAttachments: true,
      inheritRole: false, rolePrompt: 'RESET_ROLE_SENTINEL', initialAttachments: [textAttachment('own'), imageAttachment('own-image')] });
    const captured = globalThis.__capturedGeneration, text = textOf(captured);
    assert.ok(text.includes('ANSWER_ancestor_SENTINEL') && !text.includes('ATTACHMENT_ancestor_SENTINEL') && !text.includes('ATTACHMENT_source_SENTINEL'));
    assert.equal(captured.images.length, 1);
    assert.ok(!text.includes('RESET_ROLE_SENTINEL') && !text.includes('ANCESTOR_ROLE_SENTINEL'));
    const created = store.get().nodes.find(n => n.id === 'new-turn');
    assert.equal(created.data.rolePrompt, undefined, 'retired addQuestion options are not persisted');
    assert.equal(created.data.roleMode, undefined);
    assert.equal(captured.messages.filter((message) => message.content.includes('ATTACHMENT_own_SENTINEL')).length, 1);
  });
} finally {
  for (const path of [bundle, attachmentBundle, llmBundle]) {
    try { unlinkSync(path); } catch { /* A failed build may not create the bundle. */ }
  }
  rmdirSync(temporary);
}
if (failures) process.exitCode = 1;
