import type { PoolClient } from "pg";

export interface AuditContext {
  readonly actorUserId?: string;
  readonly organizationId?: string;
  readonly requestId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface AuditEventInput extends AuditContext {
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string;
  readonly oldValues?: Readonly<Record<string, unknown>>;
  readonly newValues?: Readonly<Record<string, unknown>>;
}

const SENSITIVE_KEYS = new Set([
  "email",
  "phone",
  "message",
  "taxId",
  "taxIdNormalized",
  "primaryEmail",
]);

export function safeAuditValues(
  values: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (values === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => !SENSITIVE_KEYS.has(key))
      .map(([key, value]) => [key, typeof value === "string" && value.length > 240
        ? `${value.slice(0, 237)}...`
        : value]),
  );
}

export async function insertAuditEvent(
  client: PoolClient,
  input: AuditEventInput,
): Promise<void> {
  const oldValues = safeAuditValues(input.oldValues);
  const newValues = safeAuditValues(input.newValues);
  await client.query(
    `INSERT INTO audit_events (
       actor_user_id, organization_id, action, entity_type, entity_id,
       old_values, new_values, ip_address, user_agent, request_id
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet, $9, $10::uuid)`,
    [
      input.actorUserId ?? null,
      input.organizationId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      oldValues === undefined ? null : JSON.stringify(oldValues),
      newValues === undefined ? null : JSON.stringify(newValues),
      input.ipAddress ?? null,
      input.userAgent?.slice(0, 1000) ?? null,
      input.requestId,
    ],
  );
}
