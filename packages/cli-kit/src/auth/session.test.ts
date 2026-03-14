import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSession } from './session.js';

vi.mock('./token-store.js', () => ({
  getStoreCredentials: vi.fn(),
  getCurrentStore: vi.fn(),
}));

vi.mock('./login.js', () => ({
  loginWithBrowser: vi.fn(),
}));

vi.mock('../ui/prompt.js', () => ({
  promptInput: vi.fn(),
}));

vi.mock('../output/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('../ui/colors.js', () => ({
  colors: { bold: (s: string) => s, dim: (s: string) => s },
}));

vi.mock('../output/format.js', () => ({
  formatStoreUrl: (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
}));

import { getStoreCredentials, getCurrentStore } from './token-store.js';

describe('getSession', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.CLOUDCART_CLI_TOKEN;
    delete process.env.CLOUDCART_CLI_STORE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses CLOUDCART_CLI_TOKEN env var when set', async () => {
    process.env.CLOUDCART_CLI_TOKEN = 'cc_pat_env123';
    process.env.CLOUDCART_CLI_STORE = 'env-store.cloudcart.com';

    const session = await getSession();

    expect(session.source).toBe('env');
    expect(session.credentials.token).toBe('cc_pat_env123');
    expect(session.credentials.type).toBe('pat');
    expect(session.storeUrl).toBe('env-store.cloudcart.com');
  });

  it('detects JWT token type from env var', async () => {
    process.env.CLOUDCART_CLI_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test';
    process.env.CLOUDCART_CLI_STORE = 'shop.cloudcart.com';

    const session = await getSession();

    expect(session.credentials.type).toBe('jwt');
  });

  it('env var falls back to current store if CLOUDCART_CLI_STORE not set', async () => {
    process.env.CLOUDCART_CLI_TOKEN = 'cc_pat_env123';
    vi.mocked(getCurrentStore).mockResolvedValue('saved-store.cloudcart.com');

    const session = await getSession();

    expect(session.storeUrl).toBe('saved-store.cloudcart.com');
  });

  it('throws when env token set but no store URL anywhere', async () => {
    process.env.CLOUDCART_CLI_TOKEN = 'cc_pat_env123';
    vi.mocked(getCurrentStore).mockResolvedValue(undefined);

    await expect(getSession()).rejects.toThrow('CLOUDCART_CLI_TOKEN is set but no store URL found');
  });

  it('option storeUrl overrides env store', async () => {
    process.env.CLOUDCART_CLI_TOKEN = 'cc_pat_env123';
    process.env.CLOUDCART_CLI_STORE = 'env-store.cloudcart.com';

    const session = await getSession({ storeUrl: 'override.cloudcart.com' });

    expect(session.storeUrl).toBe('override.cloudcart.com');
  });

  it('returns stored credentials when no env var', async () => {
    vi.mocked(getCurrentStore).mockResolvedValue('shop.cloudcart.com');
    vi.mocked(getStoreCredentials).mockResolvedValue({
      token: 'cc_pat_stored',
      type: 'pat',
    });

    const session = await getSession();

    expect(session.source).toBe('keychain');
    expect(session.credentials.token).toBe('cc_pat_stored');
  });

  it('throws when no credentials and autoPrompt is false', async () => {
    vi.mocked(getCurrentStore).mockResolvedValue(undefined);

    await expect(getSession()).rejects.toThrow('No store configured');
  });

  it('throws with helpful message including env var hint', async () => {
    vi.mocked(getCurrentStore).mockResolvedValue('shop.cloudcart.com');
    vi.mocked(getStoreCredentials).mockResolvedValue(null);

    await expect(getSession()).rejects.toThrow('CLOUDCART_CLI_TOKEN');
  });

  it('accepts string argument for backward compatibility', async () => {
    vi.mocked(getStoreCredentials).mockResolvedValue({
      token: 'cc_pat_test',
      type: 'pat',
    });

    const session = await getSession('mystore.cloudcart.com');

    expect(session.storeUrl).toBe('mystore.cloudcart.com');
  });

  it('trims whitespace from env token', async () => {
    process.env.CLOUDCART_CLI_TOKEN = '  cc_pat_trimmed  ';
    process.env.CLOUDCART_CLI_STORE = 'shop.cloudcart.com';

    const session = await getSession();

    expect(session.credentials.token).toBe('cc_pat_trimmed');
  });
});
