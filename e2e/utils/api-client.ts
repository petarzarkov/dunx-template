export interface ApiResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
}

/**
 * Authenticates the way any non-browser client does: the bearer token better-auth's
 * `bearer()` plugin hands back from a sign-in, in an `Authorization` header. There
 * is no test-only door and no `x-actor-id` header any more - the suite goes through
 * the same `SessionGuard` as production.
 */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
  ) {}

  as(token: string | undefined): ApiClient {
    return new ApiClient(this.baseUrl, token);
  }

  url(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\//, '')}`;
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token !== undefined) {
      headers.set('authorization', `Bearer ${this.token}`);
    }
    if (typeof init.body === 'string' && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return fetch(this.url(path), { ...init, headers });
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
    const response = await this.raw(path, init);
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: (text === '' ? undefined : JSON.parse(text)) as T,
    };
  }

  post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.json<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }
}
