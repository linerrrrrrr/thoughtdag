// Inline field boundaries: no production data and no LLM calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1680, height: 1100 } });
const page = await context.newPage();
const errors = [];
const writes = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
await context.route('**/api/**', route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  writes.push(route.request().url());
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.autoRefreshPaused', 'yes');
});
const fixture = (id, type, question, extra = {}) => ({
  id, type: 'thought', position: { x: 0, y: 0 }, selected: true,
  data: { question, response: '', responses: [], responseIndex: 0, summaries: [], isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false, tokenCount: 0, highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [], roleMode: 'inherit', isRoot: true, isBranch: false, ...(type === 'frame' ? { stepKind: 'frame' } : {}), ...extra },
});
const install = async (nodes, edges = []) => {
  await page.evaluate(({ nodes, edges }) => {
    window.__store.getState().setNodes(nodes);
    window.__store.getState().setEdges(edges);
    window.__store.getState().setSelectedNodeId(nodes[0].id);
    window.__ui.getState().setPanelOpen(false);
    window.__rf.setViewport({ x: 120, y: 120, zoom: 1 }, { duration: 0 });
  }, { nodes, edges });
};
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const current = id => page.evaluate(id => window.__store.getState().nodes.find(n => n.id === id).data, id);
const outside = () => page.mouse.click(1450, 900);
const check = name => console.log(`PASS ${name}`);

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5189', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__store?.persist.hasHydrated() && window.__rf && window.__ui);
  await page.evaluate(() => { window.__ui.getState().setTutorialOpen(false); window.__ui.getState().setReleaseNotesOpen(false); });

  await install([fixture('frame-test', 'frame', 'Original frame')]);
  await node('frame-test').locator('[title="双击编辑"]').dblclick();
  let input = node('frame-test').locator('[data-frame-title-editor]');
  await input.fill('Cancelled frame');
  await input.press('Escape');
  assert.equal((await current('frame-test')).question, 'Original frame');
  await node('frame-test').locator('[title="双击编辑"]').dblclick();
  await input.fill('Saved frame');
  await outside();
  assert.equal((await current('frame-test')).question, 'Saved frame');
  await node('frame-test').locator('[title="双击编辑"]').dblclick();
  await input.fill('Composing frame');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal((await current('frame-test')).question, 'Saved frame');
  assert.equal(await input.count(), 1);
  await input.press('Enter');
  assert.equal((await current('frame-test')).question, 'Composing frame');
  check('frame outside commits; Escape cancels; composition Enter does not submit');

  const child = fixture('waiting-step', 'thought', 'Waiting', { stepKind: 'prompt' });
  child.position = { x: 650, y: 0 };
  await install([fixture('note-test', 'content', 'Original note', { stepKind: 'note' }), child], [{ id: 'note-edge', source: 'note-test', target: 'waiting-step' }]);
  await page.evaluate(() => {
    window.__testRerun = window.__store.getState().rerunNode;
    window.__testCascadeCount = 0;
    window.__store.setState({ rerunNode: async () => { window.__testCascadeCount += 1; } });
    window.__ui.getState().setAutoRefreshPaused(false);
  });
  await node('note-test').locator('.markdown-body').dblclick();
  let noteEditor = node('note-test').locator('[data-note-editor]');
  await noteEditor.locator('textarea').fill('Kept note draft');
  await outside();
  assert.equal((await current('note-test')).question, 'Original note');
  assert.equal(await page.evaluate(() => window.__testCascadeCount), 0);
  await node('note-test').locator('[data-resume-note-draft]').click();
  assert.equal(await noteEditor.locator('textarea').inputValue(), 'Kept note draft');
  await noteEditor.locator('textarea').fill('');
  await outside();
  await node('note-test').locator('[data-resume-note-draft]').click();
  assert.equal(await noteEditor.locator('textarea').inputValue(), '');
  await noteEditor.locator('textarea').press('Escape');
  assert.equal(await node('note-test').locator('[data-resume-note-draft]').count(), 0);
  assert.equal((await current('note-test')).question, 'Original note');
  await node('note-test').locator('.markdown-body').dblclick();
  await noteEditor.locator('textarea').fill('Saved note');
  await noteEditor.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await current('note-test')).question, 'Saved note');
  assert.equal(await page.evaluate(() => window.__testCascadeCount), 1);
  await page.evaluate(() => { window.__store.setState({ rerunNode: window.__testRerun }); window.__ui.getState().setAutoRefreshPaused(true); });
  check('note outside keeps even empty drafts without cascade; Escape discards; explicit save advances once');

  await install([fixture('file-test', 'content', '', { stepKind: 'file', attachments: [{
    id: 'image-test', name: 'sample.png', type: 'image/png', size: 68,
    content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMRsAAAAASUVORK5CYII=',
    extractedText: 'Original extraction', extractedBy: 'manual',
  }] })]);
  const toggle = node('file-test').locator('[data-extract-toggle]');
  await toggle.click();
  let extraction = node('file-test').locator('[data-extraction-editor]');
  await extraction.locator('textarea').fill('Kept extraction');
  await outside();
  assert.equal((await current('file-test')).attachments[0].extractedText, 'Original extraction');
  await toggle.click();
  assert.equal(await extraction.locator('textarea').inputValue(), 'Kept extraction');
  await extraction.locator('textarea').press('Escape');
  await toggle.click();
  assert.equal(await extraction.locator('textarea').inputValue(), 'Original extraction');
  await extraction.locator('textarea').fill('');
  await extraction.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await current('file-test')).attachments[0].extractedText, '');
  assert.equal(await toggle.count(), 1);
  check('image extraction keeps drafts, cancels safely, and can save an empty correction');

  await page.evaluate(() => {
    window.__ui.getState().setRoleLib({ hidden: [], custom: [{ id: 'custom-test', name: 'Custom role', prompt: 'Original prompt' }] });
    window.__ui.getState().setRoleManagerOpen(true);
  });
  const builtin = page.locator('[data-role-template]').first();
  const builtinId = await builtin.getAttribute('data-role-template');
  await builtin.locator('input').fill('Renamed builtin');
  await builtin.locator('textarea').click();
  assert.equal(await page.locator(`[data-role-template="${builtinId}"]`).count(), 1);
  assert.equal(await page.evaluate(() => window.__ui.getState().roleLib.custom.length), 1);
  await builtin.locator('textarea').fill('Changed builtin prompt');
  await builtin.locator('textarea').press('Tab');
  const copied = await page.evaluate(() => window.__ui.getState().roleLib.custom.find(role => role.name === 'Renamed builtin'));
  assert.equal(copied?.prompt, 'Changed builtin prompt');
  const custom = page.locator('[data-role-template="custom-test"]');
  await custom.locator('input').fill('Cancelled custom');
  await custom.locator('input').press('Escape');
  assert.equal(await custom.locator('input').inputValue(), 'Custom role');
  assert.equal(await page.evaluate(() => window.__ui.getState().roleLib.custom.find(role => role.id === 'custom-test').name), 'Custom role');
  await page.evaluate(() => window.__ui.getState().setRoleManagerOpen(false));
  check('role fields share one boundary; builtin clones once after leaving; Escape reverts the row');

  const switcher = page.locator('[data-project-switcher]');
  await switcher.locator('.canvas-project-button').click();
  await switcher.getByRole('button', { name: '重命名', exact: true }).first().click();
  const projectInput = switcher.locator('[data-project-name-editor]');
  await projectInput.fill('Outside saved project');
  await outside();
  assert.equal(await projectInput.count(), 0);
  assert.ok((await switcher.textContent()).includes('Outside saved project'));
  if (await switcher.getByRole('button', { name: '重命名', exact: true }).count() === 0) await switcher.locator('.canvas-project-button').click();
  await switcher.getByRole('button', { name: '重命名', exact: true }).first().click();
  await projectInput.fill('Cancelled project');
  await projectInput.press('Escape');
  await switcher.getByRole('button', { name: '重命名', exact: true }).first().waitFor({ state: 'attached' });
  assert.ok((await switcher.textContent()).includes('Outside saved project'));
  assert.equal(await projectInput.count(), 0);
  assert.ok(await switcher.getByRole('button', { name: '重命名', exact: true }).count() > 0);
  await page.keyboard.press('Escape');
  assert.equal(await switcher.getByRole('button', { name: '重命名', exact: true }).count(), 0);
  check('project outside saves; first Escape cancels rename; second Escape closes the menu');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  check('no browser errors or API writes');
} catch (error) {
  console.error(errors);
  console.error(await page.evaluate(() => ({
    nodes: window.__store?.getState().nodes.map(node => ({ id: node.id, kind: node.data.stepKind, question: node.data.question })),
    viewport: window.__rf?.getViewport(),
    project: document.querySelector('[data-project-switcher]')?.innerHTML.slice(0, 7000),
    body: document.body.innerText.slice(0, 3000),
  })));
  throw error;
} finally {
  await browser.close();
}
