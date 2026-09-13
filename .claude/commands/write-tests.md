---
description: Write unit, integration and/or e2e tests for a given service or module, following this project's Bun-test conventions.
---

The user will name the target (e.g. `/write-tests FileService`).
If not specified, ask which service/module to test.

### Test taxonomy (three tiers, by file extension)

- **Unit** (`<name>.test.ts`, next to the source) — pure logic, all deps mocked,
  no I/O. Run with `bun run test:unit`.
- **Integration** (`<name>.spec.ts`, next to the source) — real components against
  an **in-memory SQLite** DB (`createDrizzleClient(':memory:')` — migrations +
  audit triggers applied exactly as on boot). Run with `bun run test:int`.
- **E2E** (`e2e/<feature>/<feature>.e2e.ts`) — a real running app + a **throwaway
  SQLite DB**, exercising HTTP/WS end-to-end. Run with `bun run test:e2e`.

Ask (or infer) which tier(s) to write. `bun run test` runs unit + integration.

### Unit tests (`<name>.test.ts`)

- Import primitives from `bun:test`: `describe`, `it`/`test`, `expect`,
  `beforeEach`, `afterEach`, `mock`. There is **no** `jest`.
- A unit test needs no container. Construct the class with hand-built
  collaborators: `new SessionSweeper(db, logger)`. Reach for `createTestApp`
  from `@dunx/testing` only when the graph is the thing under test.
- Mock with `mock(() => undefined)` and pass the double straight into the
  constructor. `overrides: [provide(X, { useValue: y })]` replaces a provider by
  token when you do build a container.
- Reset call history in `afterEach` (`.mockClear()`); never share mutable state.
- A pure rule with branches is worth its own test without a server:
  `src/core/decorators/throttle.test.ts` is the pattern.

### Integration tests (`<name>.spec.ts`)

- Spin up a throwaway DB: `const { db, sqlite } = createDrizzleClient(':memory:')`
  in `beforeEach`; `sqlite.close()` in `afterEach`.
- Either drive Drizzle directly (see
  [`src/infra/db/triggers.spec.ts`](../../src/infra/db/triggers.spec.ts)) or wire
  the real provider through a `TestingModule` with
  `{ provide: DRIZZLE_DB, useValue: db }` (see
  [`src/users/repos/users.repository.spec.ts`](../../src/users/repos/users.repository.spec.ts)).

### E2E tests (`e2e/<feature>/<feature>.e2e.ts`)

- Import primitives from `bun:test` (`describe`, `test`, `expect`, `afterEach`).
- Use the shared singleton context:
  `import { getTestContext } from '../setup/context'` →
  `const ctx = getTestContext()`. It exposes:
  - `ctx.api` — HTTP client (`get`/`post`/…, generic-typed); `ctx.api.signUp(...)`
    and `ctx.api.login(...)` hit Better Auth's native routes (`{ token, user }`).
  - `ctx.db` — direct Drizzle access for setup/teardown
  - `ctx.ws` — Socket.io client (authenticate with the bearer session token)
  - `ctx.loginAsAdmin()` → `{ token }` for the seeded admin
  - `ctx.reset()` — clear auth token + disconnect WS (call in `afterEach`)
- Respect the rate limiter: the short throttle is 10 req/1s, so add
  `await Bun.sleep(1100)` at the start of throttle-sensitive tests (see
  [`e2e/users/users.e2e.ts`](../../e2e/users/users.e2e.ts)).
- Clean up rows you create (delete dependent `auditLogs` first, then the entity)
  via `ctx.db`.
- Paginated endpoints follow the cursor contract — assert on `data` + `meta`
  (`take`, `hasNextPage`, `hasPreviousPage`, `nextCursor`, `previousCursor`).

### General rules

- Test **services**, not controllers or gateways (controllers stay thin).
- Cover happy path, error/exception paths (`NotFoundException`,
  `BadRequestException`, …), and edge cases.
- Don't write tests for migrations or scripts.
- After writing, confirm they pass:
  - Unit / integration: `bun run test`
  - Single e2e: `bun run test:e2e:single ./e2e/<feature>/<feature>.e2e.ts`
