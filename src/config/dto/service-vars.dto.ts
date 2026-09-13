import { z } from 'zod';
import { blank, csv } from './scalars.js';

export const AppEnv = Object.freeze({
  LOCAL: 'local',
  DEV: 'dev',
  STAGE: 'stage',
  PROD: 'prod',
} as const);
export type AppEnv = (typeof AppEnv)[keyof typeof AppEnv];

export const NodeEnv = Object.freeze({
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
} as const);
export type NodeEnv = (typeof NodeEnv)[keyof typeof NodeEnv];

/**
 * `@arkv/logger` levels, restated as a zod enum. Core's `LogLevel` is a frozen
 * object rather than a TS enum, so `z.enum` needs the literal tuple.
 */
export const logLevels = [
  'verbose',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;

export const serviceVarsSchema = z.object({
  APP_ENV: z
    .enum([AppEnv.LOCAL, AppEnv.DEV, AppEnv.STAGE, AppEnv.PROD])
    .default(AppEnv.LOCAL),
  NODE_ENV: z
    .enum([NodeEnv.DEVELOPMENT, NodeEnv.TEST, NodeEnv.PRODUCTION])
    .default(NodeEnv.DEVELOPMENT),

  LOG_LEVEL: z.enum(logLevels).default('debug'),
  LOG_MASK_FIELDS: csv([
    'accessToken',
    'jwt',
    'password',
    'secret',
    'key',
    'phone',
  ]),
  LOG_FILTER_EVENTS: csv([
    '/api/service/up',
    '/api/service/health',
    '/favicon.ico',
  ]),
  LOG_REQUEST_BODY: z.stringbool().default(false),
  LOG_RESPONSE_BODY: z.stringbool().default(false),

  API_PORT: z.coerce.number().int().min(0).max(65535),
  API_PREFIX: z.string().default('api'),

  HEALTH_MAX_MEMORY_MB: z.coerce.number().int().min(16).default(2048),

  // Docker `ARG COMMIT_SHA` with no value becomes an empty string, not an absent
  // variable, so an empty one is normalised to undefined rather than reported as
  // a build with a blank sha.
  SERVICE_COMMIT_SHA: blank,
  SERVICE_COMMIT_MESSAGE: blank,

  CORS_ORIGIN: z.string().default('*'),
  TRUST_PROXY: z.stringbool().default(false),

  DOCS_PATH: z.string().default('docs'),
  DOCS_JSON_PATH: z.string().default('openapi.json'),

  TZ: z
    .string()
    .default('UTC')
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone'),
});
