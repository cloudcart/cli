import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontVariable } from '../../../lib/storefront-env.js';

// A made-up value, new on every run.
const LOCAL_SECRET = randomBytes(12).toString('hex');
const remote: StorefrontVariable[] = [
  { key: 'PUBLIC_STORE_DOMAIN', value: 'shop.example.com', environment: 'all', isSecret: false, isSystem: true },
  { key: 'API_URL', value: 'https://old.example.invalid', environment: 'production', isSecret: false, isSystem: false },
  { key: 'KEPT', value: 'x', environment: 'production', isSecret: false, isSystem: false },
];
const mutations: Array<Record<string, unknown>> = [];
let refusal: string | null = null;

vi.mock('@cloudcart/cli-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudcart/cli-kit')>()),
  printBanner: () => {},
  getSession: async () => ({}),
  createGraphQLClient: () => ({
    query: async () => ({ data: { nitrogenStorefront: { id: 'storefront-1', name: 'Main', environmentVariables: remote } } }),
    mutation: async (_document: string, variables: Record<string, unknown>) => {
      mutations.push(variables);
      if (refusal) return { data: null, errors: [{ message: refusal }] };
      const sent = variables.variables as Array<{ key: string }>;
      return { data: { batchSetNitrogenEnvironmentVariables: sent.map(({ key }) => ({ key, environment: 'production' })) } };
    },
  }),
}));

const { default: NitrogenEnvPush } = await import('./push.js');

const folders: string[] = [];
let output: string[] = [];

beforeEach(() => {
  output = [];
  mutations.length = 0;
  refusal = null;
  for (const method of ['log', 'error', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(args.join(' ')));
  }
});

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function project(env: string, linked = true): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-env-push-test-'));
  folders.push(root);
  if (linked) {
    mkdirSync(join(root, '.cloudcart'));
    writeFileSync(join(root, '.cloudcart/project.json'), JSON.stringify({ store: 'shop.example.com', storefrontId: 'storefront-1' }));
  }
  writeFileSync(join(root, '.env'), env);
  return root;
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const push = (...argv: string[]) => new NitrogenEnvPush(argv, config as never).run();
const ENV = `PUBLIC_STORE_DOMAIN=localhost\nSESSION_SECRET=local\nAPI_URL=https://new.example.invalid\nPAYMENT_KEY=${LOCAL_SECRET}\n`;

describe('nitrogen env push', () => {
  it('pushes the custom variables that differ, by key, and says what it kept (B-051)', async () => {
    await push('--path', project(ENV), '--force');

    expect(mutations).toEqual([
      {
        id: 'storefront-1',
        environment: 'PRODUCTION',
        variables: [
          { key: 'API_URL', value: 'https://new.example.invalid', isSecret: false },
          { key: 'PAYMENT_KEY', value: LOCAL_SECRET, isSecret: true },
        ],
      },
    ]);
    const text = output.join('\n');
    expect(text).toContain('~ API_URL');
    expect(text).toContain('+ PAYMENT_KEY');
    expect(text).toContain('- SESSION_SECRET (not sent');
    expect(text).toContain('- PUBLIC_STORE_DOMAIN (not sent: set by CloudCart)');
    expect(text).toContain('On CloudCart, not in .env (kept): KEPT');
    expect(text).toContain('2 variables set for "production" of Main on shop.example.com');
    expect(text).not.toContain(LOCAL_SECRET);
    expect(text).not.toContain('new.example.invalid');
  });

  it('counts one variable as one (B-485)', async () => {
    await push('--path', project('API_URL=https://new.example.invalid\n'), '--force');

    expect(output.join('\n')).toContain('1 variable set for "production"');
  });

  it('sends nothing when the environment already has the values', async () => {
    await push('--path', project('API_URL=https://old.example.invalid\n'), '--force');

    expect(mutations).toEqual([]);
    expect(output.join('\n')).toContain('Nothing to push');
  });

  it('asks nothing and pushes nothing without a terminal and without --force', async () => {
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from([]) as unknown as typeof process.stdin);
    await expect(push('--path', project(ENV))).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(mutations).toEqual([]);
    expect(output.join('\n')).toContain('Nothing pushed: run again with --force');
  });

  it("reports CloudCart's refusal and fails", async () => {
    refusal = 'PAYMENT_KEY: Maximum of 50 custom environment variables allowed per storefront. Nothing was set.';
    await expect(push('--path', project(ENV), '--force', '--env', 'production')).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(output.join('\n')).toContain(`Nothing pushed: ${refusal}`);
    expect(output.join('\n')).not.toContain('variables set');
  });

  it('fails without a link or a file', async () => {
    await expect(push('--path', project(ENV, false), '--force')).rejects.toMatchObject({ oclif: { exit: 1 } });
    expect(output.join('\n')).toContain('No store linked');

    await expect(push('--path', project(ENV), '--env-file', '.env.missing', '--force')).rejects.toMatchObject({ oclif: { exit: 1 } });
    expect(output.join('\n')).toContain('.env.missing not found.');
    expect(mutations).toEqual([]);
  });
});
