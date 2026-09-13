import { z } from 'zod';

/**
 * Which backend `EmailService` sends through. The same shape `STORAGE_DRIVER`
 * uses: one variable picks a class, and nothing else in the app branches on it.
 */
export const EmailTransportKind = Object.freeze({
  LOG: 'log',
  SMTP: 'smtp',
  RESEND: 'resend',
} as const);
export type EmailTransportKind =
  (typeof EmailTransportKind)[keyof typeof EmailTransportKind];

/**
 * Outbound email.
 *
 * `@dunx/infra/email` owns the sender default, the per-second pacing, the retry
 * policy and the rendering call; the vendor is a `EmailTransport` on its own
 * subpath. This app ships two of them plus the log transport, which is the
 * default - so a clean checkout sends nowhere, prints what it would have sent,
 * and still demonstrably delivers a job to a worker.
 *
 * The NestJS template posted to Resend directly. That is still available here as
 * one variable, and so is any SMTP server, which is what `docker compose
 * --profile mail up` starts locally.
 */
export const notificationVarsSchema = z.object({
  EMAIL_TRANSPORT: z
    .enum([
      EmailTransportKind.LOG,
      EmailTransportKind.SMTP,
      EmailTransportKind.RESEND,
    ])
    .default(EmailTransportKind.LOG)
    .describe('Which backend sends mail. `log` prints instead of sending.'),

  EMAIL_FROM: z
    .string()
    .default('dunx-template <no-reply@localhost>')
    .describe('The default sender. A message may still name its own.'),

  EMAIL_REPLY_TO: z
    .string()
    .optional()
    .describe('Applied to every message that does not set its own.'),

  /**
   * `smtp://user:pass@host:1025`. Mailpit under `--profile mail` needs no
   * credentials, so `smtp://localhost:1025` is the whole local setup.
   */
  EMAIL_SMTP_URL: z
    .string()
    .optional()
    .describe('SMTP connection URL, used when EMAIL_TRANSPORT=smtp.'),

  EMAIL_RESEND_KEY: z
    .string()
    .optional()
    .describe('Resend API key, used when EMAIL_TRANSPORT=resend.'),

  /**
   * Resend caps sends per second and answers a breach with a 429 inside a job
   * handler. Pacing is the answer to that rather than a retry, which is why
   * retries stay off: a provider that accepted the message and lost the response
   * cannot be told from one that never saw it, and guessing costs a second email
   * in a real inbox.
   */
  EMAIL_MAX_PER_SECOND: z.coerce
    .number()
    .min(0)
    .max(100)
    .default(0)
    .describe('Provider cap on send starts. `0` leaves them unpaced.'),

  EMAIL_DRY_RUN: z
    .stringbool()
    .default(false)
    .describe(
      'Build the configured transport but send through the log one instead.',
    ),
});
