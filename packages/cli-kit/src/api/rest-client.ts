export interface RestClientOptions {
  storeUrl: string;
  token: string;
}

export class RestClient {
  private baseUrl: string;
  private token: string;

  constructor(options: RestClientOptions) {
    this.baseUrl = options.storeUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api2${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`REST request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}
