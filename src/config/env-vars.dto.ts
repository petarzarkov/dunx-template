import { z } from 'zod';
import { authVarsSchema } from './dto/auth-vars.dto.js';
import { dbVarsSchema, DbType } from './dto/db-vars.dto.js';
import { notificationVarsSchema } from './dto/notification-vars.dto.js';
import { redisVarsSchema } from './dto/redis-vars.dto.js';
import { serviceVarsSchema } from './dto/service-vars.dto.js';
import { StorageDriver, storageVarsSchema } from './dto/storage-vars.dto.js';

/**
 * One flat schema over the raw environment, composed from the per-concern
 * schemas. `superRefine` carries the cross-field rules that a single field's
 * validator cannot see.
 */
export const envVarsSchema = z
  .object({
    ...serviceVarsSchema.shape,
    ...dbVarsSchema.shape,
    ...redisVarsSchema.shape,
    ...storageVarsSchema.shape,
    ...authVarsSchema.shape,
    ...notificationVarsSchema.shape,
  })
  .superRefine((vars, ctx) => {
    if (vars.DB_TYPE === DbType.POSTGRES && vars.POSTGRES_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['POSTGRES_URL'],
        message: 'POSTGRES_URL is required when DB_TYPE=postgres',
      });
    }

    if (
      vars.STORAGE_DRIVER === StorageDriver.S3 &&
      vars.S3_BUCKET === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
      });
    }

    if (vars.APP_ENV === 'prod' && vars.BETTER_AUTH_SECRET === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message:
          'BETTER_AUTH_SECRET is required when APP_ENV=prod: the development fallback is a constant in the repository and would let anyone mint a session',
      });
    }

    if (vars.AUTH_SESSION_STORE === 'redis' && vars.REDIS_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when AUTH_SESSION_STORE=redis',
      });
    }

    if (vars.AUTH_SESSION_UPDATE_AGE > vars.AUTH_SESSION_EXPIRATION) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SESSION_UPDATE_AGE'],
        message:
          'AUTH_SESSION_UPDATE_AGE must not exceed AUTH_SESSION_EXPIRATION',
      });
    }
  });

export type EnvVars = z.infer<typeof envVarsSchema>;
