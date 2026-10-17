// Fails when a file names the framework Nitrogen was modelled on, in its content or in its path.
// The CLI stands on its own, as Nitrogen does, so neither its code nor its docs refer to it. The name
// is decoded here, not written. Tracked files and new ones not yet added are read; git-ignored ones are not.
import {execFileSync} from 'node:child_process';

const name = Buffer.from('aHlkcm9nZW4=', 'base64').toString();

/** Runs git; exit status 1 means "nothing found", any other failure fails the check. */
function git(args) {
  try {
    return execFileSync('git', args, {encoding: 'utf8'});
  } catch (error) {
    if (error.status === 1) return '';
    throw error;
  }
}

// Lockfiles name third-party packages; they are not ours to word.
const contents = git(['grep', '--untracked', '-n', '-i', '-I', '-e', name, '--', '.', ':!pnpm-lock.yaml'])
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split(':').slice(0, 2).join(':'));
const paths = git(['ls-files', '--cached', '--others', '--exclude-standard'])
  .split('\n')
  .filter((path) => path.toLowerCase().includes(name));

const places = [...contents, ...paths.map((path) => `${path} (path)`)];
if (places.length) {
  console.error(`A name that must not appear was found in ${places.length} place(s):\n${places.join('\n')}`);
  process.exit(1);
}
