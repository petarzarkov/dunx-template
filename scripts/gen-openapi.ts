/**
 * Writes `openapi.json` without a container and without a server.
 *
 * `describeRoutes` walks the module graph for its routes, `generateDocument`
 * converts each route's zod schemas. Nothing is constructed, so this works with
 * no database, no port and no environment beyond what `validate` needs.
 */
import { describeRoutes, generateDocument } from '@dunx/openapi';
import { appModule } from '../src/app.module.js';
import pkg from '../package.json' with { type: 'json' };

const { document, warnings } = await generateDocument(
  describeRoutes(
    appModule({
      source: { API_PORT: '0', SQLITE_DB_PATH: ':memory:' },
      logLevel: 'fatal',
    }),
  ),
  {
    title: pkg.name,
    version: pkg.version,
    description: pkg.description,
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
