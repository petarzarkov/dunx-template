import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

describe('service endpoints against a live server', () => {
  test('liveness', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.json<{ uptimeSeconds: number }>(
      'service/up',
    );
    expect(status).toBe(200);
    expect(body.uptimeSeconds).toBeGreaterThan(0);
  });

  test('readiness reports the real SQLite file up', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.json<{
      status: string;
      info: Record<string, { status: string }>;
    }>('service/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.info['db']?.status).toBe('up');
  });

  test('a logged response carries a request id', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('service/config');
    expect(headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('an inbound request id is echoed back', async () => {
    const { api } = getTestContext();
    const mine = crypto.randomUUID();
    const response = await api.raw('service/config', {
      headers: { 'x-request-id': mine },
    });
    expect(response.headers.get('x-request-id')).toBe(mine);
  });

  /**
   * Pins a coupling that is easy to trip over. `x-request-id` is emitted by
   * `RequestLoggingMiddleware`, so a path listed in `requestLogging.ignore`
   * loses correlation as well as its log line - and so does everything the
   * handler logs, because the `AsyncLocalStorage` scope is never opened.
   * `/service/up` and `/service/health` are both ignored here.
   */
  test('KNOWN GAP: an ignored path gets no request id', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('service/up');
    expect(headers.get('x-request-id')).toBeNull();
  });
});
