import { Logger } from '@dunx/core';
import { HttpFactory } from '@dunx/http';
import { OpenApiExplorer, OpenApiModule } from '@dunx/openapi';
import { appModule } from './app.module.js';
import { authDocument } from './auth/auth.document.js';
import { AUTH_MOUNT } from './auth/auth.options.js';
import { AppConfigService } from './config/app.config.service.js';
import { validateConfig } from './config/env.validation.js';
import { httpOptions } from './http.options.js';
import { forceExitAfter } from './core/force-exit.js';
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
    // Better Auth serves every one of its endpoints from one wildcard route, so
    // route discovery sees none of them. This asks the library for its own schema
    // and merges it in - a declared route wins a collision, and a missing
    // `openAPI()` plugin costs documentation rather than the boot.
    contribute: [authDocument(boot)],
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
const cancelWatchdog = forceExitAfter();

const { warnings } = app.get(OpenApiExplorer);
if (warnings.length > 0) logger.warn('openapi schema warnings', { warnings });

if (config.get('auth').usingDevSecret) {
  logger.warn(
    'BETTER_AUTH_SECRET is unset, using the development constant. Sessions are forgeable by anyone with this repository.',
  );
}

const url = await app.listen(appConfig.port);

logger.info(`${appConfig.name} listening`, {
  url,
  env: appConfig.env,
  docs: `${url}${appConfig.prefix}/${boot.docs.path}`,
  openapi: `${url}${appConfig.prefix}/${boot.docs.jsonPath}`,
  health: `${url}${appConfig.prefix}/${SERVICE_ROUTES.BASE}/${SERVICE_ROUTES.HEALTH}`,
  auth: `${url}${appConfig.prefix}${AUTH_MOUNT}`,
  websocket: app.gatewayPaths.map(
    (path) => `${url.replace('http', 'ws').replace(/\/$/, '')}${path}`,
  ),
  timezone: appConfig.timezone,
  versions: { bun: Bun.version, node: process.versions.node },
});

await app.closed;

// Every shutdown hook has run, so leaving is correct - and explicit, because a
// connection that never opened can still be holding the loop. See force-exit.ts.
cancelWatchdog();
process.exit(0);
