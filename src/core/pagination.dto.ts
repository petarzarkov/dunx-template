import {
  PAGINATION,
  PaginationDirection,
  PaginationOrder,
} from '@dunx/infra/pagination';
import { z } from 'zod';

/**
 * The zod half of pagination, which is the only half this app still owns.
 *
 * The cursor codec, the keyset query, the options bounds and the response envelope
 * all moved to `@dunx/infra/pagination`. What cannot move is the *schema*: dunx's
 * route validation targets Standard Schema, so `@dunx/infra` deliberately ships no
 * zod schema - shipping one would pick a validator for every consumer. The
 * constants are exported precisely so an app can build its own and get the OpenAPI
 * document for free, because the schema is then its own.
 *
 * So the bounds are still stated once, and still stated here - they are just no
 * longer *invented* here. Changing `PAGINATION.MAX_TAKE` upstream changes what this
 * route accepts and what the document says it accepts, together.
 */
export const pageOptionsSchema = z.object({
  order: z
    .enum([PaginationOrder.ASC, PaginationOrder.DESC])
    .default(PAGINATION.DEFAULT_ORDER),
  direction: z
    .enum([PaginationDirection.FORWARD, PaginationDirection.BACKWARD])
    .default(PAGINATION.DEFAULT_DIRECTION),
  take: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_TAKE)
    .max(PAGINATION.MAX_TAKE)
    .default(PAGINATION.DEFAULT_TAKE),
  cursor: z.string().max(PAGINATION.MAX_CURSOR).optional(),
  search: z.string().min(1).max(PAGINATION.MAX_SEARCH).optional(),
});

/**
 * Assignable to `@dunx/infra/pagination`'s `PageOptions`, which is what lets the
 * validated query go straight into `paginate` with no adapter. `order` is lowercase
 * now (`asc`/`desc`) because that is what the framework's frozen object spells -
 * the enum this replaced used `ASC`/`DESC`, so a client sending `?order=DESC` gets a
 * 400 where it used to get a page.
 */
export type PageOptionsQuery = z.infer<typeof pageOptionsSchema>;

const pageMetaSchema = z.object({
  take: z.number().int(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable(),
});

/**
 * The response schema for a page of `item`, named for the OpenAPI components.
 *
 * Deliberately **not** called `pageOf`, which is what it was before: that name now
 * belongs to `@dunx/infra/pagination`'s runtime envelope builder, and two functions
 * with one name doing different things in the same codebase is how someone imports
 * the wrong one and gets a type error three files away.
 */
export const paginatedOf = <T extends z.ZodType>(item: T, id: string) =>
  z
    .object({ data: z.array(item), meta: pageMetaSchema })
    .meta({ id, title: id });
