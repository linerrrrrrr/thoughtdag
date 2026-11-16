import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

// Real host file handles, scoped to generated fixtures and a disposable
// browser profile. Only the loopback test origin can write its selected files.
export async function documentBrowser(appUrl, launchOptions) {
  const url = new URL(appUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use a loopback test server');
  const parent = path.resolve(tmpdir());
  const profile = await mkdtemp(path.join(parent, 'thoughtdag-doc-test-'));
  await mkdir(path.join(profile, 'Default'));
  await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
    profile: { content_settings: { exceptions: {
      file_system_read_guard: { [url.origin + ',*']: { setting: 1 } },
      file_system_write_guard: { [url.origin + ',*']: { setting: 1 } },
      file_system_access_extended_permission: { [url.origin + ',*']: { setting: 1 } },
    } } },
  }));
  const context = await chromium.launchPersistentContext(profile, { headless: true, ...launchOptions });
  return { context, async close() {
    await context.close();
    if (path.dirname(profile) === parent && path.basename(profile).startsWith('thoughtdag-doc-test-')) {
      await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  } };
}

export async function dropFixtureFiles(page, files, x, y) {
  const root = path.resolve('local-tests') + path.sep;
  const paths = files.map(file => path.resolve(file));
  if (paths.some(file => !file.startsWith(root))) throw new Error('Expected generated test fixtures');
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x, y, data: { items: [], files: paths, dragOperationsMask: 1 } });
    }
  } finally { await cdp.detach(); }
}

// For old attachments: automate the picker choice, leaving permission checks,
// browser stream writes, IndexedDB handle persistence and disk reads real.
export async function chooseFixtureOriginal(page, file) {
  await page.evaluate(() => {
    const capture = event => { event.stopImmediatePropagation(); event.preventDefault(); };
    window.addEventListener('dragover', capture, { capture: true });
    window.addEventListener('drop', event => {
      capture(event);
      const handle = event.dataTransfer.items[0].getAsFileSystemHandle();
      window.showOpenFilePicker = async () => [await handle];
      window.removeEventListener('dragover', capture, true);
    }, { once: true, capture: true });
  });
  await dropFixtureFiles(page, [file], 10, 10);
}
