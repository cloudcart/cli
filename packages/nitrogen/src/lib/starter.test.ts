import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { starterArchiveUrl, unpackStarter } from './starter.js';

const folders: string[] = [];

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'nitrogen-starter-test-'));
  folders.push(path);
  return path;
}

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A git repository with a committed starter, and the files a working copy has that a push never sends. */
function localStarter(): string {
  const repository = folder();
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(repository, 'package.json'), '{"name":"nitrogen-starter"}\n');
  writeFileSync(join(repository, '.env.example'), 'SESSION_SECRET=\n');
  writeFileSync(join(repository, '.gitignore'), 'node_modules\n.env\n');
  mkdirSync(join(repository, 'app/routes'), { recursive: true });
  writeFileSync(join(repository, 'app/routes/_index.tsx'), 'export default function Home() {}\n');
  git('add', '-A');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'starter');
  // Not committed: never in a project made from it.
  writeFileSync(join(repository, '.env'), 'SESSION_SECRET=local\n');
  mkdirSync(join(repository, 'node_modules/some-package'), { recursive: true });
  writeFileSync(join(repository, 'node_modules/some-package/index.js'), '');
  writeFileSync(join(repository, 'package.json'), '{"name":"changed-after-the-commit"}\n');
  return repository;
}

/** A gzipped tar of the given entries, written by hand so that an unsafe one can be made. */
function tarball(entries: Array<{ path: string; body?: string; type?: 'File' | 'Directory' | 'SymbolicLink'; linkpath?: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    const type = entry.type ?? 'File';
    const header = new Header({
      path: entry.path,
      mode: type === 'Directory' ? 0o755 : 0o644,
      size: type === 'File' ? body.length : 0,
      mtime: new Date(0),
      type,
      linkpath: entry.linkpath,
    });
    header.encode();
    blocks.push(header.block!);
    if (type === 'File') blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function answering(body: Buffer | null, status = 200, statusText = 'OK'): typeof fetch {
  return (async () => new Response(body && new Uint8Array(body), { status, statusText })) as typeof fetch;
}

describe('starterArchiveUrl', () => {
  it('is the published template at its default branch', () => {
    expect(starterArchiveUrl()).toBe('https://codeload.github.com/cloudcart/nitro-starter/tar.gz/refs/heads/main');
  });
});

describe('unpackStarter from a local repository', () => {
  it('gives the last commit only: no .env, no node_modules, no uncommitted change', async () => {
    const project = folder();
    await unpackStarter({ kind: 'local', directory: localStarter() }, project);

    expect(readFileSync(join(project, 'package.json'), 'utf-8')).toBe('{"name":"nitrogen-starter"}\n');
    expect(existsSync(join(project, 'app/routes/_index.tsx'))).toBe(true);
    expect(existsSync(join(project, '.env.example'))).toBe(true);
    expect(existsSync(join(project, '.env'))).toBe(false);
    expect(existsSync(join(project, 'node_modules'))).toBe(false);
    expect(existsSync(join(project, 'starter'))).toBe(false);
  });

  it('fails when the folder is not a git repository', async () => {
    await expect(unpackStarter({ kind: 'local', directory: folder() }, folder())).rejects.toThrow(/git archive failed/);
  });
});

describe('unpackStarter from the published starter', () => {
  it('drops the archive top folder', async () => {
    const project = folder();
    const archive = tarball([
      { path: 'nitro-starter-main/', type: 'Directory' },
      { path: 'nitro-starter-main/package.json', body: '{"name":"nitrogen-starter"}\n' },
      { path: 'nitro-starter-main/app/root.tsx', body: 'export default function App() {}\n' },
    ]);
    await unpackStarter({ kind: 'published' }, project, answering(archive));

    expect(readFileSync(join(project, 'package.json'), 'utf-8')).toBe('{"name":"nitrogen-starter"}\n');
    expect(existsSync(join(project, 'app/root.tsx'))).toBe(true);
  });

  it('names the status and the address when the download fails', async () => {
    await expect(unpackStarter({ kind: 'published' }, folder(), answering(null, 404, 'Not Found'))).rejects.toThrow(
      'Could not download the starter from https://codeload.github.com/cloudcart/nitro-starter/tar.gz/refs/heads/main: 404 Not Found',
    );
  });

  it('names the address when the network fails', async () => {
    const offline = (async () => {
      throw new Error('getaddrinfo ENOTFOUND codeload.github.com');
    }) as typeof fetch;
    await expect(unpackStarter({ kind: 'published' }, folder(), offline)).rejects.toThrow(
      /Could not download the starter from https:\/\/codeload\.github\.com\/.+: getaddrinfo ENOTFOUND/,
    );
  });

  it('refuses an entry that climbs out of the project', async () => {
    const parent = folder();
    const project = join(parent, 'project');
    mkdirSync(project);
    const archive = tarball([
      { path: 'top/package.json', body: '{}' },
      { path: 'top/../../escaped.txt', body: 'out' },
    ]);

    await expect(unpackStarter({ kind: 'published' }, project, answering(archive))).rejects.toThrow();
    expect(existsSync(join(parent, 'escaped.txt'))).toBe(false);
  });

  it('refuses to write through a link the archive made', async () => {
    const outside = folder();
    const project = folder();
    const archive = tarball([
      { path: 'top/package.json', body: '{}' },
      { path: 'top/linked', type: 'SymbolicLink', linkpath: outside },
      { path: 'top/linked/planted.txt', body: 'out' },
    ]);

    await expect(unpackStarter({ kind: 'published' }, project, answering(archive))).rejects.toThrow();
    expect(existsSync(join(outside, 'planted.txt'))).toBe(false);
  });

  it('refuses an archive that is not a Nitrogen project', async () => {
    const archive = tarball([{ path: 'top/README.md', body: '# Not a starter\n' }]);
    await expect(unpackStarter({ kind: 'published' }, folder(), answering(archive))).rejects.toThrow(/no package\.json/);
  });
});
