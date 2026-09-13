import { Auth } from '@dunx/auth';
import { Logger } from '@dunx/core';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { JobPublisher } from '@dunx/infra/queue';
import { AppConfigService } from '../../../config/app.config.service.js';
import { JOBS, QUEUES } from '../../../notifications/events/events.js';
import type { SanitizedUser } from '../../dto/user.dto.js';
import { UserRole } from '../../schema/user.schema.js';
import { UsersRepository } from '../../repos/users.repository.js';
import type { AcceptInvite, CreateInvite, Invite } from '../dto/invite.dto.js';
import { InvitesRepository } from '../repos/invites.repository.js';
import { InviteStatus, type InviteRow } from '../schema/invite.schema.js';

/** Never returns `inviteCode`. See the note on the `Invite` schema. */
const present = (row: InviteRow): Invite => ({
  id: row.id,
  email: row.email,
  role: row.role,
  status: row.status,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

export class InvitesService {
  constructor(
    private readonly repo: InvitesRepository,
    private readonly users: UsersRepository,
    private readonly auth: Auth,
    private readonly publisher: JobPublisher,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  list(status?: InviteStatus): Invite[] {
    return this.repo.list(status).map(present);
  }

  async create(input: CreateInvite): Promise<Invite> {
    if (this.users.findByEmail(input.email) !== undefined) {
      throw new HttpError(
        HttpStatusCode.CONFLICT,
        `${input.email} already has an account`,
      );
    }

    const { ttlHours } = this.config.get('invites');
    const row = this.repo.upsert({
      email: input.email,
      // 32 bytes of CSPRNG, hex. The code is the only thing standing in front
      // of a public route, so it is generated rather than derived from
      // anything about the invitee.
      inviteCode: Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString('hex'),
      role: input.role,
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + ttlHours * 3_600_000),
    });

    /**
     * Wrapped, like the registration hook and unlike the password reset: an
     * unreachable queue must not lose the invite row that was just written. The
     * operator can see it pending and send it again.
     */
    try {
      await this.publisher.publish(QUEUES.NOTIFICATIONS, JOBS.USER_INVITED, {
        inviteId: row.id,
        email: row.email,
        role: row.role,
        inviteCode: row.inviteCode,
        expiresAt: row.expiresAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn('invite notification not queued', {
        inviteId: row.id,
        reason: (error as Error).message,
      });
    }

    return present(row);
  }

  /**
   * The public half. Knowing the code is the authorisation, so every refusal
   * below is the same 403 with the same wording: a distinct "expired" or "already
   * used" would let someone probe which codes exist.
   */
  async accept(input: AcceptInvite): Promise<SanitizedUser> {
    const invalid = (): never => {
      throw new HttpError(HttpStatusCode.FORBIDDEN, 'Invalid invite');
    };

    const row = this.repo.findByCode(input.inviteCode);
    if (row === undefined || row.status !== InviteStatus.PENDING)
      return invalid();

    if (row.expiresAt.getTime() < Date.now()) {
      this.repo.setStatus(row.id, InviteStatus.EXPIRED);
      return invalid();
    }
    if (this.users.findByEmail(row.email) !== undefined) {
      // Accepted between the lookup and here, or the address signed up
      // independently. Either way the invite is spent.
      this.repo.setStatus(row.id, InviteStatus.ACCEPTED);
      return invalid();
    }

    /**
     * Through better-auth's own sign-up for the same reason `UsersService.create`
     * is: a row written straight into `user` has no `account` row, so it has no
     * password hash and could never sign in.
     */
    const { user } = await this.auth.api.signUpEmail({
      body: {
        email: row.email,
        password: input.password,
        name: input.name ?? row.email.split('@')[0] ?? row.email,
      },
    });

    // The `admin()` plugin's sign-up always applies its `defaultRole`, and its
    // `setRole` endpoint needs an authenticated admin this service does not have.
    if (row.role !== UserRole.USER) {
      this.users.update(user.id, { role: row.role });
    }
    this.repo.setStatus(row.id, InviteStatus.ACCEPTED);

    const created = this.users.findById(user.id);
    if (created === undefined) {
      throw new HttpError(
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        'The invited account was created but could not be read back',
      );
    }

    this.logger.info('invite accepted', { inviteId: row.id, userId: user.id });
    return {
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      banned: created.banned,
      emailVerified: created.emailVerified,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  revoke(id: string): void {
    if (!this.repo.deleteById(id)) {
      throw new HttpError(HttpStatusCode.NOT_FOUND, `No invite with id ${id}`);
    }
  }
}
