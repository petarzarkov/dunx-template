# NestJS to dunx, concept by concept

The port of [`nestjs-template`](https://github.com/petarzarkov/nestjs-template).
Every row is something the NestJS template does and what replaced it here.

## Dependency injection

| NestJS                                       | dunx                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@Injectable()`                              | nothing. Listing a class in `providers` is enough, and a class reached through a constructor self-binds.                    |
| `@Inject(TOKEN)` parameter decorator         | does not exist and never will: TC39 standard decorators have no parameter decorators.                                       |
| `@Inject(DRIZZLE_DB)` with a symbol          | annotate the drizzle class itself: `constructor(private readonly db: SyncDatabase<typeof schema>)`. The class is the token. |
| `reflect-metadata` + `emitDecoratorMetadata` | `@dunx/transform`, a load-time oxc transform enabled by one line in `bunfig.toml`.                                          |
| `@Global()`                                  | nothing. The container is flat, so every provider is visible everywhere.                                                    |
| `exports: [...]` on a module                 | does not exist. See above.                                                                                                  |
| `forwardRef(() => X)`                        | not needed. The dependency record is a thunk, evaluated at resolution.                                                      |
| `Scope.REQUEST`                              | does not exist. Per-request state is `RequestContext`, an `AsyncLocalStorage`.                                              |
| `useExisting`                                | `provide(Alias, { useFactory: (real) => real, inject: [Real] })`.                                                           |
| interface token                              | an `abstract class`. It is a runtime value, so it can be a constructor parameter type.                                      |
| `OnModuleInit` / `OnModuleDestroy`           | `OnInit` / `OnShutdown`, structural, awaited, reverse construction order on shutdown.                                       |

## HTTP

| NestJS                                                | dunx                                                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Body()`, `@Query()`, `@Param()`, `@Req()`           | one `input` argument: `list(input: Input<typeof listUsers>)`. Which fields exist is decided by the route's schemas.                                                                    |
| `@Headers()`                                          | `input.req.headers.get('...')`.                                                                                                                                                        |
| `@Res()`                                              | return a `Response`. `src/infra/health/health.controller.ts` does it for the 503.                                                                                                      |
| global `ZodValidationPipe` + `createZodDto`           | a zod schema per source on the route: `@Get('/', { query: ListUsersQuery })`.                                                                                                          |
| `PageDto` / `PageMetaDto` classes with `@ApiProperty` | `paginate`, `pageOf`, `parsePageOptions` and the cursor codec from `@dunx/infra/pagination`. This app keeps only the zod query schema, built from the framework's `PAGINATION` bounds. |
| `@ApiTags` + `@ApiOperation`                          | one `@ApiDoc({ tags, summary, description })`. See the caveat in the README.                                                                                                           |
| `@ApiOkResponse({ type: X })`                         | **no equivalent.** dunx documents inputs only.                                                                                                                                         |
| `CanActivate` guard                                   | a `Middleware` that throws. `SessionGuard` from `@dunx/auth`, and `ThrottleGuard` in `src/infra/redis/guards/`.                                                                        |
| `APP_GUARD`                                           | `HttpFactory.create(root, { middleware: [Guard] })`.                                                                                                                                   |
| `@UseGuards(X)`                                       | same name, same places, but guards compose rather than override.                                                                                                                       |
| `NestInterceptor`                                     | a `Middleware`. Work before `next()`, after it, or both. `src/core/middlewares/audit-context.middleware.ts` was an `APP_INTERCEPTOR`.                                                  |
| `SetMetadata` + `Reflector`                           | `metaKey<T>(name)` and `meta(key, value)` from `@dunx/http`, read back with `ctx.get(key)`. `src/core/decorators/throttle.decorator.ts`.                                               |
| `ExceptionFilter` + `@Catch()`                        | one `onError: ErrorMapper` passed to `create()`. `src/core/errors/error-mapper.ts` folds the generic filter and the SQLite filter into one function.                                   |
| `enableVersioning` / `@Version()`                     | **no equivalent.** `setGlobalPrefix('api')` only.                                                                                                                                      |
| `app.setGlobalPrefix('api')`                          | same, but imperative-only and it throws after `listen()`.                                                                                                                              |
| `app.enableCors(...)`                                 | same, imperative-only, before `listen()`.                                                                                                                                              |
| `app.set('trust proxy', true)`                        | same. `AppSettings` has exactly this one key.                                                                                                                                          |
| Express body parser                                   | none. Bun parses by content-type; an unsupported one is a 415 and the body is never read.                                                                                              |
| unmatched method gives 405                            | 404. Bun's router owns method dispatch.                                                                                                                                                |
| `/users` and `/users/` are the same route             | they are not. There is no trailing-slash normalisation.                                                                                                                                |

## Infrastructure

| NestJS                                                 | dunx                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/config` + `validate`                          | `ConfigModule.forRoot({ validate, as })`. Same single validation function.                                                                   |
| `ConfigService.get('a.b.c')` dotted path               | `config.get('a').b.c`. There is no dotted lookup.                                                                                            |
| `ConfigModule.forRoot({ isGlobal: true })`             | nothing to pass. Everything is global.                                                                                                       |
| `@nestjs/config` `envFilePath`                         | nothing. Bun loads `.env` and `.env.local` itself.                                                                                           |
| `@arkv/nestjs-context-logger`                          | `LoggerModule` from `@dunx/infra/logger`, which binds `@arkv/logger` to core's `Logger`.                                                     |
| `RequestMiddleware` + `HttpLoggingInterceptor`         | one built-in `RequestLoggingMiddleware`. One entry per request, not two.                                                                     |
| `@nestjs/terminus`                                     | **no equivalent.** `src/infra/health/health.controller.ts` reproduces the envelope in about twenty lines.                                    |
| `drizzle()` called by hand in `client.ts`              | `DbModule.forRootAsync(SyncDatabase, { useFactory, inject })`. It binds the drizzle handle under drizzle's own class.                        |
| `migrate()` inside the client factory                  | the same `drizzle-orm/bun-sqlite/migrator`, called from `DatabaseBootstrap`'s constructor.                                                   |
| `scripts/seed.ts` with a hand-rolled `__seeders` table | `runSeeds` from `@dunx/infra/db`, journaling into `dunx_seeds`.                                                                              |
| `@nestjs/testing` `Test.createTestingModule`           | `createTestApp` / `createTestServer` from `@dunx/testing`.                                                                                   |
| `axios` / `HttpModule` from `@nestjs/axios`            | `HttpModule` / `HttpService` from `@dunx/http/client` - `fetch` with a per-attempt timeout, retry, `Retry-After` and request-id propagation. |
| `scripts/gen-env-docs.ts`                              | the same script over the same zod schemas. `bun run gen:env:docs` writes `docs/env-vars.md`.                                                 |
| `.overrideProvider(X).useValue(y)`                     | `overrides: [provide(X, { useValue: y })]`, replaced in place by token.                                                                      |

## Authentication

| NestJS                                                        | dunx                                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@thallesp/nestjs-better-auth` `AuthModule.forRootAsync`      | `AuthModule.forRootAsync({ useFactory, inject }, '/auth')` from `@dunx/auth`. The second argument is the mount - see below.                         |
| the package's global `AuthGuard`                              | `SessionGuard`, listed in `HttpOptions.middleware`. It is a provider, so `@UseGuards(SessionGuard)` on one controller also works.                   |
| `drizzleAdapter(db, { provider, schema })` by hand            | `drizzleDatabase(connection, { schema })` from `@dunx/auth/drizzle`. `provider` comes from the connection's own dialect.                            |
| `req.user`, `@CurrentUser()`                                  | `AuthContext`, an `AsyncLocalStorage`. `src/auth/services/current-user.service.ts` wraps it. No parameter decorator exists.                         |
| `@Public()` / `AllowAnonymous`                                | same name, from `@dunx/http`. Better Auth's own handler carries it at class scope, which is what makes sign-in reachable.                           |
| `@Roles(...)` reading the `admin()` plugin's `role`           | same name, same source. `SessionGuard` reads it; `@dunx/openapi` reads the same metadata for `x-required-roles`.                                    |
| custom `bunBcryptPassword`                                    | `bunPassword`, which `AuthModule` applies by default when `emailAndPassword` is on.                                                                 |
| `RedisService` as `secondaryStorage`                          | `redisStorage(connection)`. Opt in with `AUTH_SESSION_STORE=redis`: it deliberately does not degrade.                                               |
| `mergeBetterAuthSchema` in `setupDocs.ts`                     | `betterAuthDocument(auth, { basePath })` passed to `OpenApiModule.forRoot({ contribute })`. A declared route wins a collision.                      |
| `@ApiAuth()` Swagger marker                                   | nothing to add. `@Roles`/`@Public` already produce the security requirement.                                                                        |
| `HtmlSessionAuthMiddleware` over the docs and dashboard pages | Half. The dashboard takes an `authorize(request)` that asks better-auth for the session and 404s a non-admin; the explorer is still not behind one. |

**The `basePath` and `mountAt` split is the one thing to get right.** Under
`setGlobalPrefix('api')` the handler is a route at `/auth` while better-auth
matches the whole pathname `/api/auth`, so the two are different strings for one
URL: mount at `/auth`, configure `basePath: '/api/auth'`. Getting it wrong is a
boot error rather than a 404 at runtime.

## Queues

| NestJS                                                       | dunx                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `BullModule.forRootAsync` + `registerQueue`                  | `QueueModule.forRootAsync`. A queue is a key prefix, so there is nothing to register - `publisher.queue(name)`. |
| `@Processor` class + `WorkerHost`                            | `@JobHandler({ queue, name })` on a method of any provider. No class decorator, no base class.                  |
| the template's own `JobDispatcher` + `job.processor.ts` fork | `WorkerFactory.create(workerModule())` in `src/worker.ts`. A worker is its own container, not a fork.           |
| `JobPublisherService`                                        | `JobPublisher`, which returns bullmq's own `Queue` rather than wrapping it.                                     |
| `ioredis` connection options                                 | a URL. `@dunx/infra/queue` runs bullmq's `createBunRedisClient` over `Bun.RedisClient`.                         |
| `@bull-board/express` at `/api/queues`                       | `QueueDashboardModule` from `@dunx/queue-dashboard`, at `/queues`. The real Bull Board, over `Bun.serve`.       |
| `runWithTimeout(jobTimeoutMs)` in the dispatcher             | `jobTimeoutMs` on `QueueOptions`.                                                                               |

## Files, images and storage

| NestJS                                                     | dunx                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@aws-sdk/client-s3` in `s3.service.ts`                    | `S3StorageOptions`, which is `Bun.S3Client`. Credentials fall through to Bun's own resolution.               |
| no local fallback                                          | `LocalStorageOptions`, which is `Bun.file`/`Bun.write`/`Bun.Glob`. It is the default, so uploads need no S3. |
| `FilesInterceptor` + multer + `MultipartFormDataGuard`     | nothing. Bun parses by content type and answers 415 itself; the body is a zod schema like any other.         |
| `@ValidatedFiles({ fileType, maxSize })`                   | plain checks in `FilesService`, against validated config rather than decorator arguments.                    |
| `new Bun.Image(buffer).metadata()` in a `@Global()` helper | `Images` from `@dunx/infra/images`, plus a resize and re-encode pipeline the template did not have.          |

## Realtime

| NestJS                                   | dunx                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@WebSocketGateway()` + socket.io        | `@Gateway('/ws')`. Served by the same `Bun.serve` call as the HTTP routes - no second server, no adapter.   |
| `io.use()` auth middleware               | `@OnUpgrade()`. Return a `Response` and there is no socket; anything else becomes `socket.data.context`.    |
| `@SubscribeMessage('x')`                 | `@OnMessage('x')`. It receives the decoded payload, and what it returns is replied under the same event.    |
| `socket.join(room)` / `io.to(room).emit` | `socket.subscribe(topic)` / `pubsub.publishEvent(topic, ...)`. Bun's own pub/sub, no JavaScript room map.   |
| namespaces                               | **no equivalent.** One gateway is one path; topics do the rest.                                             |
| acknowledgement callbacks                | the handler's return value, sent back under the same event name.                                            |
| `@socket.io/redis-adapter`               | `relay: new RedisRelay({ url })` in `HttpOptions`. Two methods over `Bun.RedisClient`, no extra dependency. |
| `@socket.io/redis-emitter` in the worker | `encodeRelay` + `encode` onto the relay channel. `src/notifications/events/events.publisher.ts`.            |

## Cache and rate limiting

| NestJS                                                          | dunx                                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `CacheModule` + `keyv` + `KeyvIoredisAdapter` + `cache-manager` | `CacheService`, forty lines over `RedisConnection`. Three dependencies for six commands Bun already has.          |
| `ThrottlerModule` with three named tiers                        | `THROTTLE_LIMIT`/`THROTTLE_WINDOW_SECONDS`, and `@Throttle({ limit, windowSeconds })` to override per route.      |
| a second `EnvThrottlerGuard` with its own Lua script            | the same guard. `INCR` then `EXPIRE` on the call that created the key - Bun pipelines, so it is one round trip.   |
| `RedisService.newConnection(name, { db })` per concern          | one connection, or `RedisModule.forRootAsync(factory, 'name')` for a second. Key prefixes rather than db numbers. |

## Deliberately not ported

Four things, each for a reason that is not "it needs a service running". There were
six; **two came back**, and both because a dunx release closed the gap rather than
because the judgement was wrong at the time.

| Not ported                           | Why                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI providers                         | A `fetch` to a vendor. Nothing about it is framework-shaped, and a template that picks one for you is picking wrong for most readers.                                                                                                                                                  |
| Resend email + React Email templates | Same: a transport the consumer owns. `EmailService` logs the message it would have sent, which is enough to prove the queue delivered the job to a worker, and swapping in a provider is one method body.                                                                              |
| The CMS                              | A product feature, not a framework capability.                                                                                                                                                                                                                                         |
| Swagger UI preauthorization          | The template hooks the sign-in response and calls `preauthorizeApiKey`, so the explorer is authenticated straight after a login. dunx's explorer has an Authorize dialog and no hook to drive it from a response. Still open upstream.                                                 |
| Postgres                             | `DB_TYPE=postgres` is refused at boot. The data layer here is synchronous (`bun:sqlite`, `SyncDatabase`), and making it async is a rewrite of every repository rather than a configuration change. `@dunx/infra/db` supports `Bun.SQL` perfectly well - this template does not use it. |

## The two that came back

**Bull Board's page.** The judgement was that Bull Board is an Express-mounted React
application and `Bun.serve` is not Express, so what was portable was the _data_ -
counts, one job, retry, drain - and `/api/queues` served that as admin-only JSON.

That was wrong about the hard part. bull-board's `IServerAdapter` is a **sink**: it
pushes its routes, its view path, its static path, an error handler and its UI config
in, and the adapter answers requests from them. Implementing it over `Bun.serve` is
about a page of code, which is what `@dunx/queue-dashboard` is. The JSON controller is
deleted rather than kept alongside - it was a reimplementation of a page that now
exists, and an admin endpoint that enqueues an arbitrary job by name is not worth
keeping for its own sake.

**Keyset pagination.** Never in this table, but it was ~200 lines of this app's own
code and it is now `@dunx/infra/pagination`. The framework's version fixed three
things on the way in: it awaits the query builder rather than calling `.all()`, so it
serves `Bun.SQL` as well as `bun:sqlite`; the cursor's id is any non-empty string
rather than a UUID, which silently broke keyset pagination over a serial id; and a
cursor is minted only when there is a page in that direction, where a `nextCursor` on
the last page reads as "there is more" to any client checking for null.

The pattern in both: **"dunx has no equivalent" is a statement with a date on it.**
Re-read this section against each release rather than trusting it.
