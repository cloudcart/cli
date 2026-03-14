import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphQLClient, GraphQLRequestError } from './graphql-client.js';
import { AuthenticationError, NetworkError, RateLimitError } from '../error/types.js';

describe('GraphQLClient', () => {
  const options = {
    storeUrl: 'https://mystore.cloudcart.com',
    token: 'cc_pat_test123',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a query with correct headers', async () => {
    const mockResponse = { data: { __typename: 'Query' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const client = new GraphQLClient(options);
    const result = await client.query('{ __typename }');

    expect(fetch).toHaveBeenCalledWith('https://mystore.cloudcart.com/api/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer cc_pat_test123',
        'X-API-Version': '2026-01',
      },
      body: JSON.stringify({ query: '{ __typename }', variables: undefined }),
    });
    expect(result).toEqual(mockResponse);
  });

  it('sends variables when provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    }));

    const client = new GraphQLClient(options);
    await client.query('query($id: ID!) { node(id: $id) { id } }', { id: '123' });

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.variables).toEqual({ id: '123' });
  });

  it('throws AuthenticationError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }));

    const client = new GraphQLClient(options);
    await expect(client.query('{ __typename }')).rejects.toThrow(AuthenticationError);
  });

  it('throws AuthenticationError on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    }));

    const client = new GraphQLClient(options);
    await expect(client.query('{ __typename }')).rejects.toThrow(AuthenticationError);
  });

  it('throws RateLimitError on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    }));

    const client = new GraphQLClient(options);
    await expect(client.query('{ __typename }')).rejects.toThrow(RateLimitError);
  });

  it('throws GraphQLRequestError on other non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    const client = new GraphQLClient(options);
    await expect(client.query('{ __typename }')).rejects.toThrow(GraphQLRequestError);
  });

  it('throws NetworkError on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));

    const client = new GraphQLClient(options);
    await expect(client.query('{ __typename }')).rejects.toThrow(NetworkError);
  });

  it('strips trailing slash from store URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    }));

    const client = new GraphQLClient({ ...options, storeUrl: 'https://mystore.cloudcart.com/' });
    await client.query('{ __typename }');

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://mystore.cloudcart.com/api/gql');
  });

  it('uses custom API version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    }));

    const client = new GraphQLClient({ ...options, apiVersion: '2025-10' });
    await client.query('{ __typename }');

    const call = vi.mocked(fetch).mock.calls[0];
    expect((call[1]!.headers as Record<string, string>)['X-API-Version']).toBe('2025-10');
  });

  it('mutation delegates to query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { productCreate: { id: '1' } } }),
    }));

    const client = new GraphQLClient(options);
    const result = await client.mutation('mutation { productCreate { id } }');
    expect(result.data).toEqual({ productCreate: { id: '1' } });
  });
});
