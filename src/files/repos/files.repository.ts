import { and, eq, like, type SQL } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import { paginate, type Page, type PageOptions } from '@dunx/infra/pagination';
import * as schema from '../../infra/db/schema.js';
import { files, type FileRow, type NewFileRow } from '../schema/file.schema.js';

export interface ListFilesFilters extends PageOptions {
  readonly userId?: string | undefined;
}

export class FilesRepository {
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  findById(id: string): FileRow | undefined {
    return this.db.select().from(files).where(eq(files.id, id)).get();
  }

  create(values: NewFileRow): FileRow {
    return this.db.insert(files).values(values).returning().get();
  }

  update(
    id: string,
    values: { [K in keyof NewFileRow]?: NewFileRow[K] | undefined },
  ): FileRow | undefined {
    return this.db
      .update(files)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(files.id, id))
      .returning()
      .get();
  }

  deleteById(id: string): boolean {
    return (
      this.db.delete(files).where(eq(files.id, id)).returning().all().length > 0
    );
  }

  list(filters: ListFilesFilters): Promise<Page<FileRow>> {
    const clauses: SQL[] = [];
    if (filters.userId !== undefined) {
      clauses.push(eq(files.userId, filters.userId));
    }
    if (filters.search !== undefined) {
      clauses.push(like(files.name, `%${filters.search}%`));
    }

    return paginate<typeof files, FileRow>({
      db: this.db,
      table: files,
      options: filters,
      orderBy: 'createdAt',
      where: clauses.length === 0 ? undefined : and(...clauses),
    });
  }
}
