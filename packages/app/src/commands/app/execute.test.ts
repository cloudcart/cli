import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGraphQLClient, getSession } from '@cloudcart/cli-kit';
import AppExecute from './execute.js';

// Mock @cloudcart/cli-kit
vi.mock('@cloudcart/cli-kit', () => ({
  getSession: vi.fn().mockResolvedValue({
    storeUrl: 'https://test.cloudcart.com',
    token: 'cc_pat_test',
    source: 'config',
  }),
  createGraphQLClient: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({ data: { shop: { name: 'Test' } } }),
  }),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  colors: {
    dim: (s: string) => s,
  },
  formatJson: (obj: unknown) => JSON.stringify(obj, null, 2),
  toStructuredError: (err: unknown) => ({
    type: 'unexpected_error',
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  }),
  ExitCode: { SUCCESS: 0, GENERAL: 1, USAGE: 2, NOT_FOUND: 3, AUTH: 4, CONFLICT: 5, RATE_LIMITED: 6, NETWORK: 7 },
}));

// Mock @oclif/core to avoid the full framework
vi.mock('@oclif/core', async () => {
  const { Command: RealCommand, Flags: RealFlags } = await vi.importActual<typeof import('@oclif/core')>('@oclif/core');
  return { Command: RealCommand, Flags: RealFlags };
});

describe('AppExecute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has the correct description', () => {
    expect(AppExecute.description).toContain('GraphQL');
  });

  it('defines required flags', () => {
    const flags = AppExecute.flags;
    expect(flags).toHaveProperty('query');
    expect(flags).toHaveProperty('file');
    expect(flags).toHaveProperty('variables');
    expect(flags).toHaveProperty('store');
    expect(flags).toHaveProperty('json');
    expect(flags).toHaveProperty('compact-output');
  });

  it('has examples', () => {
    expect(AppExecute.examples.length).toBeGreaterThan(0);
  });

  it('query and file flags are mutually exclusive', () => {
    const queryFlag = AppExecute.flags.query as { exclusive?: string[] };
    const fileFlag = AppExecute.flags.file as { exclusive?: string[] };
    expect(queryFlag.exclusive).toContain('file');
    expect(fileFlag.exclusive).toContain('query');
  });
});

describe('app execute, the exit code (B-505)', () => {
  const config = { runHook: async () => ({ successes: [], failures: [] }) };
  // The describe above restores every mock before each of its tests, so the session is set here again.
  const answer = (result: unknown) => {
    vi.mocked(getSession).mockResolvedValue({ storeUrl: 'https://test.cloudcart.com' } as never);
    vi.mocked(createGraphQLClient).mockReturnValue({ query: vi.fn().mockResolvedValue(result) } as never);
  };
  async function exitCode(...argv: string[]): Promise<number> {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await new AppExecute(argv, config as never).run();
      return 0;
    } catch (error) {
      return (error as { oclif?: { exit?: number } }).oclif?.exit ?? -1;
    }
  }

  it('is 0 for an answer without errors', async () => {
    answer({ data: { shop: { name: 'Test' } } });
    expect(await exitCode('--query', '{ shop { name } }')).toBe(0);
    expect(await exitCode('--query', '{ shop { name } }', '--json')).toBe(0);
  });

  it('is 1 for an answer with errors, as text or JSON', async () => {
    answer({ errors: [{ message: 'Cannot query field "nme" on type "Shop".' }] });
    expect(await exitCode('--query', '{ shop { nme } }')).toBe(1);
    expect(await exitCode('--query', '{ shop { nme } }', '--json')).toBe(1);
  });
});

