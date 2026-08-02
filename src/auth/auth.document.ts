import { betterAuthDocument } from '@dunx/auth';
import { betterAuth } from 'better-auth';
import type { AppConfig } from '../config/app.config.js';
import { AUTH_MOUNT, baseAuthOptions } from './auth.options.js';

/**
 * Better Auth's own endpoints, contributed to the app's OpenAPI document.
 *
 * better-auth serves `<basePath>/*` from one handler rather than from dunx
 * controllers, so route discovery cannot see any of it and the document would
 * otherwise describe an API with no authentication surface at all. This is the
 * counterpart of the NestJS template's `mergeBetterAuthSchema`, except the merge
 * itself lives in `@dunx/openapi` and a declared route wins a collision rather than
 * being overwritten.
 *
 * ## Why this builds a second instance
 *
 * `betterAuthDocument` takes an `Auth`, and its own documentation shows it being
 * passed one inside `OpenApiModule.forRoot({ contribute: [...] })`. That is not
 * reachable: `OpenApiModule` has `forRoot` only, its options are evaluated before
 * `HttpFactory.create` builds the container, and `OpenApiExplorer`'s factory
 * declares no `inject`, so a contributor thunk has nothing to resolve `Auth` from.
 *
 * So the schema comes from a second instance built from the **same** pure options
 * the container's instance is built from, minus the database. That is sound
 * precisely because schema generation never queries: `betterAuth()` opens no
 * connection and issues no statement when it is constructed, and
 * `generateOpenAPISchema` reads the plugin list and the option shape. Sharing
 * `baseAuthOptions` is what keeps the document and the running API from drifting.
 */
/**
 * ## Why `basePath` here is the mount, not `AuthOptions.basePath`
 *
 * `AuthDocumentOptions.basePath` is documented as "Where the handler is mounted.
 * Matches `AuthOptions.basePath`", which under `setGlobalPrefix('api')` is
 * `/api/auth`. Passing that produces **`/api/api/auth/sign-in/email`**: the
 * contributed paths go through the explorer's own mount prefixing along with the
 * declared routes, so the prefix is applied twice and nothing warns.
 *
 * Passing the mount instead - `/auth`, the second argument to
 * `AuthModule.forRootAsync` - lets the explorer add the one prefix, and the paths
 * come out at `/api/auth/...` where the handler actually answers. With no global
 * prefix the two are the same string and either works.
 */
export const authDocument = (config: AppConfig) =>
  betterAuthDocument(betterAuth(baseAuthOptions(config)), {
    basePath: AUTH_MOUNT,
  });
