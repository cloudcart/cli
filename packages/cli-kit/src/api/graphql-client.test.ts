import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphQLClient, GraphQLRequestError } from './graphql-client.js';
import {
  AuthenticationError,
  ExitCode,
  MUTATION_MAY_HAVE_RUN,
  NetworkError,
  RateLimitError,
  toStructuredError,
} from '../error/types.js';

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(mockResponse))));

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
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual(mockResponse);
  });

  it('sends variables when provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }))));

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429, statusText: 'Too Many Requests' })));

    const client = new GraphQLClient(options);
    await expect(client.query('{ __typename }')).rejects.toThrow(RateLimitError);
  });

  it('throws GraphQLRequestError on other non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500, statusText: 'Internal Server Error' })));

    const client = new GraphQLClient(options);
    await expect(client.query('{ __typename }')).rejects.toThrow(GraphQLRequestError);
  });

  it('throws NetworkError on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));

    const client = new GraphQLClient(options);
    await expect(client.query('{ __typename }')).rejects.toThrow(NetworkError);
  });

  it('strips trailing slash from store URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }))));

    const client = new GraphQLClient({ ...options, storeUrl: 'https://mystore.cloudcart.com/' });
    await client.query('{ __typename }');

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://mystore.cloudcart.com/api/gql');
  });

  it('uses custom API version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }))));

    const client = new GraphQLClient({ ...options, apiVersion: '2025-10' });
    await client.query('{ __typename }');

    const call = vi.mocked(fetch).mock.calls[0];
    expect((call[1]!.headers as Record<string, string>)['X-API-Version']).toBe('2025-10');
  });

  it('mutation delegates to query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { productCreate: { id: '1' } } }))));

    const client = new GraphQLClient(options);
    const result = await client.mutation('mutation { productCreate { id } }');
    expect(result.data).toEqual({ productCreate: { id: '1' } });
  });
});

/** A store that answers once with this status, body and headers. */
function answering(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { status, statusText: 'Status', headers })));
}

/** What a failed call tells an assistant, as `--json` prints it. */
async function failure(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return toStructuredError(error);
  }
  throw new Error('the call did not fail');
}

describe('GraphQLClient, a store that does not answer (B-548)', () => {
  const options = { storeUrl: 'https://mystore.cloudcart.com', token: 'cc_pat_test123', timeoutMs: 50 };

  /** A store that takes the request and never answers: the call ends only by its signal. */
  function hanging() {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })));
  }

  it('ends after the set time with a retryable timeout, exit 7', async () => {
    hanging();
    const s = await failure(new GraphQLClient(options).query('{ __typename }'));
    expect(s).toMatchObject({ type: 'timeout', retryable: true, exitCode: 7 });
    expect(s.message).toContain('0.05 s');
  });

  it('never marks a timed-out mutation retryable', async () => {
    hanging();
    const s = await failure(new GraphQLClient(options).mutation('mutation { productDelete(id: 1) }'));
    expect(s).toMatchObject({ type: 'timeout', retryable: false, hint: MUTATION_MAY_HAVE_RUN });
  });

  it('counts the body too: a body that stops midway ends as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      text: () => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
    })));
    expect(await failure(new GraphQLClient(options).query('{ __typename }'))).toMatchObject({ type: 'timeout' });
  });

  it('waits 15 s by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"data":{}}')));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await new GraphQLClient({ storeUrl: options.storeUrl, token: options.token }).query('{ __typename }');
    expect(timeout).toHaveBeenCalledWith(15_000);
  });
});

describe('GraphQLClient, a refused answer (B-549)', () => {
  const options = { storeUrl: 'https://mystore.cloudcart.com', token: 'cc_pat_test123' };

  it('calls a 503 unavailable and retryable for a query, with the store\'s message, exit 7', async () => {
    answering(503, { errors: [{ message: 'Down for maintenance' }] });
    const s = await failure(new GraphQLClient(options).query('{ __typename }'));
    expect(s).toMatchObject({ type: 'server_unavailable', retryable: true, exitCode: 7 });
    expect(s.message).toContain('503');
    expect(s.message).toContain('Down for maintenance');
  });

  it('never marks a mutation retryable after a 502, 503 or 504', async () => {
    for (const status of [502, 503, 504]) {
      answering(status, '<html>gateway</html>');
      const s = await failure(new GraphQLClient(options).mutation('mutation { productDelete(id: 1) }'));
      expect(s).toMatchObject({ type: 'server_unavailable', retryable: false, hint: MUTATION_MAY_HAVE_RUN, exitCode: 7 });
      expect(s.message).not.toContain('<html>');
    }
  });

  it('keeps a 500\'s message and does not call it retryable, exit 1', async () => {
    answering(500, { message: 'Server Error' });
    const s = await failure(new GraphQLClient(options).query('{ __typename }'));
    expect(s).toMatchObject({ type: 'http_error', retryable: false, exitCode: 1 });
    expect(s.message).toBe('GraphQL request failed: 500 Status: Server Error');
  });

  it('passes on a 429\'s Retry-After, in seconds or as a date', async () => {
    answering(429, '', { 'Retry-After': '30' });
    expect(await failure(new GraphQLClient(options).query('{ __typename }'))).toMatchObject({
      type: 'rate_limited', retryable: true, retryAfterSeconds: 30, exitCode: 6,
    });

    answering(429, '', { 'Retry-After': new Date(Date.now() + 90_000).toUTCString() });
    const s = await failure(new GraphQLClient(options).query('{ __typename }'));
    expect(s.retryAfterSeconds).toBeGreaterThanOrEqual(89);
    expect(s.retryAfterSeconds).toBeLessThanOrEqual(90);
  });

  it('says nothing of a wait the store did not name', async () => {
    answering(429, '');
    expect(await failure(new GraphQLClient(options).query('{ __typename }'))).not.toHaveProperty('retryAfterSeconds');
  });
});

describe('GraphQLClient, an answer that is not the API (B-551)', () => {
  const options = { storeUrl: 'https://mystore.cloudcart.com', token: 'cc_pat_test123' };

  it('names a 200 page that is not JSON by its status and content type, never printing it, exit 1', async () => {
    answering(200, '<!doctype html><html><body>Welcome</body></html>', { 'Content-Type': 'text/html; charset=UTF-8' });
    const s = await failure(new GraphQLClient(options).query('{ __typename }'));
    expect(s).toMatchObject({ type: 'unexpected_answer', retryable: false, exitCode: ExitCode.GENERAL });
    expect(s.message).toBe("The store answered HTTP 200 with text/html, not the Admin API's JSON.");
  });

  it('treats a JSON array, a bare value and an empty body the same', async () => {
    for (const body of ['[1, 2]', '"ok"', '']) {
      answering(200, body);
      expect(await failure(new GraphQLClient(options).query('{ __typename }'))).toMatchObject({ type: 'unexpected_answer' });
    }
  });

  it('still answers with the API\'s JSON, errors included', async () => {
    answering(200, { errors: [{ message: 'Cannot query field "x" on type "Query".' }] });
    expect(await new GraphQLClient(options).query('{ x }')).toEqual({ errors: [{ message: 'Cannot query field "x" on type "Query".' }] });
  });
});

describe('GraphQLClient, a connection that broke (B-553)', () => {
  const options = { storeUrl: 'https://mystore.cloudcart.com', token: 'cc_pat_test123' };

  /** `fetch` failing as Node 24's does: a TypeError whose cause carries the code (measured in T-607). */
  function failingWith(cause: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause });
    }));
  }

  it('calls a mutation retryable when nothing was sent: refused, no such host, a refused certificate', async () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'DEPTH_ZERO_SELF_SIGNED_CERT']) {
      failingWith({ code });
      expect(await failure(new GraphQLClient(options).mutation('mutation { productDelete(id: 1) }'))).toMatchObject({
        type: 'network_error', retryable: true, exitCode: 7,
      });
    }
  });

  it('never calls a mutation retryable when the socket closed after the request', async () => {
    failingWith({ name: 'SocketError', code: 'UND_ERR_SOCKET', message: 'other side closed' });
    expect(await failure(new GraphQLClient(options).mutation('mutation { productDelete(id: 1) }'))).toMatchObject({
      type: 'network_error', retryable: false, hint: MUTATION_MAY_HAVE_RUN, exitCode: 7,
    });
  });

  it('reads every code of an AggregateError: one that may have sent makes the mutation not retryable', async () => {
    failingWith({ name: 'AggregateError', errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] });
    expect((await failure(new GraphQLClient(options).mutation('mutation { a }'))).retryable).toBe(true);
    failingWith({ name: 'AggregateError', errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNRESET' }] });
    expect((await failure(new GraphQLClient(options).mutation('mutation { a }'))).retryable).toBe(false);
  });

  it('calls a mutation with no code to read not retryable, and a read retryable whatever broke', async () => {
    failingWith({});
    expect((await failure(new GraphQLClient(options).mutation('mutation { a }'))).retryable).toBe(false);
    failingWith({ code: 'UND_ERR_SOCKET' });
    expect((await failure(new GraphQLClient(options).query('{ a }'))).retryable).toBe(true);
  });
});

