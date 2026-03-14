import { NetworkError, RateLimitError, AuthenticationError } from '../error/types.js';

export interface GraphQLClientOptions {
  storeUrl: string;
  token: string;
  apiVersion?: string;
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

  constructor(options: GraphQLClientOptions) {
    this.baseUrl = options.storeUrl.replace(/\/$/, '');
    this.token = options.token;
    this.apiVersion = options.apiVersion ?? '2026-01';
  }

  async query<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResponse<T>> {
    const url = `${this.baseUrl}/api/gql`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          'X-API-Version': this.apiVersion,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
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
      throw new RateLimitError();
    }

    if (!response.ok) {
      throw new GraphQLRequestError(
        `GraphQL request failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    return (await response.json()) as GraphQLResponse<T>;
  }

  async mutation<T = Record<string, unknown>>(
    mutation: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResponse<T>> {
    return this.query<T>(mutation, variables);
  }
}

export class GraphQLRequestError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'GraphQLRequestError';
  }
}
