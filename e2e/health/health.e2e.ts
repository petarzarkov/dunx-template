import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

interface HealthReport {
  status: string;
  draining: boolean;
  uptimeMs: number;
  checks: { name: string; state: string; critical: boolean; detail?: string }[];
}

describe('service endpoints against a live server', () => {
  test('liveness asks nothing and answers up', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.json<HealthReport>('health/live');
    expect(status).toBe(200);
    expect(body.status).toBe('up');
    expect(body.uptimeMs).toBeGreaterThan(0);
    // A process that answers is alive; readiness is where the probes are.
    expect(body.checks).toEqual([]);
  });

  test('readiness reports the real SQLite file up', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.json<HealthReport>('health/ready');
    expect(status).toBe(200);
    expect(body.status).toBe('up');
    expect(body.checks.find((c) => c.name === 'database')?.state).toBe('up');
  });

  /**
   * The whole point of `critical: false`, against a real server with no Redis
   * and no broker: the checks report themselves down and readiness still passes,
   * which is what the old `degraded` bucket meant.
   */
  test('a non-critical check can be down without failing readiness', async () => {
    const { api } = getTestContext();
    const { status, body } = await api.json<HealthReport>('health/ready');

    expect(status).toBe(200);
    for (const c of body.checks) {
      if (c.state !== 'up') expect(c.critical).toBe(false);
    }
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
   * `/health/live` and `/health/ready` are both ignored here.
   */
  test('KNOWN GAP: an ignored path gets no trace', async () => {
    const { api } = getTestContext();
    const { headers } = await api.json('health/live');
    expect(headers.get('traceresponse')).toBeNull();
  });
});
