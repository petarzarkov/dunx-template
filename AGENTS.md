# Working in this repository

A dunx application on Bun. `README.md` is the tour and `MAPPING.md` is the
NestJS-to-dunx concept table; this is what to do and what not to.

Run `bun run check` when you are done. It is lint, format, typecheck and the
suites, and it is what CI runs.

## The shape of things

- **Bun only.** Never `npm`, `npx`, `yarn` or `pnpm`. `bunx` to run a tool,
  `bun <file.ts>` to execute TypeScript.
- **ESM, and relative imports carry a `.js` extension.** The source says `.js`
  and the file is `.ts`; that is correct and not a typo.
- **TC39 standard decorators.** `experimentalDecorators` and
  `emitDecoratorMetadata` are deliberately absent, so there is no
  `reflect-metadata`, no `tsyringe`, and **no parameter decorators** - `@Inject()`,
  `@Body()`, `@Param()` and `@CurrentUser()` do not exist and cannot.
- **Nothing is required to be running.** An area whose service is absent reports
  itself degraded and the app boots anyway. `bun test` and `bun run test:e2e`
  both pass on a machine with nothing installed. Any new area has to keep that
  true.

## Dependency injection

Constructor injection needs no annotation: `@dunx/transform` reads constructor
parameter types at load time, enabled by one line in `bunfig.toml`.

```ts
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}
```

A parameter whose type is erased - an interface, a primitive, a union, a
type-only import - is a **boot error naming that parameter**, not a silent
`undefined`. When you need an injectable contract, declare an `abstract class`:
it is a runtime value, so it can be a parameter type. `EventsPublisher` and
`Storage` are the examples.

**The container is scoped, not flat.** This is the thing that bites:

- A dynamic module's factory sees only what **that module** imports. Importing
  something beside it in `AppModule` reaches the app's scope, not the factory's.
  `AppDashboardModule` imports `AccountsModule` itself for exactly this reason.
- `OpenApiModule` wraps `AppModule` as its root, so `AppModule` cannot see
  `OpenApiExplorer`. `ReferenceMiddleware` is in no `providers` list and
  self-binds through `app.use`, which asks from the app root.
- A module that takes no options is a **decorated class**, not a `forRoot()`. A
  factory returns a fresh object per call, which is a fresh scope per call.

## Routes

One `input` argument, shaped by the route's own schemas. Declare the schemas once
as a `const ... satisfies RouteSchemas` and derive the handler's parameter from
it with `Input<typeof x>`.

`response` is keyed by status and is checked against the handler's return type by
tsc, so **do not share one schema object across methods**: `@Post` answers 201
where `@Get` answers 200, and a shared schema documents a status the route never
sends. `oneUser` and `setUserBan` are split for this reason.

Metadata is `metaKey` plus `meta`, read back with `ctx.get(KEY)`. That is how
`@Throttle`, `@NoCache`, `@Roles` and `@Public` all work, and it is how any new
marker should.

## Middleware order

`httpOptions.middleware` runs before anything `app.use` appends, and the order in
that array is the order they run. `DashboardMiddleware` is ahead of
`SessionGuard` on purpose: it does its own authorization against better-auth, and
behind the guard its polling would also be counted by `ThrottleGuard` against a
single key. `ThrottleGuard` is `@dunx/http`'s now, and it skips unmatched paths
unless a route claims them.

The documentation is not gated by a middleware at all. `OpenApiModule` and
`DashboardModule` each take an `Authorize`, and `ReferenceMiddleware` runs the
same function through `gate()` for the Scalar page this app mounts itself. An
`Authorize` returning a `Response` refuses with it, which is how a browser gets a
login form where an API client would get a 404.

`notFound: 'public'` is set, so an unmatched path is a 404 rather than the
guard's 401. Middleware appended by `app.use` relies on that.

## Data

Repositories are **synchronous**, including `list`: the handle is `SyncDatabase`
over `bun:sqlite`, and `paginate` picks its return type off the driver by
overload. Do not add an `async` to a repository that has no reason for one.

A user is created through **better-auth's own sign-up**, never by inserting a
row: a row written straight into `user` has no `account` row, so it has no
password hash and could never sign in.

Audit rows are written by SQLite triggers, not application code, and the actor
comes from `AuditContextMiddleware`. If you add an audited table, add it to
`AUDITED_TABLES` and add an e2e assertion - the two halves only agree at runtime.

## Tests

- `*.test.ts` is a unit test, `*.spec.ts` boots a container, `*.e2e.ts` drives a
  spawned server over HTTP.
- A spec that needs production behaviour sets `APP_ENV`/`NODE_ENV` in its own
  `source`. The response cache and the docs gate are both only reachable that
  way, which is exactly why they have suites.
- **`test.skipIf` is evaluated when a test is registered**, before any hook. A
  flag set in `beforeAll` is still `false` there, so every guarded test skips and
  the suite reports success while asserting nothing. Probe at module scope.
- A suite that needs Redis probes for it and skips, because the suites have to
  pass with nothing running.

## Do not

- Do not add `reflect-metadata`, `experimentalDecorators`, or a parameter
  decorator.
- Do not write a router. `Bun.serve({ routes })` does params, per-method dispatch
  and method-miss 404s natively.
- Do not reach for a library for something Bun has: `Bun.password`, `Bun.S3Client`,
  `Bun.RedisClient`, `Bun.Image`, `Bun.Glob`, `Bun.cron`, `bun:sqlite`.
- Do not use an em dash or en dash anywhere, including commit messages.
- Do not add a `Co-Authored-By` or any attribution trailer to a commit.
- Do not hand-edit `docs/env-vars.md` or `openapi.json`; both are generated.

## Three messaging shapes, and which is which

Getting these confused is the easiest mistake to make here, because all three
carry a payload somewhere:

- **A bullmq job** is work this system owes and must finish. Durable, retried,
  exactly one consumer. `JobPublisher.publish`, and a failure to enqueue is told
  to the caller.
- **An AMQP domain event** is a fact other services subscribe to. Zero or many
  consumers, and this app is not responsible for what they do with it.
  `DomainPublisher.announce`, which never throws.
- **An `AppEvent`** crosses nothing. It is how one part of this process tells
  another that something happened, without naming who listens. `EventBus.emit`.

A subscriber that must survive a restart wants the queue. One in another service
wants the exchange. One that only needs to react wants the bus.

## The health report carries data, not just prose

`ProbeResult` has `detail` for the one line an operator reads and `data` for the
values anything else reads. A new indicator should fill both: a scrape or an
alert rule cannot parse a sentence, and `QueueIndicator` is the example - per
queue counts as numbers, and the same counts flattened into `detail`.

## SQLite is multi-writer here

A web server, a worker, and a forked child per `@JobHandler({ background: true })`
job all write one file. `SQLITE_PRAGMAS` sets `busy_timeout` for exactly that
reason - WAL lets many readers run beside one writer, but a second writer gets
`SQLITE_BUSY` back immediately rather than waiting. Open every connection with
that constant.
