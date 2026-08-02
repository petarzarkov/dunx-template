import { bunPassword } from '@dunx/auth';
import type { BetterAuthOptions } from 'better-auth';
import { admin, bearer, openAPI } from 'better-auth/plugins';
import type { AppConfig } from '../config/env.validation.js';

/**
 * The route path `AuthHandler` is mounted at, before the global prefix is
 * applied. `AuthOptions.basePath` is the same URL *after* it, which is why the
 * two are different strings for the same thing - see {@link authBasePath}.
 */
export const AUTH_MOUNT = '/auth';

export const authBasePath = (prefix: string): string =>
  `/${prefix}${AUTH_MOUNT}`;

/**
 * Everything `betterAuth()` is configured with **except** the database and the
 * secondary storage, which only exist inside the container.
 *
 * Split out as a pure function of the validated config because it has two
 * consumers: `AuthModule.forRootAsync` adds the connection and binds the real
 * instance, and `authDocument()` builds a second, database-less instance purely
 * to ask it for its OpenAPI schema. Keeping the plugin list in one place is what
 * stops the document from describing a different API than the one that runs.
 */
export const baseAuthOptions = (config: AppConfig) => {
  const { auth } = config;
  const origins = [auth.baseUrl, ...auth.trustedOrigins];

  return {
    appName: config.app.name,
    secret: auth.secret,
    baseURL: auth.baseUrl,
    basePath: authBasePath(config.app.prefix),
    trustedOrigins: [...new Set(origins)],
    advanced: {
      // The app's own ids are uuid v4 everywhere else, including the columns
      // better-auth writes to. One id shape across every table.
      database: { generateId: () => crypto.randomUUID() },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 64,
      // What `AuthModule` would apply anyway - named here so it is visible.
      // better-auth's own default is a pure-JavaScript scrypt; this is
      // `Bun.password`'s native bcrypt.
      password: bunPassword,
    },
    session: {
      expiresIn: auth.sessionExpiration,
      updateAge: auth.sessionUpdateAge,
      cookieCache: { enabled: true, maxAge: 300 },
    },
    socialProviders: {
      ...(auth.google === undefined ? {} : { google: auth.google }),
      ...(auth.github === undefined ? {} : { github: auth.github }),
    },
    plugins: [
      // `role` on the user, which `@Roles()` reads through `SessionGuard`, plus
      // ban and impersonation.
      admin(),
      // `Authorization: Bearer <token>` instead of a cookie, which is what a
      // non-browser client and the e2e suite use.
      bearer(),
      // Without this plugin `generateOpenAPISchema` does not exist and
      // `betterAuthDocument` contributes nothing. `disableDefaultReference`
      // stops better-auth mounting a second explorer page next to dunx's.
      openAPI({ disableDefaultReference: true }),
    ],
    // `satisfies` rather than a `: BetterAuthOptions` return annotation, and it is
    // load-bearing twice over. An annotation widens `plugins` to
    // `BetterAuthPlugin[]`, and `betterAuth()` infers the endpoints on `api` from
    // that tuple - so the widened form produces an instance with no
    // `generateOpenAPISchema`, which `betterAuthDocument` then rejects at compile
    // time under TypeScript's weak-type rule.
  } satisfies BetterAuthOptions;
};
