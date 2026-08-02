import { z } from 'zod';
import { csv } from './scalars.js';

/**
 * The one secret Better Auth cannot do without. A fixed, obviously-fake constant
 * rather than a generated one: `validateConfig` is called twice at boot (see
 * src/main.ts) and has to be a pure function of its input, so a
 * `crypto.randomUUID()` fallback would hand the two calls different secrets.
 *
 * `env.validation.ts` refuses it outright when `APP_ENV=prod`.
 */
export const DEV_AUTH_SECRET = 'dunx-template-development-secret-do-not-ship';

export const AuthSessionStore = Object.freeze({
  DATABASE: 'database',
  REDIS: 'redis',
} as const);
export type AuthSessionStore =
  (typeof AuthSessionStore)[keyof typeof AuthSessionStore];

export const authVarsSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32).optional(),

  /**
   * Where live sessions are kept. `redis` is better-auth's `secondaryStorage`, and
   * it is an explicit opt-in rather than something a `REDIS_URL` turns on by
   * accident: `redisStorage` deliberately does not soften a connection failure,
   * because a swallowed `null` from `get` reads as "no session" and signs every
   * user out. Choosing it is choosing to have Redis up.
   */
  AUTH_SESSION_STORE: z
    .enum([AuthSessionStore.DATABASE, AuthSessionStore.REDIS])
    .default(AuthSessionStore.DATABASE),

  /** The origin cookies are issued for. Defaults to `http://localhost:$API_PORT`. */
  WEB_URL: z.string().optional(),
  AUTH_TRUSTED_ORIGINS: csv([]),

  AUTH_SESSION_EXPIRATION: z.coerce
    .number()
    .int()
    .min(60)
    .max(604_800)
    .default(86_400),
  AUTH_SESSION_UPDATE_AGE: z.coerce
    .number()
    .int()
    .min(60)
    .max(604_800)
    .default(3600),

  /**
   * A provider is enabled only when both halves are present, which is what lets
   * the same build run with none, one or all of them.
   */
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),

  SEED_ADMIN_EMAIL: z.string().default('admin@local.dev'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('admin-password'),
});
