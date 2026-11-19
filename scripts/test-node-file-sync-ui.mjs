// A real browser, ordinary files and the native run entry point. Only the
// agent process is substituted, so no credentials or model call are needed.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { documentBrowser } from './fixtures/original-file-browser.mjs';
import { createSuperdocFixture } from './fixtures/superdoc-fixture.mjs';
import managed from '../runtime/managed-documents.cjs';
import { createServer } from 'vite';

const root = await mkdtemp(path.join(tmpdir(), 'td-node-files-'));
const api = managed.createManagedDocuments(root);
const server = process.env.APP_URL ? null : await createServer({
  server: { host: '127.0.0.1', port: 0 }, cacheDir: path.join(root, 'vite-cache'), logLevel: 'error',
});
await server?.listen();
const url = process.env.APP_URL ?? server.resolvedUrls.local[0];
const executablePath = process.env.CHROME_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const { context, close } = await documentBrowser(url, { executablePath, viewport: { width: 1440, height: 960 } });
try {
  const source = (await createSuperdocFixture('FIRST')).buffer;
  const edited = (await createSuperdocFixture('SECOND')).buffer;
  const final = (await createSuperdocFixture('FINAL')).buffer;
  const original = path.join(root, 'report.docx');
  await writeFile(original, source);
  await context.route('**/__thoughtdag_storage', route => route.fulfill({ status: 404, body: '' }));
  await context.exposeFunction('managedTestFile', api);
  await context.addInitScript(() => {
    localStorage.setItem('thoughtdag.seeded', 'yes');
    localStorage.setItem('thoughtdag.tutorialDone', '1');
    window.desktopAgents = {
      managedDocument: request => window.managedTestFile(request),
      models: async () => ({ installed: false, models: [] }),
      onEvent: fn => { window.agentEvent = fn; },
      run: async request => { window.agentRequest = request; return 'test-turn'; },
    };
  });
  const page = await context.newPage();
  page.on('pageerror', e => console.error(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf);
  const fixture = await page.evaluate(async base64 => {
    const { buildContentNode } = await import('/src/lib/content.ts');
    const { readFileToAttachment } = await import('/src/lib/attachments.ts');
    const { useProjects } = await import('/src/store/projects.ts');
    const { useUiStore } = await import('/src/lib/ui-store.ts');
    const { openNodeFile } = await import('/src/lib/node-files.ts');
    useUiStore.getState().setTutorialOpen(false);
    useUiStore.getState().setReleaseNotesOpen(false);
    const canvasId = useProjects.getState().activeId;
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const left = buildContentNode('file', { x: 10, y: 20 });
    const right = buildContentNode('file', { x: 450, y: 20 });
    for (const n of [left, right]) n.data.attachments = [await readFileToAttachment(new File([bytes], 'report.docx'))];
    const asker = buildContentNode('note', { x: 10, y: 520 });
    const graph = window.__store;
    graph.getState().setNodes([left, right, asker]);
    const live = graph.getState().nodes;
    const label = '#' + live[0].data.nodeNumber;
    const question = 'Edit ' + label;
    graph.setState({ nodes: live.map(n => n.id === asker.id ? { ...n, data: { ...n.data, question } } : n) });
    const one = await openNodeFile(canvasId, left.id, left.data.attachments[0]);
    const two = await openNodeFile(canvasId, right.id, right.data.attachments[0]);
    await window.__rf.setViewport({ x: 100, y: 80, zoom: 1 });
    const { agentCallStream } = await import('/src/lib/agents/agent-runtime.ts');
    window.finished = agentCallStream([{ role: 'user', content: question }], () => {}, undefined, [], {}, 'codex/test', { cwd: 'test-external-project' }, asker.id);
    return { path: one.path, other: two.path, node: left.id, label, att: left.data.attachments[0].id };
  }, source.toString('base64'));
  assert.notEqual(fixture.path, fixture.other);
  await page.waitForFunction(() => window.agentRequest);
  const request = await page.evaluate(() => window.agentRequest);
  assert.equal(request.cwd, 'test-external-project');
  assert.equal(request.nativePermissions, true);
  const note = request.codexHistory.items.at(-1).content[0].text;
  assert.ok(note.includes(JSON.stringify(fixture.path)) && !note.includes(JSON.stringify(fixture.other)));
  for (const replacement of ['逐步', '逐步修改完成']) {
    await page.evaluate(({ label, replacement }) => window.agentEvent({ runId: 'test-turn', event: { type: 'activity', item: {
      id: 'preview', kind: 'commentary', status: 'running', startedAt: 1, text: 'TD-PREVIEW ' + label + ' "FIRST original document"\n' + replacement,
    } } }), { label: fixture.label, replacement });
    await page.waitForFunction(text => document.querySelector('[data-file-edit-replacement]')?.textContent === text, replacement);
    assert.deepEqual(await readFile(fixture.path), source);
  }
  await writeFile(fixture.path + '.tmp', edited);
  await rename(fixture.path + '.tmp', fixture.path);
  await page.waitForFunction(id => window.__store.getState().nodes.find(n => n.id === id)?.data.attachments[0].editedText?.includes('SECOND original document'), fixture.node);
  await writeFile(fixture.path + '.tmp', final);
  await rename(fixture.path + '.tmp', fixture.path);
  await page.evaluate(async () => {
    window.agentEvent({ runId: 'test-turn', event: { type: 'run_end', how: 'end', text: 'done' } });
    await window.finished;
  });
  assert.equal(await page.locator('[data-file-edit-replacement]').count(), 0);
  assert.ok(await page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data.attachments[0].editedText.includes('FINAL original document'), fixture.node));
  assert.deepEqual(await readFile(original), source);
  assert.deepEqual(await readFile(fixture.other), source);
  await page.evaluate(() => window.__store.getState().undo());
  await page.waitForFunction(id => !window.__store.getState().nodes.find(n => n.id === id)?.data.attachments[0].editedText, fixture.node);
  await page.waitForFunction(async ({ id, target }) => {
    const { openNodeFile } = await import('/src/lib/node-files.ts');
    const { useProjects } = await import('/src/store/projects.ts');
    const a = window.__store.getState().nodes.find(n => n.id === id).data.attachments[0];
    return (await openNodeFile(useProjects.getState().activeId, id, a)).revision === target;
  }, { id: fixture.node, target: (await import('node:crypto')).createHash('sha256').update(source).digest('hex') });
  assert.deepEqual(await readFile(fixture.path), source);
  const card = page.locator(`.react-flow__node[data-id="${fixture.node}"]`);
  await card.locator('[data-superdoc-ready="true"]').waitFor();
  const editor = card.locator('[data-superdoc-scroll]');
  await editor.click({ position: { x: 140, y: 140 } });
  await editor.evaluate(el => el.__docxSession.instance.focus({ preventScroll: true }));
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' LOCAL SAVE');
  await card.locator('[data-superdoc-dirty="true"]').waitFor();
  await page.locator('[data-superdoc-toolbar] [data-docx-save]').click();
  await page.waitForFunction(id => window.__store.getState().nodes.find(n => n.id === id)?.data.attachments[0].editedText?.includes('LOCAL SAVE'), fixture.node);
  const zip = await (await import('jszip')).default.loadAsync(await readFile(fixture.path));
  assert.match(await zip.file('word/document.xml').async('string'), /LOCAL SAVE/);
  assert.deepEqual(await readFile(original), source);
  const plain = await page.evaluate(async () => {
    const { buildContentNode } = await import('/src/lib/content.ts');
    const { openNodeFile } = await import('/src/lib/node-files.ts');
    const { useProjects } = await import('/src/store/projects.ts');
    const node = buildContentNode('file', { x: 10, y: 600 });
    const att = { id: 'plain', type: 'text/markdown', name: 'notes.md', content: 'initial', size: 7 };
    node.data.attachments = [att];
    const state = window.__store.getState();
    state.setNodes([...state.nodes, node]);
    const file = await openNodeFile(useProjects.getState().activeId, node.id, att);
    return { nodeId: node.id, path: file.path };
  });
  for (const value of ['初稿已修改', '']) {
    await writeFile(plain.path, value);
    await page.waitForFunction(({ id, value }) => window.__store.getState().nodes.find(n => n.id === id).data.attachments[0].content === value, { id: plain.nodeId, value });
  }
  console.log('PASS: numbered same-name DOCX selection, native cwd, streamed paragraphs, two saves with one undo, native editor save into the internal file, untouched import source and unadapted Markdown saves including empty content.');
} finally {
  await close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
