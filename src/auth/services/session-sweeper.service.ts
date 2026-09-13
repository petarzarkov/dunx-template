import { Logger } from '@dunx/core';
import { SyncDatabase } from '@dunx/infra/db';
import { Cron } from '@dunx/infra/schedule';
import { lt } from 'drizzle-orm';
import * as schema from '../../infra/db/schema.js';
import { sessions } from '../schema/session.schema.js';
import { verifications } from '../schema/verification.schema.js';

/**
 * Deletes the rows better-auth stops reading but never removes.
 *
 * Both tables carry `expires_at` and both grow without bound: a session row per
 * sign-in, a verification row per reset or email link. With Redis configured the
 * live session is in `secondaryStorage` and this table is only the durable
 * record, so nothing on the request path notices either way - which is precisely
 * why it goes unnoticed until the table is large.
 *
 * The NestJS template registered `ScheduleModule.forRoot()` and then declared no
 * handlers at all, so its scheduling was a module doing nothing. This is the
 * capability actually used.
 *
 * `@Cron` is `Bun.cron`, five fields, minute resolution. `ScheduleModule` is
 * in-process and single-node, so two replicas both run this - which is safe here
 * because a delete by expiry is idempotent and the second one simply matches no
 * rows. A schedule that must fire once per fleet belongs on a queue instead,
 * through bullmq's `upsertJobScheduler`.
 */
export class SessionSweeper {
  constructor(
    private readonly db: SyncDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  @Cron('17 * * * *', { name: 'auth.sweep-expired' })
  sweep(): void {
    const now = new Date();

    // Synchronous, like every other read and write over `SyncDatabase`. Two
    // statements rather than one transaction: neither depends on the other, and
    // a partial sweep is corrected by the next run an hour later.
    const expiredSessions = this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, now))
      // Ids rather than a bare `.returning()`, which would materialise every
      // swept row just to count it.
      .returning({ id: sessions.id })
      .all().length;

    const expiredVerifications = this.db
      .delete(verifications)
      .where(lt(verifications.expiresAt, now))
      .returning({ id: verifications.id })
      .all().length;

    if (expiredSessions === 0 && expiredVerifications === 0) return;

    this.logger.info('swept expired auth rows', {
      sessions: expiredSessions,
      verifications: expiredVerifications,
    });
  }
}
