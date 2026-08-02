import { rm } from 'node:fs/promises';

const filename = Bun.env['SQLITE_DB_PATH'] ?? './data/app.db';
if (filename === ':memory:') {
  console.log('nothing to drop: SQLITE_DB_PATH is :memory:');
  process.exit(0);
}

for (const suffix of ['', '-shm', '-wal']) {
  await rm(`${filename}${suffix}`, { force: true });
}
console.log(`dropped ${filename}`);
