import { ACTOR_HEADER } from '../../src/constants.js';

export interface ApiResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private actorId: string | undefined,
  ) {}

  as(actorId: string | undefined): ApiClient {
    return new ApiClient(this.baseUrl, actorId);
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.actorId !== undefined) headers.set(ACTOR_HEADER, this.actorId);
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return fetch(`${this.baseUrl}/${path.replace(/^\//, '')}`, {
      ...init,
      headers,
    });
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
