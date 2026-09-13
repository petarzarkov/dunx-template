import { Logger, type DynamicModule } from '@dunx/core';
import {
  EmailModule,
  LogTransport,
  type EmailTransport,
} from '@dunx/infra/email';
import { AppConfigService } from '../../config/app.config.service.js';
import {
  EmailTransportKind,
  type EmailTransportKind as Kind,
} from '../../config/dto/notification-vars.dto.js';
import renderer from './render.js';

/** `EMAIL_SMTP_URL=` parses as `''`, which is set and useless. */
const set = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

/**
 * One `EmailTransport`, chosen once at boot.
 *
 * Each vendor sits on its own subpath and is reached with `await import()`
 * rather than a static import, so an app on `EMAIL_TRANSPORT=log` never loads
 * `resend` or `nodemailer` at all. That is the whole reason the subpaths exist,
 * and a static import here would defeat it.
 *
 * A provider named without its credential degrades to the log transport rather
 * than failing boot, which keeps the contract every other area here keeps.
 */
const transportFor = async (
  kind: Kind,
  smtpUrl: string | undefined,
  resendKey: string | undefined,
  logger: Logger,
): Promise<EmailTransport> => {
  if (kind === EmailTransportKind.RESEND && set(resendKey)) {
    const { ResendTransport } = await import('@dunx/infra/email/resend');
    return new ResendTransport({ apiKey: resendKey });
  }
  if (kind === EmailTransportKind.SMTP && set(smtpUrl)) {
    const { SmtpTransport } = await import('@dunx/infra/email/smtp');
    return new SmtpTransport({ url: smtpUrl });
  }
  if (kind !== EmailTransportKind.LOG) {
    logger.warn(
      `EMAIL_TRANSPORT=${kind} needs its credential and none is set. ` +
        'Sending through the log transport instead.',
    );
  }
  return new LogTransport(logger);
};

/**
 * Binds `EmailOptions`, `EmailTransport`, `TemplateRenderer` and `EmailService`.
 *
 * This replaced an app-owned `EmailService` that posted to a webhook. What that
 * class actually owned was a default sender, a retry, and a log-instead
 * fallback - all three of which `@dunx/infra/email` owns now, and the vendor is
 * a transport rather than a URL.
 *
 * **Retries stay off**, which is the framework's default and worth restating: a
 * provider that accepted the message and lost the response cannot be told from
 * one that never saw it, and guessing costs a second email in a real inbox. The
 * queue's own three attempts still sit on top, and `EMAIL_MAX_PER_SECOND` is the
 * answer to a 429.
 */
export class AppEmailModule {
  static forRoot(): DynamicModule {
    return EmailModule.forRootAsync({
      useFactory: async (config: AppConfigService, logger: Logger) => {
        const email = config.get('email');
        return {
          transport: await transportFor(
            email.transport,
            email.smtpUrl,
            email.resendKey,
            logger,
          ),
          from: email.from,
          ...(email.replyTo === undefined ? {} : { replyTo: email.replyTo }),
          maxPerSecond: email.maxPerSecond,
          dryRun: email.dryRun,
          renderer,
        };
      },
      inject: [AppConfigService, Logger] as const,
    });
  }
}
