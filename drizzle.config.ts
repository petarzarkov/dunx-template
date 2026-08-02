import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infra/db/schema.ts',
  out: './src/infra/db/migrations',
  dbCredentials: {
    // `process.env`, not `Bun.env`: drizzle-kit's bin has a node shebang, so this
    // file is evaluated by Node and `Bun` is not defined there.
    url: process.env['SQLITE_DB_PATH'] ?? './data/app.db',
  },
});
