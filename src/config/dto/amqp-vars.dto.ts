import { z } from 'zod';
import { EVENTS_EXCHANGE } from '../../notifications/messaging/domain-events.js';

/**
 * RabbitMQ, for the half of messaging a job queue is not.
 *
 * bullmq already carries this app's own work: a job is something *this* system
 * must do, with retries and a worker it owns. A topic exchange is the other
 * shape - a domain event announced once, that zero or many **other** services
 * subscribe to, and that this app is not responsible for completing. Both exist
 * here because they are not alternatives.
 *
 * Absent by default. `docker compose --profile amqp up -d` starts a broker, and
 * with none the publish side warns once and the consumers stand down - the same
 * contract Redis and the bucket keep.
 */
export const amqpVarsSchema = z.object({
  AMQP_URL: z
    .string()
    .optional()
    .describe('amqp://user:pass@host:5672. Unset means nothing is published.'),

  /**
   * Consuming is off in the web process by default: it publishes, and a process
   * that started consuming to send a message would be a surprise. The worker
   * turns it on.
   */
  AMQP_CONSUME: z.stringbool().default(false),

  /**
   * Defaults to `EVENTS_EXCHANGE`, which `@AmqpHandler` also names - a decorator
   * argument is evaluated before config exists, so the constant is the source
   * and this is the override.
   */
  AMQP_EXCHANGE: z
    .string()
    .default(EVENTS_EXCHANGE)
    .describe('The topic exchange this app owns and declares.'),
});
