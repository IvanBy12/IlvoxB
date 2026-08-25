import "dotenv/config";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_MISSING");

const services = [
  ["Aplicación web a la medida", "development", "Desarrollo de aplicaciones web escalables adaptadas a los procesos y objetivos del negocio."],
  ["Tienda virtual e integración", "ecommerce", "Tiendas en línea con inventario, pagos, pedidos e integración con la operación existente."],
  ["Landing page + SEO", "digital_presence", "Sitios de alto impacto optimizados para conversión, visibilidad y presencia digital profesional."],
  ["Automatización de procesos", "automation", "Automatización de tareas, integraciones entre herramientas y reportes operativos."],
  ["Plan de mantenimiento mensual", "support", "Soporte técnico, monitoreo, correcciones y mejoras continuas para soluciones digitales."],
] as const;

const links = [
  ["sell_online", "Tienda virtual e integración", 100, true],
  ["sell_online", "Aplicación web a la medida", 55, false],
  ["sell_online", "Automatización de procesos", 40, false],
  ["sell_online", "Landing page + SEO", 30, false],
  ["digital_presence", "Landing page + SEO", 100, true],
  ["digital_presence", "Aplicación web a la medida", 45, false],
  ["business_automation", "Automatización de procesos", 100, true],
  ["business_automation", "Aplicación web a la medida", 70, false],
  ["business_automation", "Tienda virtual e integración", 25, false],
  ["customer_management", "Aplicación web a la medida", 90, true],
  ["customer_management", "Automatización de procesos", 75, false],
  ["customer_management", "Plan de mantenimiento mensual", 35, false],
  ["system_improvement", "Aplicación web a la medida", 90, true],
  ["system_improvement", "Plan de mantenimiento mensual", 75, false],
  ["system_improvement", "Automatización de procesos", 45, false],
  ["system_integration", "Automatización de procesos", 95, true],
  ["system_integration", "Aplicación web a la medida", 85, false],
  ["system_integration", "Tienda virtual e integración", 60, false],
  ["data_insights", "Automatización de procesos", 90, true],
  ["data_insights", "Aplicación web a la medida", 80, false],
  ["technical_support", "Plan de mantenimiento mensual", 100, true],
  ["technical_support", "Aplicación web a la medida", 40, false],
  ["cybersecurity", "Plan de mantenimiento mensual", 80, true],
  ["cybersecurity", "Aplicación web a la medida", 70, false],
  ["not_sure", "Aplicación web a la medida", 50, true],
  ["not_sure", "Automatización de procesos", 35, false],
  ["not_sure", "Plan de mantenimiento mensual", 35, false],
] as const;

const pool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-public-catalog-seed" });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('ilvox:public-catalog:seed'))");
  let insertedServices = 0;
  for (const [name, category, description] of services) {
    const inserted = await client.query(
      `INSERT INTO services (name, category, description, is_public, is_active)
       VALUES ($1, $2, $3, true, true)
       ON CONFLICT (name) DO NOTHING`,
      [name, category, description],
    );
    insertedServices += inserted.rowCount ?? 0;
  }
  let insertedLinks = 0;
  for (const [needCode, serviceName, weight, isPrimary] of links) {
    const inserted = await client.query(
      `INSERT INTO service_need_links (need_id, service_id, weight, is_primary)
       SELECT n.id, s.id, $3, $4
       FROM service_needs n CROSS JOIN services s
       WHERE n.code = $1 AND s.name = $2
       ON CONFLICT (need_id, service_id) DO NOTHING`,
      [needCode, serviceName, weight, isPrimary],
    );
    if (inserted.rowCount === 0) {
      const sourceExists = await client.query(
        `SELECT 1 FROM service_needs n CROSS JOIN services s WHERE n.code = $1 AND s.name = $2`,
        [needCode, serviceName],
      );
      if (sourceExists.rowCount === 0) throw new Error(`CATALOG_SOURCE_MISSING:${needCode}:${serviceName}`);
    } else {
      insertedLinks += inserted.rowCount ?? 0;
    }
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ insertedServices, insertedLinks, overwroteExisting: false }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
