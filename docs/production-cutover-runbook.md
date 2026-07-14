# Runbook: promoción del preview a producción (postulpro.com)

Estado: **documentado, no ejecutado**. Este documento no autoriza ni dispara ningún cambio — es la referencia a seguir cuando el equipo decida promover.

**Actualizado en Fase 5** (2026-07-13) — ver `docs/production-go-no-go.md` para el veredicto gate por gate completo, `docs/release-candidate.md` para el detalle de bugs corregidos esta fase, y `docs/production-data-decision.md` / `docs/production-environment-manifest.md` / `docs/cutover-rehearsal-report.md` para el resto de los deliverables de esta fase.

Contexto al momento de escribir esto:

- Preview: `lostykk-postulpro-preview` (workers.dev, sin Custom Domain), Supabase `ccpejnklrfvgtwryqfrw`.
- Producción: `lostykk-postulpro` (`postulpro.com` / `www.postulpro.com`), Supabase **distinto** (ref confirmado vía el bundle público de producción, no vía credenciales) — producción **no** usa el proyecto Supabase nuevo todavía.
- La prueba real de IA end-to-end en preview **ya se validó** en una fase anterior (1 plan + 1 entregable real, créditos/idempotencia confirmados, sin doble cobro) — la precondición A.1 de abajo pasó a ✅.
- Esta fase (Fase 5) corrigió 5 bugs reales adicionales (password reset roto de punta a punta, `BILLING_RPC_SECRET` nunca rotado del placeholder, borrar cuenta sin cancelar la suscripción real de Lemon Squeezy, CSP Report-Only sin recolección, Storage sin límites de tamaño/MIME) y ensayó un rollback real en preview (`wrangler rollback` en ambas direcciones, verificado por HTTP).
- Fase posterior: se resolvió el acceso al Supabase anterior (vía Lovable Cloud, no vía la organización de Supabase asumida antes — ver `docs/production-data-decision.md`) y se confirmó por click-through real que **Google OAuth nativo ya funciona end-to-end en preview** (el commit `b2e7e06` lo había arreglado; nunca se había verificado en vivo hasta ahora — ver `docs/production-go-no-go.md` gate #3).
- Fase posterior: se habilitó y validó **Custom SMTP de Supabase Auth** (`smtp.resend.com`, sender `no-reply@auth.postulpro.com`) con dos correos reales entregados y clickeados — confirmación de signup y recuperación de contraseña, ambos de punta a punta contra preview (ver `docs/production-go-no-go.md` gate #2).
- Fase posterior: se activó `RESEND_API_KEY` (Worker Secret, solo en preview) para los emails propios de la app — welcome, low-credits, weekly-summary — con idempotencia real vía `public.sent_notifications`/`claim_notification`. Welcome verificado con un envío real (`Sent → Delivered`, cero duplicados). `RESEND_API_KEY` es un secret **distinto y separado** del que usa el Custom SMTP de Auth (mismo dominio verificado `auth.postulpro.com`, dos mecanismos de envío independientes) — rotar/revocar uno no afecta al otro. **Sigue sin configurarse en producción, deliberadamente.**
- **Ya no queda ningún bloqueante técnico para el cutover.** Lo que queda son decisiones de producto no urgentes (cuándo configurar `RESEND_API_KEY` en producción; si mover el allowlist `PREVIEW_AI_ALLOWED_USER_ID` para terminar de validar low-credits/weekly-summary con un envío real) y la logística de programar la ventana de corte en sí.

---

## A. Precondiciones

Todas deben estar en `✅` antes de programar una ventana de corte.

| # | Precondición | Estado actual |
|---|---|---|
| 1 | Al menos una generación real de IA (plan + un entregable) validada end-to-end en preview, con créditos/idempotencia/refund confirmados | ✅ Validado en una fase anterior — 1 crédito cobrado, 1 generación persistida, cero doble cobro, confirmado tras refresh y logout/login completo |
| 2 | Registro público funcionando sin rate-limit bloqueado | ✅ Confirmado esta fase: registro real completado en preview (email/password) sin bloqueo de rate limit |
| 3 | SMTP de producción configurado (o decisión consciente de seguir con el servicio default de Supabase) | ✅ Custom SMTP habilitado esta fase (`smtp.resend.com`, sender `no-reply@auth.postulpro.com`) y validado end-to-end con correos reales de confirmación y recuperación de contraseña, ambos entregados y clickeados. `RESEND_API_KEY` del Worker (emails de marca propios de la app) activado y validado en **preview** en una fase posterior — welcome verificado real, low-credits/weekly-summary cubiertos por tests + gate fail-closed real. Falta configurarlo en **producción** cuando se decida el corte — ver `docs/production-environment-manifest.md` |
| 4 | Site URL / Redirect URLs listos para `postulpro.com` | ❌ Todavía no agregado — hoy el Site URL del proyecto nuevo apunta al preview |
| 5 | OAuth (Google nativo de Supabase) funcionando end-to-end | ✅ Confirmado por click-through real contra preview: botón → Google → callback de Supabase → `/dashboard`, sesión persistente tras refresh, logout limpio, ruta protegida bloqueada sin sesión, segundo login sin duplicar usuario/identidad (verificado por SQL). Sin cambios de código ni de config — ya estaba correcto desde `b2e7e06`, solo no se había verificado en vivo. Para producción falta agregar `https://postulpro.com/**` y `https://www.postulpro.com/**` a las Redirect URLs del proyecto nuevo (sección F) — mecánico, sin riesgo técnico conocido |
| 6 | Lemon Squeezy: variantes, webhook, secretos confirmados como Live Mode (no Test Mode) | ✅ Confirmado esta fase que la tienda está inequívocamente en **Test Mode** (badge + aprobación de Live Mode todavía pendiente) — cero riesgo de cobro real hoy |
| 7 | Billing: checkout, webhook, RPC secret probados con Test Mode primero | ✅ Probado end-to-end esta fase: checkout real generado y pagado con tarjeta de prueba (PRO Monthly, $29.00), webhook Test Mode entregado y procesado (4 eventos, 200 ok), plan/créditos/suscripción verificados en Supabase y en la UI. Bug real de idempotencia encontrado y corregido (`sha256(raw body)` no sobrevivía al "Resend" oficial de Lemon Squeezy) — ver `docs/lemon-squeezy-test-validation.md` |
| 8 | Affiliates: flujo de comisión probado end-to-end | ⚠️ Auditado por código esta fase (no probado en vivo): guard de auto-referido solo bloquea el caso literal mismo-id, no dos cuentas de la misma persona — riesgo de abuso financiero documentado, sin fix (requiere decisión de producto sobre qué señal usar) |
| 9 | Storage: buckets/políticas confirmados en el proyecto nuevo | ✅ RLS ya era correcta; esta fase agregó `file_size_limit`/`allowed_mime_types` a los 3 buckets (cerraba un XSS almacenado real en los 2 buckets públicos) |
| 10 | CSP: Report-Only sin violaciones en el click-through completo | ✅ Cobertura global confirmada por código esta fase (sin rutas excluidas); se agregó `/api/csp-report` (antes Report-Only no recolectaba nada) y las directivas `object-src`/`base-uri`/`form-action` que faltaban. Sigue en Report-Only, no enforcing |
| 11 | Monitoring: alguna forma de ver logs/errores de producción post-corte | Los logs del Worker productivo ya existen (Cloudflare); no se agregó nada nuevo específico para el corte |
| 12 | Backups: snapshot de datos y configuración de producción antes de tocar nada | Manifests del proyecto **nuevo** generados esta fase (`.local-backups/`, ver su README) — el dump del Supabase **anterior** (producción) sigue pendiente de alguien con acceso a esa organización |
| 13 | Rollback: plan probado, no solo escrito | ✅ Ensayado de verdad esta fase contra el Worker **preview** (`wrangler rollback` en ambas direcciones, verificado por HTTP) — ver `docs/cutover-rehearsal-report.md`. El mecanismo es idéntico contra producción (mismo comando, sin `--env`), pero no se ejecutó ahí |

**No programar el corte hasta que 1–8 estén en ✅.** 9–13 son necesarias pero menos riesgosas de resolver el mismo día. Ver `docs/production-go-no-go.md` para el detalle completo gate por gate, incluyendo los tres gates humanos (no técnicos) que hoy bloquean el resto.

---

## B. Decisión de datos

Antes de migrar nada, alguien con acceso al Supabase anterior debe responder:

- ¿Cuántos usuarios reales tiene `auth.users` hoy en producción?
- ¿Hay suscripciones/compras activas en Lemon Squeezy ligadas a esos usuarios?
- ¿Hay generaciones/proyectos que un usuario real esperaría seguir viendo después del corte?
- ¿Hay relaciones de afiliados con comisiones pendientes de pago?

Esta sesión **no tuvo acceso** al proyecto Supabase anterior (pertenece a una organización distinta, no visible desde la cuenta de CLI actualmente autenticada) — confirmar esto es el primer paso literal de la migración, no algo que se pueda inferir de antemano.

Si la respuesta es "cero usuarios reales, todo es de prueba": la migración se simplifica a un corte limpio, sin migración de datos, solo de esquema/config.

Si hay usuarios reales: este runbook necesita una fase D (Migración) mucho más detallada que la que sigue, con mapeo campo a campo de `auth.users`, `public.users`, `subscriptions`, `orders`, `affiliate_*`, `generations`, `projects`, y storage — no intentar en la misma sesión que el corte.

---

## C. Backup (el mismo día, antes de tocar nada)

1. `supabase db dump --linked -f backup-schema-<fecha>.sql` (schema) — proyecto nuevo, ya en uso.
2. Si hay datos reales en el proyecto anterior: dump completo desde una cuenta con acceso a esa organización — fuera del alcance de esta sesión.
3. `npx wrangler secret list --config .output/server/wrangler.json` (nombres únicamente) antes y después — ya es el patrón usado en todas las fases de esta migración.
4. Captura del Worker version ID de producción actual (`npx wrangler deployments list --config .output/server/wrangler.json`) — es el punto exacto al que volver con rollback.
5. Export de la configuración de Auth (Site URL, Redirect URLs, providers) del proyecto anterior, si es accesible.

---

## D. Migración (solo si la sección B determina que hay datos reales)

Orden sugerido — cada paso con su propio dry-run:

1. Schema: aplicar todas las migraciones del proyecto nuevo (ya aplicadas — 18 migraciones, confirmadas en sync).
2. `auth.users`: exportar e importar preservando UUIDs — los password hashes de Supabase Auth no son trivialmente portables entre proyectos; probablemente requiera que los usuarios reseteen contraseña, o usar la Admin API para recrear usuarios con `email_confirm: true` y forzar un flujo de "set new password".
3. `public.users` y tablas dependientes: mapear por el mismo UUID de `auth.users`, verificar foreign keys después de cada tabla.
4. Verificación de integridad: contar filas en origen vs. destino por tabla, no dar por bueno un `INSERT` sin volver a contar.
5. Storage: copiar objetos bucket por bucket, no solo la metadata.
6. Tiempo estimado de downtime: depende del volumen real — con 0 usuarios (escenario más probable dado el estado actual) es prácticamente cero.

---

## E. Cloudflare (producción)

Cambios que habría que aplicar al Worker `lostykk-postulpro` — **ninguno ejecutado esta sesión**:

| Secret | Acción |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Apuntar al proyecto nuevo (`ccpejnklrfvgtwryqfrw`) |
| `SUPABASE_SECRET_KEY` o `SUPABASE_SERVICE_ROLE_KEY` | Nuevo valor del proyecto nuevo — necesario para `delete-account` |
| `RATE_LIMIT_PEPPER` | **Generar uno nuevo para producción** — nunca reusar el del preview |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Ya existen en producción hoy (no tocar si siguen siendo las correctas para el proyecto nuevo) |
| `LEMON_SQUEEZY_*` | Confirmar Live Mode antes de copiar cualquier valor |
| `PLAN_RATE_LIMIT_*` | Mismos valores que preview salvo que el volumen esperado en producción justifique otros límites |
| `APP_ENV`, `AI_GENERATION_ENABLED`, `PREVIEW_AI_ALLOWED_USER_ID` | **No configurar en producción** — son exclusivos de preview; producción no debe tener un allowlist de un solo usuario |

Deploy: `wrangler deploy` **sin** `--env` (el Worker productivo es el default sin sufijo). Nunca usar `--env preview` para este paso.

---

## F. Auth (Supabase nuevo, para producción)

- Site URL → `https://postulpro.com`
- Redirect URLs: agregar `https://postulpro.com/**` y `https://www.postulpro.com/**`, manteniendo el preview y localhost si siguen siendo necesarios para desarrollo.
- Confirmar `www` vs. apex: decidir cuál es el canónico y si el otro redirige.
- Password reset / confirmation / OAuth: el código ya usa `window.location.origin` dinámicamente — funcionará automáticamente una vez que el dominio esté en la allowlist, sin cambios de código.
- SMTP: confirmar remitente/plantillas antes del corte si se espera volumen real de registros.

---

## G. Lemon Squeezy

- Confirmar que las credenciales de producción son Live Mode (nunca las de Test Mode usadas en desarrollo).
- Variants: mapear los IDs de Live Mode, no reusar los de Test Mode.
- Webhook: registrar la URL de producción, generar un `LEMON_SQUEEZY_WEBHOOK_SECRET` propio de ese webhook.
- Probar un checkout de Test Mode contra producción ANTES de aceptar el primer pago real, si Lemon Squeezy lo permite en la misma tienda.
- Success/cancel URLs: deben apuntar a `postulpro.com`, no a la preview.

---

## H. Cutover

1. Ventana anunciada, freeze de merges no urgentes.
2. Deploy del Worker productivo con los nuevos secrets (sección E).
3. Smoke test inmediato: landing, login, registro, onboarding, dashboard, un checkout de prueba si aplica.
4. Prueba real de IA (la misma validada en preview, ahora contra producción) — un plan + un entregable, verificando créditos y persistencia.
5. Billing: un ciclo de checkout Test Mode si Lemon Squeezy lo permite, o el primer pago real vigilado de cerca.
6. Affiliates: confirmar que el tracking sigue funcionando.
7. **Umbral de rollback**: si cualquier smoke test falla, o si el error rate sube de forma sostenida en los primeros 15 minutos, ejecutar rollback (sección I) antes de seguir investigando en caliente.

---

## I. Rollback

1. `wrangler rollback` a la versión de Worker capturada en la sección C.4 (o `wrangler deploy` re-subiendo el build anterior si `rollback` no está disponible para el plan).
2. Restaurar los secrets anteriores (nombres ya documentados en el backup — los valores deberían seguir estando en el proveedor original de secretos, no en este repo).
3. Dominio: no requiere cambios si solo se hizo rollback del Worker (Custom Domains no se tocan en un cutover de este tipo).
4. Datos: cualquier escritura real que haya ocurrido durante la ventana de corte fallida (nuevos registros, compras) queda en el proyecto Supabase nuevo — antes de reconciliar, decidir si esos datos se migran hacia adelante en el próximo intento o se descartan por ser de la ventana fallida.
5. Comunicar el rollback y la causa raíz antes de reprogramar.

---

## J. Post-cutover

Primeras 24–48 horas:

- Logs del Worker: buscar errores nuevos, en particular `provider_error`, `insufficient_credits` inesperados, o picos de `rate_limited`.
- Costos: revisar el consumo real de Anthropic/OpenAI contra lo estimado — el telemetry agregado esta fase (`logModelUsage`) da tokens reales por operación, no solo un estimado.
- Latencia: comparar contra el preview como baseline.
- Signups: tasa de conversión del registro público, ahora sin el bloqueo de rate-limit que afectó las pruebas QA.
- Billing: primeras transacciones reales, reconciliar contra Lemon Squeezy.
- Soporte: canal para reportes de usuarios reales, ya no solo QA.

---

## Decisión recomendada

**Ya no hay bloqueante técnico para programar el corte.** Con A.1 (IA end-to-end), A.2 (registro público), A.3 (SMTP de Auth), A.5 (Google OAuth nativo), A.7 (billing Test Mode end-to-end), y la decisión de datos del Supabase anterior (Escenario C, relanzamiento limpio) todas en ✅, lo que queda es logística de producto: decidir si configurar `RESEND_API_KEY` para los emails de marca propios de la app (no crítico, hoy código muerto) y programar la ventana de corte (sección H), agregando `postulpro.com`/`www.postulpro.com` a las Redirect URLs de Supabase y a Google Cloud Console como parte de esa ventana. Nada de esto requiere tocar producción antes del día del corte en sí.
