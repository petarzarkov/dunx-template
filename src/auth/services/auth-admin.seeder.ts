import { Auth } from '@dunx/auth';
import { Logger, type OnInit } from '@dunx/core';
import { SyncDatabase } from '@dunx/infra/db';
import { eq } from 'drizzle-orm';
import { AppConfigService } from '../../config/app.config.service.js';
import * as schema from '../../infra/db/schema.js';
import { UserRole, users } from '../../users/schema/user.schema.js';

/**
 * The first admin, created through better-auth's own sign-up rather than by
 * inserting a row.
 *
 * A row inserted straight into `user` has no `account` row and therefore no
 * password hash, so it can never sign in - which is exactly what the drizzle
 * seeder used to produce, and why the seeder no longer touches users. Going
 * through `api.signUpEmail` is what makes the credential real, and it is also the
 * only way the hash comes from `bunPassword`.
 *
 * `onInit`, so it runs after the migrations and before `listen()` binds. Refused
 * outright in production: the fallback password is a documented default, and a
 * default administrator account is not something a deployment should acquire by
 * booting.
 */
export class AuthAdminSeeder implements OnInit {
  constructor(
    private readonly auth: Auth,
    private readonly db: SyncDatabase<typeof schema>,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  async onInit(): Promise<void> {
    if (this.config.get('isProd')) return;

    const { email, password } = this.config.get('auth').seedAdmin;
    const existing = this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .get();

    if (existing !== undefined) {
      if (existing.role !== UserRole.ADMIN) this.promote(email);
      return;
    }

    await this.auth.api.signUpEmail({
      body: { email, password, name: 'Admin' },
    });
    this.promote(email);
    this.logger.info('seeded the first administrator', { email });
  }

  /**
   * better-auth's `signUpEmail` applies the `admin()` plugin's `defaultRole`, and
   * there is no way to ask for another one at sign-up - the plugin's `setRole`
   * endpoint needs an existing admin to authorise it, which is the chicken and
   * egg this exists to break.
   */
  private promote(email: string): void {
    this.db
      .update(users)
      .set({ role: UserRole.ADMIN, emailVerified: true })
      .where(eq(users.email, email))
      .run();
  }
}
