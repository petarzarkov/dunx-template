import { Logger } from '@dunx/core';
import { HttpFactory } from '@dunx/http';
import { OpenApiExplorer, OpenApiModule } from '@dunx/openapi';
import { appModule } from './app.module.js';
import { AppConfigService } from './config/app.config.service.js';
import { validateConfig } from './config/env.validation.js';
import { httpOptions } from './http.options.js';
import { SERVICE_ROUTES } from './constants.js';

/**
 * The config is validated here as well as inside `ConfigModule`, because
 * `HttpOptions` and `OpenApiModule.forRoot` are both evaluated *before* the
 * container exists, so nothing can be injected into them:
 *
 *  - `requestLogging` is an `HttpOptions` field and `HttpFactory.create` is what
 *    builds the container, so `app.get(AppConfigService)` is not available yet.
 *    Middleware is registered by class, never by instance, so the NestJS trick of
 *    `app.useGlobalInterceptors(new HttpLoggingInterceptor(config))` after
 *    `app.get(ConfigService)` has no counterpart.
 *  - `OpenApiModule` has `forRoot` only. There is no `forRootAsync`, unlike
 *    `LoggerModule`, `DbModule`, `RedisModule` and the rest, so the title,
 *    version and mount paths cannot come off `ConfigService`.
 *
 * `validateConfig` is a pure function of the environment, so calling it twice
 * costs one extra zod parse at boot and cannot disagree with itself.
 */
const boot = validateConfig(Bun.env);

const app = await HttpFactory.create(
  OpenApiModule.forRoot({
    title: boot.app.name,
    version: boot.app.version,
    description: boot.app.description,
    root: appModule(),
    path: `/${boot.docs.path}`,
    jsonPath: `/${boot.docs.jsonPath}`,
  }),
  httpOptions(boot),
);

const config = app.get(AppConfigService);
const logger = app.get(Logger);
const { app: appConfig, cors } = config.values;

// Everything below `listen()` configures the route table, which is built exactly
// once. Calling any of them afterwards throws rather than being quietly dropped.
app.setGlobalPrefix(appConfig.prefix);
app.set('trust proxy', cors.trustProxy);
app.enableCors({ origin: cors.origin, credentials: config.get('isProd') });
app.enableShutdownHooks();

const { warnings } = app.get(OpenApiExplorer);
if (warnings.length > 0) logger.warn('openapi schema warnings', { warnings });

const url = await app.listen(appConfig.port);

logger.info(`${appConfig.name} listening`, {
  url,
  env: appConfig.env,
  docs: `${url}${appConfig.prefix}/${boot.docs.path}`,
  openapi: `${url}${appConfig.prefix}/${boot.docs.jsonPath}`,
  health: `${url}${appConfig.prefix}/${SERVICE_ROUTES.BASE}/${SERVICE_ROUTES.HEALTH}`,
  timezone: appConfig.timezone,
  versions: { bun: Bun.version, node: process.versions.node },
});

await app.closed;
