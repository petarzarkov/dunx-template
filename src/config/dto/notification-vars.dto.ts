import { z } from 'zod';

/**
 * Outbound notification transport.
 *
 * A **webhook URL** rather than a vendor's SDK, which is the same call the NestJS
 * template's Resend integration was not worth porting for: an email provider is a
 * `POST` with a JSON body, and every one of them accepts that shape. Naming
 * Resend, Postmark or SES here would pick for the reader; a URL does not, and it
 * also covers an internal relay.
 *
 * Absent by default, and `EmailService` logs the message it would have sent when it
 * is - so the queue still demonstrably delivers a job to a worker with nothing
 * configured.
 */
export const notificationVarsSchema = z.object({
  EMAIL_WEBHOOK_URL: z
    .url()
    .optional()
    .describe(
      'Where to POST an outbound email. Unset logs the message instead of sending it.',
    ),
  EMAIL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(5_000)
    .describe('Per-attempt budget for the email webhook call.'),
  EMAIL_MAX_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(5)
    .default(2)
    .describe(
      'Retries inside one job attempt. The queue retries the job on top of this.',
    ),
});
