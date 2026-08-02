import { z } from 'zod';
import { dbVarsSchema, DbType } from './dto/db-vars.dto.js';
import { serviceVarsSchema } from './dto/service-vars.dto.js';

/**
 * One flat schema over the raw environment, composed from the per-concern
 * schemas. `superRefine` carries the cross-field rules that a single field's
 * validator cannot see.
 */
export const envVarsSchema = z
  .object({
    ...serviceVarsSchema.shape,
    ...dbVarsSchema.shape,
  })
  .superRefine((vars, ctx) => {
    if (vars.DB_TYPE === DbType.POSTGRES && vars.POSTGRES_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['POSTGRES_URL'],
        message: 'POSTGRES_URL is required when DB_TYPE=postgres',
      });
    }
  });

export type EnvVars = z.infer<typeof envVarsSchema>;
