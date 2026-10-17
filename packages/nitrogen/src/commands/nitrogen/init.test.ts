import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from '../../lib/project.js';
import NitrogenInit from './init.js';

vi.mock('../../lib/project.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/project.js')>()),
  exec: vi.fn(async () => {}),
}));

const run = vi.mocked(exec);
const folders: string[] = [];
let output: string[] = [];

beforeEach(() => {
  output = [];
  for (const method of ['log', 'error', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(args.join(' ')));
  }
});

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  run.mockReset();
  run.mockImplementation(async () => {});
});

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'nitrogen-init-test-'));
  folders.push(path);
  return path;
}

/** A starter repository as a local one gives it: Nitrogen from local packs. */
function starter(): string {
  const repository = folder();
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { stdio: 'ignore' });
  git('init', '-q');
  const pkg = {
    name: 'nitrogen-starter',
    dependencies: { '@cloudcart/nitrogen': 'file:../packs/nitrogen.tgz', react: '^19.1.0' },
    devDependencies: { '@cloudcart/nitrogen-codegen': 'file:../packs/codegen.tgz' },
  };
  writeFileSync(join(repository, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(join(repository, 'package-lock.json'), '{}\n');
  writeFileSync(join(repository, '.env.example'), '# The domain.\nPUBLIC_STORE_DOMAIN=\nSESSION_SECRET=\n');
  mkdirSync(join(repository, 'app/routes'), { recursive: true });
  writeFileSync(join(repository, 'app/routes/product.$handle.tsx'), 'export default function Product() {}\n');
  git('add', '-A');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'starter');
  return repository;
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const init = (...argv: string[]) => new NitrogenInit(argv, config as never).run();
const calls = () => run.mock.calls.map(([command, args, cwd]) => `${[command, ...args].join(' ')} in ${cwd}`);

describe('nitrogen init', () => {
  it('makes the project from the starter, then runs git init and the install there (T-502)', async () => {
    const path = join(folder(), 'my-store');
    await init(path, '--quickstart', '--template', starter());

    const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('my-store');
    expect(pkg.dependencies['@cloudcart/nitrogen']).toBe('^2.0.0');
    expect(pkg.devDependencies['@cloudcart/nitrogen-codegen']).toBe('^2.0.0');
    expect(existsSync(join(path, 'app/routes/product.$handle.tsx'))).toBe(true);
    expect(statSync(join(path, '.env')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(path, '.env'), 'utf-8')).toMatch(/^SESSION_SECRET=[0-9a-f]{64}$/m);
    expect(calls()).toEqual([`git init -q in ${path}`, `npm install in ${path}`]);
    expect(output.join('\n')).toContain('Created');
  });

  it('installs with the chosen package manager and leaves npm\'s lockfile to npm', async () => {
    const path = join(folder(), 'store');
    await init(path, '--quickstart', '--package-manager', 'pnpm', '--no-git', '--template', starter());

    expect(calls()).toEqual([`pnpm install in ${path}`]);
    expect(existsSync(join(path, 'package-lock.json'))).toBe(false);
  });

  it('runs nothing with --no-git --no-install, and says to install', async () => {
    const path = join(folder(), 'store');
    await init(path, '--quickstart', '--no-git', '--no-install', '--template', starter());

    expect(run).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('npm install');
  });

  it('refuses a folder that exists', async () => {
    const path = folder();
    await expect(init(path, '--quickstart', '--template', starter())).rejects.toMatchObject({ oclif: { exit: 1 } });
    expect(output.join('\n')).toContain('already exists');
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves no folder behind when the starter cannot be downloaded', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 503, statusText: 'Service Unavailable' }));
    const path = join(folder(), 'store');
    await expect(init(path, '--quickstart')).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(existsSync(path)).toBe(false);
    expect(output.join('\n')).toContain('Could not download the starter from https://codeload.github.com/cloudcart/nitro-starter/tar.gz/refs/heads/main: 503 Service Unavailable');
  });

  it('keeps the project and says what to run when the install fails', async () => {
    run.mockImplementation(async (command) => {
      if (command === 'npm') throw new Error('Process exited with code 1');
    });
    const path = join(folder(), 'store');
    await expect(init(path, '--quickstart', '--template', starter())).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(existsSync(join(path, 'package.json'))).toBe(true);
    expect(output.join('\n')).toContain('The install failed (Process exited with code 1)');
  });

  it('says the input ended when it has a question and no terminal (B-462)', async () => {
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from([]) as unknown as typeof process.stdin);
    await expect(init('--template', starter())).rejects.toThrow('No answer to "Project name:": the input ended');
    expect(run).not.toHaveBeenCalled();
  });
});
