import type { Pool, PoolClient } from "pg";
import { insertAuditEvent } from "../../common/audit/audit.js";
import type { AuditContext } from "../../common/audit/audit.js";
import type {
  DiagnosticAdminState,
  DiagnosticConfiguration,
  DiagnosticDraftInput,
  DiagnosticOptionDefinition,
  DiagnosticQuestionDefinition,
  DiagnosticRepository,
  DiagnosticRuleSetDefinition,
  DiagnosticRunCreate,
  DiagnosticRunResult,
} from "./diagnostic.types.js";

type Executor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

interface RuleSetRow {
  readonly id: string;
  readonly version: number;
  readonly status: DiagnosticRuleSetDefinition["status"];
  readonly title: string;
  readonly description: string;
  readonly published_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface QuestionRow {
  readonly id: string;
  readonly code: string;
  readonly question: string;
  readonly help_text: string | null;
  readonly type: DiagnosticQuestionDefinition["type"];
  readonly display_order: number;
  readonly required: boolean;
  readonly is_active: boolean;
}

interface OptionRow {
  readonly id: string;
  readonly question_id: string;
  readonly code: string;
  readonly label: string;
  readonly description: string | null;
  readonly display_order: number;
  readonly need_id: string | null;
  readonly points: number | null;
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

function mapRuleSet(row: RuleSetRow, questions: readonly DiagnosticQuestionDefinition[]): DiagnosticRuleSetDefinition {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    title: row.title,
    description: row.description,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questions,
  };
}

async function loadRuleSet(executor: Executor, id: string, activeOnly: boolean): Promise<DiagnosticRuleSetDefinition | null> {
  const ruleSet = await executor.query<RuleSetRow>(
    `SELECT id, version, status, title, description, published_at, created_at, updated_at
     FROM diagnostic_rule_sets WHERE id = $1`,
    [id],
  );
  if (ruleSet.rows[0] === undefined) return null;
  const questions = await executor.query<QuestionRow>(
    `SELECT id, code, question, help_text, type, display_order, required, is_active
     FROM diagnostic_questions WHERE rule_set_id = $1 ${activeOnly ? "AND is_active = true" : ""}
     ORDER BY display_order ASC, code ASC, id ASC`,
    [id],
  );
  const questionIds = questions.rows.map((question) => question.id);
  const options = questionIds.length === 0 ? { rows: [] as OptionRow[] } : await executor.query<OptionRow>(
    `SELECT o.id, o.question_id, o.code, o.label, o.description, o.display_order,
            p.need_id, p.points
     FROM diagnostic_options o
     LEFT JOIN diagnostic_option_need_points p ON p.option_id = o.id
     WHERE o.question_id = ANY($1::uuid[])
     ORDER BY o.display_order ASC, o.code ASC, o.id ASC, p.need_id ASC`,
    [questionIds],
  );
  const optionsByQuestion = new Map<string, DiagnosticOptionDefinition[]>();
  const optionById = new Map<string, DiagnosticOptionDefinition>();
  for (const row of options.rows) {
    let option = optionById.get(row.id);
    if (option === undefined) {
      option = {
        id: row.id,
        code: row.code,
        label: row.label,
        description: row.description,
        displayOrder: row.display_order,
        points: [],
      };
      optionById.set(row.id, option);
      const list = optionsByQuestion.get(row.question_id) ?? [];
      list.push(option);
      optionsByQuestion.set(row.question_id, list);
    }
    if (row.need_id !== null && row.points !== null) {
      (option.points as { needId: string; points: number }[]).push({ needId: row.need_id, points: row.points });
    }
  }
  return mapRuleSet(ruleSet.rows[0], questions.rows.map((row) => ({
    id: row.id,
    code: row.code,
    question: row.question,
    helpText: row.help_text,
    type: row.type,
    displayOrder: row.display_order,
    required: row.required,
    isActive: row.is_active,
    options: optionsByQuestion.get(row.id) ?? [],
  })));
}

async function cloneQuestions(
  client: PoolClient,
  targetRuleSetId: string,
  questions: DiagnosticRuleSetDefinition["questions"],
): Promise<void> {
  for (const question of questions) {
    const insertedQuestion = await client.query<{ readonly id: string }>(
      `INSERT INTO diagnostic_questions
       (rule_set_id, code, question, help_text, type, display_order, required, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [targetRuleSetId, question.code, question.question, question.helpText, question.type,
        question.displayOrder, question.required, question.isActive],
    );
    for (const option of question.options) {
      const insertedOption = await client.query<{ readonly id: string }>(
        `INSERT INTO diagnostic_options (question_id, code, label, description, display_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [insertedQuestion.rows[0]!.id, option.code, option.label, option.description, option.displayOrder],
      );
      for (const rule of option.points) {
        await client.query(
          `INSERT INTO diagnostic_option_need_points (option_id, need_id, points) VALUES ($1, $2, $3)`,
          [insertedOption.rows[0]!.id, rule.needId, rule.points],
        );
      }
    }
  }
}

export class PostgresDiagnosticRepository implements DiagnosticRepository {
  constructor(private readonly pool: Pool) {}

  async getPublishedConfiguration(): Promise<DiagnosticConfiguration | null> {
    const published = await this.pool.query<{ readonly id: string }>(
      "SELECT id FROM diagnostic_rule_sets WHERE status = 'published' LIMIT 1",
    );
    const id = published.rows[0]?.id;
    if (id === undefined) return null;
    const ruleSet = await loadRuleSet(this.pool, id, true);
    if (ruleSet === null) return null;
    const [needs, services, links] = await Promise.all([
      this.pool.query<{
        readonly id: string; readonly code: string; readonly title: string;
        readonly short_description: string; readonly display_order: number;
      }>(`SELECT id, code, title, short_description, display_order FROM service_needs
          WHERE is_public = true AND is_active = true ORDER BY display_order, title, id`),
      this.pool.query<{ readonly id: string; readonly name: string; readonly category: string; readonly description: string }>(
        `SELECT id, name, category, description FROM services
         WHERE is_public = true AND is_active = true ORDER BY name, id`,
      ),
      this.pool.query<{ readonly need_id: string; readonly service_id: string; readonly weight: number; readonly is_primary: boolean }>(
        `SELECT l.need_id, l.service_id, l.weight, l.is_primary
         FROM service_need_links l
         JOIN service_needs n ON n.id = l.need_id AND n.is_public = true AND n.is_active = true
         JOIN services s ON s.id = l.service_id AND s.is_public = true AND s.is_active = true
         ORDER BY l.need_id, l.service_id`,
      ),
    ]);
    return {
      ruleSet,
      needs: needs.rows.map((row) => ({
        id: row.id, code: row.code, title: row.title,
        shortDescription: row.short_description, displayOrder: row.display_order,
      })),
      services: services.rows,
      serviceNeedLinks: links.rows.map((row) => ({
        needId: row.need_id, serviceId: row.service_id, weight: row.weight, isPrimary: row.is_primary,
      })),
    };
  }

  async createRun(input: DiagnosticRunCreate): Promise<DiagnosticRunResult> {
    const inserted = await this.pool.query<{ readonly id: string; readonly expires_at: Date }>(
      `INSERT INTO diagnostic_runs
       (rule_set_id, initial_need_id, answers, need_scores, result_snapshot, completed_at, expires_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)
       RETURNING id, expires_at`,
      [input.ruleSetId, input.initialNeedId, JSON.stringify(input.answers), JSON.stringify(input.needScores),
        JSON.stringify(input.resultSnapshot), input.completedAt, input.expiresAt],
    );
    return { id: inserted.rows[0]!.id, expiresAt: inserted.rows[0]!.expires_at, result: input.resultSnapshot };
  }

  async getAdminState(): Promise<DiagnosticAdminState> {
    const rows = await this.pool.query<{ readonly id: string; readonly status: "draft" | "published" }>(
      "SELECT id, status FROM diagnostic_rule_sets WHERE status IN ('draft', 'published') ORDER BY version DESC",
    );
    const publishedId = rows.rows.find((row) => row.status === "published")?.id;
    const draftId = rows.rows.find((row) => row.status === "draft")?.id;
    const [published, draft] = await Promise.all([
      publishedId === undefined ? Promise.resolve(null) : loadRuleSet(this.pool, publishedId, false),
      draftId === undefined ? Promise.resolve(null) : loadRuleSet(this.pool, draftId, false),
    ]);
    return { published, draft };
  }

  saveDraft(input: DiagnosticDraftInput, audit: AuditContext): Promise<DiagnosticRuleSetDefinition> {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox:diagnostic:publish'))");
      let draft = await client.query<{ readonly id: string }>(
        "SELECT id FROM diagnostic_rule_sets WHERE status = 'draft' ORDER BY version DESC LIMIT 1 FOR UPDATE",
      );
      if (draft.rows[0] === undefined) {
        draft = await client.query<{ readonly id: string }>(
          `INSERT INTO diagnostic_rule_sets (version, status, title, description)
           SELECT COALESCE(max(version), 0) + 1, 'draft', $1, $2 FROM diagnostic_rule_sets RETURNING id`,
          [input.title, input.description],
        );
      } else {
        await client.query(
          "UPDATE diagnostic_rule_sets SET title = $1, description = $2, updated_at = now() WHERE id = $3 AND status = 'draft'",
          [input.title, input.description, draft.rows[0].id],
        );
      }
      const draftId = draft.rows[0]!.id;
      const needIds = [...new Set(input.questions.flatMap((question) => question.options.flatMap((option) => option.points.map((rule) => rule.needId))))];
      if (needIds.length > 0) {
        const existing = await client.query<{ readonly total: string }>(
          "SELECT count(*)::text AS total FROM service_needs WHERE id = ANY($1::uuid[])", [needIds],
        );
        if (Number(existing.rows[0]?.total ?? 0) !== needIds.length) {
          throw Object.assign(new Error("diagnostic_need_not_found"), { code: "ILVOX_DIAGNOSTIC_NEED_NOT_FOUND" });
        }
      }
      await client.query(
        `DELETE FROM diagnostic_option_need_points WHERE option_id IN (
           SELECT o.id FROM diagnostic_options o JOIN diagnostic_questions q ON q.id = o.question_id WHERE q.rule_set_id = $1
         )`, [draftId],
      );
      await client.query(
        "DELETE FROM diagnostic_options WHERE question_id IN (SELECT id FROM diagnostic_questions WHERE rule_set_id = $1)",
        [draftId],
      );
      await client.query("DELETE FROM diagnostic_questions WHERE rule_set_id = $1", [draftId]);
      await cloneQuestions(client, draftId, input.questions.map((question, questionIndex) => ({
        id: "", ...question, helpText: question.helpText ?? null,
        displayOrder: question.displayOrder ?? questionIndex,
        options: question.options.map((option, optionIndex) => ({
          id: "", ...option, description: option.description ?? null,
          displayOrder: option.displayOrder ?? optionIndex,
        })),
      })));
      await insertAuditEvent(client, {
        ...audit, action: "diagnostic.draft_saved", entityType: "diagnostic_rule_set", entityId: draftId,
        newValues: { questionCount: input.questions.length },
      });
      return (await loadRuleSet(client, draftId, false))!;
    });
  }

  publishDraft(audit: AuditContext): Promise<DiagnosticAdminState | "draft_missing" | "draft_incomplete"> {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox:diagnostic:publish'))");
      const draftRow = await client.query<{ readonly id: string }>(
        "SELECT id FROM diagnostic_rule_sets WHERE status = 'draft' ORDER BY version DESC LIMIT 1 FOR UPDATE",
      );
      const draftId = draftRow.rows[0]?.id;
      if (draftId === undefined) return "draft_missing" as const;
      const incomplete = await client.query<{ readonly invalid: boolean }>(
        `SELECT NOT EXISTS (SELECT 1 FROM diagnostic_questions WHERE rule_set_id = $1 AND is_active = true)
          OR EXISTS (
            SELECT 1 FROM diagnostic_questions q WHERE q.rule_set_id = $1 AND q.is_active = true
            AND (NOT EXISTS (SELECT 1 FROM diagnostic_options o WHERE o.question_id = q.id)
              OR EXISTS (SELECT 1 FROM diagnostic_options o WHERE o.question_id = q.id
                         AND NOT EXISTS (SELECT 1 FROM diagnostic_option_need_points p WHERE p.option_id = o.id)))
          ) AS invalid`, [draftId],
      );
      if (incomplete.rows[0]?.invalid === true) return "draft_incomplete" as const;
      await client.query("UPDATE diagnostic_rule_sets SET status = 'archived', updated_at = now() WHERE status = 'published'");
      await client.query(
        "UPDATE diagnostic_rule_sets SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1",
        [draftId],
      );
      const published = (await loadRuleSet(client, draftId, false))!;
      const next = await client.query<{ readonly id: string }>(
        `INSERT INTO diagnostic_rule_sets (version, status, title, description)
         SELECT max(version) + 1, 'draft', $1, $2 FROM diagnostic_rule_sets RETURNING id`,
        [published.title, published.description],
      );
      await cloneQuestions(client, next.rows[0]!.id, published.questions);
      await insertAuditEvent(client, {
        ...audit, action: "diagnostic.published", entityType: "diagnostic_rule_set", entityId: draftId,
        newValues: { version: published.version, nextDraftId: next.rows[0]!.id },
      });
      return { published, draft: (await loadRuleSet(client, next.rows[0]!.id, false))! };
    });
  }
}
