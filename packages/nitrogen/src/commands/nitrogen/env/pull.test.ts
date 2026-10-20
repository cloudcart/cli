import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from '../../../lib/project.js';

/** What the store answers instead of the storefront below, when a test sets it. */
let refusal: unknown;

vi.mock('@cloudcart/cli-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudcart/cli-kit')>()),
  printBanner: () => {},
  getSession: async () => ({}),
  createGraphQLClient: () => ({
    query: async () => refusal ?? ({
      data: {
        nitrogenStorefront: {
          id: 'storefront-1',
          name: 'Storefront',
          environmentVariables: [
            { key: 'PUBLIC_STORE_DOMAIN', value: 'shop.example.com', environment: 'all', isSecret: false, isSystem: true },
            { key: 'SESSION_SECRET', value: '', environment: 'all', isSecret: true, isSystem: true },
          ],
        },
        nitrogenStorefrontPrivateToken: { token: 'p'.repeat(40), maskedToken: null },
      },
    }),
  }),
}));

const { default: NitrogenEnvPull } = await import('./pull.js');

const folders: string[] = [];

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
  refusal = undefined;
});

/** A linked project whose `.env` holds the given session secret. */
function linkedProject(sessionSecret: string): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-pull-test-'));
  folders.push(root);
  mkdirSync(join(root, '.cloudcart'));
  writeFileSync(join(root, '.cloudcart/project.json'), JSON.stringify({ store: 'shop.example.com', storefrontId: 'storefront-1' }));
  writeFileSync(join(root, '.env'), `SESSION_SECRET=${sessionSecret}\n`);
  return root;
}

async function pull(root: string): Promise<{ env: Record<string, string>; output: string }> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')));
  // The command's only use of the CLI's configuration here: the hooks around parsing, of which there are none.
  const config = { runHook: async () => ({ successes: [], failures: [] }) };
  await new NitrogenEnvPull(['--path', root, '--force'], config as never).run();
  return { env: loadEnvFile(join(root, '.env')), output: lines.join('\n') };
}

describe('env pull and the session secret (B-461)', () => {
  it('replaces a secret shorter than Nitrogen accepts, naming the key only', async () => {
    const old = 's'.repeat(29);
    const { env, output } = await pull(linkedProject(old));

    expect(env.SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(output).toContain('SESSION_SECRET was shorter than 32 characters');
    expect(output).not.toContain(old);
    expect(output).not.toContain(env.SESSION_SECRET);
  });

  it('keeps a secret Nitrogen accepts', async () => {
    const kept = 'k'.repeat(64);
    const { env, output } = await pull(linkedProject(kept));

    expect(env.SESSION_SECRET).toBe(kept);
    expect(output).not.toContain('was shorter');
  });
});

describe('env pull when the store refuses (B-505)', () => {
  it("says what the store said, not that the storefront was deleted", async () => {
    refusal = {
      data: { nitrogenStorefront: null, nitrogenStorefrontPrivateToken: null },
      errors: [
        { message: 'This action is unauthorized.', path: ['nitrogenStorefront'] },
        { message: 'This action is unauthorized.', path: ['nitrogenStorefrontPrivateToken'] },
      ],
    };
    const root = linkedProject('s'.repeat(64));
    await expect(pull(root)).rejects.toMatchObject({ oclif: { exit: 1 } });
    const said = vi.mocked(console.error).mock.calls.flat().join('\n');

    expect(said).toContain('shop.example.com refused the request: This action is unauthorized.');
    expect(said).not.toContain('deleted');
  });
});

