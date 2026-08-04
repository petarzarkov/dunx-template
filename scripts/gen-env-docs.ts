#!/usr/bin/env bun
import { z } from 'zod';
import { authVarsSchema } from '../src/config/dto/auth-vars.dto.js';
import { dbVarsSchema } from '../src/config/dto/db-vars.dto.js';
import { notificationVarsSchema } from '../src/config/dto/notification-vars.dto.js';
import { redisVarsSchema } from '../src/config/dto/redis-vars.dto.js';
import { serviceVarsSchema } from '../src/config/dto/service-vars.dto.js';
import { storageVarsSchema } from '../src/config/dto/storage-vars.dto.js';

/**
 * `docs/env-vars.md`, derived from the schemas that actually validate the
 * environment.
 *
 * Adopted from the NestJS template's `gen-env-docs.ts`, and it works here for the
 * same reason it worked there: the config is one zod schema per concern, so the
 * document is a projection of the thing being documented rather than a second
 * description of it. A hand-written table is a table that drifts the first time
 * someone adds a variable.
 *
 * `z.toJSONSchema(schema, { io: 'input' })` is the whole mechanism - it is zod's own
 * conversion, the same call `@dunx/openapi` makes behind its vendor check, and it
 * already knows the type, the default, the bounds, the enum members and the
 * description. `io: 'input'` matters: these schemas transform (`csv` returns an
 * array from a string, `stringbool` a boolean), and the reader sets the *input*.
 *
 * Descriptions come from `.describe()` and are optional. A variable without one
 * still gets a row with its type, bounds and default, so this is useful before every
 * field is annotated and gets better as they are.
 */
const GROUPS = [
  {
    title: 'Service, logging and HTTP',
    schema: serviceVarsSchema,
    blurb:
      'Everything about the process itself. `API_PORT` is the only variable in the ' +
      'whole file with no default, so it is the only one that is strictly required.',
  },
  {
    title: 'Database',
    schema: dbVarsSchema,
    blurb:
      'SQLite by default and with no path to set. `DB_TYPE=postgres` is refused at ' +
      'boot: the data layer here is synchronous `bun:sqlite`, and `@dunx/infra/db` ' +
      'supports `Bun.SQL` perfectly well but this template does not use it.',
  },
  {
    title: 'Redis, cache and rate limiting',
    schema: redisVarsSchema,
    blurb:
      'All optional. With no `REDIS_URL` the cache reports itself degraded, the ' +
      'throttler stops counting and websocket fan-out stays local to the process.',
  },
  {
    title: 'Storage and uploads',
    schema: storageVarsSchema,
    blurb:
      '`STORAGE_DRIVER=local` writes through `Bun.file` and needs nothing. `s3` is ' +
      '`Bun.S3Client`, and credentials fall through to Bun’s own resolution when ' +
      'the `S3_*` variables are unset.',
  },
  {
    title: 'Authentication',
    schema: authVarsSchema,
    blurb:
      '`BETTER_AUTH_SECRET` is optional outside production and **mandatory when ' +
      '`APP_ENV=prod`** - the development fallback is a constant in this repository, ' +
      'so anyone holding it can mint a session.',
  },
  {
    title: 'Notifications',
    schema: notificationVarsSchema,
    blurb:
      'With no `EMAIL_WEBHOOK_URL`, `EmailService` logs the message it would have ' +
      'sent. That is enough to prove the queue delivered a job to a worker.',
  },
] as const;

interface Field {
  readonly type: string;
  readonly required: boolean;
  readonly default: string;
  readonly description: string;
}

const cell = (value: string): string =>
  value === '' ? '-' : value.replaceAll('|', '\\|');

const code = (value: string): string => `\`${value}\``;

/** The type column: an enum lists its members, everything else names its type. */
const typeOf = (schema: Record<string, unknown>): string => {
  const members = schema['enum'];
  if (Array.isArray(members)) {
    return members.map((m) => code(String(m))).join(' · ');
  }

  const base = typeof schema['type'] === 'string' ? schema['type'] : 'string';
  const format = schema['format'];
  const name = typeof format === 'string' ? `${base} (${format})` : base;

  const min = schema['minimum'] ?? schema['minLength'];
  // `z.coerce.number().int()` carries an implicit `MAX_SAFE_INTEGER` ceiling, which
  // is true and useless: printing `16..9007199254740991` for a memory limit reads as
  // a real bound someone chose. Only a max the schema actually states is shown.
  const stated = schema['maximum'] ?? schema['maxLength'];
  const max =
    typeof stated === 'number' && stated >= Number.MAX_SAFE_INTEGER
      ? undefined
      : stated;

  if (min === undefined && max === undefined) return code(name);
  const range = max === undefined ? `min ${min}` : `${min ?? ''}..${max}`;
  return `${code(name)} ${range}`;
};

const fieldsOf = (schema: z.ZodObject): Record<string, Field> => {
  const json = z.toJSONSchema(schema, { io: 'input' }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: readonly string[];
  };
  const required = new Set(json.required ?? []);
  const out: Record<string, Field> = {};

  for (const [name, property] of Object.entries(json.properties ?? {})) {
    const fallback = property['default'];
    out[name] = {
      type: typeOf(property),
      required: required.has(name),
      default:
        fallback === undefined
          ? ''
          : code(
              typeof fallback === 'string' && fallback === ''
                ? '(empty)'
                : JSON.stringify(fallback),
            ),
      description:
        typeof property['description'] === 'string'
          ? property['description']
          : '',
    };
  }
  return out;
};

const table = (fields: Record<string, Field>): string => {
  const rows = Object.entries(fields).map(
    ([name, field]) =>
      `| ${code(name)} | ${field.type} | ${field.required ? '**yes**' : 'no'} | ${cell(field.default)} | ${cell(field.description)} |`,
  );
  return [
    '| Variable | Type | Required | Default | Notes |',
    '| -------- | ---- | -------- | ------- | ----- |',
    ...rows,
  ].join('\n');
};

const total = GROUPS.reduce(
  (sum, group) => sum + Object.keys(fieldsOf(group.schema)).length,
  0,
);

const document = [
  '# Environment variables',
  '',
  '<!-- Generated by `bun run gen:env:docs`. Do not edit by hand. -->',
  '',
  `All ${total} of them, derived from the zod schemas in [\`src/config/dto/\`](../src/config/dto/)`,
  'by `scripts/gen-env-docs.ts` - so this table cannot drift from what actually',
  'validates the environment at boot.',
  '',
  'Bun loads `.env` and `.env.local` itself, so there is no loader and no `dotenv`.',
  'A variable set in the real environment wins over both.',
  '',
  '**Only `API_PORT` is strictly required.** Everything else has a default or is',
  'genuinely optional, which is what makes `bun run start` work on a clean checkout',
  'with nothing else running. Two variables become required conditionally, and both',
  'are enforced by `superRefine` rather than by a field: `POSTGRES_URL` when',
  '`DB_TYPE=postgres`, `S3_BUCKET` when `STORAGE_DRIVER=s3`, `REDIS_URL` when',
  '`AUTH_SESSION_STORE=redis`, and `BETTER_AUTH_SECRET` when `APP_ENV=prod`.',
  '',
  'Two things to read correctly, both consequences of the table describing what you',
  '**write** rather than what the app ends up holding:',
  '',
  '- A boolean is `string` here, because that is what an environment variable is.',
  '  `z.stringbool()` accepts `true`/`false`, `1`/`0`, `yes`/`no` and `on`/`off`, and',
  '  every one of them defaults to `false` when unset. The default sits on the parsed',
  '  side, so this column cannot show it.',
  '- A comma-separated list is `string` too. `LOG_MASK_FIELDS` and',
  '  `LOG_FILTER_EVENTS` parse `a, b ,c` into an array and fall back to a list spelled',
  '  out in `src/config/dto/service-vars.dto.ts` when blank or absent.',
  '',
  ...GROUPS.flatMap((group) => [
    `## ${group.title}`,
    '',
    group.blurb,
    '',
    table(fieldsOf(group.schema)),
    '',
  ]),
].join('\n');

const target = new URL('../docs/env-vars.md', import.meta.url);
await Bun.write(target, document);
console.log(
  `wrote docs/env-vars.md - ${total} variables, ${new Blob([document]).size} bytes`,
);
