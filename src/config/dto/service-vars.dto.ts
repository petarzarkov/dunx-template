import { z } from 'zod';

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

const csv = (fallback: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ''
        ? [...fallback]
        : value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
    );

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

  SERVICE_COMMIT_SHA: z.string().optional(),
  SERVICE_COMMIT_MESSAGE: z.string().optional(),

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
