import "dotenv/config";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_MISSING");

const needs = [
  ["sell_online", "Vender en línea", "Quiero ofrecer y vender mis productos o servicios por internet.", "Ideal si necesitas una tienda virtual, pagos en línea o un proceso digital que facilite pedidos y ventas.", "shopping-cart"],
  ["digital_presence", "Mejorar mi presencia digital", "Quiero que mi negocio se vea profesional y sea fácil de encontrar.", "Puede incluir un sitio web, una página informativa o mejoras a la experiencia digital de tu marca.", "globe"],
  ["business_automation", "Automatizar mi negocio", "Quiero reducir tareas manuales y ahorrar tiempo en procesos repetitivos.", "Pensado para procesos como registros, aprobaciones, reportes, seguimiento y otras tareas que hoy se hacen a mano.", "workflow"],
  ["customer_management", "Gestionar mejor a mis clientes", "Quiero organizar contactos, oportunidades y seguimiento comercial.", "Útil cuando necesitas centralizar información de clientes y dar continuidad clara a ventas o atención.", "users"],
  ["system_improvement", "Mejorar un sistema existente", "Tengo una solución digital que necesita evolucionar o funcionar mejor.", "Abarca ajustes de experiencia, rendimiento, estabilidad, funcionalidades y modernización de sistemas actuales.", "gauge"],
  ["system_integration", "Conectar mis sistemas", "Quiero que distintas plataformas compartan información y trabajen juntas.", "Aplica cuando necesitas integrar herramientas, automatizar intercambios de datos o evitar registros duplicados.", "plug"],
  ["data_insights", "Entender mejor mis datos", "Quiero convertir información dispersa en decisiones más claras.", "Puede incluir tableros, indicadores, consolidación de datos y reportes que ayuden a entender el negocio.", "chart"],
  ["technical_support", "Recibir soporte técnico", "Necesito ayuda para resolver problemas y mantener mis soluciones operando.", "Pensado para acompañamiento técnico, mantenimiento, correcciones y atención de incidentes digitales.", "life-buoy"],
  ["cybersecurity", "Fortalecer mi seguridad", "Quiero proteger mejor la información, los accesos y mis sistemas.", "Incluye evaluación y mejora de prácticas de seguridad, control de accesos y reducción de riesgos tecnológicos.", "shield"],
  ["not_sure", "No estoy seguro todavía", "Tengo un reto, pero aún no sé qué tipo de solución necesito.", "Podemos ayudarte a entender la necesidad, ordenar prioridades y definir el siguiente paso sin asumir una solución de antemano.", "compass"],
] as const;

const pool = new Pool({ connectionString: databaseUrl, application_name: "ilvox-service-needs-seed" });
try {
  for (const [index, need] of needs.entries()) {
    await pool.query(
      `INSERT INTO service_needs
         (code, title, short_description, detailed_description, icon_key, display_order, is_public, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true, true)
       ON CONFLICT (code) DO NOTHING`,
      [...need, (index + 1) * 10],
    );
  }
  console.log(JSON.stringify({ seededCodes: needs.map(([code]) => code), serviceLinksCreated: 0 }));
} finally {
  await pool.end();
}
