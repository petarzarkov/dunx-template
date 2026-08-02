# dunx-template

A production-shaped starter for [dunx](https://petarzarkov.github.io/dunx/),
ported feature for feature from
[`nestjs-template`](https://github.com/petarzarkov/nestjs-template).

Validated configuration, structured logging with request context, one log entry
per request, health endpoints, prefixed REST controllers with zod validation and
keyset pagination, SQLite through drizzle with migrations, seeds and audit
triggers, a single error mapper, generated OpenAPI, unit / integration / e2e
suites, Docker and CI.

`MAPPING.md` is the NestJS-to-dunx concept table.

## Quick start

```bash
bun install
cp .env.example .env
bun run seed          # migrations, audit triggers and the admin row
bun run start
```

```
http://localhost:3001/api/service/health
http://localhost:3001/api/docs
http://localhost:3001/api/openapi.json
```

Every write route needs an actor. The seeded admin's id is in the `user` table:

```bash
ADMIN=$(bun -e 'import{Database}from"bun:sqlite";console.log(new Database("./data/app.db",{readonly:true}).query("select id from user where role=?").get("admin").id)')
curl -H "x-actor-id: $ADMIN" http://localhost:3001/api/users
```

## Scripts

| Script                | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `bun run dev`         | `bun --watch src/main.ts`                                        |
| `bun run start`       | `bun src/main.ts`, the shape the Dockerfile uses                 |
| `bun run build`       | `Bun.build` with `depsPlugin` into `dist/`; `start:dist` runs it |
| `bun run typecheck`   | `tsc --noEmit`                                                   |
| `bun run lint`        | oxlint, fixing in place. `lint:check` does not fix               |
| `bun run format`      | oxfmt. `format:check` does not write                             |
| `bun test`            | unit (`*.test.ts`) and integration (`*.spec.ts`) under `src/`    |
| `bun run test:e2e`    | spawns a real server and drives it over HTTP                     |
| `bun run mig:gen`     | `drizzle-kit generate`                                           |
| `bun run mig:run`     | applies migrations without booting the app                       |
| `bun run seed`        | migrate, apply triggers, then `runSeeds`                         |
| `bun run db:drop`     | deletes the SQLite file and its WAL sidecars                     |
| `bun run gen:openapi` | writes `openapi.json` with no container and no server            |

## Layout

```
src/
  main.ts                    bootstrap: create, configure, listen
  http.options.ts            the HttpOptions, shared with the test suites
  app.module.ts              the module graph, as a factory
  constants.ts               route segments and the actor header
  config/                    zod env schemas, validateConfig, AppConfigService
  core/
    errors/error-mapper.ts   the one ErrorMapper: HttpError, ValidationError, SQLiteError
    guards/roles.guard.ts    a guard is middleware that throws
    middlewares/             the audit-actor stamp
    pagination/              keyset cursors, no offsets
  infra/
    db/                      schema, columns, migrations, triggers, seeds, DbModule wiring
    health/                  liveness, readiness, build info
  users/                     controller, service, repository, schema, DTOs
  audit/                     read side of the trigger-written audit_log
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

## Licence

MIT.
