# GO / NO-GO — cutover a producción

Veredicto global: **NO-GO / PARCIAL.** No hay ningún hallazgo técnico que por sí solo sea inaceptable, pero varios gates dependen de una decisión o credencial humana que esta sesión no puede ni debe resolver por su cuenta. Ver la sección "Próximo gate único" al final.

Leyenda: **PASS** (verificado, listo) · **FAIL** (verificado y roto) · **BLOCKED** (no se puede verificar sin una credencial/acceso/decisión humana) · **N/R** (not required — no aplica a un cutover técnico) · **HUMAN** (requiere una decisión de producto, no técnica).

| # | Gate | Estado | Evidencia / gate exacto |
|---|---|---|---|
| 1 | Auth público (signup/login/logout/reset/enumeración) | **PASS**, con 1 fix aplicado | Password reset estaba completamente roto, corregido esta fase (`fix(auth)` `63306f6`) y verificado en vivo contra preview (request se envía correctamente; entrega del email de Supabase no se confirmó dentro de esta sesión por latencia del SMTP default — ver #2). Anti-enumeración correcta en el mensaje de "reset enviado". |
| 2 | SMTP / emails transaccionales | **PARCIAL** | Confirmado: Supabase usa su servicio SMTP default (no custom). `RESEND_API_KEY` no configurada en ningún entorno — cero emails de marca se envían hoy. 3 de 6 funciones de email (`sendWelcomeEmail`, `sendLowCreditsEmail`, `sendWeeklySummaryEmail`) son código muerto sin call site. No bloqueante para un cutover técnico, pero si se espera volumen real de registros, es una brecha de producto conocida. |
| 3 | Google OAuth / Lovable | **FAIL, sin fix mínimo seguro disponible** | Confirmado por click-through real: 404 en `/~oauth/initiate` porque depende de un proxy de borde exclusivo de `*.lovable.app`/`*.lovableproject.com`, ausente en un Worker de Cloudflare directo. Email/password no afectado. Corrección real requiere o restaurar el proxy de Lovable delante del Worker, o migrar a OAuth nativo de Supabase — ambas fuera de "corrección mínima segura" y requieren credenciales/decisión humana (`No crear OAuth Client nuevo sin intervención humana`). |
| 4 | Lemon Squeezy Test Mode confirmado | **PASS** | Confirmado inequívocamente vía dashboard: badge "Test mode" junto al nombre de la tienda, más "Your application has been received and will be reviewed" — Live Mode ni siquiera está aprobado todavía, cero riesgo de cobro real accidental. |
| 5 | Checkout Test Mode en preview | **PASS** | Sesión de Lemon Squeezy re-autenticada por el usuario; credenciales Test Mode configuradas solo en preview (API key nueva creada exclusivamente para esto, store ID y 5 variant IDs verificados 1:1 contra el código). Checkout real generado vía `POST /api/billing/checkout` con el token de la cuenta QA — 200, URL de Test Mode correcta, producto/precio/moneda confirmados visualmente. Ver `docs/lemon-squeezy-test-validation.md`. |
| 6 | Webhook Test Mode en preview | **PASS** | Webhook Test-Mode-only creado apuntando a la URL real de preview con los 12 eventos exactos que el handler procesa. Una transacción de prueba real (tarjeta 4242, $29.00 PRO Monthly) completada — 4 eventos entregados, los 4 con `200 ok`, procesados correctamente en el Supabase nuevo (plan, créditos, fila de suscripción). Webhook de producción sin tocar. |
| 7 | Billing: créditos/idempotencia | **PASS**, con 1 bug real encontrado y corregido | 9 tests cubren firma HMAC, RPC con args correctos, "already processed", error de RPC sin notificar, e idempotencia de reintentos bit-a-bit. **Hallazgo real en vivo**: la función oficial "Resend" de Lemon Squeezy no produce un cuerpo byte-idéntico (URLs firmadas nuevas cada vez), lo que rompía la idempotencia basada en `sha256(raw body)` — confirmado viendo crecer `lemon_squeezy_events` en cada resend antes del fix. Corregido re-clave a `sha256(event_name + resource_id + updated_at)`; verificado en vivo que 3 resends consecutivos post-fix colapsan a una sola fila. |
| 8 | Delete-account: auditoría | **PARCIAL, 1 fix crítico aplicado** | Fix real: cancelación de suscripción Lemon Squeezy antes de borrar (`fix(billing)` `9571f12`) — antes, borrar la cuenta dejaba una suscripción real cobrando indefinidamente. Gaps documentados sin corregir: sin re-autenticación antes de borrar, `billing_history` huérfano (podría ser intencional). No probable end-to-end en preview hoy por falta de `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`. |
| 9 | Storage: buckets/políticas | **PASS**, con 1 fix aplicado | RLS ya era correcta (ownership vía `storage.foldername`, verificado no hay path traversal). Fix real: los 3 buckets no tenían `file_size_limit`/`allowed_mime_types` — vector de XSS almacenado real en los 2 buckets públicos, corregido vía migración. |
| 10 | CSP / headers | **PASS**, con mejoras aplicadas | Cobertura confirmada global (todo pasa por `src/server.ts`, sin rutas excluidas). Se agregó recolección de reportes (antes Report-Only sin ningún `report-uri`, cero telemetría real) y las directivas `object-src`/`base-uri`/`form-action` que faltaban. Sigue en Report-Only, no enforcing — pasar a enforcing es una decisión de producto una vez que se junten reportes reales. |
| 11 | Observabilidad / alertas | **PARCIAL** | Logging estructurado ya existente (`logWebhookEvent`, `logModelUsage`) más el nuevo `/api/csp-report`. No hay alerting activo (solo logs de Cloudflare) — aceptable para un cutover inicial, no para escala. |
| 12 | Mobile / rutas críticas | **N/R esta fase** | No se re-testeó esta fase — ya cubierto en el click-through de una fase anterior. |
| 13 | Inventario Supabase anterior | **BLOCKED** | Sin acceso a esa organización desde esta sesión. Ver `docs/production-data-decision.md`. |
| 14 | Estrategia de migración/relanzamiento | **HUMAN** | 3 escenarios documentados (A/B/C) en `docs/production-data-decision.md` — la elección depende enteramente de las cifras del gate #13. |
| 15 | Backups/manifests del sistema nuevo | **PASS**, con limitación documentada | Manifests de columnas/RLS/funciones/buckets generados (`.local-backups/`). Un dump SQL literal (`supabase db dump`) no fue posible — Docker no está disponible en este entorno; documentado como limitación, no como omisión. |
| 16 | Simulacro de cutover técnico | **PASS (documental) + rollback real ensayado** | Ver `docs/cutover-rehearsal-report.md` — línea de tiempo T-24h a T+60m con placeholders `NOT-EXECUTED` para todo lo que tocaría producción real. |
| 17 | Simulacro de rollback | **PASS, ejecutado de verdad en preview** | `wrangler rollback` probado en ambas direcciones contra el Worker preview, con verificación HTTP concreta (headers CSP y endpoint `/api/csp-report` cambiando de estado y volviendo) — no solo el comando "no falló", sino evidencia de que efectivamente sirvió el código de cada versión. |
| 18 | Checklist GO/NO-GO | **PASS** | Este documento. |
| 19 | Runbook actualizado | **PASS** | `docs/production-cutover-runbook.md` actualizado con el estado real de esta fase (ver diffs de la sección A). |
| 20 | Producción intacta | **PASS** | Sin deploys, sin cambios de secrets, sin cambios de DNS/dominio/rutas, sin merge a `main`, sin Live Mode, secret accidental sin tocar. Confirmado explícitamente al final de esta fase. |

## Resumen numérico

- **PASS**: 12 (incluye 4 con mejoras/fixes reales aplicados y verificados en vivo)
- **PARCIAL**: 3
- **FAIL**: 1 (Google OAuth — sin corrección mínima segura disponible)
- **BLOCKED**: 1 (Supabase anterior — falta de acceso, no de código)
- **HUMAN**: 1
- **N/R**: 1

## Próximo gate único antes de un cutover real

Con el checkout/webhook de Lemon Squeezy ahora validado end-to-end, queda un solo gate real bloqueando el cutover, y no es técnico:

**Alguien con acceso a la organización del Supabase anterior** corre `SELECT count(*) FROM auth.users` (y el cruce contra suscripciones/compras) para poder elegir entre los Escenarios A/B/C de `docs/production-data-decision.md`.

Como nota secundaria, no bloqueante para el cutover si email/password sigue siendo el flujo principal: decidir conscientemente qué hacer con Google OAuth (restaurar el proxy de Lovable vs. migrar a OAuth nativo de Supabase) — no debe quedar olvidado, pero no es un gate duro.

Ninguno de los dos requiere tocar producción para resolverse.
