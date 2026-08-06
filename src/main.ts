import { Logger } from '@dunx/core';
import { HttpFactory } from '@dunx/http';
import { OpenApiExplorer, OpenApiModule } from '@dunx/openapi';
import { AppModule } from './app.module.js';
import { authDocument } from './auth/auth.document.js';
import { AUTH_MOUNT } from './auth/auth.options.js';
import { AppConfigService } from './config/app.config.service.js';
import { validateConfig } from './config/env.validation.js';
import { httpOptions } from './http.options.js';
import { forceExitAfter } from './core/force-exit.js';
import { SERVICE_ROUTES } from './constants.js';

/**
 * The config is validated here as well as inside `ConfigModule`, because
 * `HttpOptions` is an argument to `HttpFactory.create` - the call that *builds* the
 * container - so `requestLogging`, `onError`, `middleware` and `relay` cannot read
 * validated config. Middleware is registered by class, never by instance, so the
 * NestJS trick of `app.useGlobalInterceptors(new HttpLoggingInterceptor(config))`
 * after `app.get(ConfigService)` has no counterpart.
 *
 * `validateConfig` is a pure function of the environment, so calling it twice costs
 * one extra zod parse at boot and cannot disagree with itself.
 *
 * `OpenApiModule` used to be the other half of this. It has `forRootAsync` now, so
 * the title, version, description and both mount paths come off `AppConfigService`
 * like every other module's options - including the paths, which works because the
 * controller declares its routes with thunks resolved at discovery, after every
 * provider has settled.
 */
const boot = validateConfig(Bun.env);

const app = await HttpFactory.create(
  OpenApiModule.forRootAsync({
    root: AppModule.forRoot(),
    useFactory: (config: AppConfigService) => {
      const { app: meta, docs } = config.values;
      return {
        title: meta.name,
        version: meta.version,
        description: meta.description,
        path: `/${docs.path}`,
        jsonPath: `/${docs.jsonPath}`,
        // Better Auth serves every one of its endpoints from one wildcard route, so
        // route discovery sees none of them. This asks the library for its own
        // schema and merges it in - a declared route wins a collision, and a missing
        // `openAPI()` plugin costs documentation rather than the boot.
        //
        // Built from `boot`, not from the injected `Auth`, because
        // `scripts`/openapi.config.ts shares this function and runs with no
        // container at all. One contribution, two entrypoints.
        contribute: [authDocument(boot)],
      };
    },
    inject: [AppConfigService] as const,
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
  /**
   * `/ok`, not the bare mount.
   *
   * better-auth serves every endpoint it and its plugins declare under one
   * wildcard, which `@dunx/auth` mounts as `<basePath>/*` - and `Bun.serve`'s `/*`
   * needs a segment after the slash, so **nothing is registered at the mount
   * itself**. Printing it here advertised a URL that answered 404 to anyone who
   * clicked it. `/ok` is better-auth's own liveness route, returns `{"ok":true}`,
   * and is the one GET at this mount that a browser can usefully open.
   *
   * The sign-in and sign-up endpoints are POSTs, so they belong in the OpenAPI
   * document rather than in a list of links - `authDocument()` contributes them.
   */
  auth: `${url}${appConfig.prefix}${AUTH_MOUNT}/ok`,
  // Admin-only, so opening it in a browser with no session is a 401 by design -
  // `SessionGuard` refusing is the template working, not a misconfiguration. The
  // URL is here because it is where the queue data lives; get a token first.
  queues: `${url}${appConfig.prefix}/queues`,
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
