import type { Pool, PoolClient, QueryResultRow } from "pg";
import { insertAuditEvent, type AuditContext } from "../../common/audit/audit.js";
import type {
  AssignableInternalRole,
  BeginInternalResendResult,
  GrantExistingInternalResult,
  InternalClaimResult,
  InternalInvitation,
  InternalInvitationRepository,
} from "./internal-invitation.types.js";

interface InvitationRow extends QueryResultRow {
  readonly id: string;
  readonly email: string;
  readonly role_id: string;
  readonly role_code: string;
  readonly role_name: string;
  readonly status: InternalInvitation["status"];
  readonly clerk_invitation_id: string | null;
  readonly invited_by_user_id: string;
  readonly accepted_by_user_id: string | null;
  readonly expires_at: Date;
  readonly accepted_at: Date | null;
  readonly revoked_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface RoleRow extends QueryResultRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
}

interface UserRow extends QueryResultRow {
  readonly id: string;
  readonly status: "pending" | "active" | "blocked" | "deleted";
}

const INVITATION_SELECT = `i.id, i.email, i.role_id, r.code AS role_code, r.name AS role_name,
  i.status, i.clerk_invitation_id, i.invited_by_user_id, i.accepted_by_user_id,
  i.expires_at, i.accepted_at, i.revoked_at, i.created_at, i.updated_at`;

function mapInvitation(row: InvitationRow): InternalInvitation {
  return {
    id: row.id,
    email: row.email,
    roleCode: row.role_code,
    roleName: row.role_name,
    status: row.status,
    clerkInvitationId: row.clerk_invitation_id,
    invitedByUserId: row.invited_by_user_id,
    acceptedByUserId: row.accepted_by_user_id,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

async function expirePending(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE internal_user_invitations SET status='expired', updated_at=now()
     WHERE status='pending' AND expires_at <= now()`,
  );
}

async function findInvitation(client: PoolClient, invitationId: string, forUpdate = false): Promise<InternalInvitation | null> {
  const result = await client.query<InvitationRow>(
    `SELECT ${INVITATION_SELECT}
     FROM internal_user_invitations i JOIN roles r ON r.id=i.role_id AND r.scope='global'
     WHERE i.id=$1 ${forUpdate ? "FOR UPDATE OF i" : ""}`,
    [invitationId],
  );
  return result.rows[0] === undefined ? null : mapInvitation(result.rows[0]);
}

async function grantRole(client: PoolClient, userId: string, roleId: string, invitedByUserId: string): Promise<boolean> {
  const role = await client.query(
    "SELECT 1 FROM roles WHERE id=$1 AND scope='global' AND code <> 'super_admin'",
    [roleId],
  );
  if (role.rowCount !== 1) throw new Error("INTERNAL_INVITATION_ROLE_NOT_ASSIGNABLE");
  const result = await client.query(
    `INSERT INTO user_roles (user_id,role_id,role_scope,assigned_by_user_id)
     VALUES ($1,$2,'global',$3) ON CONFLICT (user_id,role_id) DO NOTHING`,
    [userId, roleId, invitedByUserId],
  );
  return result.rowCount === 1;
}

async function auditRoleGrant(
  client: PoolClient,
  audit: AuditContext,
  invitation: InternalInvitation,
  userId: string,
  actorUserId: string,
): Promise<void> {
  await insertAuditEvent(client, {
    ...audit,
    actorUserId,
    action: "internal_user.role_granted",
    entityType: "app_user",
    entityId: userId,
    newValues: { roleCode: invitation.roleCode, invitationId: invitation.id },
  });
}

export class PostgresInternalInvitationRepository implements InternalInvitationRepository {
  constructor(private readonly pool: Pool) {}

  async listAssignableRoles(actorUserId: string): Promise<readonly AssignableInternalRole[]> {
    const result = await this.pool.query<RoleRow>(
      `SELECT r.id,r.code,r.name,r.description FROM roles r
       WHERE r.scope='global' AND r.code <> 'super_admin'
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions target_rp
           WHERE target_rp.role_id=r.id AND NOT EXISTS (
             SELECT 1 FROM user_roles actor_ur
             JOIN roles actor_r ON actor_r.id=actor_ur.role_id AND actor_r.scope='global'
             JOIN role_permissions actor_rp ON actor_rp.role_id=actor_r.id
             WHERE actor_ur.user_id=$1 AND actor_rp.permission_id=target_rp.permission_id
           )
         )
       ORDER BY r.name,r.code`,
      [actorUserId],
    );
    return result.rows;
  }

  async findAssignableRole(actorUserId: string, roleCode: string): Promise<AssignableInternalRole | null> {
    const roles = await this.listAssignableRoles(actorUserId);
    return roles.find((role) => role.code === roleCode) ?? null;
  }

  list(): Promise<readonly InternalInvitation[]> {
    return transaction(this.pool, async (client) => {
      await expirePending(client);
      const result = await client.query<InvitationRow>(
        `SELECT ${INVITATION_SELECT}
         FROM internal_user_invitations i JOIN roles r ON r.id=i.role_id AND r.scope='global'
         ORDER BY i.created_at DESC,i.id DESC`,
      );
      return result.rows.map(mapInvitation);
    });
  }

  reserve(input: {
    readonly email: string; readonly normalizedEmail: string; readonly roleId: string;
    readonly invitedByUserId: string; readonly expiresAt: Date;
  }): Promise<InternalInvitation | "duplicate"> {
    return transaction(this.pool, async (client) => {
      await expirePending(client);
      try {
        const inserted = await client.query<{ readonly id: string }>(
          `INSERT INTO internal_user_invitations
             (email,normalized_email,role_id,status,invited_by_user_id,expires_at)
           VALUES ($1,$2,$3,'pending',$4,$5) RETURNING id`,
          [input.email, input.normalizedEmail, input.roleId, input.invitedByUserId, input.expiresAt],
        );
        return (await findInvitation(client, inserted.rows[0]!.id))!;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") return "duplicate";
        throw error;
      }
    });
  }

  finalizeDelivery(invitationId: string, clerkInvitationId: string, audit: AuditContext): Promise<InternalInvitation> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "UPDATE internal_user_invitations SET clerk_invitation_id=$2,updated_at=now() WHERE id=$1 AND status='pending'",
        [invitationId, clerkInvitationId],
      );
      const invitation = (await findInvitation(client, invitationId))!;
      await insertAuditEvent(client, {
        ...audit, action: "internal_user.invited", entityType: "internal_user_invitation", entityId: invitation.id,
        newValues: { roleCode: invitation.roleCode, status: invitation.status },
      });
      return invitation;
    });
  }

  async cancelDelivery(invitationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE internal_user_invitations SET status='revoked',revoked_at=now(),updated_at=now()
       WHERE id=$1 AND status='pending'`,
      [invitationId],
    );
  }

  grantExisting(input: {
    readonly email: string; readonly normalizedEmail: string; readonly roleId: string;
    readonly invitedByUserId: string; readonly clerkUserId: string; readonly expiresAt: Date;
  }, audit: AuditContext): Promise<GrantExistingInternalResult> {
    return transaction(this.pool, async (client) => {
      await expirePending(client);
      const pending = await client.query(
        "SELECT 1 FROM internal_user_invitations WHERE normalized_email=$1 AND status='pending' LIMIT 1",
        [input.normalizedEmail],
      );
      if (pending.rowCount !== 0) return { kind: "duplicate" };
      const userResult = await client.query<UserRow>(
        "SELECT id,status FROM app_users WHERE clerk_user_id=$1 FOR UPDATE",
        [input.clerkUserId],
      );
      const user = userResult.rows[0];
      if (user === undefined) return { kind: "not_synchronized" };
      if (user.status === "blocked" || user.status === "deleted") return { kind: "ineligible_profile" };
      const internal = await client.query(
        `SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.scope='global'
         WHERE ur.user_id=$1 LIMIT 1`,
        [user.id],
      );
      if (internal.rowCount !== 0) return { kind: "already_internal" };
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO internal_user_invitations
           (email,normalized_email,role_id,status,invited_by_user_id,accepted_by_user_id,expires_at,accepted_at)
         VALUES ($1,$2,$3,'accepted',$4,$5,$6,now()) RETURNING id`,
        [input.email, input.normalizedEmail, input.roleId, input.invitedByUserId, user.id, input.expiresAt],
      );
      await grantRole(client, user.id, input.roleId, input.invitedByUserId);
      if (user.status === "pending") {
        await client.query("UPDATE app_users SET status='active',updated_at=now() WHERE id=$1", [user.id]);
      }
      const invitation = (await findInvitation(client, inserted.rows[0]!.id))!;
      await insertAuditEvent(client, {
        ...audit, action: "internal_user.invited", entityType: "internal_user_invitation", entityId: invitation.id,
        newValues: { roleCode: invitation.roleCode, status: "accepted", existingAccount: true },
      });
      await insertAuditEvent(client, {
        ...audit, action: "internal_user.existing_account_granted", entityType: "internal_user_invitation", entityId: invitation.id,
        newValues: { roleCode: invitation.roleCode, status: "accepted" },
      });
      await auditRoleGrant(client, audit, invitation, user.id, input.invitedByUserId);
      return { kind: "granted", invitation };
    });
  }

  beginResend(invitationId: string, invitedByUserId: string, expiresAt: Date): Promise<BeginInternalResendResult> {
    return transaction(this.pool, async (client) => {
      await expirePending(client);
      const source = await findInvitation(client, invitationId, true);
      if (source === null) return { kind: "not_found" };
      if (source.status === "accepted") return { kind: "invalid_state" };
      if (source.status === "revoked") {
        const current = await client.query<InvitationRow>(
          `SELECT ${INVITATION_SELECT} FROM internal_user_invitations i
           JOIN roles r ON r.id=i.role_id AND r.scope='global'
           WHERE i.normalized_email=lower(btrim($1)) AND i.status='pending'
           ORDER BY i.created_at DESC LIMIT 1`,
          [source.email],
        );
        if (current.rows[0] !== undefined) return { kind: "already_replaced", invitation: mapInvitation(current.rows[0]) };
        const manuallyRevoked = await client.query(
          `SELECT 1 FROM audit_events WHERE entity_type='internal_user_invitation' AND entity_id=$1
             AND action='internal_user.invitation_revoked' LIMIT 1`,
          [source.id],
        );
        if (manuallyRevoked.rowCount !== 0) return { kind: "invalid_state" };
      }
      if (source.status === "pending") {
        await client.query(
          "UPDATE internal_user_invitations SET status='revoked',revoked_at=now(),updated_at=now() WHERE id=$1",
          [source.id],
        );
      }
      const role = await client.query<{ readonly id: string }>(
        "SELECT role_id AS id FROM internal_user_invitations WHERE id=$1",
        [source.id],
      );
      const inserted = await client.query<{ readonly id: string }>(
        `INSERT INTO internal_user_invitations
           (email,normalized_email,role_id,status,invited_by_user_id,expires_at)
         VALUES ($1::varchar(320),lower(btrim($1::varchar(320))),$2,'pending',$3,$4) RETURNING id`,
        [source.email, role.rows[0]!.id, invitedByUserId, expiresAt],
      );
      return {
        kind: "created",
        invitation: (await findInvitation(client, inserted.rows[0]!.id))!,
        previousClerkInvitationId: source.clerkInvitationId,
      };
    });
  }

  finalizeResend(invitationId: string, clerkInvitationId: string, audit: AuditContext): Promise<InternalInvitation> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "UPDATE internal_user_invitations SET clerk_invitation_id=$2,updated_at=now() WHERE id=$1 AND status='pending'",
        [invitationId, clerkInvitationId],
      );
      const invitation = (await findInvitation(client, invitationId))!;
      await insertAuditEvent(client, {
        ...audit, action: "internal_user.invitation_resent", entityType: "internal_user_invitation", entityId: invitation.id,
        newValues: { roleCode: invitation.roleCode, status: invitation.status },
      });
      return invitation;
    });
  }

  revoke(invitationId: string, audit: AuditContext): Promise<InternalInvitation | "not_found" | "invalid_state"> {
    return transaction(this.pool, async (client) => {
      await expirePending(client);
      const invitation = await findInvitation(client, invitationId, true);
      if (invitation === null) return "not_found";
      if (invitation.status === "revoked") return invitation;
      if (invitation.status !== "pending") return "invalid_state";
      await client.query(
        "UPDATE internal_user_invitations SET status='revoked',revoked_at=now(),updated_at=now() WHERE id=$1",
        [invitationId],
      );
      const revoked = (await findInvitation(client, invitationId))!;
      await insertAuditEvent(client, {
        ...audit, action: "internal_user.invitation_revoked", entityType: "internal_user_invitation", entityId: invitationId,
        oldValues: { status: "pending" }, newValues: { status: "revoked" },
      });
      return revoked;
    });
  }

  claim(invitationId: string, clerkUserId: string, verifiedEmails: readonly string[], audit: AuditContext): Promise<InternalClaimResult> {
    return transaction(this.pool, async (client) => {
      await expirePending(client);
      const invitation = await findInvitation(client, invitationId, true);
      if (invitation === null) return { kind: "not_found" };
      if (invitation.status === "expired") return { kind: "expired" };
      if (invitation.status === "revoked") return { kind: "revoked" };
      if (invitation.status === "accepted") {
        const accepted = await client.query<{ readonly clerk_user_id: string }>(
          "SELECT clerk_user_id FROM app_users WHERE id=$1",
          [invitation.acceptedByUserId],
        );
        return accepted.rows[0]?.clerk_user_id === clerkUserId
          ? { kind: "already_claimed", invitation }
          : { kind: "used" };
      }
      const normalizedEmails = new Set(verifiedEmails.map((email) => email.trim().toLowerCase()));
      if (!normalizedEmails.has(invitation.email.trim().toLowerCase())) return { kind: "email_mismatch" };
      const userResult = await client.query<UserRow>(
        "SELECT id,status FROM app_users WHERE clerk_user_id=$1 FOR UPDATE",
        [clerkUserId],
      );
      const user = userResult.rows[0];
      if (user === undefined) return { kind: "not_synchronized" };
      if (user.status === "blocked" || user.status === "deleted") return { kind: "ineligible_profile" };
      const role = await client.query<{ readonly role_id: string; readonly invited_by_user_id: string }>(
        "SELECT role_id,invited_by_user_id FROM internal_user_invitations WHERE id=$1",
        [invitationId],
      );
      await grantRole(client, user.id, role.rows[0]!.role_id, role.rows[0]!.invited_by_user_id);
      if (user.status === "pending") {
        await client.query("UPDATE app_users SET status='active',updated_at=now() WHERE id=$1", [user.id]);
      }
      await client.query(
        `UPDATE internal_user_invitations SET status='accepted',accepted_by_user_id=$2,
           accepted_at=now(),updated_at=now() WHERE id=$1`,
        [invitationId, user.id],
      );
      const claimed = (await findInvitation(client, invitationId))!;
      await insertAuditEvent(client, {
        ...audit, actorUserId: user.id, action: "internal_user.invitation_accepted",
        entityType: "internal_user_invitation", entityId: invitationId,
        oldValues: { status: "pending" }, newValues: { status: "accepted", roleCode: invitation.roleCode },
      });
      await auditRoleGrant(client, audit, claimed, user.id, user.id);
      return { kind: "claimed", invitation: claimed };
    });
  }
}
