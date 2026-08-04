import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClerkClient } from "@clerk/backend";
import { Pool, type PoolClient } from "pg";

interface ClerkEmailAddressLike {
  readonly emailAddress: string;
}

interface ClerkUserLike {
  readonly id: string;
  readonly emailAddresses: readonly ClerkEmailAddressLike[];
}

interface OwnerRow {
  readonly id: string;
  readonly status: string;
}

interface RoleRow {
  readonly id: string;
}

interface CountRow {
  readonly total: number;
}

export interface BootstrapOwnerResult {
  readonly localUserId: string;
  readonly clerkUserId: string;
  readonly status: "active";
  readonly role: "super_admin";
  readonly scope: "global";
  readonly permissionCount: number;
  readonly changed: boolean;
}

export function parseOwnerEmail(args: readonly string[]): string {
  const flagIndex = args.indexOf("--email");
  const value = flagIndex === -1 ? undefined : args[flagIndex + 1];
  const email = value?.trim().toLowerCase();
  if (email === undefined || email.length === 0 || !email.includes("@")) {
    throw new Error("Uso: npm run bootstrap:owner -- --email usuario@dominio");
  }
  return email;
}

export function resolveExactClerkUser(
  email: string,
  users: readonly ClerkUserLike[],
): ClerkUserLike {
  const normalized = email.trim().toLowerCase();
  const exact = users.filter((user) =>
    user.emailAddresses.some(
      (address) => address.emailAddress.trim().toLowerCase() === normalized,
    ),
  );
  if (exact.length !== 1) {
    throw new Error("OWNER_CLERK_IDENTITY_COUNT_INVALID");
  }
  return exact[0]!;
}

export async function bootstrapOwnerByClerkUserId(
  client: PoolClient,
  clerkUserId: string,
): Promise<BootstrapOwnerResult> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox-owner-bootstrap'))");

    const ownerResult = await client.query<OwnerRow>(
      `SELECT id, status
       FROM app_users
       WHERE clerk_user_id=$1
       FOR UPDATE`,
      [clerkUserId],
    );
    if (ownerResult.rowCount !== 1) {
      throw new Error("OWNER_LOCAL_PROFILE_NOT_SYNCHRONIZED");
    }
    const owner = ownerResult.rows[0]!;

    const roleResult = await client.query<RoleRow>(
      `SELECT id
       FROM roles
       WHERE scope='global' AND code='super_admin'
       FOR UPDATE`,
    );
    if (roleResult.rowCount !== 1) {
      throw new Error("SUPER_ADMIN_ROLE_COUNT_INVALID");
    }
    const roleId = roleResult.rows[0]!.id;

    const permissionResult = await client.query<CountRow & { readonly assigned: number }>(
      `SELECT
         (SELECT count(*)::integer FROM permissions) AS total,
         (SELECT count(*)::integer
          FROM role_permissions
          WHERE role_id=$1) AS assigned`,
      [roleId],
    );
    const counts = permissionResult.rows[0]!;
    if (counts.total === 0 || counts.assigned !== counts.total) {
      throw new Error("SUPER_ADMIN_PERMISSION_CATALOG_INCOMPLETE");
    }

    const wasActive = owner.status === "active";
    if (!wasActive) {
      await client.query(
        `UPDATE app_users
         SET status='active', updated_at=now()
         WHERE id=$1`,
        [owner.id],
      );
    }

    const roleAssignment = await client.query(
      `INSERT INTO user_roles (user_id, role_id, role_scope, assigned_by_user_id)
       VALUES ($1,$2,'global',NULL)
       ON CONFLICT (user_id,role_id) DO NOTHING`,
      [owner.id, roleId],
    );
    const roleAdded = roleAssignment.rowCount === 1;
    const changed = !wasActive || roleAdded;

    if (changed) {
      await client.query(
        `INSERT INTO audit_events
           (actor_user_id, action, entity_type, entity_id, old_values, new_values, request_id)
         VALUES
           (NULL, 'identity.bootstrap_owner', 'app_user', $1, $2::jsonb, $3::jsonb, $4)`,
        [
          owner.id,
          JSON.stringify({ status: owner.status, hadSuperAdminRole: !roleAdded }),
          JSON.stringify({
            status: "active",
            role: "super_admin",
            scope: "global",
            permissionCount: counts.total,
            source: "administrative_script",
          }),
          randomUUID(),
        ],
      );
    }

    const effectivePermissions = await client.query<CountRow>(
      `SELECT count(DISTINCT p.id)::integer AS total
       FROM user_roles ur
       JOIN roles r ON r.id=ur.role_id AND r.scope='global'
       JOIN role_permissions rp ON rp.role_id=r.id
       JOIN permissions p ON p.id=rp.permission_id
       WHERE ur.user_id=$1`,
      [owner.id],
    );
    if (effectivePermissions.rows[0]?.total !== counts.total) {
      throw new Error("OWNER_EFFECTIVE_PERMISSIONS_INCOMPLETE");
    }

    await client.query("COMMIT");
    return {
      localUserId: owner.id,
      clerkUserId,
      status: "active",
      role: "super_admin",
      scope: "global",
      permissionCount: counts.total,
      changed,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function runOwnerBootstrap(args: readonly string[]): Promise<BootstrapOwnerResult> {
  const email = parseOwnerEmail(args);
  const secretKey = process.env.CLERK_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (secretKey === undefined || databaseUrl === undefined) {
    throw new Error("OWNER_BOOTSTRAP_CONFIGURATION_INCOMPLETE");
  }

  const clerk = createClerkClient({ secretKey });
  const clerkResponse = await clerk.users.getUserList({
    emailAddress: [email],
    limit: 100,
  });
  const clerkUser = resolveExactClerkUser(email, clerkResponse.data);

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    return await bootstrapOwnerByClerkUserId(client, clerkUser.id);
  } finally {
    client.release();
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  runOwnerBootstrap(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify({
        status: result.changed ? "configured" : "already_configured",
        localUserId: result.localUserId,
        clerkUserId: result.clerkUserId,
        role: result.role,
        scope: result.scope,
        permissionCount: result.permissionCount,
      }));
    })
    .catch((error: unknown) => {
      const code = error instanceof Error ? error.message : "OWNER_BOOTSTRAP_FAILED";
      console.error(`Owner bootstrap failed: ${code}`);
      process.exitCode = 1;
    });
}
