import { Logger } from '@dunx/core';
import { HttpService } from '@dunx/http/client';
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
 * `HttpService` is a plain constructor dependency, like everything else in this app.
 * `HttpModule` can also register a *named* client, which is bound to
 * `httpClient(name)` - a `Token`, not a class, so it has to be reached with
 * `inject()` in a field initialiser. That is the shape for an app calling several
 * upstreams; this one calls a single webhook, so it does not pay for it.
 */
export class EmailService {
  constructor(
    private readonly http: HttpService,
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

    await this.http.post(webhookUrl, email, {
      timeoutMs,
      flow: 'email.send',
      retry: { maxRetries },
    });

    // The body is deliberately not logged on the success path: it went somewhere,
    // and an email body is the field most likely to carry something personal.
    this.logger.info('email sent', { to: email.to, subject: email.subject });
  }
}
