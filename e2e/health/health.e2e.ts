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

  /**
   * W3C trace context, not `x-request-id`.
   *
   * dunx replaced the uuid request id with a real trace: the response header is
   * `traceresponse`, the inbound one is `traceparent`, and the log line carries
   * `traceId`/`spanId`/`traceFlags` where it used to carry `requestId`. Both are
   * `00-<32 hex>-<16 hex>-<2 hex>`.
   */
  test('a logged response carries a trace', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('service/config');
    expect(headers.get('traceresponse')).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
  });

  /**
   * An inbound trace is continued rather than replaced: the trace id is the
   * caller's, and the span id is this hop's own. That is the whole difference
   * between a trace and an echoed correlation header, so both halves are
   * asserted.
   */
  test('an inbound traceparent is continued, with a new span', async () => {
    const { api } = getTestContext();
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);

    const response = await api.raw('service/config', {
      headers: { traceparent: `00-${traceId}-${spanId}-01` },
    });

    const traceresponse = response.headers.get('traceresponse') ?? '';
    const [, received, span] = traceresponse.split('-');
    expect(received).toBe(traceId);
    expect(span).not.toBe(spanId);
  });

  /**
   * Pins a coupling that is easy to trip over. The trace is emitted by
   * `RequestLoggingMiddleware`, so a path listed in `requestLogging.ignore`
   * loses correlation as well as its log line - and so does everything the
   * handler logs, because the `AsyncLocalStorage` scope is never opened.
   * `/service/up` and `/service/health` are both ignored here.
   */
  test('KNOWN GAP: an ignored path gets no trace', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('service/up');
    expect(headers.get('traceresponse')).toBeNull();
  });
});
