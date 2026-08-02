import { Logger } from '@dunx/core';

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * Where a real transport would go.
 *
 * The NestJS template sends through Resend with React Email templates. Neither has
 * a dunx answer and neither should - Rule 1's second half says integrate the mature
 * library rather than invent one, and an email provider is a `fetch` call the
 * consumer owns. So this logs the message it would have sent, which is enough to
 * prove the queue delivered the job to a worker, and swapping in a provider is one
 * method body.
 */
export class EmailService {
  constructor(private readonly logger: Logger) {}

  async send(email: Email): Promise<void> {
    // `await` so the signature stays honest: a real transport is a network call and
    // the handler that awaits this is what the queue's retry policy applies to.
    await Promise.resolve();
    this.logger.info('email sent', {
      to: email.to,
      subject: email.subject,
      body: email.body,
    });
  }
}
