import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@cloudcart/cli-kit';
import NitrogenLink from './link.js';

const storefront = {
  id: 'gid-1',
  name: 'Main',
  handle: 'main',
  novaHostname: 'main.nova.example',
  deploymentMethod: 'cli',
  repository: null,
  defaultBranch: null,
  storefrontScopes: [],
};
let found: typeof storefront | null = storefront;
let refused: Array<{ message: string }> | undefined;
const queries: string[] = [];

vi.mock('@cloudcart/cli-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudcart/cli-kit')>()),
  printBanner: () => {},
  getSession: vi.fn(async () => ({ storeUrl: 'shop.example.com' })),
  createGraphQLClient: () => ({
    query: async (query: string) => {
      const name = /query (\w+)/.exec(query)?.[1] ?? '';
      queries.push(name);
      return name === 'FindStorefront'
        ? { data: { nitrogenStorefrontByName: refused ? null : found }, errors: refused }
        : { data: { nitrogenStorefronts: { edges: [{ node: { id: 'gid-1', name: 'Main', handle: 'main', novaHostname: null } }] } } };
    },
  }),
}));

const folders: string[] = [];
let output: string[] = [];

beforeEach(() => {
  output = [];
  found = storefront;
  refused = undefined;
  queries.length = 0;
  for (const method of ['log', 'error', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(args.join(' ')));
  }
});

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.mocked(getSession).mockClear();
});

function project(linked?: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'nitrogen-link-test-'));
  folders.push(root);
  if (linked) {
    mkdirSync(join(root, '.cloudcart'));
    writeFileSync(join(root, '.cloudcart/project.json'), JSON.stringify(linked));
  }
  return root;
}

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const link = (...argv: string[]) => new NitrogenLink(argv, config as never).run();
const linked = (root: string) => JSON.parse(readFileSync(join(root, '.cloudcart/project.json'), 'utf-8'));

describe('nitrogen link', () => {
  it('writes the storefront it finds into .cloudcart/project.json, and no token', async () => {
    const root = project({ store: 'old.example.com', publicToken: 'an-old-public-token' });
    await link('--path', root, '--storefront', 'Main', '--force');

    expect(linked(root)).toMatchObject({ store: 'shop.example.com', storefrontId: 'gid-1', storefrontName: 'Main', handle: 'main' });
    expect(linked(root)).not.toHaveProperty('publicToken');
    expect(output.join('\n')).toContain('env pull');
  });

  it('fails with the store\'s storefronts when the name is not one of them', async () => {
    found = null;
    const root = project();
    await expect(link('--path', root, '--storefront', 'Missing')).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(queries).toEqual(['FindStorefront', 'ListStorefronts']);
    expect(output.join('\n')).toContain('Storefront "Missing" not found on shop.example.com.');
    expect(output.join('\n')).toContain('Main');
  });

  it("says what the store said when it refused the request, not that the storefront is missing (B-505)", async () => {
    refused = [{ message: 'This action is unauthorized.' }];
    const root = project();
    await expect(link('--path', root, '--storefront', 'Main')).rejects.toMatchObject({ oclif: { exit: 1 } });

    expect(queries).toEqual(['FindStorefront']);
    expect(output.join('\n')).toContain('shop.example.com refused the request: This action is unauthorized.');
    expect(output.join('\n')).not.toContain('not found');
  });

  it('keeps an existing link without --force, and asks nothing', async () => {
    const root = project({ store: 'shop.example.com', storefrontId: 'gid-1', storefrontName: 'Main' });
    await link('--path', root, '--storefront', 'Other');

    expect(getSession).not.toHaveBeenCalled();
    expect(linked(root).storefrontId).toBe('gid-1');
    expect(output.join('\n')).toContain('Use --force to overwrite.');
  });
});
