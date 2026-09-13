import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { provide } from '@dunx/core';
import {
  EmailOptions,
  EmailService,
  MemoryTransport,
  type OutboundEmail,
} from '@dunx/infra/email';
import { createTestApp } from '@dunx/testing';
import { AppModule } from '../../app.module.js';
import renderer from './render.js';

/**
 * The send path, against `MemoryTransport` - the framework's own double, which
 * keeps every message instead of delivering it.
 *
 * `EmailOptions` is replaced wholesale rather than the transport alone, because
 * the module builds the transport from the options: overriding `EmailTransport`
 * on its own would leave `dryRun` free to route past it to `LogTransport`, and
 * the suite would assert an empty inbox and pass.
 */
const DB_PATH = `./.tmp/email-spec-${crypto.randomUUID()}.db`;

const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: DB_PATH,
  QUEUE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
  EMAIL_FROM: 'dunx-template <no-reply@local.dev>',
};

const transport = new MemoryTransport();
let app: Awaited<ReturnType<typeof createTestApp>>;
let email: EmailService;

beforeAll(async () => {
  app = await createTestApp({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    overrides: [
      provide(EmailOptions, {
        useValue: new EmailOptions({
          transport,
          from: 'dunx-template <no-reply@local.dev>',
          renderer,
        }),
      }),
    ],
  });
  email = app.get(EmailService);
}, 30_000);

afterAll(async () => {
  await app.shutdown();
});

const sentTo = (address: string): OutboundEmail => {
  const [message] = transport.to(address);
  if (message === undefined) throw new Error(`nothing sent to ${address}`);
  return message;
};

describe('sending through the configured transport', () => {
  test('a plain message picks up the module default sender', async () => {
    await email.send({
      to: 'plain@example.com',
      subject: 'Your account has been suspended',
      text: 'Repeatedly ignoring the rate limit.',
    });

    const message = sentTo('plain@example.com');
    // The sender was never passed. `EmailService.resolve` applies it, which is
    // the thing every app otherwise rewrites.
    expect(message.from).toEqual({
      address: 'no-reply@local.dev',
      name: 'dunx-template',
    });
    expect(message.text).toContain('rate limit');
  });

  /**
   * The point of the renderer seam: the bodies come from the same React Email
   * component `bun run mail:preview` shows, so the preview cannot drift from
   * what an inbox receives.
   */
  test('a template renders both bodies from one component', async () => {
    await email.sendTemplate({
      to: 'ada@example.com',
      subject: 'Welcome',
      template: (await import('./templates/welcome.js')).default,
      props: { name: 'Ada Lovelace', signInUrl: 'http://localhost:3001/' },
    });

    const message = sentTo('ada@example.com');
    expect(message.html).toContain('Ada Lovelace');
    expect(message.html).toContain('http://localhost:3001/');
    // React Email produces the plain-text alternative too, which is what stops
    // a client with HTML off seeing an empty message.
    expect(message.text).toContain('Ada Lovelace');
  });

  test('the invite code reaches the mail and nothing else', async () => {
    const inviteCode = 'f'.repeat(64);
    await email.sendTemplate({
      to: 'invitee@example.com',
      subject: 'You have been invited',
      template: (await import('./templates/invite.js')).default,
      props: {
        role: 'admin',
        inviteCode,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });

    expect(sentTo('invitee@example.com').html).toContain(inviteCode);
  });

  /**
   * Header injection, refused by `EmailService.resolve` before a transport is
   * reached. A CR or LF in a subject starts a header the caller never wrote.
   */
  test('a newline in the subject is refused', async () => {
    await expect(
      email.send({
        to: 'victim@example.com',
        subject: 'Hello\r\nBcc: attacker@example.com',
        text: 'body',
      }),
    ).rejects.toThrow();

    expect(transport.to('attacker@example.com')).toHaveLength(0);
  });

  test('an address with no @ is refused', async () => {
    await expect(
      email.send({ to: 'not-an-address', subject: 'Hi', text: 'body' }),
    ).rejects.toThrow();
  });
});
