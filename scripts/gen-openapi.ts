/**
 * Writes `openapi.json` without a container and without a server.
 *
 * `describeRoutes` walks the module graph for its routes, `generateDocument`
 * converts each route's zod schemas. Nothing is constructed, so this works with
 * no database, no port and no environment beyond what `validate` needs.
 */
import { describeRoutes, generateDocument } from '@dunx/openapi';
import { appModule } from '../src/app.module.js';
import { authDocument } from '../src/auth/auth.document.js';
import { validateConfig } from '../src/config/env.validation.js';
import pkg from '../package.json' with { type: 'json' };

const source = { API_PORT: '0', SQLITE_DB_PATH: ':memory:' };
const config = validateConfig(source);

const { document, warnings } = await generateDocument(
  describeRoutes(appModule({ source, logLevel: 'fatal' })),
  {
    title: pkg.name,
    version: pkg.version,
    description: pkg.description,
    // Better Auth's endpoints are not dunx routes, so route discovery cannot see
    // them. Contributed here for the same reason `src/main.ts` contributes them.
    contribute: [authDocument(config)],
  },
);

for (const warning of warnings) console.warn(`warning: ${warning}`);

const bytes = await Bun.write(
  'openapi.json',
  JSON.stringify(document, null, 2),
);
console.log(
  `wrote openapi.json (${(bytes / 1024).toFixed(1)} KiB, ${Object.keys(document.paths ?? {}).length} paths)`,
);
