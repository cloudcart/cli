import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from '../../lib/project.js';
import NitrogenPreview from './preview.js';

vi.mock('../../lib/project.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/project.js')>()),
  exec: vi.fn(async () => {}),
}));

const run = vi.mocked(exec);
const folders: string[] = [];

beforeEach(() => {
  for (const method of ['log', 'error', 'warn'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
  run.mockReset();
  run.mockImplementation(async () => {});
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-preview-test-'));
  folders.push(root);
  mkdirSync(join(root, 'app/routes'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"store"}\n');
  return root;
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const preview = (...argv: string[]) => new NitrogenPreview(argv, config as never).run();
const calls = () => run.mock.calls.map(([command, args, , env]) => `${[command, ...args].join(' ')} (${env?.NODE_ENV})`);

describe('nitrogen preview', () => {
  it('serves the production build on the port', async () => {
    await preview('--path', project(), '--port', '4100');
    expect(calls()).toEqual(['npx vite preview --port 4100 (production)']);
  });

  it('builds first with --build', async () => {
    await preview('--path', project(), '--build');
    expect(calls()).toEqual(['npx react-router build (production)', 'npx vite preview --port 3000 (production)']);
  });
});
