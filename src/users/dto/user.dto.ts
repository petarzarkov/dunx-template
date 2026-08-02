import type { RouteSchemas } from '@dunx/http';
import { z } from 'zod';
import {
  pageOf,
  pageOptionsSchema,
} from '../../core/pagination/page-options.dto.js';
import { UserRole } from '../schema/user.schema.js';

/**
 * `.meta({ id })` is what lifts a schema into `components/schemas` and makes
 * `@dunx/openapi` emit a `$ref` instead of inlining it.
 */
export const SanitizedUser = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: z.enum([UserRole.ADMIN, UserRole.USER]),
    banned: z.boolean(),
    emailVerified: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({
    id: 'SanitizedUser',
    title: 'A user, without anything secret on it',
  });

export type SanitizedUser = z.infer<typeof SanitizedUser>;

export const PaginatedUsers = pageOf(SanitizedUser, 'PaginatedUsers');

export const UserIdParams = z.object({ userId: z.uuid() });

export const ListUsersQuery = pageOptionsSchema.extend({
  role: z.enum([UserRole.ADMIN, UserRole.USER]).optional(),
  banned: z.stringbool().optional(),
});

export const CreateUser = z
  .object({
    email: z.email(),
    name: z.string().min(2).max(80),
    // The route goes through better-auth's own sign-up, so a created user has a
    // real credential and can sign in. The bounds are better-auth's own.
    password: z.string().min(8).max(64),
    role: z.enum([UserRole.ADMIN, UserRole.USER]).default(UserRole.USER),
  })
  .meta({ id: 'CreateUser', title: 'Create a user' });

export type CreateUser = z.infer<typeof CreateUser>;

export const UpdateUser = z
  .object({
    name: z.string().min(2).max(80).optional(),
    role: z.enum([UserRole.ADMIN, UserRole.USER]).optional(),
    banned: z.boolean().optional(),
  })
  .meta({ id: 'UpdateUser', title: 'Patch a user' });

export type UpdateUser = z.infer<typeof UpdateUser>;

export const listUsers = {
  query: ListUsersQuery,
} as const satisfies RouteSchemas;
export const oneUser = { params: UserIdParams } as const satisfies RouteSchemas;
export const createUser = { body: CreateUser } as const satisfies RouteSchemas;
export const updateUser = {
  params: UserIdParams,
  body: UpdateUser,
} as const satisfies RouteSchemas;
