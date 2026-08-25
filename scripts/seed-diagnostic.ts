import "dotenv/config";
import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_MISSING");

type Point = readonly [needCode: string, points: number];
type Option = readonly [code: string, label: string, description: string | null, points: readonly Point[]];
type Question = {
  readonly code: string;
  readonly question: string;
  readonly helpText: string;
  readonly type: "single_choice" | "multiple_choice";
  readonly required: boolean;
  readonly options: readonly Option[];
};

const questions: readonly Question[] = [
  {
    code: "main_goal", question: "¿Qué te gustaría lograr primero?", helpText: "Elige el resultado que hoy tendría más impacto.",
    type: "single_choice", required: true,
    options: [
      ["sell_online", "Vender en línea", null, [["sell_online", 6]]],
      ["digital_presence", "Tener o mejorar mi presencia digital", null, [["digital_presence", 6]]],
      ["business_automation", "Ahorrar tiempo automatizando tareas", null, [["business_automation", 6]]],
      ["customer_management", "Organizar mejor clientes y ventas", null, [["customer_management", 6]]],
      ["system_improvement", "Mejorar una solución que ya usamos", null, [["system_improvement", 6]]],
      ["system_integration", "Conectar herramientas o sistemas", null, [["system_integration", 6]]],
      ["data_insights", "Entender mejor los datos del negocio", null, [["data_insights", 6]]],
      ["technical_support", "Resolver problemas o recibir mantenimiento", null, [["technical_support", 6]]],
      ["cybersecurity", "Fortalecer la seguridad", null, [["cybersecurity", 6]]],
      ["not_sure", "Aún no estoy seguro", "El resto de preguntas ayudará a orientar el resultado.", [["not_sure", 2]]],
    ],
  },
  {
    code: "digital_presence_now", question: "¿Cómo describirías tu presencia digital actual?", helpText: "Piensa en sitio web, canales y experiencia para tus clientes.",
    type: "single_choice", required: true,
    options: [
      ["none", "No tenemos una presencia digital clara", null, [["digital_presence", 5]]],
      ["basic", "Tenemos algo básico o desactualizado", null, [["digital_presence", 4], ["system_improvement", 2]]],
      ["works", "Funciona, pero podría mejorar", null, [["system_improvement", 3], ["digital_presence", 2]]],
      ["strong", "Es sólida y cumple su objetivo", null, [["digital_presence", 1]]],
    ],
  },
  {
    code: "online_sales", question: "¿Qué papel tienen las ventas en línea para tu negocio?", helpText: "Incluye pagos, pedidos, reservas o contratación digital.",
    type: "single_choice", required: true,
    options: [
      ["start", "Queremos empezar a vender en línea", null, [["sell_online", 5]]],
      ["manual", "Recibimos pedidos, pero el proceso es manual", null, [["sell_online", 4], ["business_automation", 3]]],
      ["grow", "Ya vendemos y queremos mejorar o crecer", null, [["sell_online", 3], ["system_improvement", 3], ["data_insights", 2]]],
      ["not_applicable", "No es una prioridad por ahora", null, [["digital_presence", 1]]],
    ],
  },
  {
    code: "manual_work", question: "¿Qué tareas consumen tiempo de forma repetitiva?", helpText: "Puedes elegir varias.",
    type: "multiple_choice", required: true,
    options: [
      ["data_entry", "Copiar o registrar datos entre herramientas", null, [["business_automation", 5], ["system_integration", 3]]],
      ["approvals", "Aprobaciones y seguimiento interno", null, [["business_automation", 5]]],
      ["reports", "Preparar reportes manualmente", null, [["data_insights", 4], ["business_automation", 3]]],
      ["client_followup", "Dar seguimiento a clientes", null, [["customer_management", 4], ["business_automation", 2]]],
      ["none", "No identificamos tareas repetitivas importantes", null, [["not_sure", 1]]],
    ],
  },
  {
    code: "customer_management", question: "¿Cómo manejan hoy la información de clientes?", helpText: "Elige la opción más cercana.",
    type: "single_choice", required: true,
    options: [
      ["scattered", "Está dispersa en mensajes, archivos o personas", null, [["customer_management", 5], ["system_integration", 2]]],
      ["spreadsheets", "Usamos hojas de cálculo", null, [["customer_management", 4], ["business_automation", 2]]],
      ["crm_improve", "Tenemos un sistema, pero necesita mejorar", null, [["system_improvement", 4], ["customer_management", 2]]],
      ["organized", "Está centralizada y el proceso funciona bien", null, [["customer_management", 1]]],
    ],
  },
  {
    code: "existing_systems", question: "¿Qué situaciones describen sus sistemas actuales?", helpText: "Puedes elegir varias.",
    type: "multiple_choice", required: true,
    options: [
      ["isolated", "Las herramientas no comparten información", null, [["system_integration", 5]]],
      ["legacy", "Hay sistemas lentos, antiguos o difíciles de mantener", null, [["system_improvement", 5], ["technical_support", 2]]],
      ["spreadsheets", "Procesos importantes dependen de hojas de cálculo", null, [["business_automation", 4], ["data_insights", 2]]],
      ["adequate", "Los sistemas actuales cubren bien la operación", null, [["technical_support", 1]]],
      ["none", "No contamos con sistemas definidos", null, [["not_sure", 2], ["digital_presence", 1]]],
    ],
  },
  {
    code: "data_reporting", question: "¿Qué tan fácil es obtener información para tomar decisiones?", helpText: "Piensa en indicadores, reportes y consistencia.",
    type: "single_choice", required: true,
    options: [
      ["no_visibility", "No tenemos visibilidad suficiente", null, [["data_insights", 5]]],
      ["manual", "Los reportes requieren mucho trabajo manual", null, [["data_insights", 4], ["business_automation", 3]]],
      ["inconsistent", "Los datos no coinciden entre herramientas", null, [["data_insights", 4], ["system_integration", 3]]],
      ["controlled", "Tenemos indicadores confiables y oportunos", null, [["data_insights", 1]]],
    ],
  },
  {
    code: "support", question: "¿Qué tipo de acompañamiento técnico necesitan?", helpText: "Considera continuidad, incidentes y evolución.",
    type: "single_choice", required: true,
    options: [
      ["incidents", "Resolver fallas que afectan la operación", null, [["technical_support", 5]]],
      ["maintenance", "Mantenimiento y mejoras continuas", null, [["technical_support", 4], ["system_improvement", 2]]],
      ["guidance", "Orientación para priorizar próximos pasos", null, [["not_sure", 3], ["technical_support", 2]]],
      ["internal", "Tenemos un equipo que cubre el soporte", null, [["technical_support", 1]]],
    ],
  },
  {
    code: "security", question: "¿Cuál es la situación de seguridad y accesos?", helpText: "No necesitas conocer términos técnicos.",
    type: "single_choice", required: true,
    options: [
      ["weak_access", "Los accesos y permisos no están bien controlados", null, [["cybersecurity", 5]]],
      ["concerns", "Tenemos dudas o incidentes que queremos revisar", null, [["cybersecurity", 4], ["technical_support", 2]]],
      ["requirements", "Debemos cumplir requisitos de clientes o del sector", null, [["cybersecurity", 5], ["system_integration", 1]]],
      ["managed", "Contamos con controles y revisiones periódicas", null, [["cybersecurity", 1]]],
    ],
  },
] as const;

async function insertRuleSet(client: PoolClient, version: number, status: "published" | "draft") {
  const ruleSet = await client.query<{ readonly id: string }>(
    `INSERT INTO diagnostic_rule_sets (version, status, title, description, published_at)
     VALUES ($1, $2::varchar, 'Orientador de soluciones ILVOX',
       'Responde preguntas sencillas para identificar necesidades y posibles soluciones tecnológicas.',
       CASE WHEN $2::varchar = 'published' THEN now() ELSE NULL END) RETURNING id`,
    [version, status],
  );
  for (const [questionIndex, question] of questions.entries()) {
    const insertedQuestion = await client.query<{ readonly id: string }>(
      `INSERT INTO diagnostic_questions
       (rule_set_id, code, question, help_text, type, display_order, required, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
      [ruleSet.rows[0]!.id, question.code, question.question, question.helpText,
        question.type, (questionIndex + 1) * 10, question.required],
    );
    for (const [optionIndex, option] of question.options.entries()) {
      const insertedOption = await client.query<{ readonly id: string }>(
        `INSERT INTO diagnostic_options (question_id, code, label, description, display_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [insertedQuestion.rows[0]!.id, option[0], option[1], option[2], (optionIndex + 1) * 10],
      );
      for (const [needCode, points] of option[3]) {
        const scored = await client.query(
          `INSERT INTO diagnostic_option_need_points (option_id, need_id, points)
           SELECT $1, id, $3 FROM service_needs WHERE code = $2`,
          [insertedOption.rows[0]!.id, needCode, points],
        );
        if (scored.rowCount !== 1) throw new Error(`SERVICE_NEED_MISSING:${needCode}`);
      }
    }
  }
}

const pool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-diagnostic-seed" });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox:diagnostic:seed'))");
  const existing = await client.query("SELECT 1 FROM diagnostic_rule_sets LIMIT 1");
  if (existing.rowCount === 0) {
    await insertRuleSet(client, 1, "published");
    await insertRuleSet(client, 2, "draft");
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ seeded: existing.rowCount === 0, questions: questions.length, overwroteExisting: false }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
