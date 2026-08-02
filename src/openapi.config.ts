/**
 * What `bunx dunx-openapi` needs to know: the module graph, and the one thing a
 * CLI cannot guess - that Better Auth's endpoints are not dunx routes and have to
 * be contributed.
 *
 * No container and no server: `describeRoutes` reads metadata off prototypes, so
 * this runs with no database and no port.
 */
import { appModule } from './app.module.js';
import { authDocument } from './auth/auth.document.js';
import { validateConfig } from './config/env.validation.js';
import pkg from '../package.json' with { type: 'json' };

const source = { API_PORT: '0', SQLITE_DB_PATH: ':memory:' };

export const openapi = () => ({
  root: appModule({ source, logLevel: 'fatal' as const }),
  title: pkg.name,
  version: pkg.version,
  description: pkg.description,
  contribute: [authDocument(validateConfig(source))],
});
