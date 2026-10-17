/**
 * The starter a new project is made from: the published template, or a local repository's committed files.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { extract } from 'tar';

/**
 * The published starter: the public template the admin generates every storefront repository from, at its
 * default branch, so a project made here starts from the same files as one made in the admin.
 */
export const STARTER_REPOSITORY = 'cloudcart/nitro-starter';
export const STARTER_BRANCH = 'main';

/** The address of a GitHub repository's branch as a gzipped tarball. */
export function starterArchiveUrl(repository = STARTER_REPOSITORY, branch = STARTER_BRANCH): string {
  return `https://codeload.github.com/${repository}/tar.gz/refs/heads/${branch}`;
}

/** Where the starter comes from: the published one, or a local git repository's last commit. */
export type StarterSource = { kind: 'published' } | { kind: 'local'; directory: string };

/**
 * Unpacks the starter into `destination`, an existing empty folder. The archive's top folder is dropped. An
 * entry that would land outside `destination` (an absolute path, `..`, a write through a link) fails the
 * whole unpacking rather than being skipped (tar's `strict`).
 *
 * A local repository gives only what `git archive HEAD` holds — what a push would publish — so its `.env`,
 * `node_modules` and builds never reach the new project.
 */
export async function unpackStarter(
  source: StarterSource,
  destination: string,
  fetchArchive: typeof fetch = fetch,
): Promise<void> {
  const archive =
    source.kind === 'local'
      ? Readable.from([await gitArchive(source.directory)])
      : await download(starterArchiveUrl(), fetchArchive);
  await pipeline(archive, extract({ cwd: destination, strip: 1, strict: true }));

  if (!existsSync(resolve(destination, 'package.json'))) {
    throw new Error('The starter has no package.json: it is not a Nitrogen project.');
  }
}

async function download(url: string, fetchArchive: typeof fetch): Promise<Readable> {
  let response: Response;
  try {
    response = await fetchArchive(url);
  } catch (error) {
    throw new Error(`Could not download the starter from ${url}: ${(error as Error).message}`);
  }
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the starter from ${url}: ${response.status} ${response.statusText}`.trim());
  }
  return Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
}

/**
 * The repository's last commit as a tar archive, read whole before it is unpacked, so that git's own reason
 * for a failure is the one reported (a failed `git archive` writes nothing). A starter is a few megabytes.
 */
function gitArchive(directory: string): Promise<Buffer> {
  return new Promise((resolveArchive, reject) => {
    execFile(
      'git',
      ['-C', directory, 'archive', '--format=tar', '--prefix=starter/', 'HEAD'],
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`git archive failed in ${directory}: ${stderr.toString().trim() || error.message}`));
        else resolveArchive(stdout);
      },
    );
  });
}
