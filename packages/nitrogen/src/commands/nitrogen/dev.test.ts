import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchCodegen } from '../../lib/codegen.js';
import { exec } from '../../lib/project.js';
import NitrogenDev from './dev.js';

vi.mock('../../lib/project.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/project.js')>()),
  exec: vi.fn(async () => {}),
}));

const close = vi.fn();
vi.mock('../../lib/codegen.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/codegen.js')>()),
  watchCodegen: vi.fn(() => ({ close })),
}));

const run = vi.mocked(exec);
const watch = vi.mocked(watchCodegen);
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
  watch.mockClear();
  close.mockClear();
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-dev-test-'));
  folders.push(root);
  mkdirSync(join(root, 'app/routes'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"store"}\n');
  writeFileSync(join(root, 'codegen.ts'), 'export default {};\n');
  writeFileSync(join(root, '.env'), 'PUBLIC_STORE_DOMAIN=shop.example.com\n');
  return root;
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const dev = (...argv: string[]) => new NitrogenDev(argv, config as never).run();
const calls = () => run.mock.calls.map(([command, args]) => [command, ...args].join(' '));

describe('nitrogen dev', () => {
  it('starts the dev server on the port, with the .env values', async () => {
    await dev('--path', project(), '--port', '4000', '--host');

    expect(calls()).toEqual(['npx react-router dev --port 4000 --host']);
    expect(run.mock.calls[0][3]).toMatchObject({ PUBLIC_STORE_DOMAIN: 'shop.example.com', PORT: '4000' });
    expect(watch).not.toHaveBeenCalled();
  });

  it('with --codegen makes the types first and watches the queries until the server exits (T-504)', async () => {
    const root = project();
    run.mockImplementation(async (_command, args) => {
      // While the server runs, the watch is open.
      if (args[1] === 'dev') expect(close).not.toHaveBeenCalled();
    });
    await dev('--path', root, '--codegen');

    expect(calls()).toEqual(['npx graphql-codegen --config codegen.ts', 'npx react-router typegen', 'npx react-router dev --port 3000']);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch.mock.calls[0][0]).toBe(root);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('starts anyway when the first codegen fails, and closes the watch when the server fails', async () => {
    run.mockImplementation(async (_command, args) => {
      if (args[0] === 'graphql-codegen') throw new Error('Process exited with code 1');
      if (args[1] === 'dev') throw new Error('Process exited with code 7');
    });
    await expect(dev('--path', project(), '--codegen')).rejects.toThrow('Process exited with code 7');

    expect(calls()).toEqual(['npx graphql-codegen --config codegen.ts', 'npx react-router dev --port 3000']);
    expect(output.join('\n')).toContain('The GraphQL codegen failed');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
