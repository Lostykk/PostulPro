# Runbook: promoción del preview a producción (postulpro.com)

Estado: **documentado, no ejecutado**. Este documento no autoriza ni dispara ningún cambio — es la referencia a seguir cuando el equipo decida promover.

Contexto al momento de escribir esto:

- Preview: `lostykk-postulpro-preview` (workers.dev, sin Custom Domain), Supabase `ccpejnklrfvgtwryqfrw`.
- Producción: `lostykk-postulpro` (`postulpro.com` / `www.postulpro.com`), Supabase **distinto** (ref confirmado vía el bundle público de producción, no vía credenciales) — producción **no** usa el proyecto Supabase nuevo todavía.
- La prueba real de IA end-to-end en preview sigue **PENDIENTE** (sin `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` autorizada) — es una precondición dura, no opcional, para el cutover.

---

## A. Precondiciones

Todas deben estar en `✅` antes de programar una ventana de corte.

| # | Precondición | Estado actual |
|---|---|---|
| 1 | Al menos una generación real de IA (plan + un entregable) validada end-to-end en preview, con créditos/idempotencia/refund confirmados | ❌ PENDIENTE — falta API key autorizada |
| 2 | Registro público funcionando sin rate-limit bloqueado | ⚠️ No reintentado esta fase — último estado conocido: bloqueado por rate limit de GoTrue |
| 3 | SMTP de producción configurado (o decisión consciente de seguir con el servicio default de Supabase) | ⚠️ No auditado en el dashboard esta fase (asumido default, sin SMTP custom, basado en el historial de la migración) |
| 4 | Site URL / Redirect URLs listos para `postulpro.com` | ❌ Todavía no agregado — hoy el Site URL del proyecto nuevo apunta al preview |
| 5 | OAuth (Google vía Lovable) con su propio redirect configurado para el dominio final | ⚠️ No auditado — vive fuera de Supabase Auth, en la integración Lovable |
| 6 | Lemon Squeezy: variantes, webhook, secretos confirmados como Live Mode (no Test Mode) | ❌ No confirmado — las credenciales locales no tienen forma de distinguirse como test/live por el nombre |
| 7 | Billing: checkout, webhook, RPC secret probados con Test Mode primero | ⚠️ Ver fase de billing anterior — no reprobado esta sesión |
| 8 | Affiliates: flujo de comisión probado end-to-end | Sin auditar en esta fase |
| 9 | Storage: buckets/políticas confirmados en el proyecto nuevo | ✅ Auditado en una fase anterior (limitación conocida de list/get documentada, no bloqueante) |
| 10 | CSP: Report-Only sin violaciones en el click-through completo | ✅ Confirmado esta fase (9 páginas, 0 violaciones) — todavía Report-Only, no enforcing |
| 11 | Monitoring: alguna forma de ver logs/errores de producción post-corte | Los logs del Worker productivo ya existen (Cloudflare); no se agregó nada nuevo específico para el corte |
| 12 | Backups: snapshot de datos y configuración de producción antes de tocar nada | Pendiente de ejecutar el día del corte (ver sección C) |
| 13 | Rollback: plan probado, no solo escrito | Documentado abajo (sección I), no ensayado en vivo |

**No programar el corte hasta que 1–8 estén en ✅.** 9–13 son necesarias pero menos riesgosas de resolver el mismo día.

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

**No programar el corte todavía.** El gate que bloquea todo lo demás es la precondición A.1 (prueba real de IA end-to-end) — sin eso, ni siquiera se puede validar que el flujo central del producto funciona con proveedores reales. El siguiente paso concreto es obtener una API key de desarrollo autorizada, exclusiva para preview, con límite de gasto controlado (ver informe final, sección Q).
