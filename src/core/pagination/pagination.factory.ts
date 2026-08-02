import { and, asc, desc, gt, lt, or, eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { SyncDatabase } from '@dunx/infra/db';
import * as schema from '../../infra/db/schema.js';
import { decodeCursor, encodeCursor } from './cursor.util.js';
import {
  PaginationDirection,
  PaginationOrder,
  type Page,
  type PageOptions,
} from './page-options.dto.js';

export interface PaginateArgs<TTable extends SQLiteTable> {
  readonly table: TTable;
  readonly id: SQLiteColumn;
  /** The keyset sort column. Must be monotonic per row. */
  readonly sort: SQLiteColumn;
  /** The sort column's property name on the selected row. */
  readonly sortKey: string;
  readonly options: PageOptions;
  readonly where?: SQL | undefined;
}

const sortValue = (row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  return value instanceof Date ? value.toISOString() : String(value);
};

/**
 * Keyset pagination over a synchronous `bun:sqlite` handle. It fetches
 * `take + 1` rows as a has-more sentinel, so there is no COUNT.
 */
export class PaginationFactory {
  /**
   * The annotation has to be the class name itself. `@dunx/transform` records the
   * bare type name from the parameter, so a `type Db = SyncDatabase<...>` alias is
   * erased and boot fails naming this parameter.
   */
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  paginate<TTable extends SQLiteTable, TRow extends Record<string, unknown>>(
    args: PaginateArgs<TTable>,
  ): Page<TRow> {
    const { table, id, sort, sortKey, options, where } = args;
    const backward = options.direction === PaginationDirection.BACKWARD;
    // Backward paging walks the opposite way and the result is reversed at the end.
    const ascending = (options.order === PaginationOrder.ASC) !== backward;
    const compare = ascending ? gt : lt;

    let keyset: SQL | undefined;
    if (options.cursor !== undefined) {
      const { s, i } = decodeCursor(options.cursor);
      // The cursor carries an ISO string, but the column is
      // `integer({ mode: 'timestamp_ms' })`, and drizzle's driver mapper calls
      // `.getTime()` on whatever it is handed. A string there is a TypeError
      // from inside drizzle, not a query that returns nothing.
      const bound = new Date(s);
      keyset = or(compare(sort, bound), and(eq(sort, bound), compare(id, i)));
    }

    const predicate =
      where === undefined
        ? keyset
        : keyset === undefined
          ? where
          : and(where, keyset);

    const direction = ascending ? asc : desc;
    const rows = this.db
      .select()
      .from(table)
      .where(predicate)
      .orderBy(direction(sort), direction(id))
      .limit(options.take + 1)
      .all() as TRow[];

    const hasMore = rows.length > options.take;
    const page = hasMore ? rows.slice(0, options.take) : rows;
    const ordered = backward ? [...page].reverse() : page;

    const first = ordered[0];
    const last = ordered[ordered.length - 1];

    const cursorFor = (row: Record<string, unknown> | undefined) =>
      row === undefined
        ? null
        : encodeCursor({
            s: sortValue(row, sortKey),
            i: String(row['id']),
          });

    return {
      data: ordered,
      meta: {
        take: options.take,
        hasNextPage: backward ? options.cursor !== undefined : hasMore,
        hasPreviousPage: backward ? hasMore : options.cursor !== undefined,
        nextCursor: cursorFor(last),
        previousCursor: cursorFor(first),
      },
    };
  }
}
