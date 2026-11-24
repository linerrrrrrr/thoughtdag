import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function git(...args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

const rootResult = git('rev-parse', '--show-toplevel');
if (rootResult.error || rootResult.status !== 0) {
  console.error('Run this command inside a Git worktree.');
  process.exit(1);
}
const root = rootResult.stdout.trim();
const expected = resolve(root, '.githooks');
if (!existsSync(resolve(expected, 'pre-commit'))) {
  console.error('The repository pre-commit hook is missing.');
  process.exit(1);
}

const config = git('config', '--get', 'core.hooksPath');
if (config.error || (config.status !== 0 && config.status !== 1)) {
  console.error('Could not inspect the existing Git hook configuration.');
  process.exit(1);
}
const configuredPath = config.stdout.trim();
if (configuredPath && resolve(root, configuredPath) !== expected) {
  console.error(`An existing core.hooksPath is configured (${configuredPath}); it was not changed.`);
  process.exit(1);
}

if (!configuredPath) {
  const hooksResult = git('rev-parse', '--git-path', 'hooks');
  if (hooksResult.error || hooksResult.status !== 0) {
    console.error('Could not inspect the existing Git hooks directory.');
    process.exit(1);
  }
  const hooksDir = resolve(root, hooksResult.stdout.trim());
  const existing = existsSync(hooksDir)
    ? readdirSync(hooksDir).filter((name) => !name.endsWith('.sample'))
    : [];
  if (existing.length) {
    console.error(`Existing Git hooks were not replaced: ${existing.join(', ')}`);
    process.exit(1);
  }
}

const install = git('config', '--local', 'core.hooksPath', '.githooks');
if (install.error || install.status !== 0) {
  console.error('Could not configure the repository hook:', install.error?.message || install.stderr.trim());
  process.exit(1);
}
console.log('Installed the untracked-file pre-commit check for this repository.');
