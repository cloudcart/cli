import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loginWithPAT } from './login.js';

vi.mock('./token-store.js', () => ({
  saveStoreCredentials: vi.fn(),
}));

describe('loginWithPAT', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects tokens without cc_pat_ prefix', async () => {
    await expect(
      loginWithPAT({ token: 'bad_token', storeUrl: 'shop.cloudcart.com' }),
    ).rejects.toThrow('Invalid token format');
  });

  it('normalizes store URL — strips protocol and trailing slash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { __typename: 'Query' } }),
    }));

    await loginWithPAT({
      token: 'cc_pat_test123',
      storeUrl: 'https://shop.cloudcart.com/',
    });

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://shop.cloudcart.com/api/gql');
  });

  it('trims whitespace from token and URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { __typename: 'Query' } }),
    }));

    const result = await loginWithPAT({
      token: '  cc_pat_test123  ',
      storeUrl: '  shop.cloudcart.com  ',
    });

    expect(result.token).toBe('cc_pat_test123');
  });

  it('validates token against the store API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { __typename: 'Query' } }),
    }));

    const result = await loginWithPAT({
      token: 'cc_pat_test123',
      storeUrl: 'shop.cloudcart.com',
    });

    expect(result.type).toBe('pat');
    expect(result.token).toBe('cc_pat_test123');
  });

  it('gives specific error for 401/403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }));

    await expect(
      loginWithPAT({ token: 'cc_pat_test123', storeUrl: 'shop.cloudcart.com' }),
    ).rejects.toThrow('Invalid or expired token');
  });

  it('gives helpful error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND bad.url')));

    await expect(
      loginWithPAT({ token: 'cc_pat_test123', storeUrl: 'bad.url' }),
    ).rejects.toThrow('Could not connect to bad.url');
  });

  it('rejects empty store URL', async () => {
    await expect(
      loginWithPAT({ token: 'cc_pat_test123', storeUrl: '  ' }),
    ).rejects.toThrow('Invalid store URL');
  });
});
