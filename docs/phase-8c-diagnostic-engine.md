# Fase 8C — motor de diagnóstico

## Alcance y datos

La migración `0011_phase8c-diagnostic-engine.sql` crea cinco tablas. `diagnostic_rule_sets` versiona estados `draft`, `published` y `archived`, con versión única y un índice parcial que permite una sola publicación activa. `diagnostic_questions` y `diagnostic_options` guardan el cuestionario ordenado; `diagnostic_option_need_points` relaciona cada opción con una o varias necesidades mediante puntos enteros positivos y una clave única `(option_id, need_id)`. Todas las FK usan `RESTRICT`.

`diagnostic_runs` conserva `answers`, `need_scores` y `result_snapshot` en JSONB, además de ruleset, contexto inicial opcional, vencimiento y lead. No contiene nombre, correo ni teléfono. `lead_id` es único, por lo que una ejecución no puede reclamarse dos veces. El resultado histórico nunca se recalcula.

## Algoritmo determinista

La única función de cálculo es `evaluateDiagnostic`. Para cada opción seleccionada suma sus reglas a `needScore`. Después consulta exclusivamente necesidades, servicios y `service_need_links` públicos/activos de 8B y aplica `serviceScore += needScore * weight`. No hay puntuación directa hacia servicios ni reglas duplicadas en React.

Las necesidades se ordenan por puntuación, orden administrativo, título e ID. Los servicios se ordenan por puntuación; `isPrimary` solo desempata. Nombre e ID resuelven empates restantes. La respuesta pública contiene necesidad principal, hasta tres secundarias, solución principal, hasta tres complementarias, razones derivadas de respuestas, resumen y disclaimer. Nunca expone puntos ni porcentajes.

## Versionado, cuestionario y API

El seed idempotente solo actúa cuando no existe ningún ruleset; crea una publicación y un draft sin sobrescribir configuraciones. Incluye nueve preguntas sobre objetivo, presencia digital, ventas, trabajo manual, clientes, sistemas, datos, soporte y seguridad.

`GET /api/v1/diagnostic` entrega solo ruleset publicado, preguntas y opciones. `POST /api/v1/diagnostic/evaluate` valida versión vigente, preguntas, pertenencia y duplicados de opciones, obligatoriedad, selección única/múltiple y propiedades adicionales; calcula en backend, persiste el snapshot y devuelve `diagnosticId`. Ambos son públicos, sin Clerk, con límites de 30 y 10 solicitudes por minuto.

El contexto `?need=<code>` solo preselecciona la primera opción si sus códigos coinciden y siempre puede cambiarse. Un código inválido se ignora y jamás concede puntos ocultos.

## Leads y operación interna

`POST /api/v1/leads` acepta `diagnosticId` únicamente con `source=diagnostic`. En la transacción de creación bloquea la ejecución, valida existencia, vigencia y ausencia de lead, y la reclama; cualquier fallo revierte el lead. El flujo público no crea un lead al terminar el cuestionario.

`GET /api/v1/leads/:leadId/diagnostic` exige `leads.read` y reutiliza exactamente el scope SQL del lead. Prospectos muestra fecha, respuestas, necesidades, recomendación, complementarios, resumen y versión como snapshot de solo lectura.

Administración reutiliza `services.read`/`services.manage`. Permite editar el draft completo, orden, obligatoriedad, opciones y puntos hacia necesidades, previsualizar y publicar. La publicación archiva la versión previa y clona el siguiente draft en una transacción; una versión publicada nunca se edita.

El smoke `PHASE8C_SMOKE_` cubre reglas, pregunta, puntuación, recomendación, complementario, asociación, lectura interna y limpieza; exige `residualFixtures: 0`. El motor no usa IA ni inicia otras fases.
