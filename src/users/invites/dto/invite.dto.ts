import type { RouteSchemas } from '@dunx/http';
import { z } from 'zod';
import { emailSchema, passwordSchema } from '../../../core/zod/schemas.js';
import { SanitizedUser } from '../../dto/user.dto.js';
import { UserRole } from '../../schema/user.schema.js';
import { InviteStatus } from '../schema/invite.schema.js';

/**
 * The code is deliberately absent. An admin listing invites has no reason to
 * read the credential, and a list endpoint that returns it turns one leaked
 * response into every pending account.
 */
export const Invite = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum([UserRole.ADMIN, UserRole.USER]),
    status: z.enum([
      InviteStatus.PENDING,
      InviteStatus.ACCEPTED,
      InviteStatus.EXPIRED,
    ]),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Invite', title: 'An invitation to create an account' });

export type Invite = z.infer<typeof Invite>;

export const CreateInvite = z
  .object({
    email: emailSchema,
    role: z.enum([UserRole.ADMIN, UserRole.USER]).default(UserRole.USER),
  })
  .meta({ id: 'CreateInvite', title: 'Invite an address' });

export type CreateInvite = z.infer<typeof CreateInvite>;

/**
 * The code arrives in the body rather than the path, so it stays out of access
 * logs and out of a `Referer` header if the accept page links anywhere.
 */
export const AcceptInvite = z
  .object({
    inviteCode: z.string().min(16).max(128),
    password: passwordSchema,
    name: z.string().min(2).max(80).optional(),
  })
  .meta({ id: 'AcceptInvite', title: 'Redeem an invite code' });

export type AcceptInvite = z.infer<typeof AcceptInvite>;

export const ListInvitesQuery = z.object({
  status: z
    .enum([InviteStatus.PENDING, InviteStatus.ACCEPTED, InviteStatus.EXPIRED])
    .optional(),
});

export const InviteIdParams = z.object({ inviteId: z.uuid() });

export const listInvites = {
  query: ListInvitesQuery,
  response: { 200: z.array(Invite) },
} as const satisfies RouteSchemas;

export const createInvite = {
  body: CreateInvite,
  response: { 201: Invite },
} as const satisfies RouteSchemas;

export const acceptInvite = {
  body: AcceptInvite,
  status: 201,
  response: { 201: SanitizedUser },
} as const satisfies RouteSchemas;

export const revokeInvite = {
  params: InviteIdParams,
} as const satisfies RouteSchemas;
