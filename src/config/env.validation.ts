import type { ConfigSource } from '@dunx/core';
import { ConfigValidationError } from './config-validation.error.js';
import { DbType } from './dto/db-vars.dto.js';
import { envVarsSchema } from './env-vars.dto.js';
import type { AppConfig } from './app.config.js';
import pkg from '../../package.json' with { type: 'json' };

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
  };
};

export { DbType };
