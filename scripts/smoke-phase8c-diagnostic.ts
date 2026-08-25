import { randomUUID } from "node:crypto";
import "dotenv/config";
import { Pool } from "pg";
import { evaluateDiagnostic } from "../src/modules/diagnostic/diagnostic.engine.js";
import { PostgresDiagnosticRepository } from "../src/modules/diagnostic/diagnostic.repository.js";
import type { DiagnosticConfiguration } from "../src/modules/diagnostic/diagnostic.types.js";
import { PostgresLeadRepository } from "../src/modules/leads/lead.repository.js";

const PREFIX = "PHASE8C_SMOKE_";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_MISSING");
const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("PHASE8C_SMOKE_REQUIRES_LOCAL_POSTGRESQL");

const pool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-phase8c-smoke" });
const diagnosticRepository = new PostgresDiagnosticRepository(pool);
const leadRepository = new PostgresLeadRepository(pool);
const ids = {
  rule: randomUUID(), question: randomUUID(), option: randomUUID(), need: randomUUID(),
  primaryService: randomUUID(), complementaryService: randomUUID(),
};
let diagnosticId: string | null = null;
let leadId: string | null = null;
const audit = { requestId: randomUUID(), ipAddress: "127.0.0.1", userAgent: "phase8c-smoke" };

async function cleanup() {
  await pool.query("DELETE FROM diagnostic_runs WHERE id = $1 OR lead_id = $2", [diagnosticId, leadId]);
  await pool.query("DELETE FROM leads WHERE id = $1", [leadId]);
  await pool.query("DELETE FROM audit_events WHERE user_agent = 'phase8c-smoke'");
  await pool.query("DELETE FROM diagnostic_option_need_points WHERE option_id = $1", [ids.option]);
  await pool.query("DELETE FROM diagnostic_options WHERE id = $1", [ids.option]);
  await pool.query("DELETE FROM diagnostic_questions WHERE id = $1", [ids.question]);
  await pool.query("DELETE FROM diagnostic_rule_sets WHERE id = $1", [ids.rule]);
  await pool.query("DELETE FROM service_need_links WHERE need_id = $1", [ids.need]);
  await pool.query("DELETE FROM service_needs WHERE id = $1", [ids.need]);
  await pool.query("DELETE FROM services WHERE id = ANY($1::uuid[])", [[ids.primaryService, ids.complementaryService]]);
}

async function fixtureCount() {
  const result = await pool.query<{ readonly total: string }>(
    `SELECT ((SELECT count(*) FROM diagnostic_rule_sets WHERE id = $1) +
             (SELECT count(*) FROM diagnostic_runs WHERE id = $2) +
             (SELECT count(*) FROM leads WHERE id = $3) +
             (SELECT count(*) FROM service_needs WHERE id = $4) +
             (SELECT count(*) FROM services WHERE id = ANY($5::uuid[])) +
             (SELECT count(*) FROM audit_events WHERE user_agent = 'phase8c-smoke'))::text AS total`,
    [ids.rule, diagnosticId, leadId, ids.need, [ids.primaryService, ids.complementaryService]],
  );
  return Number(result.rows[0]?.total ?? 0);
}

try {
  await cleanup();
  const version = Number((await pool.query<{ readonly version: number }>(
    "SELECT COALESCE(max(version), 0) + 100000 AS version FROM diagnostic_rule_sets",
  )).rows[0]!.version);
  await pool.query(
    `INSERT INTO services (id, name, category, description, is_public, is_active) VALUES
     ($1, $2, 'automation', 'Principal smoke', true, true),
     ($3, $4, 'support', 'Complementario smoke', true, true)`,
    [ids.primaryService, `${PREFIX}PRIMARY`, ids.complementaryService, `${PREFIX}COMPLEMENTARY`],
  );
  await pool.query(
    `INSERT INTO service_needs
     (id, code, title, short_description, detailed_description, icon_key, display_order, is_public, is_active)
     VALUES ($1, $2, $3, 'Automatizar tareas', 'Necesidad temporal para el smoke 8C.', 'workflow', 9999, true, true)`,
    [ids.need, `phase8c_smoke_${ids.need.replaceAll("-", "")}`, `${PREFIX}NEED`],
  );
  await pool.query(
    `INSERT INTO service_need_links (need_id, service_id, weight, is_primary) VALUES
     ($1, $2, 90, true), ($1, $3, 40, false)`,
    [ids.need, ids.primaryService, ids.complementaryService],
  );
  await pool.query(
    `INSERT INTO diagnostic_rule_sets (id, version, status, title, description)
     VALUES ($1, $2, 'archived', $3, 'Ruleset temporal smoke')`,
    [ids.rule, version, `${PREFIX}RULESET`],
  );
  await pool.query(
    `INSERT INTO diagnostic_questions
     (id, rule_set_id, code, question, type, display_order, required, is_active)
     VALUES ($1, $2, 'smoke_goal', '¿Qué quieres automatizar?', 'multiple_choice', 10, true, true)`,
    [ids.question, ids.rule],
  );
  await pool.query(
    `INSERT INTO diagnostic_options (id, question_id, code, label, display_order)
     VALUES ($1, $2, 'manual_tasks', 'Tareas manuales', 10)`,
    [ids.option, ids.question],
  );
  await pool.query(
    "INSERT INTO diagnostic_option_need_points (option_id, need_id, points) VALUES ($1, $2, 7)",
    [ids.option, ids.need],
  );

  const timestamp = new Date();
  const configuration: DiagnosticConfiguration = {
    ruleSet: {
      id: ids.rule, version, status: "archived", title: `${PREFIX}RULESET`, description: "Ruleset temporal smoke",
      publishedAt: null, createdAt: timestamp, updatedAt: timestamp,
      questions: [{ id: ids.question, code: "smoke_goal", question: "¿Qué quieres automatizar?", helpText: null,
        type: "multiple_choice", displayOrder: 10, required: true, isActive: true,
        options: [{ id: ids.option, code: "manual_tasks", label: "Tareas manuales", description: null,
          displayOrder: 10, points: [{ needId: ids.need, points: 7 }] }] }],
    },
    needs: [{ id: ids.need, code: "smoke_need", title: `${PREFIX}NEED`, shortDescription: "Automatizar tareas", displayOrder: 9999 }],
    services: [
      { id: ids.primaryService, name: `${PREFIX}PRIMARY`, category: "automation", description: "Principal smoke" },
      { id: ids.complementaryService, name: `${PREFIX}COMPLEMENTARY`, category: "support", description: "Complementario smoke" },
    ],
    serviceNeedLinks: [
      { needId: ids.need, serviceId: ids.primaryService, weight: 90, isPrimary: true },
      { needId: ids.need, serviceId: ids.complementaryService, weight: 40, isPrimary: false },
    ],
  };
  const evaluated = evaluateDiagnostic(configuration, [{ questionId: ids.question, optionIds: [ids.option] }], timestamp);
  if (evaluated.needScores[ids.need] !== 7 || evaluated.result.primaryService?.id !== ids.primaryService) {
    throw new Error("DETERMINISTIC_RECOMMENDATION_INVALID");
  }
  const run = await diagnosticRepository.createRun({
    ruleSetId: ids.rule, initialNeedId: ids.need, answers: evaluated.result.answers,
    needScores: evaluated.needScores, resultSnapshot: evaluated.result, completedAt: timestamp,
    expiresAt: new Date(timestamp.getTime() + 60 * 60 * 1000),
  });
  diagnosticId = run.id;
  const lead = await leadRepository.createPublic({
    fullName: `${PREFIX}PERSON`, email: "phase8c-smoke@example.test", message: "Solicitud smoke",
    source: "diagnostic", diagnosticId: run.id, serviceId: ids.primaryService,
  }, audit);
  leadId = lead.id;
  const internal = await leadRepository.findDiagnosticAuthorized(
    { kind: "global", actorId: randomUUID(), crossOrganization: true }, lead.id,
  );
  if (internal?.resultSnapshot.primaryService?.id !== ids.primaryService || internal.resultSnapshot.engineVersion !== version) {
    throw new Error("HISTORICAL_SNAPSHOT_READ_INVALID");
  }
  console.log(JSON.stringify({
    ruleset: true, questions: 1, needScore: 7, recommendation: ids.primaryService,
    complementaryServices: 1, leadAssociated: true, internalSnapshot: true,
  }));
} finally {
  await cleanup();
  const residualFixtures = await fixtureCount();
  await pool.end();
  console.log(JSON.stringify({ residualFixtures }));
  if (residualFixtures !== 0) process.exitCode = 1;
}
