import { describe, expect, test } from 'bun:test';
import { Logger, Module, provide } from '@dunx/core';
import { Auth } from '@dunx/auth';
import { JobPublisher } from '@dunx/infra/queue';
import { HttpError } from '@dunx/http';
import { createTestApp, RecordingLogger } from '@dunx/testing';
import { UsersRepository } from '../repos/users.repository.js';
import type { UserRow } from '../schema/user.schema.js';
import { UsersService } from './users.service.js';

const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.com',
  name: 'Ada',
  image: null,
  role: 'user',
  banned: false,
  banReason: null,
  banExpires: null,
  emailVerified: false,
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
 * `Auth` and `JobPublisher` are bound as values rather than listed as classes.
 * `Auth` is an abstract class that throws when the container tries to self-bind it,
 * and a real `JobPublisher` would open a socket - so both are declared here, which
 * is also what gives `overrides` something to replace.
 *
 * `UsersRepository` has to be listed even though it is never constructed. A class
 * only reached through another class's constructor self-binds and resolves fine,
 * but `overrides` refuses it:
 *
 *   AppError: Nothing to override for UsersRepository: no module in the graph
 *   binds it. An override replaces a binding - it cannot add one [...]
 */
const signedUp: string[] = [];
const published: { queue: string; name: string }[] = [];

const fakeAuth = {
  api: {
    signUpEmail: async ({ body }: { body: { email: string } }) => {
      signedUp.push(body.email);
      await Promise.resolve();
      return {};
    },
  },
} as unknown as Auth;

const fakePublisher = {
  publish: async (queue: string, name: string) => {
    published.push({ queue, name });
    await Promise.resolve();
    return {};
  },
} as unknown as JobPublisher;

@Module({
  providers: [
    UsersService,
    UsersRepository,
    provide(Auth, { useValue: fakeAuth }),
    provide(JobPublisher, { useValue: fakePublisher }),
  ],
})
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
      emailVerified: false,
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

  test('a duplicate email is a 409 before better-auth is called', async () => {
    const repo = new FakeRepo();
    repo.rows.push(row());
    const { app, users } = await build(repo);

    await expect(
      users.create({
        email: 'ada@example.com',
        name: 'Other',
        password: 'a-password',
        role: 'user',
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(repo.rows).toHaveLength(1);
    expect(signedUp).not.toContain('ada@example.com');
    await app.shutdown();
  });

  test('banning queues a notification', async () => {
    const repo = new FakeRepo();
    repo.rows.push(row());
    const { app, users } = await build(repo);

    published.length = 0;
    const banned = await users.setBanned(row().id, true);

    expect(banned.banned).toBe(true);
    expect(published).toEqual([
      { queue: 'notifications', name: 'user.banned' },
    ]);
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
