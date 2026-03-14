import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
