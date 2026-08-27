import type { Pool, PoolClient } from "pg";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type {
  BeginResendResult,
  ClaimResult,
  ClientInvitation,
  ClientInvitationRepository,
  GrantExistingResult,
  VerifiedClerkUser,
} from "./client-invitation.types.js";

interface InvitationRow {
  readonly id: string;
  readonly organization_id: string;
  readonly email: string;
  readonly membership_role: ClientInvitation["membershipRole"];
  readonly status: ClientInvitation["status"];
  readonly clerk_invitation_id: string | null;
  readonly invited_by_user_id: string;
  readonly invited_by_email: string;
  readonly invited_by_name: string | null;
  readonly accepted_by_user_id: string | null;
  readonly expires_at: Date;
  readonly accepted_at: Date | null;
  readonly revoked_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface UserRow {
  readonly id: string;
  readonly status: "pending" | "active" | "blocked" | "deleted";
}

const INVITATION_SELECT = `
  i.id, i.organization_id, i.email, i.membership_role, i.status,
  i.clerk_invitation_id, i.invited_by_user_id,
  inviter.primary_email AS invited_by_email,
  nullif(concat_ws(' ', inviter.first_name, inviter.last_name), '') AS invited_by_name,
  i.accepted_by_user_id, i.expires_at, i.accepted_at, i.revoked_at,
  i.created_at, i.updated_at`;

function mapInvitation(row: InvitationRow): ClientInvitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    membershipRole: row.membership_role,
    status: row.status,
    clerkInvitationId: row.clerk_invitation_id,
    invitedByUserId: row.invited_by_user_id,
    invitedByEmail: row.invited_by_email,
    invitedByName: row.invited_by_name,
    acceptedByUserId: row.accepted_by_user_id,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scopePredicate(
  scope: AuthorizedRepositoryScope,
  alias = "o",
  startAt = 1,
): { readonly sql: string; readonly values: unknown[] } {
  if (scope.kind === "global") return { sql: "true", values: [] };
  if (scope.kind === "public" || scope.organizationIds.length === 0) {
    return { sql: "false", values: [] };
  }
  return {
    sql: `${alias}.id = ANY($${startAt}::uuid[])`,
    values: [[...scope.organizationIds]],
  };
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function organizationExists(
  client: PoolClient,
  scope: AuthorizedRepositoryScope,
  organizationId: string,
): Promise<boolean> {
  const scoped = scopePredicate(scope, "o", 2);
  const result = await client.query(
    `SELECT 1 FROM organizations o
     WHERE o.id = $1 AND o.status = 'active' AND ${scoped.sql} FOR UPDATE`,
    [organizationId, ...scoped.values],
  );
  return result.rowCount !== 0;
}

async function expirePending(client: PoolClient, organizationId?: string): Promise<void> {
  await client.query(
    `UPDATE organization_invitations
     SET status = 'expired', updated_at = now()
     WHERE status = 'pending' AND expires_at <= now()
       AND ($1::uuid IS NULL OR organization_id = $1)`,
    [organizationId ?? null],
  );
}

async function findInvitation(
  client: PoolClient,
  invitationId: string,
  forUpdate = false,
): Promise<ClientInvitation | null> {
  const result = await client.query<InvitationRow>(
    `SELECT ${INVITATION_SELECT}
     FROM organization_invitations i
     JOIN app_users inviter ON inviter.id = i.invited_by_user_id
     WHERE i.id = $1
     ${forUpdate ? "FOR UPDATE OF i" : ""}`,
    [invitationId],
  );
  return result.rows[0] === undefined ? null : mapInvitation(result.rows[0]);
}

async function roleId(client: PoolClient, roleCode: ClientInvitation["membershipRole"]): Promise<string> {
  const result = await client.query<{ readonly id: string }>(
    "SELECT id FROM roles WHERE scope = 'organization' AND code = $1",
    [roleCode],
  );
  if (result.rows[0] === undefined) throw new Error("Client membership role is not configured");
  return result.rows[0].id;
}

async function activateMembership(
  client: PoolClient,
  organizationId: string,
  userId: string,
  membershipRole: ClientInvitation["membershipRole"],
): Promise<void> {
  const selectedRoleId = await roleId(client, membershipRole);
  await client.query(
    `INSERT INTO organization_memberships (
       organization_id, user_id, role_id, role_scope, status, activated_at, revoked_at
     ) VALUES ($1, $2, $3, 'organization', 'active', now(), NULL)
     ON CONFLICT (organization_id, user_id) DO UPDATE
     SET role_id = EXCLUDED.role_id,
         role_scope = 'organization',
         status = 'active',
         activated_at = COALESCE(organization_memberships.activated_at, now()),
         revoked_at = NULL,
         updated_at = now()`,
    [organizationId, userId, selectedRoleId],
  );
}

async function synchronizeInvitedUser(
  client: PoolClient,
  identity: VerifiedClerkUser,
  fallbackEmail: string,
): Promise<UserRow> {
  const synchronized = await client.query<UserRow>(
    `INSERT INTO app_users (
       clerk_user_id, primary_email, first_name, last_name, avatar_url, status, last_synced_at
     ) VALUES ($1,$2,$3,$4,$5,'pending',$6)
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       primary_email = EXCLUDED.primary_email,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       avatar_url = EXCLUDED.avatar_url,
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = now()
     WHERE app_users.last_synced_at IS NULL OR app_users.last_synced_at <= EXCLUDED.last_synced_at
     RETURNING id,status`,
    [
      identity.clerkUserId,
      identity.primaryEmail ?? fallbackEmail,
      identity.firstName,
      identity.lastName,
      identity.avatarUrl,
      identity.syncedAt,
    ],
  );
  if (synchronized.rows[0] !== undefined) return synchronized.rows[0];
  const current = await client.query<UserRow>(
    "SELECT id,status FROM app_users WHERE clerk_user_id=$1 FOR UPDATE",
    [identity.clerkUserId],
  );
  if (current.rows[0] === undefined) throw new Error("Invited Clerk profile synchronization failed");
  return current.rows[0];
}

export class PostgresClientInvitationRepository implements ClientInvitationRepository {
  constructor(private readonly pool: Pool) {}

  async actorOwnsEmail(actorUserId: string, normalizedEmail: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM app_users WHERE id = $1 AND lower(btrim(primary_email)) = $2",
      [actorUserId, normalizedEmail],
    );
    return result.rowCount !== 0;
  }

  listAuthorized(scope: AuthorizedRepositoryScope, organizationId: string) {
    return transaction(this.pool, async (client) => {
      if (!await organizationExists(client, scope, organizationId)) return null;
      await expirePending(client, organizationId);
      const result = await client.query<InvitationRow>(
        `SELECT ${INVITATION_SELECT}
         FROM organization_invitations i
         JOIN app_users inviter ON inviter.id = i.invited_by_user_id
         WHERE i.organization_id = $1
         ORDER BY i.created_at DESC, i.id DESC`,
        [organizationId],
      );
      return result.rows.map(mapInvitation);
    });
  }

  reserve(
    scope: AuthorizedRepositoryScope,
    input: {
      readonly organizationId: string;
      readonly email: string;
      readonly normalizedEmail: string;
      readonly membershipRole: ClientInvitation["membershipRole"];
      readonly invitedByUserId: string;
      readonly expiresAt: Date;
    },
  ) {
    return transaction(this.pool, async (client) => {
      if (!await organizationExists(client, scope, input.organizationId)) return null;
      await expirePending(client, input.organizationId);
      try {
        const inserted = await client.query<{ readonly id: string }>(
          `INSERT INTO organization_invitations (
             organization_id, email, normalized_email, membership_role,
             status, invited_by_user_id, expires_at
           ) VALUES ($1, $2, $3, $4, 'pending', $5, $6)
           RETURNING id`,
          [input.organizationId, input.email, input.normalizedEmail, input.membershipRole, input.invitedByUserId, input.expiresAt],
        );
        return (await findInvitation(client, inserted.rows[0]!.id))!;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate" as const;
        throw error;
      }
    });
  }

  finalizeDelivery(invitationId: string, clerkInvitationId: string, audit: AuditContext) {
    return transaction(this.pool, async (client) => {
      await client.query(
        `UPDATE organization_invitations
         SET clerk_invitation_id = $2, updated_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [invitationId, clerkInvitationId],
      );
      const invitation = (await findInvitation(client, invitationId))!;
      await insertAuditEvent(client, {
        ...audit,
        organizationId: invitation.organizationId,
        action: "organization_invitation.created",
        entityType: "organization_invitation",
        entityId: invitation.id,
        newValues: { membershipRole: invitation.membershipRole, status: invitation.status },
      });
      return invitation;
    });
  }

  async cancelDelivery(invitationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE organization_invitations
       SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [invitationId],
    );
  }

  grantExisting(
    scope: AuthorizedRepositoryScope,
    input: {
      readonly organizationId: string;
      readonly email: string;
      readonly normalizedEmail: string;
      readonly membershipRole: ClientInvitation["membershipRole"];
      readonly invitedByUserId: string;
      readonly identity: VerifiedClerkUser;
      readonly expiresAt: Date;
    },
    audit: AuditContext,
  ): Promise<GrantExistingResult> {
    return transaction(this.pool, async (client) => {
      if (!await organizationExists(client, scope, input.organizationId)) return { kind: "organization_not_found" };
      await expirePending(client, input.organizationId);
      const pending = await client.query(
        `SELECT 1 FROM organization_invitations
         WHERE organization_id = $1 AND normalized_email = $2 AND status = 'pending'
         LIMIT 1`,
        [input.organizationId, input.normalizedEmail],
      );
      if (pending.rowCount !== 0) return { kind: "duplicate" };
      const user = await synchronizeInvitedUser(client, input.identity, input.normalizedEmail);
      if (user.status === "blocked" || user.status === "deleted") return { kind: "ineligible_profile" };
      const membership = await client.query(
        `SELECT 1 FROM organization_memberships
         WHERE organization_id = $1 AND user_id = $2 AND status = 'active'
         FOR UPDATE`,
        [input.organizationId, user.id],
      );
      if (membership.rowCount !== 0) return { kind: "already_member" };
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO organization_invitations (
           organization_id, email, normalized_email, membership_role, status,
           invited_by_user_id, accepted_by_user_id, expires_at, accepted_at
         ) VALUES ($1, $2, $3, $4, 'accepted', $5, $6, $7, now())
         RETURNING id`,
        [input.organizationId, input.email, input.normalizedEmail, input.membershipRole, input.invitedByUserId, user.id, input.expiresAt],
      );
      await activateMembership(client, input.organizationId, user.id, input.membershipRole);
      if (user.status === "pending") {
        await client.query("UPDATE app_users SET status = 'active', updated_at = now() WHERE id = $1", [user.id]);
      }
      const invitation = (await findInvitation(client, inserted.rows[0]!.id))!;
      await insertAuditEvent(client, {
        ...audit,
        organizationId: input.organizationId,
        action: "organization_invitation.granted_existing",
        entityType: "organization_invitation",
        entityId: invitation.id,
        newValues: { membershipRole: input.membershipRole, status: "accepted", existingAccount: true },
      });
      return { kind: "granted", invitation };
    });
  }

  beginResend(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    invitationId: string,
    invitedByUserId: string,
    expiresAt: Date,
  ): Promise<BeginResendResult> {
    return transaction(this.pool, async (client) => {
      if (!await organizationExists(client, scope, organizationId)) return { kind: "organization_not_found" };
      await expirePending(client, organizationId);
      const source = await findInvitation(client, invitationId, true);
      if (source === null || source.organizationId !== organizationId) return { kind: "invitation_not_found" };
      if (source.status === "accepted") return { kind: "invalid_state" };
      if (source.status === "revoked") {
        const current = await client.query<InvitationRow>(
          `SELECT ${INVITATION_SELECT}
           FROM organization_invitations i
           JOIN app_users inviter ON inviter.id = i.invited_by_user_id
           WHERE i.organization_id = $1 AND i.normalized_email = lower(btrim($2))
             AND i.status = 'pending'
           ORDER BY i.created_at DESC LIMIT 1`,
          [organizationId, source.email],
        );
        if (current.rows[0] !== undefined) {
          return { kind: "already_replaced", invitation: mapInvitation(current.rows[0]) };
        }
        const manuallyRevoked = await client.query(
          `SELECT 1 FROM audit_events
           WHERE entity_type = 'organization_invitation' AND entity_id = $1
             AND action = 'organization_invitation.revoked'
           LIMIT 1`,
          [source.id],
        );
        if (manuallyRevoked.rowCount !== 0) return { kind: "invalid_state" };
      }
      if (source.status === "pending") {
        await client.query(
          `UPDATE organization_invitations
           SET status = 'revoked', revoked_at = now(), updated_at = now()
           WHERE id = $1`,
          [source.id],
        );
      }
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO organization_invitations (
           organization_id, email, normalized_email, membership_role, status,
           invited_by_user_id, expires_at
         ) VALUES ($1, $2, lower(btrim($2)), $3, 'pending', $4, $5)
         RETURNING id`,
        [organizationId, source.email, source.membershipRole, invitedByUserId, expiresAt],
      );
      return {
        kind: "created",
        invitation: (await findInvitation(client, inserted.rows[0]!.id))!,
        previousClerkInvitationId: source.clerkInvitationId,
      };
    });
  }

  finalizeResend(invitationId: string, clerkInvitationId: string, audit: AuditContext) {
    return transaction(this.pool, async (client) => {
      await client.query(
        `UPDATE organization_invitations
         SET clerk_invitation_id = $2, updated_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [invitationId, clerkInvitationId],
      );
      const invitation = (await findInvitation(client, invitationId))!;
      await insertAuditEvent(client, {
        ...audit,
        organizationId: invitation.organizationId,
        action: "organization_invitation.resent",
        entityType: "organization_invitation",
        entityId: invitation.id,
        newValues: { membershipRole: invitation.membershipRole, status: invitation.status },
      });
      return invitation;
    });
  }

  revokeAuthorized(
    scope: AuthorizedRepositoryScope,
    organizationId: string,
    invitationId: string,
    audit: AuditContext,
  ): Promise<ClientInvitation | "organization_not_found" | "invitation_not_found" | "invalid_state"> {
    return transaction(this.pool, async (client) => {
      if (!await organizationExists(client, scope, organizationId)) return "organization_not_found";
      await expirePending(client, organizationId);
      const invitation = await findInvitation(client, invitationId, true);
      if (invitation === null || invitation.organizationId !== organizationId) return "invitation_not_found";
      if (invitation.status === "revoked") return invitation;
      if (invitation.status !== "pending") return "invalid_state";
      await client.query(
        `UPDATE organization_invitations
         SET status = 'revoked', revoked_at = now(), updated_at = now()
         WHERE id = $1`,
        [invitationId],
      );
      const revoked = (await findInvitation(client, invitationId))!;
      await insertAuditEvent(client, {
        ...audit,
        organizationId,
        action: "organization_invitation.revoked",
        entityType: "organization_invitation",
        entityId: invitationId,
        oldValues: { status: "pending" },
        newValues: { status: "revoked" },
      });
      return revoked;
    });
  }

  claim(
    invitationId: string,
    identity: VerifiedClerkUser,
    audit: AuditContext,
  ): Promise<ClaimResult> {
    return transaction(this.pool, async (client) => {
      await expirePending(client);
      const invitation = await findInvitation(client, invitationId, true);
      if (invitation === null) return { kind: "not_found" };
      if (invitation.status === "expired") return { kind: "expired" };
      if (invitation.status === "revoked") return { kind: "revoked" };
      if (invitation.status === "accepted") {
        const accepted = await client.query<{ readonly clerk_user_id: string }>(
          "SELECT clerk_user_id FROM app_users WHERE id = $1",
          [invitation.acceptedByUserId],
        );
        return accepted.rows[0]?.clerk_user_id === identity.clerkUserId
          ? {
              kind: "already_claimed",
              invitation,
              profileExisted: true,
              reconciliationAttempted: false,
              membershipCreated: false,
            }
          : { kind: "used" };
      }
      const normalizedEmails = new Set(identity.verifiedEmails.map((email) => email.trim().toLowerCase()));
      if (!normalizedEmails.has(invitation.email.trim().toLowerCase())) return { kind: "email_mismatch" };
      const userResult = await client.query<UserRow>(
        "SELECT id, status FROM app_users WHERE clerk_user_id = $1 FOR UPDATE",
        [identity.clerkUserId],
      );
      const profileExisted = userResult.rows[0] !== undefined;
      const user = await synchronizeInvitedUser(
        client,
        identity,
        invitation.email.trim().toLowerCase(),
      );
      if (user.status === "blocked" || user.status === "deleted") return { kind: "ineligible_profile" };
      const existingMembership = await client.query(
        `SELECT 1 FROM organization_memberships
         WHERE organization_id=$1 AND user_id=$2 FOR UPDATE`,
        [invitation.organizationId, user.id],
      );
      await activateMembership(client, invitation.organizationId, user.id, invitation.membershipRole);
      if (user.status === "pending") {
        await client.query("UPDATE app_users SET status = 'active', updated_at = now() WHERE id = $1", [user.id]);
      }
      await client.query(
        `UPDATE organization_invitations
         SET status = 'accepted', accepted_by_user_id = $2,
             accepted_at = now(), updated_at = now()
         WHERE id = $1`,
        [invitationId, user.id],
      );
      const claimed = (await findInvitation(client, invitationId))!;
      await insertAuditEvent(client, {
        ...audit,
        actorUserId: user.id,
        organizationId: invitation.organizationId,
        action: "organization_invitation.accepted",
        entityType: "organization_invitation",
        entityId: invitationId,
        oldValues: { status: "pending" },
        newValues: { status: "accepted", membershipRole: invitation.membershipRole },
      });
      return {
        kind: "claimed",
        invitation: claimed,
        profileExisted,
        reconciliationAttempted: !profileExisted,
        membershipCreated: existingMembership.rowCount === 0,
      };
    });
  }
}
