// The pre-commit hook checks the files on disk. So that it checks exactly what is committed, it
// stops while the disk holds changes the commit leaves out: unstaged edits or new files.
import {execFileSync} from 'node:child_process';

const lines = (...args) => execFileSync('git', args, {encoding: 'utf8'}).split('\n').filter(Boolean);
const outside = [...lines('diff', '--name-only'), ...lines('ls-files', '--others', '--exclude-standard')];

if (outside.length) {
  console.error(
    'The check runs on the files on disk, so it would not check this commit. Add these files, or set them\n' +
      'aside with `git stash push --keep-index --include-untracked`, and commit again:',
  );
  for (const file of outside) console.error(`  ${file}`);
  process.exit(1);
}
