import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from '../../lib/project.js';
import NitrogenBuild from './build.js';

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
  run.mockReset();
  run.mockImplementation(async () => {});
});

/** A project with a codegen config and an `.env`. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-build-test-'));
  folders.push(root);
  mkdirSync(join(root, 'app/routes'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"store"}\n');
  writeFileSync(join(root, 'codegen.ts'), 'export default {};\n');
  writeFileSync(join(root, '.env'), 'PUBLIC_STORE_DOMAIN=shop.example.com\n');
  return root;
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const build = (...argv: string[]) => new NitrogenBuild(argv, config as never).run();
const calls = () => run.mock.calls.map(([command, args]) => [command, ...args].join(' '));

describe('nitrogen build', () => {
  it('builds for production with the .env values', async () => {
    const root = project();
    await build('--path', root);

    expect(calls()).toEqual(['npx react-router build']);
    expect(run.mock.calls[0][2]).toBe(root);
    expect(run.mock.calls[0][3]).toMatchObject({ PUBLIC_STORE_DOMAIN: 'shop.example.com', NODE_ENV: 'production' });
  });

  it('with --codegen makes the GraphQL types, then the route types, then builds (T-504)', async () => {
    await build('--path', project(), '--codegen');
    expect(calls()).toEqual(['npx graphql-codegen --config codegen.ts', 'npx react-router typegen', 'npx react-router build']);
  });

  it('builds nothing when the codegen fails', async () => {
    run.mockImplementation(async (_command, args) => {
      if (args[0] === 'graphql-codegen') throw new Error('Process exited with code 1');
    });
    await expect(build('--path', project(), '--codegen')).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(calls()).toEqual(['npx graphql-codegen --config codegen.ts']);
    expect(output.join('\n')).toContain('The GraphQL codegen failed (Process exited with code 1); its output is above. Nothing was built.');
  });

  it('asks for source maps with --sourcemap', async () => {
    await build('--path', project(), '--sourcemap');
    expect(run.mock.calls[0][3]).toMatchObject({ GENERATE_SOURCEMAP: 'true' });
  });

  it('refuses a folder that is not a Nitrogen project', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'nitrogen-build-test-'));
    folders.push(empty);
    await expect(build('--path', empty)).rejects.toThrow(/No package\.json found/);
    expect(run).not.toHaveBeenCalled();
  });
});
