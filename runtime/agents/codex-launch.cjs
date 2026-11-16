// Prefer the official standalone CLI. A Windows desktop-bundled CLI is usable
// only with the supported MXC sandbox: legacy Registered Core needs an MSIX
// activation identity that direct child-process spawning cannot provide.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { searchDirs, childEnv } = require('./where.cjs');

const fsp = fs.promises;
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INSTALL_COMMAND = 'npm install --prefix node_modules/.thoughtdag-codex --no-audit --no-fund --ignore-scripts --save-exact @openai/codex@0.167.1';

function isDesktopBundle(candidate) {
  const normalized = String(candidate || '').replaceAll('\\', '/');
  return /\/WindowsApps\/OpenAI\.Codex_[^/]+\/app\/resources\//i.test(normalized)
    || /\/Codex\.app\/Contents\/Resources\//i.test(normalized);
}

function recordFailure(failures, candidate, error) {
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
  failures.push({ path: candidate, code: error?.code || 'UNKNOWN', message: error?.message || String(error) });
}

async function fileExists(candidate, failures) {
  try {
    await fsp.access(candidate, fs.constants.X_OK);
    return (await fsp.stat(candidate)).isFile();
  } catch (error) { recordFailure(failures, candidate, error); return false; }
}

async function readPackage(root, failures) {
  try { return JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8')); }
  catch (error) { recordFailure(failures, path.join(root, 'package.json'), error); return null; }
}

/** Follow the official npm package's native companion, not a .cmd shell.
 * Direct spawning also lets shutdown terminate the actual app-server on Windows.
 * Only npm management metadata is added; host security and auth variables survive.
 */
async function npmBinary(root, failures) {
  const manifest = await readPackage(root, failures);
  if (manifest?.name !== '@openai/codex') return null;
  const triples = {
    'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
    'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl',
  };
  const target = `${process.platform}-${process.arch}`;
  const triple = triples[target];
  if (!triple) return null;
  const companionName = `codex-${target}`;
  const candidates = [
    path.join(root, 'node_modules', '@openai', companionName),
    path.join(path.dirname(root), companionName),
  ];
  for (const companion of candidates) {
    const nativeManifest = await readPackage(companion, failures);
    if (!nativeManifest || nativeManifest.version !== `${manifest.version}-${target}`) continue;
    const binary = path.join(companion, 'vendor', triple, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (await fileExists(binary, failures)) return { binary, packageRoot: root, version: manifest.version };
  }
  // Older official packages kept the native payload inside the main package.
  const bundled = path.join(root, 'vendor', triple, 'codex', process.platform === 'win32' ? 'codex.exe' : 'codex');
  if (await fileExists(bundled, failures)) return { binary: bundled, packageRoot: root, version: manifest.version };
  failures.push({ path: root, code: 'INCOMPLETE_CODEX_PACKAGE', message: 'The official CLI package is missing its matching native dependency; reinstall with optional dependencies enabled.' });
  return null;
}

async function resolveCandidate(candidate, failures) {
  if (!await fileExists(candidate, failures)) return null;
  let actual = candidate;
  try { actual = await fsp.realpath(candidate); } catch (error) { recordFailure(failures, candidate, error); return null; }
  if (isDesktopBundle(actual)) {
    if (process.platform === 'win32') return { binary: actual, desktopBundle: true };
    failures.push({ path: candidate, code: 'DESKTOP_BUNDLE', message: 'Install the standalone CLI; this desktop-private executable has not been verified as a standalone launch path.' });
    return null;
  }
  if (/\.(cmd|bat|js)$/i.test(actual)) {
    const dir = path.dirname(actual);
    const roots = /\.js$/i.test(actual)
      ? [path.dirname(dir)]
      : [path.join(dir, 'node_modules', '@openai', 'codex'), path.join(path.dirname(dir), '@openai', 'codex')];
    for (const root of roots) {
      const npm = await npmBinary(root, failures);
      if (npm) return npm;
    }
    failures.push({ path: candidate, code: 'UNSUPPORTED_CODEX_SHIM', message: 'Use an official standalone executable or the @openai/codex npm installation.' });
    return null;
  }
  return { binary: actual };
}

/** Full spawn contract. Discovery never executes a shell, changes global config,
 * or removes CODEX_WINDOWS_REGISTERED_CORE / other inherited policy variables.
 */
async function resolveCodexLaunch({ extraHomes = [], projectRoot = PROJECT_ROOT } = {}) {
  const failures = [];
  const searched = [];
  const env = childEnv(extraHomes);
  const explicit = process.env.THOUGHTDAG_CODEX_PATH?.trim();
  const build = (resolved, source, displayPath = resolved.binary) => {
    const launchEnv = { ...env };
    if (resolved.packageRoot) {
      launchEnv.CODEX_MANAGED_PACKAGE_ROOT = resolved.packageRoot;
      launchEnv.CODEX_MANAGED_BY_NPM = '1';
    }
    // MXC is an official Windows sandbox, not an unsandboxed workaround. Force
    // it for a process inherited from Registered Core; unsupported Windows or
    // managed requirements fail closed, without a weaker legacy fallback.
    const requireMxc = process.platform === 'win32' && (resolved.desktopBundle || launchEnv.CODEX_WINDOWS_REGISTERED_CORE === '1');
    const args = [...(requireMxc ? ['-c', 'windows.sandbox=mxc'] : []), 'app-server', '--listen', 'stdio://'];
    return { path: displayPath, command: resolved.binary, args, env: launchEnv, source: resolved.desktopBundle ? 'desktop-bundle-mxc' : source, version: resolved.version, windowsSandbox: requireMxc ? 'mxc' : undefined, searched, failures };
  };
  const unavailable = (message) => ({ path: null, searched, failures, error: message });
  if (explicit) {
    searched.push(explicit);
    const found = await resolveCandidate(path.resolve(explicit), failures);
    return found ? build(found, 'explicit', explicit) : unavailable(`THOUGHTDAG_CODEX_PATH is not a usable standalone CLI: ${explicit}. ${failures.at(-1)?.message || ''}`);
  }

  const localRoot = path.join(projectRoot, 'node_modules', '.thoughtdag-codex', 'node_modules', '@openai', 'codex');
  searched.push(localRoot);
  const local = await npmBinary(localRoot, failures);
  if (local) return build(local, 'project-npm');

  const directories = await searchDirs(extraHomes, failures);
  searched.push(...directories);
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex'];
  let desktopFallback = null;
  for (const dir of directories) for (const name of names) {
    const candidate = path.join(dir, name);
    const found = await resolveCandidate(candidate, failures);
    if (found?.desktopBundle) { desktopFallback ||= { found, candidate }; continue; }
    if (found) return build(found, 'path', candidate);
  }
  if (!desktopFallback && process.platform === 'win32' && process.env.CODEX_APP_RUNTIME_CLI_PATH) {
    const candidate = process.env.CODEX_APP_RUNTIME_CLI_PATH;
    searched.push(candidate);
    const found = await resolveCandidate(candidate, failures);
    if (found?.desktopBundle) desktopFallback = { found, candidate };
  }
  if (desktopFallback) return build(desktopFallback.found, 'desktop-bundle-mxc', desktopFallback.candidate);
  const detail = failures[0] ? ` (${failures[0].code}: ${failures[0].path})` : '';
  return unavailable(`No standalone CLI was found${detail}. Install it from the official distribution with: ${INSTALL_COMMAND}; or set THOUGHTDAG_CODEX_PATH to your standalone CLI.`);
}

function createCodexLaunchResolver(options) {
  let pending = null;
  return () => {
    if (!pending) pending = resolveCodexLaunch(options).finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { resolveCodexLaunch, createCodexLaunchResolver, isDesktopBundle };
