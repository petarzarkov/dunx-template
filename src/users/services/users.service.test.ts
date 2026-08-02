import { describe, expect, test } from 'bun:test';
import { provide } from '@dunx/core';
import { Logger } from '@dunx/core';
import { HttpError } from '@dunx/http';
import { createTestApp, RecordingLogger } from '@dunx/testing';
import { Module } from '@dunx/core';
import { UsersRepository } from '../repos/users.repository.js';
import type { UserRow } from '../schema/user.schema.js';
import { UsersService } from './users.service.js';

const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.com',
  name: 'Ada',
  role: 'user',
  banned: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...over,
});

/** A stand-in repository. Overrides replace a binding in place, by token. */
class FakeRepo {
  rows: UserRow[] = [];
  findById(id: string): UserRow | undefined {
    return this.rows.find((r) => r.id === id);
  }
  findByEmail(email: string): UserRow | undefined {
    return this.rows.find((r) => r.email === email);
  }
  create(values: { email: string; name: string }): UserRow {
    const created = row({ ...values, id: crypto.randomUUID() });
    this.rows.push(created);
    return created;
  }
  update(id: string, values: Partial<UserRow>): UserRow | undefined {
    const found = this.findById(id);
    if (found === undefined) return undefined;
    Object.assign(found, values);
    return found;
  }
  deleteById(id: string): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

/**
 * `UsersRepository` has to be listed even though it is never constructed here.
 * A class that is only reached through another class's constructor self-binds
 * and resolves fine, but `overrides` refuses it:
 *
 *   AppError: Nothing to override for UsersRepository: no module in the graph
 *   binds it. An override replaces a binding - it cannot add one [...]
 *
 * Listing it declares the binding the override then replaces. The real one is
 * never instantiated, so nothing tries to open a database.
 */
@Module({ providers: [UsersService, UsersRepository] })
class Fixture {}

const build = async (repo: FakeRepo) => {
  const logger = new RecordingLogger();
  const app = await createTestApp({
    modules: [Fixture],
    overrides: [
      provide(UsersRepository, {
        useValue: repo as unknown as UsersRepository,
      }),
      provide(Logger, { useValue: logger }),
    ],
  });
  return { app, logger, users: app.get(UsersService) };
};

describe('UsersService', () => {
  test('sanitizes rows into ISO timestamps', async () => {
    const repo = new FakeRepo();
    repo.rows.push(row());
    const { app, users } = await build(repo);

    expect(users.findById(row().id)).toEqual({
      id: row().id,
      email: 'ada@example.com',
      name: 'Ada',
      role: 'user',
      banned: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    await app.shutdown();
  });

  test('a missing user is a 404', async () => {
    const { app, users } = await build(new FakeRepo());
    expect(() => users.findById('nope')).toThrow(HttpError);
    try {
      users.findById('nope');
    } catch (error) {
      expect((error as HttpError).status).toBe(404);
    }
    await app.shutdown();
  });

  test('a duplicate email is a 409 before the insert is attempted', async () => {
    const repo = new FakeRepo();
    repo.rows.push(row());
    const { app, users } = await build(repo);

    try {
      users.create({ email: 'ada@example.com', name: 'Other', role: 'user' });
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as HttpError).status).toBe(409);
    }
    expect(repo.rows).toHaveLength(1);
    await app.shutdown();
  });

  test('deleting logs at warn', async () => {
    const repo = new FakeRepo();
    repo.rows.push(row());
    const { app, logger, users } = await build(repo);

    users.remove(row().id);
    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.message).toBe('user deleted');
    await app.shutdown();
  });
});
