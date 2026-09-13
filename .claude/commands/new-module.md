---
description: Scaffold a new feature module the way this repository already does it.
---

Add a feature under `src/<name>/`, following `src/users/` and `src/files/`. Read
one of them first: the conventions below are descriptions of what is already
there, not aspirations.

## 1. Schema, `schema/<name>.schema.ts`

The drizzle table, and the single source of truth for the row type.

- Use the helpers in `src/infra/db/columns.ts`: `uuidPk()`, `createdAt()`,
  `updatedAt()`, `timestampMs()`.
- Export `type <Name>Row = typeof <table>.$inferSelect` and `New<Name>Row`.
- A status or kind column is a **frozen object**, never a TypeScript `enum`:

  ```ts
  export const InviteStatus = Object.freeze({ PENDING: 'pending' } as const);
  export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];
  ```

- Add the table to the barrel in `src/infra/db/schema.ts`, then run
  `bun run mig:gen` and commit the generated SQL.

## 2. DTOs, `dto/<name>.dto.ts`

zod schemas, and the route schema objects beside them.

- The response schema carries `.meta({ id, title })`, which is what lifts it into
  `components/schemas` and makes the document emit a `$ref`.
- Reuse `emailSchema` and `passwordSchema` from `src/core/zod/schemas.ts` rather
  than restating the rules.
- Paginated list? `pageOptionsSchema.extend({ ... })` for the query and
  `paginatedOf(X, 'PaginatedX')` for the response.
- Each route gets its own `const ... satisfies RouteSchemas` with a `response`
  keyed by status. **Do not share one object across methods**: `@Post` answers
  201 where `@Get` answers 200, so a shared schema documents a status the route
  never sends.

## 3. Repository, `repos/<name>.repository.ts`

There is no base class. Write the methods the feature needs, and make them
**synchronous** - the handle is `SyncDatabase` over `bun:sqlite`, and `paginate`
returns a `Page` rather than a promise of one against a sync driver.

```ts
export class WidgetsRepository {
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  findById(id: string): WidgetRow | undefined {
    return this.db.select().from(widgets).where(eq(widgets.id, id)).get();
  }
}
```

## 4. Service, `services/<name>.service.ts`

The feature's logic, and the only place that throws `HttpError`. Keep a
`present`/`sanitize` function at the top of the file that maps a row to the
response shape, so dates become ISO strings in one place.

## 5. Controller, `<name>.controller.ts`

Thin. One `input` argument per handler, typed `Input<typeof routeSchema>`.

- `@ApiDoc({ tags, summary })` on each handler and once on the class.
- `@Roles(...)` or `@Public()` per handler. Guards compose per route, so a public
  handler can sit in an otherwise admin-only controller - `InvitesController` is
  the example.
- Return the value; do not build a `Response` unless you need a non-JSON body or
  a status the schema cannot express.

## 6. Module, `<name>.module.ts`

A decorated class if it takes no options; a class with a static `forRoot()` if it
does. **Never both** - `resolveRef` concatenates decorator metadata with the
dynamic options, so a module carrying both registers every import twice.

```ts
@Module({
  imports: [AccountsModule],
  controllers: [WidgetsController],
  providers: [WidgetsService, WidgetsRepository],
})
export class WidgetsModule {}
```

Register it in `src/app.module.ts`. If the worker needs it too, add it to
`WorkerModule` with `{ controllers: false }`.

## 7. Tests

A `.spec.ts` beside the feature, built on `createTestServer` with
`...httpOptions(validateConfig(source))` - the harness inherits nothing from
`main.ts`, and a suite that omits them tests a server with no guards that still
boots and still answers.

## Rules

- Relative imports carry a `.js` extension.
- No parameter decorators exist. Read the caller from `CurrentUser`, not a
  `@CurrentUser()` argument.
- Anything injectable that is not a class is an `abstract class`, so the
  transform has a runtime value to record.
- Every new environment variable goes in `src/config/dto/`, into the validated
  shape in `env.validation.ts`, and then `bun run gen:env:docs`.
- Finish with `bun run check`.
