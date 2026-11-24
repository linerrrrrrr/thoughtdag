// Source links and backups remain usable without a session map.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'td-source-backup-'));
try {
  const fixture = {
    'ui-store': `export const toast=(...args)=>globalThis.toasts.push(args);
      export const useUiStore={getState:()=>({
        setArrivalFocusNodeId:id=>globalThis.focus=id,
        setLastAutoBackupAt:()=>{},setAutoBackupDir:()=>{}
      })};`,
    i18n: `export const t=(key)=>key;`,
    'canvas-workspace': `export const ensureCanvasWorkspace=async id=>globalThis.folderAvailable ? 'D:/workspaces/'+id+'/external' : null;`,
    projects: `export const useProjects={getState:()=>globalThis.projects};
      export const bootProjects=async()=>{};
      export const switchProject=async(id)=>{globalThis.projects.activeId=id};`,
    store: `export const useStore={getState:()=>globalThis.graph,subscribe:()=>{}};
      export const stripTransient=(nodes)=>nodes;`,
    'disk-storage': `export const appSettings={setItem:()=>{},removeItem:()=>{},getItem:()=>null};
      export const get=async()=>null,set=async()=>{},del=async()=>{};`,
    export: `export const EXPORT_FORMAT_VERSION=1;
      export const activeProjectName=()=>globalThis.projects.projects.find(p=>p.id===globalThis.projects.activeId)?.name ?? 'canvas';`,
    viewer: `export const isViewerMode=false;`,
    'attachment-vault': `export const inlineVaultedContent=async(nodes)=>nodes;`,
    'normalize-graph': `export const normalizeConversationGraph=(graph)=>graph;`,
  };
  const plugin = { name: 'state-fixtures', setup(b) {
    b.onResolve({ filter: /^\./ }, (args) => {
      if (!/(source-navigation|local-backup)\.ts$/.test(args.importer)) return;
      const key = args.path.split('/').pop();
      if (key in fixture) return { path: key, namespace: 'fixture' };
    });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: fixture[path], loader: 'js' }));
  } };
  const navigationFile = join(temp, 'navigation.mjs');
  const backupFile = join(temp, 'backup.mjs');
  const threadFile = join(temp, 'thread.mjs');
  for (const [entry, outfile] of [['source-navigation', navigationFile], ['local-backup', backupFile], ['codex-thread-link', threadFile]]) {
    await build({ entryPoints: [join(root, `src/lib/${entry}.ts`)], outfile,
      bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [plugin] });
  }

  const id1 = '11111111-0000-4000-8000-000000000001';
  const id2 = '11111111-0000-4000-8000-000000000002';
  globalThis.projects = { activeId: id1, projects: [{ id: id1, name: 'Same' }, { id: id2, name: 'Same' }] };
  globalThis.graph = { nodes: [{ id: 'node-1', data: { question: 'kept' } }], edges: [], events: [] };
  globalThis.toasts = [];
  globalThis.folderAvailable = true;
  const opens = [];
  const writes = [];
  globalThis.window = {
    desktopSessions: { openInCli: async (...args) => {
      opens.push(args);
      return { opened: args[3] === 'terminal' };
    } },
    desktopAgents: { pickCwd: async () => 'D:/backups', backupJson: async (...args) => { writes.push(args); return { file: args[1] }; } },
  };

  const { openWhyLink, openOriginalCodexThread } = await import(pathToFileURL(navigationFile).href);
  const { displayedCodexThreadId } = await import(pathToFileURL(threadFile).href);
  const node = { responses: ['old', 'new'], responseIndex: 0, question: 'q',
    agentSession: { runtime: 'codex', sessionId: id2 },
    source: { question: 'q', response: 'old' }, importSource: { runner: 'codex', sessionId: id1 } };
  assert.equal(displayedCodexThreadId(node), id1);
  assert.equal(displayedCodexThreadId({ ...node, responseIndex: 1 }), null);
  assert.equal(displayedCodexThreadId({ ...node, codexHistories: [{ threadId: id2 }] }), id2);
  assert.equal(displayedCodexThreadId({ ...node, codexThreadIds: [null, id2] }), null);
  assert.equal(displayedCodexThreadId({ ...node, generatedBy: ['some-api'] }), null);
  assert.equal(displayedCodexThreadId({ ...node, isLoading: true }), null);
  assert.equal(displayedCodexThreadId({ ...node, isLoading: true, liveCodexThreadId: id2 }), id2);
  const desktopCalls = [], protocolCalls = [];
  window.desktopSessions.openCodexThread = async id => { desktopCalls.push(id); return true; };
  window.location = { assign: url => protocolCalls.push(url) };
  await openOriginalCodexThread(id1);
  await openOriginalCodexThread(id1 + '\n');
  await openOriginalCodexThread('codex://settings');
  assert.deepEqual(desktopCalls, [id1]);
  delete window.desktopSessions.openCodexThread;
  await openOriginalCodexThread(id2);
  await openOriginalCodexThread('../new?prompt=x');
  assert.deepEqual(protocolCalls, [`codex://threads/${id2}`]);
  assert.equal(await openWhyLink(`thoughtdag://open?canvas=${id2}&node=node-1`), true);
  assert.equal(projects.activeId, id2);
  assert.equal(globalThis.focus, 'node-1');
  assert.equal(await openWhyLink('thoughtdag://open?session=session-1&runner=codex&cwd=D%3A%2Fwork'), true);
  assert.deepEqual(opens, [['codex', `D:/workspaces/${id2}/external`, 'session-1', 'terminal']]);
  globalThis.folderAvailable = false;
  assert.equal(await openWhyLink('thoughtdag://open?session=session-1&runner=codex&cwd=D%3A%2Fwork'), false);
  assert.equal(opens.length, 1);
  assert.equal(await openWhyLink('thoughtdag://open?session=session-2&runner=pi&cwd=D%3A%2Fwork'), true);
  assert.deepEqual(opens[1], ['pi', 'D:/work', 'session-2', 'terminal']);
  assert.equal(await openWhyLink('thoughtdag://open?canvas=missing'), false);
  const terminal = createRequire(import.meta.url)('../runtime/terminal.cjs');
  assert.equal(terminal.PROGRAMS.codex('session-1'), 'codex resume --cd . session-1');
  assert.equal((await terminal.openInTerminal('codex', null, 'session-1')).opened, false);
  assert.throws(() => terminal.PROGRAMS.codex('bad;id'));
  assert.equal((await terminal.openInTerminal('codex', null, 'bad;id')).opened, false);

  const { enableAutoBackup, backupActiveProject } = await import(pathToFileURL(backupFile).href);
  assert.equal(await enableAutoBackup(), true);
  projects.activeId = id1;
  await backupActiveProject();
  assert.deepEqual(writes.map((w) => w[1]), [`Same-${id2}.thoughtdag.json`, `Same-${id1}.thoughtdag.json`]);
  assert.equal(JSON.parse(writes[1][2]).nodes[0].data.question, 'kept');
  console.log('PASS: source links and collision-safe canvas backups remain available without the session map.');
} finally {
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('td-source-backup-')) throw new Error('Unexpected test cleanup path');
  rmSync(temp, { recursive: true, force: true });
}
