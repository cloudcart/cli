import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginWithBrowser, loginWithPAT, promptInput, promptSecret, promptSelect } from '@cloudcart/cli-kit';
import AuthLogin from './login.js';

vi.mock('@cloudcart/cli-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudcart/cli-kit')>()),
  printBanner: vi.fn(),
  promptInput: vi.fn(async () => 'shop.example.com'),
  promptSecret: vi.fn(async () => 'cc_pat_typed'),
  promptSelect: vi.fn(async () => 'Personal Access Token (for CI/CD and scripts)'),
  loginWithPAT: vi.fn(async () => ({ type: 'pat' })),
  loginWithBrowser: vi.fn(async () => ({ type: 'jwt' })),
  withSpinner: (_text: string, fn: () => Promise<unknown>) => fn(),
}));

const config = { runHook: async () => ({ successes: [], failures: [] }) };
const login = (...argv: string[]) => new AuthLogin(argv, config as never).run();

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('auth login (B-487)', () => {
  it('signs in with --store and --token, asking nothing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await login('--store', 'shop.example.com', '--token', 'cc_pat_given');

    expect(promptInput).not.toHaveBeenCalled();
    expect(promptSelect).not.toHaveBeenCalled();
    expect(promptSecret).not.toHaveBeenCalled();
    expect(vi.mocked(loginWithPAT).mock.calls[0][0]).toMatchObject({ token: 'cc_pat_given' });
    expect(loginWithBrowser).not.toHaveBeenCalled();
  });

  it('asks the method without a token', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await login('--store', 'shop.example.com');

    expect(promptSelect).toHaveBeenCalledOnce();
    expect(vi.mocked(loginWithPAT).mock.calls[0][0]).toMatchObject({ token: 'cc_pat_typed' });
  });
});
