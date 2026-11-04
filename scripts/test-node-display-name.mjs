#!/usr/bin/env node
// Local names stay short and display-only; explicit edits remain ordinary undoable graph changes.
// Run: node scripts/test-node-display-name.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-node-names-'));
const bundle = join(temporary, 'node-names.mjs');
let failures = 0;
const stubs = {
  'condense-guard': 'export const condenseGuard = () => false;',
  'ui-store': 'export const toast = () => "";',
  i18n: 'export const t = (key) => key;',
};

function test(name, run) {
  try { run(); console.log(`  ok   ${name}`); }
  catch (error) { failures++; console.error(`  FAIL ${name}\n       ${error.message}`); }
}

try {
  await build({
    stdin: {
      contents: `
        export * from './lib/node-display-name';
        import { create } from 'zustand';
        import { createHistorySlice } from './store/slices/history';
        export const makeStore = () => create((set, get, api) => ({
          ...createHistorySlice(set, get, api), nodes: [], edges: [], events: [], logEvent: () => {},
        }));`,
      resolveDir: join(root, 'src'), loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.DEV': 'false' },
    plugins: [{
      name: 'ui-stubs',
      setup(build) {
        build.onResolve({ filter: /(condense-guard|ui-store|i18n)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  const { getNodeDisplayName: name, getNodeNameSource: source, makeStore } = await import(pathToFileURL(bundle).href);
  const ladder = { tokens: [{ t: 'Context' }, { t: 'flow' }], topic: [0, 1], takeaway: [], brief: [], abstract: '', sentences: [], model: 'selected-topic' };

  test('explicit names override the active topic; blank names restore automatic naming', () => {
    const data = { question: 'Original question', responseIndex: 1, summaryTopics: ['Old topic', 'Current topic'], displayName: 'My label' };
    assert.equal(name(data, 'Node'), 'My label');
    assert.equal(name({ ...data, displayName: '  ' }, 'Node'), 'Current topic');
  });
  test('the active ladder topic precedes the question without using a long summary', () => {
    assert.equal(name({ question: 'Long question', responseIndex: 0, summaryLadders: [ladder] }, 'Node'), 'Context flow');
    assert.equal(name({ question: 'Actual question', summaries: ['A very long answer summary'] }, 'Node'), 'Actual question');
  });
  test('a local ladder never replaces the question with an answer-opening fragment', () => {
    assert.equal(name({ question: '统一画布中的阅读节奏', responseIndex: 0, summaryLadders: [{ ...ladder, model: undefined, topic: ['同一画布采用'] }] }, '节点'), '统一画布中的阅读节奏');
    assert.equal(name({ question: '统一画布中的阅读节奏', responseIndex: 0, summaryLadders: [{ ...ladder, model: 'local', topic: ['同一画布采用'] }] }, '节点'), '统一画布中的阅读节奏');
  });
  test('Chinese excerpts stay within 14 characters while tooltips retain the source', () => {
    const question = '请帮我分析年度预算控制制度对部门协作流程的影响';
    const data = { question };
    assert.ok([...name(data, '节点')].length <= 14);
    assert.ok(name(data, '节点').startsWith('分析年度预算'));
    assert.ok(name(data, '节点').endsWith('…'));
    assert.equal(source(data, '节点'), question);
  });
  test('English excerpts remove polite lead-ins and preserve whole words', () => {
    const result = name({ question: 'Could you explain how shared canvas history prevents inconsistent node labels during zooming?' }, 'Node');
    assert.equal(result, 'explain how shared canvas history prevents…');
    assert.ok(result.length <= 48);
  });
  test('material names use headings, filenames, and link titles', () => {
    assert.equal(name({ stepKind: 'note', question: '# 请假管理\n正文不进入名称' }, '便签'), '请假管理');
    assert.equal(name({ stepKind: 'file', attachments: [{ name: 'D:\\reports\\预算.xlsx' }] }, '文件'), '预算.xlsx');
    const longFile = name({ stepKind: 'file', attachments: [{ name: '年度财务分析报告预算执行情况修订版.xlsx' }] }, '文件');
    assert.ok([...longFile].length <= 14);
    assert.ok(longFile.endsWith('….xlsx'));
    assert.equal(name({ stepKind: 'link', linkTitle: 'Reference guide', question: 'Full page content' }, 'Link'), 'Reference guide');
  });
  test('markdown cleanup and empty fallbacks never invent a semantic title', () => {
    assert.equal(name({ question: '# **Context** [flow](https://example.com)\nThe answer is not a title.' }, 'Node'), 'Context flow');
    assert.equal(name({ question: '\n***\n\n' }, 'Untitled node'), 'Untitled node');
    assert.equal(name({ question: '请假流程', summaryTopics: ['请假管理'], responseIndex: 0 }, '节点'), '请假管理');
  });
  test('reading automatic names never mutates content or creates persistent fields', () => {
    const data = { question: 'Original question', response: 'Original answer', responses: ['Original answer'], responseIndex: 0 };
    const before = JSON.stringify(data);
    name(data, 'Node'); source(data, 'Node');
    assert.equal(JSON.stringify(data), before);
    assert.equal(data.displayName, undefined);
  });
  test('rename and reset each undo/redo independently without changing question or response', () => {
    const store = makeStore();
    const nodes = [{ id: 'a', type: 'thought', position: { x: 0, y: 0 }, data: { question: 'Original question', response: 'Original answer', responses: ['Original answer'], responseIndex: 0, isLoading: false } }];
    store.setState({ nodes, edges: [], history: [{ nodes, edges: [] }], historyIndex: 0 });
    const rename = (displayName) => {
      store.getState().pushHistory();
      store.setState((state) => ({ nodes: state.nodes.map((node) => ({ ...node, data: { ...node.data, displayName } })) }));
      store.getState().pushHistory();
    };
    const data = () => store.getState().nodes[0].data;
    rename('Custom title');
    store.getState().undo(); assert.equal(data().displayName, undefined);
    store.getState().redo(); assert.equal(data().displayName, 'Custom title');
    rename(undefined);
    store.getState().undo(); assert.equal(data().displayName, 'Custom title');
    store.getState().redo(); assert.equal(data().displayName, undefined);
    assert.equal(data().question, 'Original question');
    assert.equal(data().response, 'Original answer');
    assert.deepEqual(data().responses, ['Original answer']);
  });
} finally {
  if (existsSync(bundle)) unlinkSync(bundle);
  rmdirSync(temporary);
}

if (failures) process.exitCode = 1;
else console.log('Node display name checks passed.');
