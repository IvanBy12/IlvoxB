import { randomUUID } from "node:crypto";
import "dotenv/config";
import { Pool } from "pg";
import { AuthorizationService } from "../src/common/auth/authorization.service.js";
import type { ActorContext } from "../src/common/auth/authorization.types.js";
import { PostgresServiceNeedRepository } from "../src/modules/service-needs/service-needs.repository.js";
import { ServiceNeedService } from "../src/modules/service-needs/service-needs.service.js";

const PREFIX = "PHASE8B_SMOKE_";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_MISSING");
const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("PHASE8B_SMOKE_REQUIRES_LOCAL_POSTGRESQL");

const pool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-phase8b-smoke" });
const service = new ServiceNeedService(new PostgresServiceNeedRepository(pool), new AuthorizationService());
const marker = randomUUID().replaceAll("-", "");
const serviceIds = { shared: randomUUID(), primary: randomUUID(), hidden: randomUUID() };
const actor: ActorContext = {
  clerkUserId: `${PREFIX}clerk`,
  localUserId: randomUUID(),
  status: "active",
  internal: true,
  memberships: [],
  roles: [{ roleId: randomUUID(), code: "admin", scope: "global" }],
  permissions: [
    { code: "services.read", scopes: ["global"], scopeOrganizationIds: { global: [] } },
    { code: "services.manage", scopes: ["global"], scopeOrganizationIds: { global: [] } },
  ],
};
const audit = { requestId: randomUUID(), ipAddress: "127.0.0.1", userAgent: "phase8b-smoke" };

async function cleanup() {
  await pool.query("DELETE FROM audit_events WHERE user_agent = 'phase8b-smoke'");
  await pool.query("DELETE FROM service_need_links WHERE need_id IN (SELECT id FROM service_needs WHERE title LIKE $1)", [`${PREFIX}%`]);
  await pool.query("DELETE FROM service_needs WHERE title LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM services WHERE name LIKE $1", [`${PREFIX}%`]);
}

async function fixtureCount() {
  const result = await pool.query<{ readonly total: string }>(
    `SELECT ((SELECT count(*) FROM service_needs WHERE title LIKE $1) +
             (SELECT count(*) FROM services WHERE name LIKE $1) +
             (SELECT count(*) FROM audit_events WHERE user_agent = 'phase8b-smoke'))::text AS total`,
    [`${PREFIX}%`],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function createNeed(suffix: string, displayOrder: number, isPublic = true) {
  return service.createAdmin(actor, {
    code: `phase8b_smoke_${suffix}_${marker}`,
    title: `${PREFIX}${suffix.toUpperCase()}_${marker}`,
    shortDescription: `Necesidad temporal ${suffix}`,
    detailedDescription: `Detalle temporal ${suffix} para validar el recorrido completo.`,
    iconKey: "compass",
    displayOrder,
    isPublic,
    isActive: true,
  }, audit);
}

try {
  await cleanup();
  await pool.query(
    `INSERT INTO services (id, name, category, description, is_public, is_active)
     VALUES ($1, $2, 'development', 'Servicio compartido', true, true),
            ($3, $4, 'ecommerce', 'Servicio principal', true, true),
            ($5, $6, 'support', 'Servicio privado', false, true)`,
    [
      serviceIds.shared, `${PREFIX}SHARED_${marker}`,
      serviceIds.primary, `${PREFIX}PRIMARY_${marker}`,
      serviceIds.hidden, `${PREFIX}HIDDEN_${marker}`,
    ],
  );

  const first = await createNeed("first", 30);
  const second = await createNeed("second", 20);
  const third = await createNeed("third", 40);
  const hidden = await createNeed("hidden", 10, false);

  let duplicateCodeRejected = false;
  let duplicateTitleRejected = false;
  const duplicateBase = {
    shortDescription: "Necesidad duplicada temporal",
    detailedDescription: "Detalle duplicado temporal para validar las restricciones únicas.",
    iconKey: "compass",
    displayOrder: 50,
    isPublic: true,
    isActive: true,
  };
  try {
    await service.createAdmin(actor, { ...duplicateBase, code: first.code, title: `${PREFIX}DUPLICATE_CODE_${marker}` }, audit);
  } catch (error) {
    duplicateCodeRejected = (error as { readonly statusCode?: number }).statusCode === 409;
  }
  try {
    await service.createAdmin(actor, { ...duplicateBase, code: `phase8b_smoke_duplicate_title_${marker}`, title: first.title }, audit);
  } catch (error) {
    duplicateTitleRejected = (error as { readonly statusCode?: number }).statusCode === 409;
  }
  if (!duplicateCodeRejected || !duplicateTitleRejected) {
    throw new Error(`NEED_UNIQUENESS_NOT_ENFORCED code=${duplicateCodeRejected} title=${duplicateTitleRejected}`);
  }

  await service.replaceServices(actor, first.id, [
    { serviceId: serviceIds.shared, weight: 55, isPrimary: false },
    { serviceId: serviceIds.primary, weight: 90, isPrimary: true },
    { serviceId: serviceIds.hidden, weight: 100, isPrimary: true },
  ], audit);
  await service.replaceServices(actor, second.id, [
    { serviceId: serviceIds.shared, weight: 80, isPrimary: true },
  ], audit);
  await service.replaceServices(actor, hidden.id, [
    { serviceId: serviceIds.shared, weight: 70, isPrimary: true },
  ], audit);

  const publicList = await service.listPublic({ page: 1, pageSize: 100, search: PREFIX });
  if (publicList.items.length !== 3 || publicList.items.some((item) => item.id === hidden.id)) {
    throw new Error("PUBLIC_NEED_FILTER_INVALID");
  }
  if (publicList.items.map((item) => item.id).join(",") !== [second.id, first.id, third.id].join(",")) {
    throw new Error("PUBLIC_NEED_ORDER_INVALID");
  }

  const firstRelations = await service.listPublicServices(first.id);
  if (firstRelations.length !== 2 || firstRelations[0]?.service.id !== serviceIds.primary ||
      firstRelations[0]?.weight !== 90 || !firstRelations[0].isPrimary ||
      firstRelations.some((link) => link.service.id === serviceIds.hidden)) {
    throw new Error("PUBLIC_RELATION_FILTER_OR_ORDER_INVALID");
  }
  const secondRelations = await service.listPublicServices(second.id);
  if (secondRelations.length !== 1 || secondRelations[0]?.service.id !== serviceIds.shared || secondRelations[0].weight !== 80) {
    throw new Error("MANY_TO_MANY_RELATION_INVALID");
  }

  const edited = await service.updateAdmin(actor, third.id, {
    title: `${PREFIX}THIRD_EDITED_${marker}`,
    displayOrder: 5,
    isActive: false,
  }, audit);
  if (edited.displayOrder !== 5 || edited.isActive || !edited.title.includes("EDITED")) {
    throw new Error("ADMIN_EDIT_INVALID");
  }

  let missingServiceRejected = false;
  try {
    await service.replaceServices(actor, third.id, [{ serviceId: randomUUID(), weight: 50, isPrimary: false }], audit);
  } catch (error) {
    missingServiceRejected = (error as { readonly statusCode?: number }).statusCode === 400;
  }
  if (!missingServiceRejected) throw new Error("MISSING_SERVICE_NOT_REJECTED");

  console.log(JSON.stringify({
    publicNeeds: 3,
    relatedServices: 2,
    sharedServiceNeeds: 2,
    privateNeedExcluded: true,
    privateServiceExcluded: true,
    weightsAndPrimaryOrdered: true,
    administrativeEdit: true,
    missingServiceRejected: true,
    duplicateCodeRejected: true,
    duplicateTitleRejected: true,
  }));
} finally {
  await cleanup();
  const residualFixtures = await fixtureCount();
  await pool.end();
  console.log(JSON.stringify({ residualFixtures }));
  if (residualFixtures !== 0) process.exitCode = 1;
}
