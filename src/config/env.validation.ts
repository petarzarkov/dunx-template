import type { ConfigSource } from '@dunx/core';
import { ConfigValidationError } from './config-validation.error.js';
import { DEV_AUTH_SECRET } from './dto/auth-vars.dto.js';
import { DbType } from './dto/db-vars.dto.js';
import { StorageDriver } from './dto/storage-vars.dto.js';
import { envVarsSchema } from './env-vars.dto.js';
import type { AppConfig, OAuthCredentials } from './app.config.js';
import pkg from '../../package.json' with { type: 'json' };

/** Both halves or nothing: a provider with one of the two is a misconfiguration. */
const oauth = (
  clientId: string | undefined,
  clientSecret: string | undefined,
): OAuthCredentials | undefined =>
  clientId === undefined || clientSecret === undefined
    ? undefined
    : { clientId, clientSecret };

/**
 * The single validation function `ConfigModule.forRoot` takes. It parses the raw
 * environment and returns the nested, typed tree the app reads, so nothing
 * downstream ever touches `process.env` or a raw string again.
 */
export const validateConfig = (env: ConfigSource): AppConfig => {
  const parsed = envVarsSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) => ` - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new ConfigValidationError(
      `Configuration validation error:\n${details}`,
    );
  }

  const vars = parsed.data;

  return {
    isProd: vars.APP_ENV === 'prod',
    app: {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      env: vars.APP_ENV,
      nodeEnv: vars.NODE_ENV,
      port: vars.API_PORT,
      prefix: vars.API_PREFIX,
      timezone: vars.TZ,
    },
    log: {
      level: vars.LOG_LEVEL,
      maskFields: vars.LOG_MASK_FIELDS,
      filterEvents: vars.LOG_FILTER_EVENTS,
      requestBody: vars.LOG_REQUEST_BODY,
      responseBody: vars.LOG_RESPONSE_BODY,
    },
    service: {
      maxMemoryMb: vars.HEALTH_MAX_MEMORY_MB,
      commitSha: vars.SERVICE_COMMIT_SHA,
      commitMessage: vars.SERVICE_COMMIT_MESSAGE,
    },
    docs: {
      path: vars.DOCS_PATH,
      jsonPath: vars.DOCS_JSON_PATH,
    },
    cors: { origin: vars.CORS_ORIGIN, trustProxy: vars.TRUST_PROXY },
    db: {
      type: vars.DB_TYPE,
      sqlitePath: vars.SQLITE_DB_PATH,
      postgresUrl: vars.POSTGRES_URL,
    },
    redis: {
      url: vars.REDIS_URL,
      connectTimeoutMs: vars.REDIS_CONNECT_TIMEOUT_MS,
      cacheTtlSeconds: vars.CACHE_TTL_SECONDS,
    },
    throttle: {
      prefix: vars.THROTTLE_PREFIX,
      limit: vars.THROTTLE_LIMIT,
      windowSeconds: vars.THROTTLE_WINDOW_SECONDS,
    },
    queue: {
      prefix: vars.QUEUE_PREFIX,
      maxRetries: vars.QUEUE_MAX_RETRIES,
      retryDelayMs: vars.QUEUE_RETRY_DELAY_MS,
      concurrency: vars.QUEUE_CONCURRENCY,
      rateLimitMax: vars.QUEUE_RATE_LIMIT_MAX,
      rateLimitDurationMs: vars.QUEUE_RATE_LIMIT_DURATION_MS,
      jobTimeoutMs: vars.QUEUE_JOB_TIMEOUT_MS,
    },
    ws: { relayChannel: vars.WS_RELAY_CHANNEL },
    storage: {
      driver: vars.STORAGE_DRIVER,
      localRoot: vars.STORAGE_LOCAL_ROOT,
      prefix: vars.STORAGE_PREFIX,
      bucket: vars.S3_BUCKET,
      region: vars.S3_REGION,
      endpoint: vars.S3_ENDPOINT,
      accessKeyId: vars.S3_ACCESS_KEY_ID,
      secretAccessKey: vars.S3_SECRET_ACCESS_KEY,
      maxBytes: vars.UPLOAD_MAX_BYTES,
      allowedTypes: vars.UPLOAD_ALLOWED_TYPES,
    },
    images: {
      quality: vars.IMAGE_QUALITY,
      maxWidth: vars.IMAGE_MAX_WIDTH,
      thumbnailWidth: vars.IMAGE_THUMBNAIL_WIDTH,
    },
    auth: {
      secret: vars.BETTER_AUTH_SECRET ?? DEV_AUTH_SECRET,
      usingDevSecret: vars.BETTER_AUTH_SECRET === undefined,
      baseUrl: vars.WEB_URL ?? `http://localhost:${vars.API_PORT}`,
      sessionStore: vars.AUTH_SESSION_STORE,
      trustedOrigins: vars.AUTH_TRUSTED_ORIGINS,
      sessionExpiration: vars.AUTH_SESSION_EXPIRATION,
      sessionUpdateAge: vars.AUTH_SESSION_UPDATE_AGE,
      google: oauth(
        vars.GOOGLE_OAUTH_CLIENT_ID,
        vars.GOOGLE_OAUTH_CLIENT_SECRET,
      ),
      github: oauth(
        vars.GITHUB_OAUTH_CLIENT_ID,
        vars.GITHUB_OAUTH_CLIENT_SECRET,
      ),
      seedAdmin: {
        email: vars.SEED_ADMIN_EMAIL,
        password: vars.SEED_ADMIN_PASSWORD,
      },
    },
  };
};

export { DbType, StorageDriver };
