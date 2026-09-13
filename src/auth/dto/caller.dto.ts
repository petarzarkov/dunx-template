import { z } from 'zod';

/**
 * The session as this service reports it.
 *
 * Declared as a schema and the type inferred from it, rather than an interface
 * beside a schema that has to be kept in step: `ProfileController` documents its
 * response with this, and `CurrentUser` returns that exact shape.
 *
 * `.readonly()` on the array is what makes the inferred `roles` a
 * `readonly string[]`, which is what `rolesOf` hands back.
 */
export const Caller = z
  .object({
    id: z.string(),
    email: z.email(),
    name: z.string(),
    roles: z.array(z.string()).readonly(),
    sessionId: z.string(),
  })
  .meta({ id: 'Caller', title: 'The authenticated caller' });

export type Caller = z.infer<typeof Caller>;

/** `null` rather than absent, so a client can tell "anonymous" from "no field". */
export const AnonymousProbe = z
  .object({ caller: z.email().nullable() })
  .meta({ id: 'AnonymousProbe', title: 'Whether a session was present' });
