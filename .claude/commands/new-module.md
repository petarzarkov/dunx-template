---
description: Scaffold a new NestJS domain module with the standard folder structure for this project.
---

The user will pass the module name as an argument (e.g. `/new-module bonus`).
Use that name (kebab-case for files, PascalCase for classes, snake_case for the
DB table).

This is a **Drizzle + `bun:sqlite` (synchronous)**, **Zod (nestjs-zod)**,
**Better Auth** stack. Create the following under `src/<name>/`:

```
src/<name>/
  <name>.module.ts          # @Module — controllers + providers (no forFeature)
  <name>.controller.ts      # Thin controller: routes + payload marshalling
  services/                 # <name>.service.ts — business logic (@Injectable)
  repos/                    # <name>.repository.ts — extends BaseRepository
  schema/                   # <name>.schema.ts — Drizzle sqliteTable (source of truth)
  entity/                   # <name>.entity.ts — Swagger DTO derived from the schema
  dto/                      # request/query DTOs (Zod via createZodDto)
  enum/                     # TS enums
```

Only create the folders you need now — add `guards/`, `handlers/`,
`validators/` later if the feature calls for it.

## 1. Schema (`schema/<name>.schema.ts`) — the single source of truth

```ts
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, updatedAt, uuidPk } from '@/infra/db/columns';

export const bonuses = sqliteTable(
  'bonus',
  {
    id: uuidPk(),
    name: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('UQ_bonus_name').on(t.name)],
);

export type BonusRow = typeof bonuses.$inferSelect;
export type NewBonusRow = typeof bonuses.$inferInsert;
```

- Use the `columns.ts` helpers (`uuidPk`, `createdAt`, `updatedAt`,
  `timestampMs`); `casing: 'snake_case'` derives column names from the property
  key, so pass no name argument.
- **Name every index / unique constraint explicitly** (`UQ_<table>_<cols>`,
  `<table>_<cols>_index`); FKs via `.references(() => other.id, { onDelete })`.
- **Register the table in the barrel** `src/infra/db/schema.ts` so Drizzle (and
  the boot-time migrator) discovers it.

## 2. Entity (`entity/<name>.entity.ts`) — single source of truth from the schema

Derive the Swagger DTO from the Drizzle table with `drizzle-zod`, wrapped in
`withDateFormat` (`@/core/zod/entity-schema`). Refine enum/JSON columns:

```ts
import { createSelectSchema } from 'drizzle-zod';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { withDateFormat } from '@/core/zod/entity-schema';
import { bonuses } from '../schema/bonus.schema';
// import { BonusKind } from '../enum/bonus-kind.enum';

export const bonusSelectSchema = withDateFormat(
  createSelectSchema(bonuses, {
    // kind: z.enum(BonusKind),  // refine $type<Enum>() text columns
  }),
);

export class BonusEntity extends createZodDto(bonusSelectSchema) {}
```

One definition, no drift. `withDateFormat` is required: zod v4 can't represent
`z.date()` in JSON Schema, so a plain `createZodDto` with a date column crashes
Swagger at boot (`Date cannot be represented in JSON Schema`,
nestjs/swagger#3672) — the helper attaches a `string`/`date-time` override to
each date column. See `src/users/entity/user.entity.ts` (note `SanitizedUser`
stays a class so it works as both a type and a Swagger value).

Response subsets / request DTOs reuse the same schema:
`bonusSelectSchema.omit({ path: true })`, or
`bonusSelectSchema.pick({ name: true }).extend({ email: emailSchema }).partial()`
for an update DTO that needs stricter-than-DB validation (see
`src/users/dto/user.dto.ts`).

## 3. Request / query DTOs (`dto/`)

Plain Zod via `createZodDto` (class-validator is NOT used). Paginated list DTOs
extend the shared cursor options:

```ts
import { createZodDto } from 'nestjs-zod';
import { pageOptionsSchema } from '@/core/pagination/dto/page-options.dto';

export class ListBonusesQueryDto extends createZodDto(
  pageOptionsSchema.extend({/* search: z.string().optional() */}),
) {}
```

## 4. Repository (`repos/<name>.repository.ts`) — extend `BaseRepository`

`BaseRepository` (`@/infra/db/base.repository`) provides `findById`, `create`,
`save` (upsert), `update`, `deleteById`, and a protected `paginate(...)`. Inject
`DRIZZLE_DB` + `PaginationFactory` (both global) and declare only bespoke finders:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PaginationFactory } from '@/core/pagination/pagination.factory';
import { BaseRepository } from '@/infra/db/base.repository';
import { DRIZZLE_DB, type DrizzleDB } from '@/infra/db/database.module';
import { bonuses } from '../schema/bonus.schema';
import { BonusEntity } from '../entity/bonus.entity';

@Injectable()
export class BonusesRepository extends BaseRepository<typeof bonuses> {
  constructor(
    @Inject(DRIZZLE_DB) db: DrizzleDB,
    paginationFactory: PaginationFactory,
  ) {
    super(db, bonuses, paginationFactory);
  }

  findByName(name: string): BonusEntity | null {
    return (
      this.db.select().from(bonuses).where(eq(bonuses.name, name)).get() ?? null
    );
  }
}
```

Data access is **synchronous** — `.get()` / `.all()` / `.run()`, no `await`.
See `src/users/repos/users.repository.ts` for a paginated example.

## 5. Module + registration

```ts
import { Module } from '@nestjs/common';
import { BonusesController } from './bonuses.controller';
import { BonusesRepository } from './repos/bonuses.repository';
import { BonusesService } from './services/bonuses.service';

@Module({
  controllers: [BonusesController],
  providers: [BonusesService, BonusesRepository],
  exports: [BonusesService],
})
export class BonusesModule {}
```

- `DatabaseModule` is `@Global` (`DRIZZLE_DB` token) — there is **no**
  `forFeature`; don't import it per module.
- Add `BonusesModule` to the `imports` array of `src/app.module.ts` among the
  domain modules.

## 6. Controller — thin, declarative

- `@Injectable()` services own logic; controllers marshal DTOs only.
- Auth: guards are global (Better Auth `AuthGuard` + `RolesGuard`). Use
  `@Public()` (bypass), `@Roles(UserRole.ADMIN)`, `@CurrentUser()`, `@ApiAuth()`
  from `@/core/decorators`.
- `@UUIDParam`/`@ApiUuidParam` for UUID route params.

## Rules

- `@/` alias for cross-module imports; relative paths within a module.
- Do **not** create gateways or queue handlers unless the user asks.
- After scaffolding, generate the migration with `bun run mig:gen` (see
  `/gen-migration`) — it also auto-applies on app boot.

After scaffolding, tell the user: (1) files created; (2) next steps — register in
`app.module.ts`, add routes, write tests (`*.spec.ts` against in-memory SQLite),
generate the migration.
