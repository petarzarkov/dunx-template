import { z } from 'zod';

/** RFC 5321's limit on a forward path, which is the real bound on an address. */
const EMAIL_MAX = 254;

/**
 * One declaration of what this app accepts as an address, because three places
 * validate one: the admin create and update routes, and an invite.
 *
 * `z.email()` alone has no upper bound, and an unbounded string reaching a
 * `varchar` column is a database error rather than a 400.
 */
export const emailSchema = z.email().max(EMAIL_MAX);

/**
 * The complexity rules, kept in one place for the same reason.
 *
 * better-auth owns its own sign-up route and enforces `minPasswordLength` and
 * `maxPasswordLength` from `auth.options.ts` there, which is length only. This
 * applies wherever **this app** is the one taking a password: an admin creating
 * a user, and a recipient accepting an invite. Those are the routes it can
 * actually speak for.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(64, 'Password must be at most 64 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');
