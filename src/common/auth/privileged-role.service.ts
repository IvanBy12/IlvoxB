import type { Pool } from "pg";
import { AppError } from "../errors/app-error.js";
import { ErrorCode } from "../errors/error-codes.js";
import type { AuthorizationService } from "./authorization.service.js";
import type { ActorContext } from "./authorization.types.js";

export class PrivilegedRoleService {
  constructor(
    private readonly pool: Pool,
    private readonly authorization: AuthorizationService,
  ) {}

  async assignSuperAdmin(actor: ActorContext, targetUserId: string, requestId: string): Promise<"assigned" | "duplicate"> {
    this.authorization.assertAllowed({
      actor, action: "roles.assign_super_admin", requestedScope: "global",
      resourceType: "app_user", resourceId: targetUserId,
      requestedRole: { scope: "global", code: "super_admin" }, idempotencyKey: requestId,
    });
    return this.mutate(actor, targetUserId, requestId, "assign");
  }

  async revokeSuperAdmin(actor: ActorContext, targetUserId: string, requestId: string): Promise<"revoked" | "duplicate"> {
    this.authorization.assertAllowed({
      actor, action: "roles.assign_super_admin", requestedScope: "global",
      resourceType: "app_user", resourceId: targetUserId,
      requestedRole: { scope: "global", code: "super_admin" }, idempotencyKey: requestId,
    });
    return this.mutate(actor, targetUserId, requestId, "revoke");
  }

  private mutate(
    actor: ActorContext, targetUserId: string, requestId: string, operation: "assign",
  ): Promise<"assigned" | "duplicate">;
  private mutate(
    actor: ActorContext, targetUserId: string, requestId: string, operation: "revoke",
  ): Promise<"revoked" | "duplicate">;
  private async mutate(
    actor: ActorContext,
    targetUserId: string,
    requestId: string,
    operation: "assign" | "revoke",
  ): Promise<"assigned" | "revoked" | "duplicate"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox-super-admin'))");
      const prior = await client.query(
        `SELECT 1 FROM audit_events WHERE request_id=$1 AND actor_user_id=$2
         AND action=$3 AND entity_id=$4`,
        [requestId, actor.localUserId, `roles.${operation}_super_admin`, targetUserId],
      );
      if ((prior.rowCount ?? 0) > 0) {
        await client.query("COMMIT");
        return "duplicate";
      }
      const target = await client.query<{ readonly status: string }>(
        "SELECT status FROM app_users WHERE id=$1 FOR UPDATE", [targetUserId],
      );
      if (target.rows[0]?.status !== "active") {
        throw new AppError({ code: ErrorCode.Forbidden, message: "Operation is not allowed", statusCode: 403 });
      }
      const role = await client.query<{ readonly id: string }>(
        "SELECT id FROM roles WHERE scope='global' AND code='super_admin' FOR UPDATE",
      );
      const roleId = role.rows[0]?.id;
      if (roleId === undefined) throw new Error("SUPER_ADMIN_ROLE_MISSING");

      let changed = false;
      if (operation === "assign") {
        const result = await client.query(
          `INSERT INTO user_roles (user_id,role_id,role_scope,assigned_by_user_id)
           VALUES ($1,$2,'global',$3) ON CONFLICT (user_id,role_id) DO NOTHING`,
          [targetUserId, roleId, actor.localUserId],
        );
        changed = (result.rowCount ?? 0) === 1;
      } else {
        const count = await client.query<{ readonly total: number }>(
          `SELECT count(DISTINCT ur.user_id)::integer AS total FROM user_roles ur
           JOIN app_users u ON u.id=ur.user_id AND u.status='active'
           WHERE ur.role_id=$1`, [roleId],
        );
        if ((count.rows[0]?.total ?? 0) <= 1) {
          throw new AppError({ code: ErrorCode.Conflict, message: "Protected privileged role", statusCode: 409 });
        }
        const result = await client.query(
          "DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2", [targetUserId, roleId],
        );
        changed = (result.rowCount ?? 0) === 1;
      }
      if (changed) {
        await client.query(
          `INSERT INTO audit_events
             (actor_user_id,action,entity_type,entity_id,new_values,request_id)
           VALUES ($1,$2,'app_user',$3,$4::jsonb,$5)`,
          [actor.localUserId, `roles.${operation}_super_admin`, targetUserId,
            JSON.stringify({ role: "super_admin", operation }), requestId],
        );
      }
      await client.query("COMMIT");
      return changed ? (operation === "assign" ? "assigned" : "revoked") : "duplicate";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
