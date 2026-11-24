import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'thoughtdag-hook-test-'));
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(temp, 'no-global-config') };
delete env.THOUGHTDAG_ALLOW_UNTRACKED;

function run(cwd, command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}
function git(cwd, ...args) {
  const result = run(cwd, 'git', args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function fixture(name) {
  const repo = join(temp, name);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, '.githooks'));
  for (const file of ['check-untracked-files.mjs', 'install-git-hooks.mjs']) {
    copyFileSync(join(source, 'scripts', file), join(repo, 'scripts', file));
  }
  copyFileSync(join(source, '.githooks', 'pre-commit'), join(repo, '.githooks', 'pre-commit'));
  chmodSync(join(repo, '.githooks', 'pre-commit'), 0o755);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  return repo;
}

try {
  const repo = fixture('repo');
  writeFileSync(join(repo, '.gitignore'), '.env\nlocal-data/\n');
  writeFileSync(join(repo, '.env'), 'private');
  mkdirSync(join(repo, 'local-data'));
  writeFileSync(join(repo, 'local-data', 'data.txt'), 'private');
  writeFileSync(join(repo, 'new file.ts'), 'export const value = 1;\n');
  let result = run(repo, process.execPath, ['scripts/install-git-hooks.mjs']);
  assert.equal(result.status, 0, result.stderr);
  git(repo, 'add', '.gitignore', '.githooks', 'scripts');
  const staged = git(repo, 'diff', '--cached', '--name-only');
  result = run(repo, 'git', ['commit', '-m', 'test']);
  assert.notEqual(result.status, 0, 'the hook must block an omitted new file');
  assert.match(result.stderr, /new file\.ts/);
  assert.doesNotMatch(result.stderr, /local-data|\.env/);
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), staged, 'the hook must not stage files');
  git(repo, 'add', 'new file.ts');
  git(repo, 'commit', '-m', 'test');
  writeFileSync(join(repo, 'later.ts'), 'later');
  writeFileSync(join(repo, 'new file.ts'), 'export const value = 2;\n');
  git(repo, 'add', 'new file.ts');
  result = run(repo, 'git', ['commit', '-m', 'partial'], { THOUGHTDAG_ALLOW_UNTRACKED: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(git(repo, 'status', '--short'), /later\.ts/);

  const existingRepo = fixture('existing');
  writeFileSync(join(existingRepo, '.git', 'hooks', 'pre-commit'), '# existing hook\n');
  result = run(existingRepo, process.execPath, ['scripts/install-git-hooks.mjs']);
  assert.notEqual(result.status, 0, 'installation must preserve existing hooks');
  assert.notEqual(run(existingRepo, 'git', ['config', '--local', '--get', 'core.hooksPath']).status, 0);
  console.log('Untracked-file guard: all checks passed.');
} finally {
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('thoughtdag-hook-test-')) {
    throw new Error(`Refusing to remove unexpected test directory: ${temp}`);
  }
  rmSync(temp, { recursive: true, force: true });
}
