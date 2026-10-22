import {
  CLIError,
  ExitCode,
  NetworkError,
  RateLimitError,
  AuthenticationError,
  ServerUnavailableError,
  TimeoutError,
} from '../error/types.js';
import { truncate } from '../output/format.js';

/** How long a call waits for the store's whole answer unless told otherwise (B-548). */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** The answers that mean "not now" rather than "never": the store, or what stands in front of it, is unavailable. */
const UNAVAILABLE = new Set([502, 503, 504]);

export interface GraphQLClientOptions {
  storeUrl: string;
  token: string;
  apiVersion?: string;
  /** How long a call waits for the store's answer, its body included */
  timeoutMs?: number;
}

export interface GraphQLResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
}

export class GraphQLClient {
  private baseUrl: string;
  private token: string;
  private apiVersion: string;
  private timeoutMs: number;

  constructor(options: GraphQLClientOptions) {
    this.baseUrl = options.storeUrl.replace(/\/$/, '');
    this.token = options.token;
    this.apiVersion = options.apiVersion ?? '2026-01';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async query<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResponse<T>> {
    return this.send<T>(query, variables, false);
  }

  /** Sends a document with a mutation: a failure that may have come after it ran is never marked retryable. */
  async mutation<T = Record<string, unknown>>(
    mutation: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResponse<T>> {
    return this.send<T>(mutation, variables, true);
  }

  private async send<T>(
    document: string,
    variables: Record<string, unknown> | undefined,
    mutation: boolean,
  ): Promise<GraphQLResponse<T>> {
    const url = `${this.baseUrl}/api/gql`;
    const signal = AbortSignal.timeout(this.timeoutMs);
    const timedOut = () => new TimeoutError(this.timeoutMs / 1000, { mutation });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          'X-API-Version': this.apiVersion,
        },
        body: JSON.stringify({ query: document, variables }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw timedOut();
      throw new NetworkError(
        `Could not connect to ${this.baseUrl}. ${error instanceof Error ? error.message : ''}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError(
        `Authentication failed (HTTP ${response.status}). Token may be invalid or expired.`,
      );
    }

    if (response.status === 429) {
      throw new RateLimitError(retryAfterSeconds(response));
    }

    if (!response.ok) {
      const said = await storeMessage(response);
      const message = `GraphQL request failed: ${response.status} ${response.statusText}${said ? `: ${said}` : ''}`;
      if (UNAVAILABLE.has(response.status)) {
        throw new ServerUnavailableError(message, {
          mutation,
          retryAfterSeconds: retryAfterSeconds(response),
        });
      }
      throw new GraphQLRequestError(message, response.status);
    }

    try {
      return (await response.json()) as GraphQLResponse<T>;
    } catch (error) {
      if (signal.aborted) throw timedOut();
      throw error;
    }
  }
}

/** Any other answer the store refused: not retryable, its own message kept. */
export class GraphQLRequestError extends CLIError {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message, { type: 'http_error', retryable: false, exitCode: ExitCode.GENERAL });
    this.name = 'GraphQLRequestError';
  }
}

/** The messages of a refused answer's JSON body (`errors[].message` or `message`); nothing for any other body. */
async function storeMessage(response: Response): Promise<string | undefined> {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null) return undefined;
  const { errors, message } = body as { errors?: unknown; message?: unknown };
  const messages = Array.isArray(errors)
    ? errors
        .map((e) => (e as { message?: unknown } | null)?.message)
        .filter((m): m is string => typeof m === 'string')
    : typeof message === 'string'
      ? [message]
      : [];
  return messages.length ? truncate(messages.join('; '), 500) : undefined;
}

/** `Retry-After` in whole seconds, sent as seconds or as an HTTP date; nothing when absent or unreadable. */
function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}
