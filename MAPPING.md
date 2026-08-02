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

| NestJS                                      | dunx                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Body()`, `@Query()`, `@Param()`, `@Req()` | one `input` argument: `list(input: Input<typeof listUsers>)`. Which fields exist is decided by the route's schemas.                                  |
| `@Headers()`                                | `input.req.headers.get('...')`.                                                                                                                      |
| `@Res()`                                    | return a `Response`. `src/infra/health/health.controller.ts` does it for the 503.                                                                    |
| global `ZodValidationPipe` + `createZodDto` | a zod schema per source on the route: `@Get('/', { query: ListUsersQuery })`.                                                                        |
| `@ApiTags` + `@ApiOperation`                | one `@ApiDoc({ tags, summary, description })`. See the caveat in the README.                                                                         |
| `@ApiOkResponse({ type: X })`               | **no equivalent.** dunx documents inputs only.                                                                                                       |
| `CanActivate` guard                         | a `Middleware` that throws. `src/core/guards/roles.guard.ts`.                                                                                        |
| `APP_GUARD`                                 | `HttpFactory.create(root, { middleware: [Guard] })`.                                                                                                 |
| `@UseGuards(X)`                             | same name, same places, but guards compose rather than override.                                                                                     |
| `NestInterceptor`                           | a `Middleware`. Work before `next()`, after it, or both. `src/core/middlewares/audit-context.middleware.ts` was an `APP_INTERCEPTOR`.                |
| `ExceptionFilter` + `@Catch()`              | one `onError: ErrorMapper` passed to `create()`. `src/core/errors/error-mapper.ts` folds the generic filter and the SQLite filter into one function. |
| `enableVersioning` / `@Version()`           | **no equivalent.** `setGlobalPrefix('api')` only.                                                                                                    |
| `app.setGlobalPrefix('api')`                | same, but imperative-only and it throws after `listen()`.                                                                                            |
| `app.enableCors(...)`                       | same, imperative-only, before `listen()`.                                                                                                            |
| `app.set('trust proxy', true)`              | same. `AppSettings` has exactly this one key.                                                                                                        |
| Express body parser                         | none. Bun parses by content-type; an unsupported one is a 415 and the body is never read.                                                            |
| unmatched method gives 405                  | 404. Bun's router owns method dispatch.                                                                                                              |
| `/users` and `/users/` are the same route   | they are not. There is no trailing-slash normalisation.                                                                                              |

## Infrastructure

| NestJS                                                 | dunx                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/config` + `validate`                          | `ConfigModule.forRoot({ validate, as })`. Same single validation function.                                            |
| `ConfigService.get('a.b.c')` dotted path               | `config.get('a').b.c`. There is no dotted lookup.                                                                     |
| `ConfigModule.forRoot({ isGlobal: true })`             | nothing to pass. Everything is global.                                                                                |
| `@nestjs/config` `envFilePath`                         | nothing. Bun loads `.env` and `.env.local` itself.                                                                    |
| `@arkv/nestjs-context-logger`                          | `LoggerModule` from `@dunx/infra/logger`, which binds `@arkv/logger` to core's `Logger`.                              |
| `RequestMiddleware` + `HttpLoggingInterceptor`         | one built-in `RequestLoggingMiddleware`. One entry per request, not two.                                              |
| `@nestjs/terminus`                                     | **no equivalent.** `src/infra/health/health.controller.ts` reproduces the envelope in about twenty lines.             |
| `drizzle()` called by hand in `client.ts`              | `DbModule.forRootAsync(SyncDatabase, { useFactory, inject })`. It binds the drizzle handle under drizzle's own class. |
| `migrate()` inside the client factory                  | the same `drizzle-orm/bun-sqlite/migrator`, called from `DatabaseBootstrap`'s constructor.                            |
| `scripts/seed.ts` with a hand-rolled `__seeders` table | `runSeeds` from `@dunx/infra/db`, journaling into `dunx_seeds`.                                                       |
| `@nestjs/testing` `Test.createTestingModule`           | `createTestApp` / `createTestServer` from `@dunx/testing`.                                                            |
| `.overrideProvider(X).useValue(y)`                     | `overrides: [provide(X, { useValue: y })]`, replaced in place by token.                                               |

## Deliberately not ported

The NestJS template also carries AI providers, Resend email with React Email
templates, S3 file upload, BullMQ queues with a Bull Board dashboard, Socket.io
with a Redis adapter, Better Auth, a CMS and Redis caching and throttling. dunx
has an answer for most of them (`@dunx/infra/queue`, `@dunx/infra/files`,
`@dunx/infra/images`, `@dunx/auth`, `@dunx/http`'s gateways), but each drags in a
service dependency, and none of them is the part of the template you read first.
Authentication is the notable absence: `RolesGuard` reads an `x-actor-id` header
so that the guard, `@Roles`, `@Public` and the metadata machinery are all
exercised without a `better-auth` dependency. Swap it for `@dunx/auth`'s
`SessionGuard` when you add real sessions.
