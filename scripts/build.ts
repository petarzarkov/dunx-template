/**
 * `Bun.build` with `depsPlugin`, which is the **only** way to get an emitted
 * build with working dependency injection.
 *
 * `@dunx/transform/preload` registers a plugin whose filter is `/\.tsx?$/`, so it
 * never sees an emitted `.js`. A `bun dist/main.js` of a plainly transpiled tree
 * therefore fails at boot with:
 *
 *   AppError: DatabaseBootstrap declares 1 constructor parameter(s) but no
 *   dependencies were recorded for it, so @dunx/transform did not transform
 *   DatabaseBootstrap. Register the plugin, then retry:
 *     # bunfig.toml
 *     preload = ["@dunx/transform/preload"]
 *
 * which is unhelpful, because that preload is already in `bunfig.toml` and could
 * not have helped. `depsPlugin` runs at build time and bakes the dependency
 * records into the output, so the emitted bundle needs no preload at all.
 *
 * Running from source with `bun src/main.ts` is the other supported shape and is
 * what the Dockerfile does; this exists so the emitted path is exercised too.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { depsPlugin } from '@dunx/transform';

const root = new URL('..', import.meta.url).pathname;
const outdir = join(root, 'dist');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, 'src', 'main.ts')],
  outdir,
  target: 'bun',
  format: 'esm',
  sourcemap: 'linked',
  plugins: [depsPlugin],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// The migrator reads real files. `MIGRATIONS_FOLDER` is
// `join(import.meta.dir, 'migrations')`, which is `src/infra/db/migrations` from
// source and `dist/migrations` from the bundle, so the copy target is fixed.
await cp(
  join(root, 'src', 'infra', 'db', 'migrations'),
  join(outdir, 'migrations'),
  {
    recursive: true,
  },
);

const bytes = result.outputs.reduce((total, output) => total + output.size, 0);
console.log(`built dist/main.js (${(bytes / 1024).toFixed(1)} KiB)`);
