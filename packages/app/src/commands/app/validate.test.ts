import { describe, it, expect, vi } from 'vitest';
import AppValidate from './validate.js';

vi.mock('@cloudcart/cli-kit', () => ({
  getSession: vi.fn(),
  createGraphQLClient: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  toStructuredError: (err: unknown) => ({
    type: 'unexpected_error',
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  }),
}));

describe('AppValidate', () => {
  it('has the correct description', () => {
    expect(AppValidate.description).toContain('Validate');
  });

  it('defines required flags', () => {
    const flags = AppValidate.flags;
    expect(flags).toHaveProperty('query');
    expect(flags).toHaveProperty('file');
    expect(flags).toHaveProperty('store');
    expect(flags).toHaveProperty('json');
  });

  it('has examples', () => {
    expect(AppValidate.examples.length).toBeGreaterThan(0);
  });

  it('query and file flags are mutually exclusive', () => {
    const queryFlag = AppValidate.flags.query as { exclusive?: string[] };
    const fileFlag = AppValidate.flags.file as { exclusive?: string[] };
    expect(queryFlag.exclusive).toContain('file');
    expect(fileFlag.exclusive).toContain('query');
  });

  it('json flag defaults to false', () => {
    const jsonFlag = AppValidate.flags.json as { default?: boolean };
    expect(jsonFlag.default).toBe(false);
  });
});
