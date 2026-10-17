import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontVariable } from '../../../lib/storefront-env.js';

// A made-up value, new on every run.
const SECRET = randomBytes(12).toString('hex');
let variables: StorefrontVariable[] = [];
let storefrontFound = true;

vi.mock('@cloudcart/cli-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudcart/cli-kit')>()),
  printBanner: () => {},
  getSession: async () => ({}),
  createGraphQLClient: () => ({
    query: async () => ({
      data: { nitrogenStorefront: storefrontFound ? { id: 'storefront-1', name: 'Main', environmentVariables: variables } : null },
    }),
  }),
}));

const { default: NitrogenEnvList } = await import('./list.js');

const folders: string[] = [];
let output: string[] = [];

beforeEach(() => {
  output = [];
  storefrontFound = true;
  variables = [
    { key: 'API_URL', value: 'https://production.example.invalid', environment: 'production', isSecret: false, isSystem: false },
    { key: 'PUBLIC_STORE_DOMAIN', value: 'shop.example.com', environment: 'all', isSecret: false, isSystem: true },
    // A secret as the API returns it, and one whose value a broken server might send: neither is printed.
    { key: 'PRIVATE_STOREFRONT_API_TOKEN', value: '********', environment: 'all', isSecret: true, isSystem: true },
    { key: 'PAYMENT_KEY', value: SECRET, environment: 'production', isSecret: true, isSystem: false },
    { key: 'PREVIEW_FLAG', value: 'on', environment: 'preview', isSecret: false, isSystem: false },
  ];
  for (const method of ['log', 'error', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(args.join(' ')));
  }
});

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function project(linked = true): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-env-list-test-'));
  folders.push(root);
  if (linked) {
    mkdirSync(join(root, '.cloudcart'));
    writeFileSync(join(root, '.cloudcart/project.json'), JSON.stringify({ store: 'shop.example.com', storefrontId: 'storefront-1' }));
  }
  return root;
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const list = (...argv: string[]) => new NitrogenEnvList(argv, config as never).run();
/** The listed rows: key, environment, value. */
const rows = () => output.filter((line) => /^ {2}[A-Z]/.test(line)).map((line) => line.trim().split(/\s+/).slice(0, 3).join(' '));

describe('nitrogen env list', () => {
  it("lists the storefront's variables, system first, a secret's value masked", async () => {
    await list('--path', project());

    expect(rows()).toEqual([
      'PRIVATE_STOREFRONT_API_TOKEN all ••••',
      'PUBLIC_STORE_DOMAIN all shop.example.com',
      'API_URL production https://production.example.invalid',
      'PAYMENT_KEY production ••••',
      'PREVIEW_FLAG preview on',
    ]);
    expect(output.join('\n')).not.toContain(SECRET);
    expect(output.join('\n')).not.toContain('********');
  });

  it('lists what a deployment of one environment binds', async () => {
    await list('--path', project(), '--env', 'preview');

    expect(rows().map((row) => row.split(' ')[0])).toEqual(['PRIVATE_STOREFRONT_API_TOKEN', 'PUBLIC_STORE_DOMAIN', 'PREVIEW_FLAG']);
  });

  it('refuses an environment CloudCart does not have', async () => {
    await expect(list('--path', project(), '--env', 'staging')).rejects.toThrow('Expected --env=staging to be one of: all, production, preview');
  });

  it('fails without a link, and when the storefront is gone', async () => {
    await expect(list('--path', project(false))).rejects.toMatchObject({ oclif: { exit: 1 } });
    expect(output.join('\n')).toContain('No store linked');

    storefrontFound = false;
    await expect(list('--path', project())).rejects.toMatchObject({ oclif: { exit: 1 } });
    expect(output.join('\n')).toContain('Storefront not found');
  });
});
