import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGraphQLClient, getSession } from '@cloudcart/cli-kit';
import AppExecute, { hasMutation } from './execute.js';

// Mock @cloudcart/cli-kit
vi.mock('@cloudcart/cli-kit', async () => ({
  // The errors and their exit codes are the real ones.
  toStructuredError: (await vi.importActual<typeof import('@cloudcart/cli-kit')>('@cloudcart/cli-kit')).toStructuredError,
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

  it("is the error's own: 4 for a refused token, 6 rate limited, 7 the network, 1 anything else (B-487)", async () => {
    const { AuthenticationError, RateLimitError, NetworkError } = await vi.importActual<typeof import('@cloudcart/cli-kit')>('@cloudcart/cli-kit');
    const failing = (error: Error) => {
      vi.mocked(getSession).mockResolvedValue({ storeUrl: 'https://test.cloudcart.com' } as never);
      vi.mocked(createGraphQLClient).mockReturnValue({ query: vi.fn().mockRejectedValue(error) } as never);
    };
    failing(new AuthenticationError('Invalid or expired token'));
    expect(await exitCode('--query', '{ shop { name } }')).toBe(4);
    expect(await exitCode('--query', '{ shop { name } }', '--json')).toBe(4);
    failing(new RateLimitError());
    expect(await exitCode('--query', '{ shop { name } }')).toBe(6);
    failing(new NetworkError('getaddrinfo ENOTFOUND'));
    expect(await exitCode('--query', '{ shop { name } }')).toBe(7);
    failing(new Error('No credentials found'));
    expect(await exitCode('--query', '{ shop { name } }')).toBe(1);
  });
});

describe('app execute, a mutation and the wait (B-548, B-549)', () => {
  const config = { runHook: async () => ({ successes: [], failures: [] }) };
  let client: { query: ReturnType<typeof vi.fn>; mutation: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    client = { query: vi.fn().mockResolvedValue({ data: {} }), mutation: vi.fn().mockResolvedValue({ data: {} }) };
    vi.mocked(getSession).mockResolvedValue({ storeUrl: 'https://test.cloudcart.com' } as never);
    vi.mocked(createGraphQLClient).mockReturnValue(client as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  const run = (...argv: string[]) => new AppExecute(argv, config as never).run();

  it('sends a document with a mutation through mutation(), any other through query()', async () => {
    await run('--query', 'mutation { productDelete(id: 1) }', '--json');
    await run('--query', 'query A { products { id } } mutation B { productDelete(id: 1) }', '--json');
    expect(client.mutation).toHaveBeenCalledTimes(2);
    expect(client.query).not.toHaveBeenCalled();

    await run('--query', '{ products { id } }', '--json');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('finds a mutation by parsing, not by the word', () => {
    expect(hasMutation('# mutation\n{ products { id } }')).toBe(false);
    expect(hasMutation('{ mutationLog { id } }')).toBe(false);
    expect(hasMutation('  mutation Delete { productDelete(id: 1) }')).toBe(true);
    expect(hasMutation('mutation {')).toBe(false);
  });

  it('waits --timeout seconds, the default when not given, and refuses a wait outside 1–600', async () => {
    await run('--query', '{ products { id } }', '--timeout', '5', '--json');
    expect(vi.mocked(createGraphQLClient).mock.lastCall?.[1]).toEqual({ timeoutMs: 5000 });
    await run('--query', '{ products { id } }', '--json');
    expect(vi.mocked(createGraphQLClient).mock.lastCall?.[1]).toEqual({ timeoutMs: undefined });
    await expect(run('--query', '{ products { id } }', '--timeout', '0')).rejects.toThrow(/greater than or equal to 1/);
    await expect(run('--query', '{ products { id } }', '--timeout', '601')).rejects.toThrow(/less than or equal to 600/);
  });
});
