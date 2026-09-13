import type { RouteSchemas } from '@dunx/http';
import { z } from 'zod';
import { paginatedOf, pageOptionsSchema } from '../../core/pagination.dto.js';
import { emailSchema, passwordSchema } from '../../core/zod/schemas.js';
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

export const PaginatedUsers = paginatedOf(SanitizedUser, 'PaginatedUsers');

export const UserIdParams = z.object({ userId: z.uuid() });

export const ListUsersQuery = pageOptionsSchema.extend({
  role: z.enum([UserRole.ADMIN, UserRole.USER]).optional(),
  banned: z.stringbool().optional(),
});

export const CreateUser = z
  .object({
    email: emailSchema,
    name: z.string().min(2).max(80),
    /**
     * The route goes through better-auth's own sign-up, so a created user has a
     * real credential and can sign in. The length bounds match
     * `auth.options.ts`; the complexity rules are this app's, because this route
     * is this app's - better-auth's own sign-up enforces length only.
     */
    password: passwordSchema,
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

/**
 * `response` is keyed by status and checked against the handler's return type at
 * compile time, which is what `@ApiOkResponse({ type: X })` only ever documented.
 * It is also what `@dunx/openapi` reads, so the document and the code cannot
 * disagree.
 */
export const listUsers = {
  query: ListUsersQuery,
  response: { 200: PaginatedUsers },
} as const satisfies RouteSchemas;

export const oneUser = {
  params: UserIdParams,
  response: { 200: SanitizedUser },
} as const satisfies RouteSchemas;

/**
 * Ban and unban. Same params and same body as `oneUser`, but `status: 200` is
 * not decoration: `@Post` answers 201 by default, and neither of these creates
 * anything - they return the user that already existed, updated. Sharing
 * `oneUser` here documented a 200 the route never sent.
 */
export const setUserBan = {
  params: UserIdParams,
  status: 200,
  response: { 200: SanitizedUser },
} as const satisfies RouteSchemas;

/**
 * Separate from `oneUser` despite the identical params, because a delete answers
 * 204 with no body and sharing the schema would document a `SanitizedUser` that
 * never arrives.
 */
export const deleteUser = {
  params: UserIdParams,
} as const satisfies RouteSchemas;

export const createUser = {
  body: CreateUser,
  // `@Post` answers 201, so that is the status the body is declared under.
  response: { 201: SanitizedUser },
} as const satisfies RouteSchemas;

export const updateUser = {
  params: UserIdParams,
  body: UpdateUser,
  response: { 200: SanitizedUser },
} as const satisfies RouteSchemas;
