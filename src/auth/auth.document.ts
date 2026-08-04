import { betterAuthDocument } from '@dunx/auth';
import { betterAuth } from 'better-auth';
import type { AppConfig } from '../config/env.validation.js';
import { authBasePath, baseAuthOptions } from './auth.options.js';

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
 * ## `basePath` is the full path the handler answers on, prefix included
 *
 * So it is `AuthOptions.basePath` - `/api/auth` under `setGlobalPrefix('api')` - and
 * not the `/auth` mount.
 *
 * This used to be the other way round, to work around a defect: contributed paths
 * went through the explorer's mount prefixing along with the declared routes, so
 * passing the real `basePath` produced `/api/api/auth/sign-in/email` and nothing
 * warned. Passing the mount cancelled one of the two prefixes out.
 *
 * dunx 0.8.0 fixed it at the source. A contributor's paths describe endpoints dunx
 * does not route, so `withPrefix` now treats them as **absolute** and leaves them
 * alone. That makes the workaround the bug: passing `/auth` now documents the whole
 * authentication surface at `/auth/...`, where nothing answers.
 */
export const authDocument = (config: AppConfig) =>
  betterAuthDocument(betterAuth(baseAuthOptions(config)), {
    basePath: authBasePath(config.app.prefix),
  });
