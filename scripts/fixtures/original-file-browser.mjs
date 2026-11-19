import path from 'node:path';
import { chromium } from 'playwright-core';

// Each test owns an isolated browser context. Import and save need no
// persistent filesystem handles or special browser permissions.
export async function documentBrowser(appUrl, launchOptions) {
  const url = new URL(appUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use a loopback test server');
  const { executablePath, headless = true, ...contextOptions } = launchOptions;
  const browser = await chromium.launch({ executablePath, headless });
  const context = await browser.newContext(contextOptions);
  return { context, close: () => browser.close() };
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
