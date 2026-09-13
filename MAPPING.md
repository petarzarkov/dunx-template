# NestJS to dunx, concept by concept

The port of the NestJS template this repository used to be. Every row is
something that template did and what replaced it here.

Written against dunx **1.2.0** and re-verified against **3.8.1**. Seven rows that
said "no equivalent" no longer do, which is the point of the note at the bottom:
a statement about what a framework lacks has a date on it.

## Dependency injection

| NestJS                                       | dunx                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@Injectable()`                              | nothing. Listing a class in `providers` is enough, and a class reached through a constructor self-binds.                    |
| `@Inject(TOKEN)` parameter decorator         | does not exist and never will: TC39 standard decorators have no parameter decorators.                                       |
| `@Inject(DRIZZLE_DB)` with a symbol          | annotate the drizzle class itself: `constructor(private readonly db: SyncDatabase<typeof schema>)`. The class is the token. |
| `reflect-metadata` + `emitDecoratorMetadata` | `@dunx/transform`, a load-time oxc transform enabled by one line in `bunfig.toml`.                                          |
| `@Global()`                                  | `global: true` on the same `@Module` options object. Every module under `src/infra/` sets it.                               |
| `exports: [...]` on a module                 | same field, and it accepts a **module reference** too, which re-exports whatever that module exports.                       |
| `forwardRef(() => X)`                        | not needed. The dependency record is a thunk, evaluated at resolution.                                                      |
| `Scope.REQUEST`                              | does not exist. Per-request state is `RequestContext`, an `AsyncLocalStorage`.                                              |
| `useExisting`                                | `provide(Alias, { useFactory: (real) => real, inject: [Real] })`.                                                           |
| interface token                              | an `abstract class`. It is a runtime value, so it can be a constructor parameter type.                                      |
| `OnModuleInit` / `OnModuleDestroy`           | `OnInit` / `OnShutdown`, structural, awaited, reverse construction order on shutdown.                                       |

## HTTP

| NestJS                                                | dunx                                                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Body()`, `@Query()`, `@Param()`, `@Req()`           | one `input` argument: `list(input: Input<typeof listUsers>)`. Which fields exist is decided by the route's schemas.                                                                                       |
| `@Headers()`                                          | `input.req.headers.get('...')`.                                                                                                                                                                           |
| `@Res()`                                              | return a `Response`. `src/infra/health/health.controller.ts` does it for the 503.                                                                                                                         |
| global `ZodValidationPipe` + `createZodDto`           | a zod schema per source on the route: `@Get('/', { query: ListUsersQuery })`.                                                                                                                             |
| `PageDto` / `PageMetaDto` classes with `@ApiProperty` | `paginate`, `pageOf`, `parsePageOptions` and the cursor codec from `@dunx/infra/pagination`. This app keeps only the zod query schema, built from the framework's `PAGINATION` bounds.                    |
| `@ApiTags` + `@ApiOperation`                          | one `@ApiDoc({ tags, summary, description })`. See the caveat in the README.                                                                                                                              |
| `@ApiOkResponse({ type: X })`                         | `response` on the route, keyed by status: `@Get('/', { query: Q, response: { 200: PaginatedUsers } })`. Stricter than the decorator it replaces, because tsc checks the handler's return type against it. |
| `CanActivate` guard                                   | a `Middleware` that throws. `SessionGuard` from `@dunx/auth`, and `ThrottleGuard` in `src/infra/redis/guards/`.                                                                                           |
| `APP_GUARD`                                           | `HttpFactory.create(root, { middleware: [Guard] })`, declared by the root module. `SessionGuard`, `ThrottleGuard` and the audit stamp are all app-level here, and `src/app.module.ts` says why.           |
| `configure(consumer)` + `forRoutes('x/*')`            | `@Module({ middleware: [X] })`. It covers the routes that module's own controllers declare and nothing it imports, so there is no path matching and no ancestor layer. `QueuesModule` is the example.     |
| `@UseGuards(X)`                                       | same name, same places, but guards compose rather than override.                                                                                                                                          |
| `NestInterceptor`                                     | a `Middleware`. Work before `next()`, after it, or both. `src/core/middlewares/audit-context.middleware.ts` was an `APP_INTERCEPTOR`.                                                                     |
| `SetMetadata` + `Reflector`                           | `metaKey<T>(name)` and `meta(key, value)` from `@dunx/http`, read back with `ctx.get(key)`. `src/core/decorators/throttle.decorator.ts`.                                                                  |
| `ExceptionFilter` + `@Catch()`                        | one `onError` passed to `create()` - a mapper, or an `ErrorFilter` class when it needs to inject. `src/core/errors/error-mapper.ts` folds the generic and SQLite filters into one function.               |
| a **controller-scoped** `@Catch()`                    | middleware with a `try` around `next()`, at whichever scope it is listed. `src/infra/queue/queue-unavailable.middleware.ts` is one; rethrowing hands the error out to `onError`.                          |
| `enableVersioning` / `@Version()`                     | **still no equivalent.** `setGlobalPrefix('api')` only, and prefix your controllers by hand. The NestJS template never used it either.                                                                    |
| `app.setGlobalPrefix('api')`                          | same, but imperative-only and it throws after `listen()`.                                                                                                                                                 |
| `app.enableCors(...)`                                 | same, imperative-only, before `listen()`.                                                                                                                                                                 |
| `app.set('trust proxy', true)`                        | same. `AppSettings` has exactly this one key.                                                                                                                                                             |
| Express body parser                                   | none. Bun parses by content-type; an unsupported one is a 415 and the body is never read.                                                                                                                 |
| unmatched method gives 405                            | 404. Bun's router owns method dispatch.                                                                                                                                                                   |
| `@UseInterceptors(CacheInterceptor)`                  | a `Middleware` over `CacheService`, with `@NoCache()` to opt a route out. `src/infra/redis/response-cache.middleware.ts`. Production only, and the caller is part of the key.                             |
| `/users` and `/users/` are the same route             | not by default, but `strict: false` on `HttpOptions` turns normalisation on (3.4.0). This app leaves it off.                                                                                              |

## Infrastructure

| NestJS                                                 | dunx                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/config` + `validate`                          | `ConfigModule.forRoot({ validate, as })`. Same single validation function.                                                                                                                                                                                                |
| `ConfigService.get('a.b.c')` dotted path               | either. `config.get('a').b.c`, or a typed dotted path up to three segments since 3.0.2.                                                                                                                                                                                   |
| `ConfigModule.forRoot({ isGlobal: true })`             | nothing to pass. Everything is global.                                                                                                                                                                                                                                    |
| `@nestjs/config` `envFilePath`                         | nothing. Bun loads `.env` and `.env.local` itself.                                                                                                                                                                                                                        |
| `@arkv/nestjs-context-logger`                          | `LoggerModule` from `@dunx/infra/logger`, which binds `@arkv/logger` to core's `Logger`.                                                                                                                                                                                  |
| `RequestMiddleware` + `HttpLoggingInterceptor`         | one built-in `RequestLoggingMiddleware`. One entry per request, not two.                                                                                                                                                                                                  |
| `@nestjs/terminus`                                     | `HealthModule` from `@dunx/http` exists now (2.1.0), with drain-aware readiness. This app keeps its own controller: it reports six areas against Terminus's two and has a third `degraded` state neither has.                                                             |
| `drizzle()` called by hand in `client.ts`              | `DbModule.forRootAsync(SyncDatabase, { useFactory, inject })`. It binds the drizzle handle under drizzle's own class.                                                                                                                                                     |
| `migrate()` inside the client factory                  | the same `drizzle-orm/bun-sqlite/migrator`, called from `DatabaseBootstrap`'s constructor.                                                                                                                                                                                |
| `scripts/seed.ts` with a hand-rolled `__seeders` table | `runSeeds` from `@dunx/infra/db`, journaling into `dunx_seeds`.                                                                                                                                                                                                           |
| `@nestjs/testing` `Test.createTestingModule`           | `createTestApp` / `createTestServer` from `@dunx/testing`.                                                                                                                                                                                                                |
| `axios` / `HttpModule` from `@nestjs/axios`            | `HttpModule` / `HttpService` from `@dunx/http/client` - `fetch` with a per-attempt timeout, retry, `Retry-After` and request-id propagation.                                                                                                                              |
| `scripts/gen-env-docs.ts`                              | the same script over the same zod schemas. `bun run gen:env:docs` writes `docs/env-vars.md`.                                                                                                                                                                              |
| `scripts/create-admin.ts`                              | the same script, over `betterAuth()` with no container. `AuthAdminSeeder` covers development and refuses to run in production, so this is how a deployment gets its first administrator.                                                                                  |
| `@nestjs/schedule` `ScheduleModule.forRoot()`          | `ScheduleModule` from `@dunx/infra/schedule`, with `@Cron`, `@Interval` and `@OnceOnBoot` on any provider. Built on `Bun.cron`, validated at decoration time. The NestJS template registered the module and declared no handlers; `SessionSweeper` here actually uses it. |
| `@nestjs/serve-static`                                 | `StaticModule` plus `app.use(StaticFiles)`. There is no index fallback, deliberately, so `HomeMiddleware` owns the one rule this app wants.                                                                                                                               |
| `.overrideProvider(X).useValue(y)`                     | `overrides: [provide(X, { useValue: y })]`, replaced in place by token.                                                                                                                                                                                                   |

## Authentication

| NestJS                                                        | dunx                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@thallesp/nestjs-better-auth` `AuthModule.forRootAsync`      | `AuthModule.forRootAsync({ useFactory, inject }, '/auth')` from `@dunx/auth`. The second argument is the mount - see below.                                                                                                                                                              |
| the package's global `AuthGuard`                              | `SessionGuard`, listed in `HttpOptions.middleware`. It is a provider, so `@UseGuards(SessionGuard)` on one controller also works.                                                                                                                                                        |
| `drizzleAdapter(db, { provider, schema })` by hand            | `drizzleDatabase(connection, { schema })` from `@dunx/auth/drizzle`. `provider` comes from the connection's own dialect.                                                                                                                                                                 |
| `req.user`, `@CurrentUser()`                                  | `AuthContext`, an `AsyncLocalStorage`. `src/auth/services/current-user.service.ts` wraps it. No parameter decorator exists.                                                                                                                                                              |
| `@Public()` / `AllowAnonymous`                                | same name, from `@dunx/http`. Better Auth's own handler carries it at class scope, which is what makes sign-in reachable.                                                                                                                                                                |
| `@Roles(...)` reading the `admin()` plugin's `role`           | same name, same source. `SessionGuard` reads it; `@dunx/openapi` reads the same metadata for `x-required-roles`.                                                                                                                                                                         |
| custom `bunBcryptPassword`                                    | `bunPassword`, which `AuthModule` applies by default when `emailAndPassword` is on.                                                                                                                                                                                                      |
| `RedisService` as `secondaryStorage`                          | `redisStorage(connection)`. Opt in with `AUTH_SESSION_STORE=redis`: it deliberately does not degrade.                                                                                                                                                                                    |
| `mergeBetterAuthSchema` in `setupDocs.ts`                     | `betterAuthDocument(auth, { basePath })` passed to `OpenApiModule.forRoot({ contribute })`. A declared route wins a collision.                                                                                                                                                           |
| `@ApiAuth()` Swagger marker                                   | nothing to add. `@Roles`/`@Public` already produce the security requirement.                                                                                                                                                                                                             |
| `HtmlSessionAuthMiddleware` over the docs and dashboard pages | split in two. Bull Board's half is `DashboardModule`'s own `authorize`, which takes the raw request and answers 404 when refused. The docs half is `DocsSessionMiddleware`, because `OpenApiModule` has no `authorize` - see [dunx#140](https://github.com/petarzarkov/dunx/issues/140). |

**The `basePath` and `mountAt` split is the one thing to get right.** Under
`setGlobalPrefix('api')` the handler is a route at `/auth` while better-auth
matches the whole pathname `/api/auth`, so the two are different strings for one
URL: mount at `/auth`, configure `basePath: '/api/auth'`. Getting it wrong is a
boot error rather than a 404 at runtime.

## Queues

| NestJS                                                       | dunx                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BullModule.forRootAsync` + `registerQueue`                  | `QueueModule.forRootAsync`. A queue is a key prefix, so there is nothing to register - `publisher.queue(name)`.                                                                                                                                    |
| `@Processor` class + `WorkerHost`                            | `@JobHandler({ queue, name })` on a method of any provider. No class decorator, no base class.                                                                                                                                                     |
| the template's own `JobDispatcher` + `job.processor.ts` fork | `WorkerFactory.create(workerModule())` in `src/worker.ts`. A worker is its own container, not a fork.                                                                                                                                              |
| `JobPublisherService`                                        | `JobPublisher`, which returns bullmq's own `Queue` rather than wrapping it.                                                                                                                                                                        |
| `ioredis` connection options                                 | a URL. `@dunx/infra/queue` runs bullmq's `createBunRedisClient` over `Bun.RedisClient`.                                                                                                                                                            |
| `@bull-board/express` at `/api/queues`                       | `@dunx/dashboard` at `/api/_dunx`, which mounts the real Bull Board over `@bull-board/bun` alongside panels for routes, providers, gateways, redis, config and runtime. `src/infra/queue/queues.controller.ts` stays as the programmable JSON API. |
| `runWithTimeout(jobTimeoutMs)` in the dispatcher             | `jobTimeoutMs` on `QueueOptions`.                                                                                                                                                                                                                  |

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
| namespaces                               | **still no equivalent.** One gateway is one path; topics do the rest.                                       |
| acknowledgement callbacks                | the handler's return value, sent back under the same event name.                                            |
| `@socket.io/redis-adapter`               | `relay: new RedisRelay({ url })` in `HttpOptions`. Two methods over `Bun.RedisClient`, no extra dependency. |
| `@socket.io/redis-emitter` in the worker | `encodeRelay` + `encode` onto the relay channel. `src/notifications/events/events.publisher.ts`.            |

## Cache and rate limiting

| NestJS                                                          | dunx                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CacheModule` + `keyv` + `KeyvIoredisAdapter` + `cache-manager` | `CacheService`, forty lines over `RedisConnection`. Three dependencies for six commands Bun already has.           |
| `ThrottlerModule` with three named tiers                        | `THROTTLE_LIMIT`/`THROTTLE_WINDOW_SECONDS`, and `@Throttle({ limit, windowSeconds })` to override per route.       |
| a second `EnvThrottlerGuard` with its own Lua script            | the same guard. `INCR` then `EXPIRE` on the call that created the key - Bun pipelines, so it is one round trip.    |
| `@EnvThrottle({ [AppEnv.PRD]: HOUR })`                          | the same `@Throttle`: `windowSeconds` takes a map beside a number, and `0` disables the limit for one environment. |
| `RedisService.newConnection(name, { db })` per concern          | one connection, or `RedisModule.forRootAsync(factory, 'name')` for a second. Key prefixes rather than db numbers.  |

## Deliberately not ported

Three things, and all three are the same reason: they are a product's choices, not
a framework's. The list was five. Swagger preauthorization and Postgres both came
off it, and what moved them is below.

| Not ported                           | Why                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI providers                         | A `fetch` to a vendor. Nothing about it is framework-shaped, and a template that picks one for you is picking wrong for most readers.                                                                                                                                                                                           |
| Resend email + React Email templates | Same: a transport the consumer owns. `EmailService` logs the message it would have sent, which is enough to prove the queue delivered the job to a worker, and swapping in a provider is one method body. Whether the _shape_ around it belongs in the framework is [dunx#139](https://github.com/petarzarkov/dunx/issues/139). |
| The CMS                              | A product feature, not a framework capability.                                                                                                                                                                                                                                                                                  |

## The four that came back

**Bull Board's page - gone, back, gone, and back again.** The first judgement was
that Bull Board is an Express-mounted React application and `Bun.serve` is not
Express, so what was portable was the _data_ - counts, one job, retry, drain - and
`/api/queues` served that as admin-only JSON.

That was wrong about the hard part: bull-board's `IServerAdapter` is a **sink**, so
implementing it over `Bun.serve` is about a page of code. `@dunx/queue-dashboard`
proved it, and was then deleted, because a queue-only dashboard is the wrong unit
for a framework.

`@dunx/dashboard` is the unit that was meant, and it shipped in 3.3.x: routes, the
provider graph, gateways, redis, config, runtime and the real Bull Board on one
page. So the row is closed by the framework rather than by this app. The JSON
controller stays beside it, because a page and a programmable API are not the same
thing and the e2e suite drives the second one.

The lesson was never "the original judgement was right". It is that **being right
about the mechanism is not the same as being right about the scope**, and that a
scope argument is the kind that gets settled by a later release.

**Swagger UI preauthorization.** Listed as unportable because dunx's explorer had
an Authorize dialog and no hook to drive it from a response. `SwaggerRenderer` takes
`requestInterceptor`, `responseInterceptor` and `onComplete` - as the **source of an
expression**, because the page is rendered on the server and a closure cannot
travel. The NestJS template's `setBearerOnLogin` is in `main.ts` now, near enough
verbatim.

**Postgres.** The claim was that the data layer is synchronous and making it async
is a rewrite of every repository. The first half is true and the second is not:
`SqlConnection` over `Bun.SQL` is bound the same way, and the reference pair in
dunx's own `examples/databases` differ by an `await` and an import. This template
still ships SQLite and still refuses `DB_TYPE=postgres` at boot, which is now a
choice about scope rather than a limit.

**Keyset pagination.** Never in this table, but it was ~200 lines of this app's own
code and it is now `@dunx/infra/pagination`. The framework's version fixed three
things on the way in: the cursor's id is any non-empty string rather than a UUID,
which silently broke keyset pagination over a serial id; a cursor is minted only
when there is a page in that direction, where a `nextCursor` on the last page reads
as "there is more" to any client checking for null; and the return type follows the
driver by overload, so a repository over `bun:sqlite` is synchronous end to end and
the same code serves `Bun.SQL`.

The pattern in all of them: **"dunx has no equivalent" is a statement with a date
on it.** This table was written against 1.2.0 and seven of its rows were wrong by
3.8.1 - not because the original reading was careless, but because the thing being
described kept moving. Re-read it against each release rather than trusting it, and
when a row is still right, say which version you checked.

Two rows are still open, and both have an issue rather than a workaround:
[dunx#137](https://github.com/petarzarkov/dunx/issues/137) for publishing to the
websocket relay from a worker, and
[dunx#140](https://github.com/petarzarkov/dunx/issues/140) for gating the explorer
the way the dashboard can be gated.
