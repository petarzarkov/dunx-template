# dunx-template

A production-shaped starter for [dunx](https://petarzarkov.github.io/dunx/),
ported feature for feature from
[`nestjs-template`](https://github.com/petarzarkov/nestjs-template).

Validated configuration, structured logging with request context, one log entry
per request, health endpoints, prefixed REST controllers with zod validation and
keyset pagination, SQLite through drizzle with migrations, seeds and audit
triggers, a single error mapper, an OpenAPI document and explorer served at
runtime, unit / integration / e2e suites, Docker and CI.

Plus every area that needs something running: **Better Auth** sessions with a
global guard and roles, **BullMQ** queues with a separate worker process,
**object storage** on local disk or S3, **image** processing on `Bun.Image`,
**websocket** gateways with multi-node fan-out, **Bull Board** at `/queues`, an
outbound HTTP client with retries, and **Redis** caching and rate limiting.

**None of it is required to be running.** An area whose service is absent reports
that it is skipping and the app boots anyway: `bun run start`, `bun test` and
`bun run test:e2e` all pass with nothing installed, and exercise the real thing
when it is up. `/api/service/health` says which is which.

`MAPPING.md` is the NestJS-to-dunx concept table, including the two things it once
listed as unportable and dunx has since shipped. `docs/env-vars.md` is every
environment variable, generated from the schemas that validate them.

## Quick start

```bash
bun install
cp .env.example .env
bun run start
```

```
http://localhost:3001/api/service/health
http://localhost:3001/api/docs          the API explorer, served at runtime
http://localhost:3001/api/openapi.json  the document, served at runtime
http://localhost:3001/queues            Bull Board, admin only
ws://localhost:3001/ws
```

Nothing else is needed: the migrations, the audit triggers and the first
administrator are all applied at boot. Every route but the health probes and
Better Auth's own endpoints needs a session, and the bearer token from a sign-in
is what carries it:

```bash
TOKEN=$(curl -sD - -o /dev/null -X POST http://localhost:3001/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"admin@local.dev","password":"admin-password"}' \
  | awk -F': ' '/^set-auth-token/ {print $2}' | tr -d '\r')

curl -H "authorization: Bearer $TOKEN" http://localhost:3001/api/users
curl -H "authorization: Bearer $TOKEN" -F file=@some.png http://localhost:3001/api/files
# Bull Board is a page, not JSON - open it in a browser with the session cookie,
# or see it 404 without one, which is deliberate.
curl -o /dev/null -w '%{http_code}\n' http://localhost:3001/queues
```

### With the services up

```bash
docker compose up -d                                  # valkey, and only valkey
REDIS_URL=redis://localhost:6379 bun run start
REDIS_URL=redis://localhost:6379 bun run worker       # a second process
```

The compose file starts **backing services only**. The app and the worker are not
services in it: `bun --watch src/main.ts` is a better development loop than a
container, and the `Dockerfile` is for deploying, which is a different job. MinIO is
behind a profile, so a plain `up` is Redis on its own:

```bash
docker compose --profile s3 up -d                     # valkey, minio, and a bucket
```

The cache, the rate limiter, the queue and websocket fan-out across nodes all go
live, and `/api/service/health` moves those areas from `degraded` to `up`. Set
`STORAGE_DRIVER=s3` with the five `S3_*` variables to put uploads in MinIO
instead of on disk - the backend is one `StorageOptions` subclass and no code
changes.

## Scripts

| Script                 | What it does                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`          | `bun --watch src/main.ts`                                                                                                                                                     |
| `bun run start`        | `bun src/main.ts`, the shape the Dockerfile uses                                                                                                                              |
| `bun run worker`       | `bun src/worker.ts`, the queue consumer. A second process                                                                                                                     |
| `bun run build`        | `Bun.build` with `depsPlugin` into `dist/`; `start:dist` runs it                                                                                                              |
| `bun run typecheck`    | `tsc --noEmit`                                                                                                                                                                |
| `bun run lint`         | oxlint, fixing in place. `lint:check` does not fix                                                                                                                            |
| `bun run format`       | oxfmt. `format:check` does not write                                                                                                                                          |
| `bun test`             | unit (`*.test.ts`) and integration (`*.spec.ts`) under `src/`                                                                                                                 |
| `bun run test:e2e`     | spawns a real server and drives it over HTTP                                                                                                                                  |
| `bun run mig:gen`      | `drizzle-kit generate`                                                                                                                                                        |
| `bun run mig:run`      | applies migrations without booting the app                                                                                                                                    |
| `bun run seed`         | migrate, apply triggers, then `runSeeds`                                                                                                                                      |
| `bun run db:drop`      | deletes the SQLite file and its WAL sidecars                                                                                                                                  |
| `bun run gen:openapi`  | exports `openapi.json` with no container and no server. The app serves the document itself at `/api/openapi.json`; this is for committing the contract and for client codegen |
| `bun run gen:env:docs` | regenerates `docs/env-vars.md` from the zod env schemas                                                                                                                       |

## Layout

```
src/
  main.ts                    bootstrap: create, configure, listen
  worker.ts                  the queue consumer, a container with no server
  http.options.ts            the HttpOptions, shared with the test suites
  app.module.ts              both module graphs: appModule() and workerModule()
  constants.ts               route segments and the websocket path
  config/                    zod env schemas, validateConfig, AppConfigService
  core/
    errors/error-mapper.ts   the one ErrorMapper: HttpError, ValidationError, SQLiteError
    decorators/              @Throttle, over @dunx/http's own metadata mechanism
    force-exit.ts            the shutdown watchdog, and why it exists
    middlewares/             the audit-actor stamp, read from AuthContext
  auth/                      Better Auth: options, module, schema, profile, admin seeder
  infra/
    db/                      schema, columns, migrations, triggers, seeds, DbModule wiring
    redis/                   RedisModule, the cache and the rate-limit guard
    queue/                   QueueModule, and Bull Board mounted at /queues
    files/                   StorageModule: local disk or S3, selected by config
    images/                  ImagesModule over Bun.Image
    health/                  liveness, readiness per area, build info
  users/                     controller, service, repository, schema, DTOs
  files/                     upload, download, presign, thumbnails, the media job
  notifications/             the websocket gateway, the events publisher, job handlers
  audit/                     read side of the trigger-written audit_log
  test-support/              sign-in helpers shared by the integration suites
e2e/                         suites against a spawned server
scripts/                     build, migrate, seed, db-drop, gen-openapi
```

## Things that will bite you

Collected while writing this. Each one has a comment at the site and, where it
matters, a test that pins the behaviour.

**The `bunfig.toml` preload is load-bearing.** Without
`preload = ["@dunx/transform/preload"]` no constructor parameter types are
recorded and boot fails. It has to be in the Docker image, and it must also be
under a separate `[test]` table or `bun test` boots nothing.

**A constructor parameter's type must be a value import.**

```ts
import type { SyncDatabase } from '@dunx/infra/db'; // boot error
import { SyncDatabase } from '@dunx/infra/db'; // works
```

Type-only imports are erased before the transform sees them, so the parameter is
recorded as unresolved. The same goes for a `type X = ...` alias over the class.
`verbatimModuleSyntax` and most editors will push you toward the broken form.

**Do not give a `@Module`-decorated class a static returning a `DynamicModule`
that names itself.** The two option sets are unioned, not overridden, so every
`forRoot()` in the decorator registers a second time and boot dies with
`Duplicate binding ... bound by module "ConfigModule" and module "ConfigModule"`.
`src/app.module.ts` is an undecorated class plus one `appModule()` factory.

**`@dunx/testing` inherits nothing from `src/main.ts`.** `createTestServer` takes
`middleware` and `onError`, and a suite that omits them gets a server with no
guards and no error mapper that still boots and still answers. That is why
`src/http.options.ts` exists.

**Repeat `tags` on every method-level `@ApiDoc`.** A method-level `@ApiDoc`
replaces the class-level one wholesale, so a class tag is dropped and the
operation silently falls back to the class-name default.

**`betterAuthDocument`'s `basePath` is prefixed again by `setGlobalPrefix`.**
Passing `AuthOptions.basePath` verbatim, which is what its documentation says,
gives you `/api/api/auth/sign-in/email` with no warning. Pass the **mount** -
`/auth`, the second argument to `AuthModule.forRootAsync` - and let the explorer
add the one prefix.

**A user row is not a user.** Inserting into `user` gives you a row with no
`account` row and therefore no password hash, so it can never sign in.
`UsersService.create` and `AuthAdminSeeder` both go through
`auth.api.signUpEmail`; the drizzle seeder deliberately creates directory entries
that cannot authenticate, and says so.

**better-auth's drizzle adapter matches on the export name.** It looks the model
up as `fullSchema['user']`, so a barrel that exports `users` needs the explicit
`schema: { user: users, ... }` mapping, whatever `drizzleDatabase`'s
documentation says. Without it the first query is
`BetterAuthError: The model "user" was not found in the schema object`.

**A global guard also guards the 404.** `listen()` puts the global middleware in
front of the not-found fallback, which is what gets an unmatched path logged and
given a request id - and means an anonymous request for a path that does not
exist is a 401 rather than a 404. Pinned in `src/users/users.spec.ts`.

**A process that touched a down Redis does not exit on `SIGTERM`.** bullmq holds
a connection whose retry timer outlives `close()`. Measured here at 30 seconds
and counting, and this app enqueues at boot, so it is squarely in that case.
`src/core/force-exit.ts` is the workaround: `process.exit(0)` once `app.closed`
resolves, with a referenced timer as the backstop.

**Rate-limit counters outlive the process.** They are in Redis, so two
deployments sharing one need two `THROTTLE_PREFIX` values, and a test run needs
its own or it inherits the last one's counters.

**No response bodies in the OpenAPI document.** `RouteSchemas` has `body`,
`query` and `params` and no `response`, so every success response is a bare
description. `SanitizedUser` and friends carry `.meta({ id })` and never reach
`components`. `src/openapi.spec.ts` pins this so it is visible when it changes.

**`requestLogging.ignore` also turns off request ids.** `x-request-id` is set by
the request-logging middleware, so an ignored path gets no correlation header and
no async context either.

**Column names are spelled out.** `@dunx/infra`'s `SqliteOptions` forwards only
`schema` to `drizzle()`, so `casing: 'snake_case'` and drizzle's query `logger`
are unreachable.

**Emitted JS needs `depsPlugin`, not the preload.** The preload plugin's filter is
`/\.tsx?$/`, so a plainly transpiled `dist/` fails at boot with a message telling
you to add a preload that is already there and cannot help. `scripts/build.ts`
uses `Bun.build({ plugins: [depsPlugin] })`.

## Configuration

Every variable is in `.env.example` and validated once at boot by
`src/config/env.validation.ts`. `API_PORT` has no default, so an empty
environment fails with a message naming it. `DB_TYPE=postgres` is rejected: the
data layer is synchronous `bun:sqlite` and `Bun.SQL` is a socket.

Four cross-field rules exist because a single field's validator cannot see them:
`POSTGRES_URL` when `DB_TYPE=postgres`, `S3_BUCKET` when `STORAGE_DRIVER=s3`,
`REDIS_URL` when `AUTH_SESSION_STORE=redis`, and `BETTER_AUTH_SECRET` when
`APP_ENV=prod`. The last one is why the Docker image refuses to boot without a
secret: the development fallback is a constant in this repository, and anyone
holding it can mint a session.

`REDIS_URL` is optional everywhere. Absent, the cache reports itself degraded,
the rate limiter stops counting rather than refusing every request, the queue
routes answer 503 in single-digit milliseconds and websocket fan-out stays local
to the process. The one thing that does **not** degrade is
`AUTH_SESSION_STORE=redis`, which is why it is an explicit opt-in: a swallowed
`null` from a session read would sign every user out.

## Testing

Three layers, split by filename, the way the NestJS template split them.

- `*.test.ts` are unit tests: `createTestApp` with `overrides` replacing
  collaborators. A collaborator has to be listed in the fixture module's
  `providers` before it can be overridden, even though it would self-bind.
- `*.spec.ts` are integration tests: `createTestServer` on port 0 against
  `:memory:` SQLite, so the migrations and the triggers run for real.
- `e2e/**/*.e2e.ts` spawn `bun src/main.ts` as a separate process and drive it
  over HTTP, which is the only layer that covers the preload, `.env` loading, a
  real database file and `SIGTERM` shutdown.

Every suite authenticates through `POST /api/auth/sign-in/email` and the bearer
token that comes back, so the tests go through the same `SessionGuard` as
production rather than a test-only door.

Service-dependent assertions are probe-gated, never skipped by convention: the
queue suite enqueues once and only spawns a worker if that answered, and
`src/infra/redis/redis.spec.ts` asserts **both** sides - a broker pointed at a
closed port has to degrade, and a live one has to actually count. CI runs the
whole thing twice, once with nothing running and once with Valkey up.

## Licence

MIT.
