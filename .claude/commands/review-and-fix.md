---
description: Review staged/unstaged changes for correctness and project conventions, then run all four quality gates and fix any failures.
---

## Step 1 — Code review

Run `git diff HEAD` (or `git diff --cached` if changes are staged) and review the
diff against the rules in AGENTS.md. Check for:

- **Architecture**: thin controllers/gateways; business logic in `@Injectable()`
  services; DB access through repositories that extend `BaseRepository`
  (synchronous Drizzle — `.get()`/`.all()`/`.run()`, no `await` on queries).
- **New domain modules** not added to the `imports` of
  [`src/app.module.ts`](../../src/app.module.ts). (There is no
  `DatabaseModule.forFeature` — `DRIZZLE_DB` is global.)
- **New Drizzle tables** not registered in the `src/infra/db/schema.ts` barrel,
  or missing explicit constraint names — `uniqueIndex('UQ_table_cols')`,
  `index('table_cols_index')`, `.references(() => x.id, { onDelete: 'cascade' })`
  — using the `columns.ts` helpers (`uuidPk`, `createdAt`, `updatedAt`).
- **Response shapes** hand-written where a zod schema with `.meta({ id })` should
  carry them, or a route schema shared across methods so it documents a status
  the route never sends (`@Post` answers 201, `@Get` answers 200).
- **Validation** anywhere but a zod schema on the route. There is no
  class-validator and no `createZodDto`.
- Roles typed as `string` where they should be `UserRole`; routes missing
  `@Roles(...)` / `@Public()` where intended; the caller read from anywhere but
  `CurrentUser` - there is no `@CurrentUser()` parameter decorator and there
  cannot be one.
- `console.log` instead of the injected `Logger`; plain `fetch` instead of
  `HttpService` from `@dunx/http/client`.
- Ad-hoc thrown errors where `HttpError` fits; literal status codes (`401`,
  `404`) where `HttpStatusCode.*` should be used.
- **User creation / password handling** done in app code — Better Auth owns
  password hashing (native Bun bcrypt); accounts are created via `auth.api`
  (`signUpEmail`), never a manual hash or a direct `user`/`account` insert.
- Paginated endpoints not using cursor pagination via `BaseRepository.paginate`
  / `PaginationFactory` (no offset/page-number pagination).
- New env vars not added to `.env.example` **and** `.env` **and** the relevant
  Zod DTO in `src/config/dto/`, or `bun run gen:env:docs` not regenerated.
- Audit handled in app code instead of the DB triggers; sensitive fields that
  should be masked in logs (`LOGGER.defaultMaskFields`).

Report all issues found before making any fixes.

## Step 2 — Apply fixes

Fix every issue identified in Step 1. Explain each fix briefly as you apply it.

## Step 3 — Quality gates

Run the four gates in order and fix all failures:

```
bun run lint
bun test
bun run build
bun run typecheck
```

Iterate until all four pass. Then give a final summary of what was changed and
the gate results.
