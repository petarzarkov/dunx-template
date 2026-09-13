import { desc, eq } from 'drizzle-orm';
import { SyncDatabase } from '@dunx/infra/db';
import * as schema from '../../../infra/db/schema.js';
import {
  invites,
  InviteStatus,
  type InviteRow,
  type NewInviteRow,
} from '../schema/invite.schema.js';

/**
 * Synchronous throughout, like every repository over `SyncDatabase`. No
 * pagination: the list is bounded by how many people an operator has invited
 * and not yet had accept, which is not a keyset problem.
 */
export class InvitesRepository {
  constructor(private readonly db: SyncDatabase<typeof schema>) {}

  list(status?: InviteStatus): InviteRow[] {
    const query = this.db.select().from(invites);
    return (
      status === undefined
        ? query.orderBy(desc(invites.createdAt))
        : query
            .where(eq(invites.status, status))
            .orderBy(desc(invites.createdAt))
    ).all();
  }

  findById(id: string): InviteRow | undefined {
    return this.db.select().from(invites).where(eq(invites.id, id)).get();
  }

  findByEmail(email: string): InviteRow | undefined {
    return this.db.select().from(invites).where(eq(invites.email, email)).get();
  }

  findByCode(code: string): InviteRow | undefined {
    return this.db
      .select()
      .from(invites)
      .where(eq(invites.inviteCode, code))
      .get();
  }

  /**
   * Insert, or replace the row this address already has.
   *
   * `email` is unique, so re-inviting somebody has to reuse the row rather than
   * fail or leave two live codes for one mailbox. The previous code stops
   * working, which is the intended reading of "send them another invite".
   */
  upsert(values: NewInviteRow): InviteRow {
    const existing =
      values.email === undefined ? undefined : this.findByEmail(values.email);
    if (existing === undefined) {
      return this.db.insert(invites).values(values).returning().get();
    }
    return this.db
      .update(invites)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(invites.id, existing.id))
      .returning()
      .get();
  }

  setStatus(id: string, status: InviteStatus): InviteRow | undefined {
    return this.db
      .update(invites)
      .set({ status, updatedAt: new Date() })
      .where(eq(invites.id, id))
      .returning()
      .get();
  }

  deleteById(id: string): boolean {
    return (
      this.db.delete(invites).where(eq(invites.id, id)).returning().all()
        .length > 0
    );
  }
}
