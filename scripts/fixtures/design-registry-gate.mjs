// Exercise the real npm and Vite entry points against an isolated copy.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createTestServer } from './vite-test-server.mjs';

async function waitForResponse(url, expected) {
  const deadline = Date.now() + 20000;
  let last;
  do {
    const res = await fetch(url);
    const body = await res.text();
    last = res.status + ' ' + body.slice(0, 600);
    if (expected ? res.status === 503 && expected.test(body) : res.status === 200) return;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail('Unexpected dev server response: ' + last);
}

export async function testRegistrationGate({ name, sourceFile, marker, expected, check, extraBuildTest }) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const scratch = path.join(root, 'local-tests');
  await fs.mkdir(scratch, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(scratch, name + '-gate-'));
  let server;
  process.env.THOUGHTDAG_DISK_STORAGE = '0';
  function rejectedBuild() {
    const build = spawnSync('npm run build', { cwd: fixture, shell: true, encoding: 'utf8', timeout: 60000 });
    assert.ifError(build.error);
    assert.notEqual(build.status, 0, 'the normal production build must reject the omission');
    return build.stdout + build.stderr;
  }
  try {
    const checkerFiles = (await fs.readdir(path.join(root, 'scripts')))
      .filter(file => /^check-(?:typography|cursors|settings-spacing|spacing-sources)(?:-[\w-]+)?\.mjs$/.test(file)).map(file => 'scripts/' + file);
    const files = ['package.json', 'vite.config.ts', 'scripts/design-registry-vite.ts', 'src',
      'public', 'runtime', 'desktop', 'vendor/design-references', 'server.mjs', ...checkerFiles,
      ...(await fs.readdir(root)).filter(file => /\.html?$/.test(file))];
    for (const name of files) {
      const target = path.join(fixture, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(path.join(root, name), target, {
        recursive: true,
        filter: file => !['node_modules', 'dist', 'out', 'payload', 'build'].includes(path.basename(file)),
      });
    }
    assert.deepEqual(check(fixture), [], 'the unmodified source must pass the same gate');
    // The live project ignores local-tests. The copy has its own watcher.
    process.chdir(fixture);
    const config = {
      root: fixture, cacheDir: path.join(fixture, '.vite'), configFile: path.join(fixture, 'vite.config.ts'), logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
    };
    server = await createTestServer(config);
    await server.listen();
    const url = 'http://127.0.0.1:' + server.httpServer.address().port;
    await waitForResponse(url);
    const file = path.join(fixture, sourceFile);
    // The HTTP listener can start before the initial recursive watch scan.
    const deadline = Date.now() + 15000;
    while (!Object.values(server.watcher.getWatched()).some(entries => entries.includes(path.basename(file)))) {
      assert.ok(Date.now() < deadline, 'Vite must be watching ' + sourceFile + ' before editing it');
      await delay(50);
    }
    const original = await fs.readFile(file, 'utf8');
    assert.equal(original.split(marker).length, 2, 'remove exactly one real registration');
    await fs.writeFile(file, original.replace(marker, ''));
    assert.match(check(fixture).join('\n'), expected);
    await waitForResponse(url, expected);
    const output = rejectedBuild();
    assert.match(output, expected);
    console.log('PASS npm run build rejected the omitted registration:', output.split(/\r?\n/).find(line => expected.test(line)));
    await assert.rejects(() => createTestServer(config), expected);
    if (extraBuildTest) await extraBuildTest(fixture, rejectedBuild);
    await fs.writeFile(file, original);
    await waitForResponse(url);
    assert.deepEqual(check(fixture), [], 'restoring the marker repairs the gate');
    console.log('PASS Vite rejected invalid startup and hot edits, then resumed after restoration');
  } finally {
    await server?.close();
    process.chdir(root);
    if (path.dirname(await fs.realpath(fixture)) === await fs.realpath(scratch)) {
      await fs.rm(fixture, { recursive: true, force: true });
    }
  }
}
