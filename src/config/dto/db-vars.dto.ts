import { z } from 'zod';

export const DbType = Object.freeze({
  SQLITE: 'sqlite',
  POSTGRES: 'postgres',
} as const);
export type DbType = (typeof DbType)[keyof typeof DbType];

export const dbVarsSchema = z.object({
  DB_TYPE: z.enum([DbType.SQLITE, DbType.POSTGRES]).default(DbType.SQLITE),
  SQLITE_DB_PATH: z.string().default('./data/app.db'),
  POSTGRES_URL: z.string().optional(),
});
