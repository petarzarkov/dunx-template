import { inject, Logger } from '@dunx/core';
import { httpClient } from '@dunx/http/client';
import { AppConfigService } from '../../config/app.config.service.js';

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * The outbound transport, over `@dunx/http/client`.
 *
 * The NestJS template sent through Resend with React Email templates. Neither has a
 * dunx answer and neither should: Rule 1's second half says integrate the mature
 * library rather than invent one, and an email provider is a `POST` with a JSON
 * body. So this posts to `EMAIL_WEBHOOK_URL` and names no vendor - Resend,
 * Postmark, SES behind a function and an internal relay all accept that shape.
 *
 * **With no URL configured it logs the message it would have sent**, which keeps the
 * contract every other area here keeps: degrade rather than fail. The queue still
 * demonstrably delivers a job to a worker on a machine with nothing set up.
 *
 * ## Why the client rather than `fetch`
 *
 * `HttpService` is `fetch` underneath - a Web standard Bun implements natively, which
 * is why `axios` and `node-fetch` are banned. What it adds is the part every caller
 * otherwise rewrites slightly differently: a per-attempt timeout, retry with backoff
 * that honours `Retry-After`, request-id propagation out of `RequestContext` so the
 * outbound call carries the inbound request's id, and a failure that says which call
 * failed.
 *
 * Retries here happen *inside one job attempt*, with the queue's own policy on top -
 * three attempts, exponential backoff. That layering is deliberate: a 503 from the
 * provider is worth two quick retries before spending a whole job attempt on it.
 *
 * ## Why `inject()` rather than a constructor parameter
 *
 * A named client is bound to `httpClient('email')`, which is a `Token` and not a
 * class - so it cannot be a constructor parameter type, because there would be no
 * type name for `@dunx/transform` to record. `inject()` in a field initialiser is
 * the documented escape hatch for exactly that.
 *
 * Registered by name rather than as the default: `HttpModule.forRoot()` would claim
 * the app's one unnamed `HttpService`, and the first upstream an app happens to call
 * should not squat on it.
 */
export class EmailService {
  readonly #http = inject(httpClient('email'));

  constructor(
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  async send(email: Email): Promise<void> {
    const { webhookUrl, timeoutMs, maxRetries } = this.config.get('email');

    if (webhookUrl === undefined) {
      this.logger.info('email not sent, no EMAIL_WEBHOOK_URL configured', {
        to: email.to,
        subject: email.subject,
        body: email.body,
      });
      return;
    }

    await this.#http.post(webhookUrl, email, {
      timeoutMs,
      flow: 'email.send',
      retry: { maxRetries },
    });

    // The body is deliberately not logged on the success path: it went somewhere,
    // and an email body is the field most likely to carry something personal.
    this.logger.info('email sent', { to: email.to, subject: email.subject });
  }
}
