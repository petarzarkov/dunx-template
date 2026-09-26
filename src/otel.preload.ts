import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from '@opentelemetry/sdk-trace-node';

/**
 * The OpenTelemetry SDK `OtelModule` reports to. dunx never configures one, so
 * the app does, here. A preload rather than an import in `main.ts`, so the web
 * process, `bun run worker` and the sandboxed image worker each register their
 * own before anything opens a span.
 *
 * With `OTEL_EXPORTER_OTLP_ENDPOINT` unset nothing is registered: every span is
 * the API's non-recording one, dunx keeps minting the trace ids it logs, and the
 * cost is nothing. The exporter reads that variable itself, with every other
 * `OTEL_EXPORTER_OTLP_*` setting, so none of them is restated in config.
 */
const provider = Bun.env['OTEL_EXPORTER_OTLP_ENDPOINT']
  ? new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': Bun.env['OTEL_SERVICE_NAME'] ?? 'dunx-template',
      }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    })
  : undefined;
provider?.register();

/**
 * Exports the last batch. `main.ts` and `worker.ts` end with `process.exit()`,
 * which never emits `beforeExit`, so they call this first.
 */
export const flushTraces = async (): Promise<void> => {
  await provider?.shutdown();
};
