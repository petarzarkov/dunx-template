/**
 * The routing keys this app announces on its topic exchange.
 *
 * Deliberately **not** `JOBS`. A job is work this system owes and must finish,
 * with retries and a worker it owns; these are statements of fact that other
 * services subscribe to and this app is not responsible for completing. The two
 * lists look similar today because the same three things happen to be worth both
 * doing and announcing - that is a coincidence, not a reason to share one
 * constant.
 *
 * A key is `<entity>.<past-tense verb>`, so a subscriber can bind `user.*` and
 * get every user event including ones added later.
 */
export const DOMAIN_EVENTS = Object.freeze({
  USER_REGISTERED: 'user.registered',
  USER_BANNED: 'user.banned',
  FILE_UPLOADED: 'file.uploaded',
} as const);

export type DomainEvent = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

/**
 * The exchange this app owns.
 *
 * A constant rather than config, because `@AmqpHandler`'s argument is evaluated
 * at class-definition time - before a container, and therefore before validated
 * config. `AMQP_EXCHANGE` defaults to this, so the two cannot disagree unless
 * someone deliberately overrides it, and then only the publish side moves.
 */
export const EVENTS_EXCHANGE = 'dunx-template.events';

/** The queue this app binds for its own demonstration of the consume side. */
export const AUDIT_QUEUE = 'dunx-template.events.audit';

export interface UserRegisteredEvent {
  readonly userId: string;
  readonly email: string;
}

export interface UserBannedEvent {
  readonly userId: string;
  readonly reason: string;
}

export interface FileUploadedEvent {
  readonly fileId: string;
  readonly userId: string;
  readonly bytes: number;
}
