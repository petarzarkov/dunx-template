import { z } from 'zod';

export const PaginationOrder = Object.freeze({
  ASC: 'ASC',
  DESC: 'DESC',
} as const);
export type PaginationOrder =
  (typeof PaginationOrder)[keyof typeof PaginationOrder];

export const PaginationDirection = Object.freeze({
  FORWARD: 'forward',
  BACKWARD: 'backward',
} as const);
export type PaginationDirection =
  (typeof PaginationDirection)[keyof typeof PaginationDirection];

/**
 * Keyset pagination only. There is no `page`/`offset`, because an offset scan
 * degrades with depth and shifts under concurrent writes.
 */
export const pageOptionsSchema = z.object({
  order: z
    .enum([PaginationOrder.ASC, PaginationOrder.DESC])
    .default(PaginationOrder.DESC),
  cursor: z.string().max(512).optional(),
  direction: z
    .enum([PaginationDirection.FORWARD, PaginationDirection.BACKWARD])
    .default(PaginationDirection.FORWARD),
  take: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().min(1).max(256).optional(),
});

export type PageOptions = z.infer<typeof pageOptionsSchema>;

export const pageMetaSchema = z.object({
  take: z.number().int(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable(),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;

export interface Page<T> {
  readonly data: readonly T[];
  readonly meta: PageMeta;
}

/** The response schema for a page of `item`, named for the OpenAPI components. */
export const pageOf = <T extends z.ZodType>(item: T, id: string) =>
  z
    .object({ data: z.array(item), meta: pageMetaSchema })
    .meta({ id, title: id });
