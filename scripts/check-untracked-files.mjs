import { spawnSync } from 'node:child_process';

if (process.env.THOUGHTDAG_ALLOW_UNTRACKED !== '1') {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    console.error('Could not check untracked files:', result.error?.message || result.stderr.trim());
    process.exitCode = 1;
  } else {
    const files = result.stdout.split('\0').filter(Boolean);
    if (files.length) {
      console.error('Untracked, non-ignored files would be omitted from this commit:');
      for (const file of files) console.error(`  ${JSON.stringify(file)}`);
      console.error('Review them and use git add for files to include, or ignore files that should stay local.');
      console.error('For an intentional partial commit, set THOUGHTDAG_ALLOW_UNTRACKED=1 for that commit.');
      process.exitCode = 1;
    }
  }
}
