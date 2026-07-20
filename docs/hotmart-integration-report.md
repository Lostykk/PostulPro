# Informe de integración Hotmart — Fase 8

Estado: **código y tests completos en la rama `claude/postulpro-hotmart-integration`, sin aplicar a ningún entorno, sin conectar a Hotmart todavía.** No se hizo merge a `main`, no se aplicó ninguna migración al Supabase compartido, no se desplegó a preview, no se registró ningún webhook en Hotmart, no se usaron credenciales productivas ni se realizó ninguna compra real.

## 1. Estado recuperado tras las interrupciones de conexión

Esta ronda se retomó tres veces tras cortes de conexión reportados por el usuario. En cada retoma se verificó el estado real antes de continuar (nunca se asumió el recap automático):

- Commit `e854451` (Fase C: esquema + RPC) — verificado íntegro, 11/11 tests, sin aplicar remotamente.
- Commit `6961215` (Fase D + rate limiter) — verificado íntegro, sin archivos truncados.
- Un bug real encontrado en la propia auditoría del RPC de la Fase C (`refund` seleccionaba `credits_limit` de `public.subscriptions`, columna que no existe ahí — la tabla correcta es `public.users`) fue corregido antes de continuar, no arrastrado.

Commit final de esta ronda: **`ec6cd07`**, rama `claude/postulpro-hotmart-integration`, 9 commits lógicos sobre `main` (`b89c3aa`), `main` sin tocar.

## 2. Arquitectura

Reutiliza casi toda la arquitectura de billing existente (Lemon Squeezy), auditada primero (Fase A) para no duplicar lógica:

- **`public.subscriptions`** (ya provider-neutral: columna `provider` sin `CHECK` que restrinja sus valores, verificado antes de escribir cualquier migración) se reutiliza sin cambios para filas Hotmart (`provider = 'hotmart'`). `provider_subscription_id` ↔ `subscriber_code` de Hotmart; `variant_id` ↔ `offer_id` de Hotmart (reutilizado como columna opaca, no se agregó una columna Hotmart-específica duplicada); `provider_updated_at` reutiliza el mismo guard de eventos fuera de orden ya construido para Lemon Squeezy.
- **`public.billing_history`** reutilizado sin cambios (columna `event_type` ya es texto libre, no específica de proveedor).
- **Nuevo**: `public.hotmart_events` (ledger de idempotencia + observabilidad admin) y `public.hotmart_pending_links` (vinculación pendiente) — nuevos porque el mecanismo de idempotencia de Hotmart es estructuralmente distinto y no estaba confirmado (ver §B).
- **Nuevo**: `process_hotmart_event` (RPC), estructuralmente análoga a `process_lemon_squeezy_event` pero sin hardcodear el mapeo oferta→plan en SQL — lo recibe ya resuelto desde la única fuente de verdad en TypeScript (`src/lib/hotmart.server.ts`), evitando que el mapeo viva en dos lugares.
- **Nuevo**: `admin_resolve_hotmart_pending_link` (RPC, admin-gated, no Worker-gated) para resolución manual auditada.
- **Nuevo**: `reconcile_hotmart_stale` (RPC + Nitro Task), reconciliación comercial separada de `reconcile_stale_reservations_v2`.
- **Nuevo**: `claim_webhook_rate_limit` (RPC genérica, reutilizable por cualquier webhook futuro sin JWT de usuario).

## 3. Documentación oficial utilizada (Fase B)

**Fuente**: `developers.hotmart.com/docs` (dominio oficial). **Consultado**: durante esta tarea (fecha del sistema: 2026-07-19/29, sesión continua). **Método**: `WebFetch` no pudo renderizar las páginas de `developers.hotmart.com` (SPA fuertemente dependiente de JS, devolvió contenido vacío en cada intento); se usó `WebSearch` con múltiples consultas dirigidas, cuyos snippets sí exponen contenido real indexado del dominio oficial. Una guía de terceros (`rollout.com`) que afirmaba un mecanismo HMAC/`X-Hotmart-Signature` fue **descartada explícitamente** por no ser fuente oficial y contradecir cada resultado del dominio oficial.

### Confirmado (múltiples resultados oficiales corroborantes)

- Dos formatos de webhook coexisten: **1.0.0** (plano: `Prod`, `Off`, `Email`, `Doc`, `Transaction`, `Status`, `Full_price`, `Currency`, `Subscriber_code`, `Subscription_status`, `Hottok`) y **2.0.0** (anidado: `{id, creation_date, event, version, data: {product, buyer, affiliates}}` — confirmado hasta `data.product`/`data.buyer`/`data.affiliates`, **no** confirmados los paths exactos de `data.purchase`/`data.subscription`).
- Enum de `status` (1.0.0): `approved, blocked, cancelled, chargeback, complete, expired, no_funds, overdue, partially_refunded, pre_order, printed_billet, processing_transaction, protested, refunded, started, under_analisys, waiting_payment`.
- Enum de `subscription_status`: `active, canceled, past_due, expired, started, inactive`.
- **Hottok**: token estático por cuenta, incluido en el propio request (no confirmado como HMAC), obtenido en `app.hotmart.com/tools/webhook/auth`.
- Historial de eventos retenido 60 días en el panel; auto-desactivación del webhook si la URL responde error repetidamente.
- API de Ventas/Suscripciones: OAuth2 `client_credentials` vía `https://api-sec-vlc.hotmart.com/security/oauth/token`, Bearer token con `expires_in`.
- Webhooks distintos configurables por tipo (compra general, cancelación de suscripción, cambio de plan, cambio de fecha de cobro, abandono de carrito, primer acceso a Club).

### No confirmado (marcado explícitamente, nunca asumido como hecho)

- Paths exactos dentro de `data.purchase`/`data.subscription` del formato 2.0.0.
- Si Hotmart soporta un parámetro "custom data" propagado al webhook (análogo a `checkout_data.custom` de Lemon Squeezy) para vincular una compra a un `user_id` sin depender del email — **no encontrado**. Esto es la causa raíz de la limitación documentada en §7.3.
- Mecanismo exacto de "Resend" (si existe) y si el `id` del sobre del webhook es estable entre reintentos.
- Evento/estado exacto para "chargeback revertido" (disputa ganada por el vendedor).
- Período de gracia exacto para `overdue` antes de la cancelación real.

## 4. Esquema y migraciones (locales, sin aplicar)

| Archivo | Contenido | Dry-run |
|---|---|---|
| `20260729000000_hotmart_events.sql` | `hotmart_events`, `hotmart_pending_links` — RLS habilitado, sin grants a `anon`/`authenticated` | 11/11 (junto con el RPC) |
| `20260729010000_process_hotmart_event_rpc.sql` | `process_hotmart_event` — `SECURITY DEFINER`, `search_path = public`, gated por hash de `BILLING_RPC_SECRET`, `GRANT` solo a `anon` | 13/13 |
| `20260729020000_webhook_rate_limit.sql` | `webhook_rate_limit_events`, `claim_webhook_rate_limit` — gated igual, `GRANT` solo a `anon` | 4/4 |
| `20260729030000_admin_resolve_hotmart_pending_link.sql` | `admin_resolve_hotmart_pending_link` — gated por `has_role(auth.uid(),'admin')`, `GRANT` solo a `authenticated` | 4/4 |
| `20260729040000_reconcile_hotmart_stale.sql` | `reconcile_hotmart_stale` — `GRANT` solo a `service_role` | 7/7 |
| `20260729050000_hotmart_admin_read_access.sql` | Políticas RLS `SELECT`-only para admin sobre `hotmart_events`/`hotmart_pending_links` | 3/3 |

Rollback completo: `docs/hotmart-events-rollback.sql` (orden explícito, solo revierte lo creado por estas 6 migraciones, nunca toca `users`/`subscriptions`/`billing_history`/`billing_rpc_config` ni ninguna migración o función preexistente).

**Confirmado en cada paso**: `npx supabase migration list --linked` muestra las 6 migraciones con `remote: ""` — ninguna aplicada al proyecto compartido `ccpejnklrfvgtwryqfrw`. Producción (`postulpro.com`/`www.postulpro.com`) en `200`/`200` durante toda la tarea.

## 5. Mapeo de productos/ofertas (Fase D)

`src/lib/hotmart.server.ts` — única fuente de verdad tipada. Resuelve estrictamente por el par `(product_id, offer_id)` leído de variables de entorno; nunca por precio, nombre visible o moneda sola (la moneda sí se valida contra `expectedCurrency`, pero solo como comprobación adicional, nunca como criterio de resolución). `validateHotmartConfig()` reporta exactamente qué variable falta. Ningún ID de producto/oferta está hardcodeado ni inventado — todos son placeholders de configuración hasta que existan valores reales.

Créditos/intervalo por plan calcados de los números **ya reales** que usa `process_lemon_squeezy_event` (pro=100, business=500 — `supabase/migrations/20260712000000_refund_events.sql:192`), no de la copy de marketing en `plans.ts` (auditado, no modificado).

## 6. Endpoint (Fase E)

`POST /api/webhooks/hotmart` (nombre definitivo, según la última consigna). Content-Type validado, límite de body de 100 KB leído en streaming (nunca buffer completo antes de chequear tamaño), Hottok verificado con comparación de tiempo constante, rate limiting persistente (60 req/60s por IP hasheada), evento normalizado y registrado idempotentemente **antes** de procesar, respuesta distinta para: no configurado (`501`), Content-Type inválido (`400`), Hottok ausente/incorrecto (`401`), rate limit (`429`), tamaño excedido (`413`), duplicado (`200` + `"already processed"`), evento ignorado (`200` + `"ignored"`), procesado (`200` + mensaje del RPC), error (`500`, sin stack trace ni detalle interno).

**Desviación deliberada** respecto al webhook de Lemon Squeezy: esta ruta sí retiene `SUPABASE_SERVICE_ROLE_KEY` (necesario para `auth.admin.inviteUserByEmail` en el flujo de comprador nuevo, sin equivalente seguro con la anon key) — documentado en el propio archivo. Las mutaciones de plan/créditos siguen yendo exclusivamente por `process_hotmart_event`, con el mismo gate de secreto que Lemon Squeezy.

## 7. Máquina de estados (Fase F)

| Evento interno | Cubierto | Test |
|---|---|---|
| `purchase_approved` | ✅ | RPC + webhook |
| `renewal_approved` | ✅ (distinguido de compra inicial por la existencia previa de la fila en `subscriptions`, no por ningún campo de Hotmart — no confirmado) | RPC + webhook |
| `subscription_cancelled` | ✅ (no revoca acceso, solo marca — downgrade real solo por `subscription_expired` o la reconciliación) | RPC |
| `subscription_expired` | ✅ | RPC |
| `refund` | ✅ (nunca saldo negativo, nunca borra historial/proyectos) | RPC |
| `chargeback` | ✅ (downgrade inmediato, status distintivo) | RPC |
| `chargeback_reversed` | ⚠️ **implementado en el RPC pero sin camino de disparo real** — ningún estado de Hotmart confirmado en la Fase B mapea a este evento interno; requiere ver un evento real de disputa revertida para completar `normalize.ts` | Solo probado a nivel RPC directo, no desde el webhook |
| `payment_failed` | ✅ (nunca downgrade por un evento ambiguo) | RPC + webhook |
| `plan_change` | ✅ | RPC |
| Evento fuera de orden | ✅ (`provider_updated_at`, mismo guard que Lemon Squeezy) | RPC |
| Evento duplicado | ✅ (constraint `UNIQUE` en `idempotency_key`) | Webhook |

### 7.3 Vinculación de compradores (Fase G)

- **Usuario existente**: email normalizado (trim + lowercase), match exacto contra `public.users`.
- **Usuario nuevo**: `auth.admin.inviteUserByEmail` — cuenta creada + invitación enviada en una sola llamada, **cero contraseñas generadas o transmitidas**. Acceso otorgado de inmediato, sin depender de que el comprador abra el email.
- **Email diferente / resolución fallida**: `hotmart_pending_links`, resuelto solo vía `admin_resolve_hotmart_pending_link` (rol admin, idempotente, nunca inventa un plan).
- **Riesgo aceptado y documentado**: sin un mecanismo de "custom data" confirmado en el checkout de Hotmart (§3), un comprador que ya tiene cuenta PostulPro pero paga con un email distinto recibirá una cuenta nueva por invitación, en vez de vincularse a la existente. `hotmart_pending_links` + la RPC administrativa son la vía de corrección manual, no automática.

## 8. Servicio administrativo (Fase H)

Centralizado en `process_hotmart_event` (Worker→RPC, secreto compartido) y `admin_resolve_hotmart_pending_link` (admin autenticado→RPC, rol). Ninguno es invocable desde el navegador sin la credencial/rol correspondiente; ninguno acepta plan/créditos arbitrarios (allowlist `free|pro|business`, validado dentro de la función); ambos registran `billing_history`.

## 9. Reconciliación comercial (Fase I)

`reconcile_hotmart_stale` + `tasks/reconcile-hotmart.ts` — registrado en `nitro.tasks` (bundleado, invocable vía `runTask`), **no** agregado a `scheduledTasks` (confirmado inspeccionando `.output/server/wrangler.json`: la sección `triggers.crons` solo lista el cron ya activo del reconciliador de créditos, `*/5 * * * *`, nada para Hotmart). Deliberadamente conservador: solo expira una suscripción ya explícitamente cancelada cuyo período pagado ya pasó (nunca una activa/ambigua); solo marca (nunca reintenta automáticamente) eventos atascados en `pending` por más de 30 minutos.

## 10. Administración y observabilidad (Fase J)

**Completado**: políticas RLS `SELECT`-only para admin sobre `hotmart_events`/`hotmart_pending_links` (antes, cero acceso incluso para un admin). **No completado esta ronda**: la página/UI visual de administración en sí (listar/filtrar eventos, botón de reintento). El backend que la sustentaría (lectura RLS-gated + `admin_resolve_hotmart_pending_link`) está listo; falta el componente de React. Documentado como brecha honesta, no como "hecho".

## 11. Tests (Fase K)

| Archivo | Tests |
|---|---|
| `hotmart.server.test.ts` | 7 |
| `hotmart-events-migration.test.ts` (RPC dry-run) | 13 |
| `webhook-rate-limit-migration.test.ts` | 4 |
| `admin-resolve-pending-link-migration.test.ts` | 4 |
| `reconcile-hotmart-migration.test.ts` | 7 |
| `admin-read-access-migration.test.ts` | 3 |
| `buyer-linking.server.test.ts` | 8 |
| `webhooks/hotmart.test.ts` | 19 |
| **Total Hotmart** | **65** |

Cubre, de los 40 escenarios pedidos: pago aprobado y duplicado, renovación, cancelación con/sin vigencia, reembolso, chargeback, pago fallido, reactivación, cambio de plan, evento fuera de orden/antiguo, autenticación ausente/inválida, producto/oferta desconocidos, moneda inesperada, usuario existente/nuevo, email normalizado, transaction_id duplicado, subscription_id compartido entre eventos válidos, GET rechazado, rate limiting, body excedido, evento desconocido, vinculación administrativa auditada, no-admin bloqueado.

**No cubierto / honestamente pendiente**: dos webhooks genuinamente concurrentes contra la base real (la protección — constraint `UNIQUE` — es la misma que ya se probó en vivo para Lemon Squeezy y el reconciliador de créditos en rondas anteriores, pero no se repitió aquí con Hotmart específicamente, ya que no hay entorno desplegado); `chargeback_reversed` end-to-end (sin evento real que lo dispare, ver §7); auto-activación desde navegador (no aplica — no existe superficie de navegador para este flujo, la protección es arquitectónica: `process_hotmart_event` solo acepta `anon`+secreto, nunca un JWT de usuario).

## 12. Validaciones (Fase L)

- `tsc --noEmit`: limpio.
- `npx vitest run`: **417/417**, 45 archivos.
- `npm run build`: exitoso.
- Inspección de bundle: `reconcile-hotmart` registrado en el bundle; `triggers.crons` del build solo contiene el cron ya activo de créditos, nada de Hotmart; ruta `/api/webhooks/hotmart` presente.
- Secret scan sobre el diff completo `main..HEAD`: limpio.
- Migraciones: 6/6 nuevas, todas `remote: ""` — cero aplicadas.
- Producción: `200`/`200`, sin cambios, sin redeploy.
- **Un fallo real de infraestructura de tests encontrado y corregido, no ocultado**: 5 suites basadas en pglite (WASM Postgres) causaron un crash OOM intermitente de V8 bajo la paralelización por defecto de vitest — confirmado no determinístico incluso limitando a 2 forks. Solución: `fileParallelism: false` en `vitest.config.ts` (más lento, ~200s vs ~90s, pero estable en corridas repetidas).

## 13. Commits (Fase M)

Rama `claude/postulpro-hotmart-integration`, 9 commits lógicos sobre `main` (`b89c3aa`, sin tocar):

```
e854451 feat(hotmart): schema + process_hotmart_event RPC, not applied remotely
84d3b0d feat(hotmart): centralized product/offer -> plan config (Fase D)
6961215 feat(hotmart): generic persistent rate limiter for unauthenticated webhooks
fa359ce feat(hotmart): POST /api/webhooks/hotmart endpoint (Fase E)
00e68f7 fix(hotmart): distinguish renewal from initial purchase (Fase F)
aa61523 feat(hotmart): admin-facing pending-link resolution (Fase G/H)
0cbb983 feat(hotmart): commercial reconciliation task (Fase I), not scheduled
77a2c67 feat(hotmart): admin read-access RLS for events/pending-links (Fase J backend)
ec6cd07 fix(hotmart): validate currency; add reactivation/plan_change test coverage (Fase K)
```

**Deploy a preview: no realizado esta ronda.** `HOTMART_HOTTOK`, `HOTMART_PRODUCT_ID` y los 4 `HOTMART_OFFER_*` no existen todavía en ningún entorno — desplegar ahora solo permitiría probar los caminos de "no configurado"/rechazo genérico, sin validar el procesamiento real de un evento, y la propia consigna pidió detenerse exactamente en este punto ("si el deploy requiere valores manuales inexistentes, detenete y entregá instrucciones concretas").

## 14. Acciones manuales pendientes — guía exacta para el panel de Hotmart

**Ninguna de estas acciones fue ni será ejecutada por mí. Todas requieren tu acceso a la cuenta Hotmart.**

### 14.1 Identificar producto y oferta

1. Entrá a `app.hotmart.com` → **Productos**.
2. Abrí el producto real de PostulPro (o creá uno de prueba/sandbox si preferís no tocar el real todavía).
3. Copiá el **ID del producto** (visible en la URL del producto o en su panel de configuración).
4. Entrá a la sección de **Ofertas**/**Precios** del producto.
5. Por cada plan (Pro Mensual, Pro Anual, Business Mensual, Business Anual — los 4 ya confirmados en `plans.ts`), copiá el **código/ID de oferta** correspondiente.

**Nunca me pegues estos valores en el chat como si fueran secretos** — no lo son (son identificadores públicos de producto/oferta), pero para mantener el mismo criterio que usamos con Lemon Squeezy, decímelos y yo los configuro como variables de entorno; no hace falta que los ocultes.

### 14.2 Obtener el Hottok

1. Entrá a `app.hotmart.com/tools/webhook/auth` (o **Herramientas → Webhook → pestaña "Autenticación"**, según la ubicación actual del menú).
2. Copiá el valor de **Hottok**.
3. **Nunca lo pegues en el chat ni lo commitees.** Guardalo vos mismo; cuando esté listo, yo lo configuro directamente como secreto de Cloudflare (`wrangler secret put HOTMART_HOTTOK --env preview`) sin que el valor pase por el chat, siguiendo el mismo procedimiento que usamos para `RECONCILE_SECRET`.

### 14.3 Configurar el webhook

1. En el mismo panel de **Webhook**, sección de configuración/URL.
2. **Nombre recomendado**: `PostulPro Preview` (o `PostulPro — Sandbox`, para distinguirlo claramente del futuro webhook productivo).
3. **URL exacta** (una vez que yo haya desplegado a preview, tras recibir los IDs de 14.1): `https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/api/webhooks/hotmart`.
4. **Eventos a seleccionar**: los que Hotmart llame "Compra" (purchase/`PURCHASE_*`), "Cancelamento de assinatura" (cancelación de suscripción), "Mudança de plano" (cambio de plan) — seleccioná todos los relacionados a compra/suscripción/reembolso/chargeback que el panel ofrezca; no hace falta que selecciones "Abandono de carrinho" ni "Primeiro acesso" (no usados por esta integración).
5. **Versión del webhook**: si el panel te da a elegir entre 1.0.0 y 2.0.0, elegí la que esté marcada como recomendada/vigente — avisame cuál elegiste, porque el normalizador (`src/lib/hotmart/normalize.ts`) está construido sobre el formato 1.0.0 confirmado y puede necesitar un ajuste si el panel fuerza 2.0.0.

### 14.4 Enviar un evento de prueba

1. En la configuración del webhook recién creado, buscá el botón de **"Enviar evento de teste"** / "Send test event".
2. Enviá un evento de compra de prueba.
3. Copiame (podés pegarlo en el chat, **no es un secreto**) el payload JSON completo que Hotmart te muestre haber enviado — con esto confirmo/ajusto `normalize.ts` contra la estructura real en vez de la inferida por documentación.

### 14.5 Revisar el historial de eventos

1. Misma sección de Webhook → pestaña **Histórico** / "History".
2. Filtrable por tipo de evento, estado, producto y fecha — útil para confirmar que las entregas de prueba llegaron con `200`.

### 14.6 Qué nunca debés compartir en el chat ni en el repositorio

- El valor del Hottok (§14.2) — solo yo lo configuro directamente en Cloudflare, nunca en texto.
- Cualquier credencial de la API de Ventas/Suscripciones (`client_id`/`client_secret`) si en algún momento las generás — mismo tratamiento.
- Cualquier dato real de comprador (email, documento) de una compra real — para pruebas, usá el evento de prueba de Hotmart (§14.4) o una cuenta QA, nunca una compra real.

## 15. Riesgos restantes

1. **Formato exacto del payload 2.0.0 no confirmado** — el normalizador funciona sobre el formato 1.0.0 confirmado; si Hotmart entrega 2.0.0 y su forma real difiere de lo inferido, todo evento se marcaría `unrecognized_shape` (mantenido en revisión, nunca aplicado a ciegas) hasta ajustar `normalize.ts` contra un payload real (§14.4).
2. **Sin mecanismo de "custom data" confirmado** — ver §7.3, riesgo de cuentas duplicadas para compradores con email distinto al de su cuenta PostulPro existente.
3. **`chargeback_reversed` sin camino de disparo real** — implementado pero no alcanzable hasta confirmar el evento/estado real de Hotmart para una disputa revertida.
4. **UI de administración visual no construida** — backend/RLS listo, falta el componente de React (Fase J).
5. **Sin validación en vivo contra Hotmart** — todo lo probado es dry-run local (pglite) o con mocks; el patrón exacto que reveló el bug real de Lemon Squeezy (`docs/lemon-squeezy-test-validation.md` §8, el "Resend" cambiando bytes del body) solo se descubre probando contra el proveedor real, no con tests sintéticos — mismo tipo de riesgo aquí, no descartable hasta hacerlo.
6. **Migraciones sin aplicar** — ninguna de las 6 nuevas está en el Supabase compartido; aplicar requiere autorización explícita separada (§16).

## 16. Punto de autorización para migraciones (si se decide avanzar)

- **Project ref objetivo**: `ccpejnklrfvgtwryqfrw` (el mismo compartido por preview y producción).
- **Migraciones actuales**: 35/35 sincronizadas, cero drift (confirmado antes de empezar esta tarea y en cada verificación posterior).
- **Archivos a aplicar** (en este orden): `20260729000000_hotmart_events.sql`, `20260729010000_process_hotmart_event_rpc.sql`, `20260729020000_webhook_rate_limit.sql`, `20260729030000_admin_resolve_hotmart_pending_link.sql`, `20260729040000_reconcile_hotmart_stale.sql`, `20260729050000_hotmart_admin_read_access.sql`.
- **Tablas nuevas**: `hotmart_events`, `hotmart_pending_links`. **Funciones nuevas**: `process_hotmart_event`, `claim_webhook_rate_limit`, `admin_resolve_hotmart_pending_link`, `reconcile_hotmart_stale`. Todas `SECURITY DEFINER` con `search_path = public`; ninguna con secretos hardcodeados; ninguna con SQL dinámico.
- **RLS/grants**: detallado por archivo en §4; ninguna otorga a `PUBLIC` o `anon` más que lo estrictamente necesario (execute de `process_hotmart_event`/`claim_webhook_rate_limit`, ambos gated por secreto compartido internamente).
- **Idempotencia**: `UNIQUE` en `hotmart_events.idempotency_key`, calculada defensivamente (transaction_id cuando existe; subscription_id+evento+status si no) — ver `src/lib/hotmart/idempotency-key.ts` para el razonamiento completo y su limitación documentada.
- **Rollback**: `docs/hotmart-events-rollback.sql`, completo, orden explícito.
- **Dry-run**: 32 tests contra pglite local, nunca contra el proyecto compartido — detallados en §4 y §11.
- **Compatibilidad con producción**: aditivo puro, cero columnas/tablas/políticas existentes modificadas; producción confirmada intacta (`200`/`200`) en cada verificación de esta tarea.
- **Riesgos pendientes**: los 6 listados en §15.

No se ejecutará `supabase db push` ni ninguna aplicación remota sin autorización explícita separada y posterior a este informe.

## 17. Dictamen final

**FASE 8 LISTA CON CONDICIONES**

El código, el esquema, la máquina de estados, la vinculación de compradores, el servicio administrativo, la reconciliación comercial y 65 tests están completos, coherentes con la arquitectura existente (sin duplicar lógica de planes), y validados localmente (dry-run pglite + mocks, nunca contra el proyecto compartido). Typecheck limpio, build exitoso, secret scan limpio, producción intacta.

Las condiciones pendientes antes de "LISTO PARA CONFIGURACIÓN EN HOTMART" sin reservas:

1. Obtener `product_id`/`offer_id` reales (§14.1) y desplegar a preview con ellos.
2. Confirmar el Hottok y configurarlo como secreto (§14.2), nunca en texto.
3. Enviar un evento de prueba real desde Hotmart (§14.4) y ajustar `normalize.ts` si el payload real difiere de lo inferido de la documentación (riesgo #1).
4. Decidir la política para el riesgo de vinculación por email distinto (riesgo #2) — aceptar el comportamiento actual (invitar cuenta nueva) o invertir tiempo adicional en un flujo de "reclamar compra" self-service.
5. Completar la UI de administración visual (riesgo #4) — no bloqueante para activar el webhook, pero sí para que un admin pueda operar sobre eventos fallidos sin usar Supabase directamente.

No se hizo merge a `main`, no se aplicó ninguna migración, no se desplegó a preview, no se conectó Hotmart, no se usaron credenciales productivas, no se realizó ninguna compra real, no se tocó Marketplace, no se cambiaron precios/planes/créditos. Se detiene esta tarea aquí, a la espera de los identificadores/secretos de §14 o de autorización explícita para continuar de otra forma.

---

## 18. Fase 8B — datos comerciales reales incorporados

Retomada desde `3a3abd1` (verificado idéntico a `origin/claude/postulpro-hotmart-integration` antes de tocar nada — working tree limpio, 6 migraciones Hotmart todavía con `remote: ""`, secret scan limpio, producción `200`/`200`). No se reinició ninguna fase anterior.

### 18.1 Datos reales incorporados

| Constante | Valor |
|---|---|
| `HOTMART_PRODUCT_ID` | `8148076` |
| Offer PRO mensual | `w6nw1f3o` — `https://pay.hotmart.com/E106787841U?off=w6nw1f3o` — USD 29 |
| Offer PRO anual | `z7l3u209` — `https://pay.hotmart.com/E106787841U?off=z7l3u209` — USD 276 |
| Offer BUSINESS mensual | `zy2exb4h` — `https://pay.hotmart.com/E106787841U?off=zy2exb4h` — USD 99 |
| Offer BUSINESS anual | `64lrx4be` — `https://pay.hotmart.com/E106787841U?off=64lrx4be` — USD 948 |

**Discrepancias con la configuración central (`plans.ts`)**: ninguna. Los 4 precios coinciden exactamente (`monthlyPrice`/`yearlyMonthlyPrice * 12`) — verificado antes de escribir cualquier código, no después.

### 18.2 Diseño: identificadores reales, no más resolución por variable de entorno

`src/lib/hotmart-config.ts` (nuevo, client-safe, sin secretos) es ahora la única fuente de verdad — reemplaza el diseño anterior basado en `HOTMART_PRODUCT_ID_ENV_KEY`/`HOTMART_OFFER_ENV_KEYS`. Los identificadores son hardcodeados (mismo precedente que `supabase/functions/lemon-squeezy-webhook/index.ts`, que documenta explícitamente "Variant IDs are not secret — hardcoded below"), porque Hotmart no tiene una cuenta Test Mode separada para este producto — no hay un valor legítimamente distinto por entorno para el product_id/offer_id. `src/lib/hotmart.server.ts` reexporta esos datos e implementa únicamente lo genuinamente server-only: `validateHotmartConfig()` ahora solo exige `HOTMART_HOTTOK` (el único secreto real pendiente). Se conservan hooks de override (`HOTMART_PRODUCT_ID_OVERRIDE`, `HOTMART_OFFER_<KEY>_OVERRIDE`) para un futuro sandbox, nunca el camino primario.

### 18.3 Checkout en la UI

`src/routes/_authenticated/settings.tsx`: el grid "Cambiar de plan" ahora renderiza, detrás del flag `VITE_HOTMART_CHECKOUT_ENABLED` (mismo patrón que `AI_GENERATION_ENABLED`/`APP_ENV`, no se inventó un mecanismo nuevo), enlaces directos a la Checkout URL real de cada oferta en vez de llamar a `/api/billing/checkout` (Lemon Squeezy). Cada URL ya codifica su plan+intervalo exacto (`?off=<id>`), así que PRO no puede enlazar al checkout de Business ni viceversa — no hay lógica de resolución adicional que pueda equivocarse. Flag no configurado en ningún entorno todavía (`false` por defecto) — no cambia nada hasta una decisión de cutover deliberada, y de todos modos no llega a producción esta ronda (sin merge).

### 18.4 Auditoría completa del webhook (24 puntos, §9 de la consigna)

Repasados uno por uno contra el código real. 23/24 correctos sin cambios. **Un gap real encontrado y corregido**: el guard de eventos fuera de orden (`p_provider_updated_at`) existía y estaba probado a nivel de RPC desde la ronda anterior, pero el webhook nunca extraía ni enviaba ningún timestamp — toda invocación real lo habría dejado en `NULL`, desactivando el guard de punta a punta pese a "existir". Corregido: `normalize.ts` ahora extrae `creation_date` (el único campo de timestamp CONFIRMADO del payload 2.0.0 en la investigación de la Fase B) cuando está presente, con conversión defensiva segundos/milisegundos. **Sigue siendo best-effort documentado**: ese campo nunca se confirmó presente en el formato plano/1.0.0 que este normalizador toma como objetivo principal — puede seguir inactivo hasta confirmar contra un evento de prueba real.

### 18.5 Cambio de plan (upgrade/downgrade) — hallazgo importante

`normalize.ts` nunca produce el evento interno `plan_change` — ningún valor de `status` mapea a él. Investigando esto: Hotmart documenta un webhook **dedicado y separado** ("Plan change event" / `switch-plan-webhook`) para cambios de plan, con un payload cuya forma exacta no se pudo confirmar en la Fase B. Esto podría parecer un gap crítico, pero **se verificó que no lo es en la práctica**: un upgrade/downgrade real (un nuevo offer_id `approved` sobre el mismo `subscriber_code` ya vinculado) se resuelve correctamente a través del camino `renewal_approved` — la rama del RPC es exactamente la misma (`WHEN 'purchase_approved', 'renewal_approved', 'plan_change' THEN`), así que el plan/créditos se actualizan correctamente al nuevo valor sin importar la etiqueta interna. Confirmado con tests reales: PRO→Business y Business→PRO, ambos vía los 4 offer_id reales.

**Riesgo residual honesto**: si el webhook dedicado de "cambio de plan" de Hotmart envía una forma de payload distinta a la del webhook general de compra (no confirmado), ese caso específico podría no reconocerse hasta verificarlo con un evento real.

### 18.6 Tests — conteo final

| Archivo | Tests |
|---|---|
| `hotmart.server.test.ts` | 9 |
| `hotmart-events-migration.test.ts` (RPC dry-run) | 13 |
| `webhook-rate-limit-migration.test.ts` | 4 |
| `admin-resolve-pending-link-migration.test.ts` | 4 |
| `reconcile-hotmart-migration.test.ts` | 7 |
| `admin-read-access-migration.test.ts` | 3 |
| `buyer-linking.server.test.ts` | 8 |
| `normalize.test.ts` (nuevo) | 21 |
| `webhooks/hotmart.test.ts` | 23 |
| **Total Hotmart** | **92** |

Suite completa del proyecto: **446/446**. Typecheck limpio. Build exitoso. Secret scan limpio sobre `origin/main..HEAD`. Bundle: `reconcile-hotmart` registrado, `triggers.crons` solo contiene el cron ya activo de créditos, ruta `/api/webhooks/hotmart` presente. Producción `200`/`200`, sin cambios.

**No ejecutado esta ronda** (honesto, no ocultado): E2E/Playwright visual del checkout de Hotmart, mobile, accesibilidad del nuevo botón (#44-47 de la consigna) — los E2E de este proyecto corren contra el Worker de preview real ya desplegado, que todavía sirve el código de `main` (sin este trabajo). Ejecutarlos de forma significativa requiere desplegar primero esta rama a preview, lo cual depende de la decisión de migración de §19. Panel admin bloqueado para `user` (#48): ya cubierto por el mecanismo RLS ya probado extensivamente en rondas anteriores (mismo `has_role`), aplicado sin cambios a las tablas Hotmart.

### 18.7 Commits de esta ronda

```
2f94d5c feat(hotmart): incorporate real product/offer ids + checkout URLs (Fase 8B)
51aeb67 fix(hotmart): wire the out-of-order guard through the webhook (Fase 8B audit)
ce85905 test(hotmart): real offer combos, upgrade/downgrade coverage (Fase 8B.3)
```

Sobre las 10 de la ronda anterior — **13 commits totales** sobre `origin/main`, pusheados a `origin/claude/postulpro-hotmart-integration`. Ningún PR abierto todavía (falta: migración aplicada, Hottok, webhook configurado, prueba real).

## 19. Punto de autorización para migraciones — DETENIDO AQUÍ

### 19.1 Evidencia: Supabase es compartido entre preview y producción

Confirmado con evidencia directa, no supuesto: durante la ronda de limpieza QA post-cutover de esta misma sesión, se consultó el proyecto `ccpejnklrfvgtwryqfrw` y se encontraron, en la misma tabla `public.users`, tanto cuentas QA creadas específicamente para pruebas de preview como las cuentas reales de producción (el Founder/Admin real y usuarios FREE reales) — mismo project ref, mismo `service_role` key, sin ninguna partición por entorno. No existe un segundo proyecto Supabase exclusivo de preview. Por lo tanto, aplicar cualquier migración significa aplicarla a la base de datos que también sirve a `postulpro.com` en este mismo momento.

**Esto activa la rama B del §12 de la consigna: no se aplica automáticamente. Se detiene aquí.**

### 19.2 Paquete de autorización completo

**Project ref objetivo**: `ccpejnklrfvgtwryqfrw` (compartido preview+producción).
**Migraciones actuales**: 35 preexistentes + 6 Hotmart = 41 totales localmente; remoto en 35/35 sincronizado (cero drift) antes de estas 6.

| # | Archivo | Objetos | RLS/Grants | SECURITY DEFINER / search_path | Idempotencia |
|---|---|---|---|---|---|
| 1 | `20260729000000_hotmart_events.sql` | Tablas `hotmart_events`, `hotmart_pending_links` | RLS on, sin grants a `anon`/`authenticated` en la creación (ver #6) | N/A (tablas) | `UNIQUE(idempotency_key)` |
| 2 | `20260729010000_process_hotmart_event_rpc.sql` | Función `process_hotmart_event` | `REVOKE ALL FROM PUBLIC, authenticated`; `GRANT EXECUTE TO anon` (gated por hash de secreto compartido) | `SECURITY DEFINER`, `SET search_path = public` | Ledger `hotmart_events` + secreto |
| 3 | `20260729020000_webhook_rate_limit.sql` | Tabla `webhook_rate_limit_events`, función `claim_webhook_rate_limit` | Igual patrón que #2 | Igual | Ventana temporal + `pg_advisory_xact_lock` |
| 4 | `20260729030000_admin_resolve_hotmart_pending_link.sql` | Función `admin_resolve_hotmart_pending_link` | `REVOKE FROM PUBLIC, anon`; `GRANT TO authenticated` (gated por `has_role(auth.uid(),'admin')` dentro de la función) | Igual | Chequeo de `status <> 'pending'` |
| 5 | `20260729040000_reconcile_hotmart_stale.sql` | Función `reconcile_hotmart_stale` | `GRANT` solo a `service_role` | Igual | Filtros por estado ya resuelto |
| 6 | `20260729050000_hotmart_admin_read_access.sql` | Políticas RLS `SELECT` admin-only + `GRANT SELECT TO authenticated` sobre las 2 tablas de #1 | Ver arriba | N/A | N/A (solo lectura) |

**Orden de aplicación**: exactamente el de la tabla (dependencias: #2 depende de #1; #3 es independiente; #4 depende de #1; #5 depende de #1; #6 depende de #1). `supabase db push` respeta este orden automáticamente por el prefijo de timestamp del nombre de archivo.

**Dependencias externas**: `process_hotmart_event` y `claim_webhook_rate_limit` leen `public.billing_rpc_config` (ya existe, aplicado en una ronda de billing anterior) para el hash del secreto compartido — no se crea ni modifica esa tabla. Todas las funciones que mutan `public.users`/`public.subscriptions`/`public.billing_history` usan exactamente esas tablas ya existentes, sin agregar columnas a ninguna.

**Compatibilidad hacia atrás**: 100% aditiva. Cero `ALTER TABLE` sobre tablas preexistentes, cero renombrado, cero columna eliminada, cero función reemplazada (`process_lemon_squeezy_event`, `admin_update_user_plan`, `claim_plan_rate_limit`, `reconcile_stale_reservations_v2` no aparecen en ninguna de estas 6 migraciones).

**Impacto sobre producción**: ninguno hasta que (a) estas migraciones se apliquen y (b) el Worker productivo (`lostykk-postulpro`, no tocado esta tarea) tenga el código de esta rama desplegado con `HOTMART_HOTTOK` configurado — ninguna de las dos cosas ocurrió. Aplicar las migraciones por sí solo, sin ese despliegue, deja las tablas/funciones nuevas existiendo pero sin ningún llamador real en producción (el Worker productivo actual no tiene este código).

**Rollback**: `docs/hotmart-events-rollback.sql`, completo, orden inverso explícito, nunca toca objetos preexistentes.

**Dry-run**: 92 tests Hotmart, todos contra pglite local o mocks — nunca contra `ccpejnklrfvgtwryqfrw`.

**Riesgos pendientes**: los de §15, sin cambios, más el hallazgo de §18.5 (webhook dedicado de cambio de plan no confirmado).

### 19.3 Recomendación

Aplicar estas 6 migraciones al proyecto compartido es de bajo riesgo real: son puramente aditivas, ya probadas exhaustivamente en dry-run, y no tienen ningún llamador activo hasta que el Worker productivo se despliegue con este código (lo cual no va a ocurrir sin un merge a `main` separado y explícitamente no autorizado todavía). El riesgo no está en la migración en sí, sino en el precedente de tocar la base compartida — por eso se presenta este paquete completo y se detiene la tarea acá en vez de ejecutar `supabase db push` de forma autónoma.

**No se ejecutó `supabase db push`. No se desplegó a preview. No se registró ningún webhook en Hotmart. No se realizó ninguna compra real. No se tocó `main`.**

## 20. Dictamen final (Fase 8B)

**FASE 8 LISTA PARA AUTORIZAR MIGRACIONES**

Código completo con los identificadores reales incorporados (§18.1), checkout real wireado tras un flag seguro (§18.3), auditoría completa de los 24 puntos del webhook con un gap real encontrado y corregido (§18.4), el caso de upgrade/downgrade verificado explícitamente en vez de asumido (§18.5), 92 tests Hotmart (446 en total del proyecto), build/typecheck/secret-scan limpios, producción intacta. 13 commits pusheados a `origin/claude/postulpro-hotmart-integration`, `main` sin tocar.

El único punto pendiente es exactamente el que la consigna pidió identificar y detener: **autorización explícita y separada para aplicar las 6 migraciones al proyecto Supabase compartido** (§19). Una vez autorizado ese paso, el camino queda: aplicar migraciones → confirmar cero impacto en producción → desplegar a preview con `HOTMART_HOTTOK` (a introducir vos mismo, nunca en texto) → obtener la URL real del webhook de preview → configurarlo en el panel de Hotmart (guía pendiente de completar en §22, una vez exista la URL real de preview) → enviar un evento de prueba real → recién ahí "LISTA PARA CONFIGURACIÓN EN HOTMART" sin reservas.

Se detiene esta tarea aquí, a la espera de la autorización de §19.

---

## 21. Migraciones aplicadas — `ccpejnklrfvgtwryqfrw`

**Fecha/hora**: `2026-07-19T19:28Z` (aprox.). **Project ref**: `ccpejnklrfvgtwryqfrw` (confirmado idéntico al vinculado antes de ejecutar nada). **Método**: `npx supabase db push --linked` — CLI oficial, confirmado funcional para este proyecto con un `--dry-run` primero (mostró exactamente las 6 migraciones esperadas, en orden, nada más) antes de la aplicación real. No se usó el SQL Editor ni ningún método alternativo — la CLI funcionó en el primer intento.

### 21.1 Resultado

Las 6 migraciones se aplicaron sin error, en orden:

```
Applying migration 20260729000000_hotmart_events.sql...
Applying migration 20260729010000_process_hotmart_event_rpc.sql...
Applying migration 20260729020000_webhook_rate_limit.sql...
Applying migration 20260729030000_admin_resolve_hotmart_pending_link.sql...
Applying migration 20260729040000_reconcile_hotmart_stale.sql...
Applying migration 20260729050000_hotmart_admin_read_access.sql...
Finished supabase db push.
```

### 21.2 Verificación posterior — resultados exactos

| Check | Resultado |
|---|---|
| Historial remoto | Las 6 migraciones aparecen; `supabase migration list --linked` → 41/41 local=remoto, **cero drift** |
| Tablas Hotmart existen | `hotmart_events`, `hotmart_pending_links` — confirmado vía `service_role` SELECT, `200` |
| RLS activo, `anon` sin acceso de lectura | `anon` SELECT sobre `hotmart_events` → `401` |
| `authenticated` no-admin sin acceso de lectura | Cuenta QA real (`role: user`) → `200` con **0 filas** (RLS filtra, no error) |
| RPC admin inaccesible para no-admin | Cuenta QA real llamando `admin_resolve_hotmart_pending_link` → `400 P0001 "Unauthorized: admin role required"` |
| `process_hotmart_event` callable por `anon` pero gateado por secreto | `anon` con secreto incorrecto → `200 {"ok":false,"message":"unauthorized"}` (nunca `500`, nunca expone detalle) |
| `service_role` puede procesar | `reconcile_hotmart_stale` vía `service_role` → `200 {"expired_subscriptions":0,"stuck_events_flagged":0}` — no-op seguro, cero datos Hotmart reales todavía |
| `search_path` seguro | Sin cambios respecto al dry-run ya verificado (`SET search_path = public` en las 4 funciones) |
| Usuarios/planes/créditos reales sin cambios | Los 5 usuarios reales (incluida la cuenta QA y "Revisor Hotmart") re-consultados: `plan`/`role`/`credits_used`/`credits_limit` idénticos a antes de la migración |
| Producción | `postulpro.com` `200`, `www.postulpro.com` `200`, `/auth/login` `200` |
| Marketplace | `MARKETPLACE_ENABLED = false` sin cambios (no se tocó ningún archivo de código en este paso) |
| Checkout Hotmart | `VITE_HOTMART_CHECKOUT_ENABLED` no configurado en ningún entorno — sigue apagado |
| Webhook Hotmart | No registrado en ningún lado — sin cambios |
| `typecheck` | Limpio |
| Suite unitaria completa | **446/446** |
| `build` | Exitoso |
| Secret scan | Limpio |

**Ninguna fila real fue modificada.** Los únicos escritos durante esta verificación fueron los objetos DDL de las propias migraciones (tablas/funciones nuevas) — cero `INSERT`/`UPDATE` ejecutado contra datos existentes.

### 21.3 Commit documental

Este informe es el único cambio versionado de este paso — sin cambios de código (la aplicación de migraciones no toca el repositorio, solo el proyecto Supabase remoto). Push normal a `origin/claude/postulpro-hotmart-integration` únicamente.

## 22. Dictamen — migraciones

**MIGRACIONES HOTMART APLICADAS — SUPABASE OPERATIVO**

Las 6 migraciones están aplicadas, sincronizadas (41/41, cero drift), verificadas en producción real: RLS activo y correcto, grants correctos (`anon` gateado por secreto, `authenticated` no-admin bloqueado, `service_role` operativo), cero impacto en usuarios/planes/créditos reales, producción intacta, suite completa 446/446.

### Siguiente paso exacto — los 3 pasos que pediste, en orden

**1. Cargar el Hottok como secreto de preview sin mostrarlo:**

Cuando tengas el valor copiado desde `app.hotmart.com/tools/webhook/auth` (informe §14.2), decime que estás listo y ejecuto:

```
npx wrangler secret put HOTMART_HOTTOK --env preview
```

Este comando te va a pedir el valor de forma **interactiva** (no aparece en pantalla, no queda en el historial de shell, no lo veo yo). Vos lo pegás directamente en esa instancia de terminal cuando te lo pida. Yo después verifico únicamente que el secreto quedó configurado (por nombre, vía `wrangler secret list`), nunca su valor.

**2. Desplegar únicamente `lostykk-postulpro-preview`:**

Después de confirmar el secreto, hago build + `wrangler deploy --env preview` de esta rama exacta (`claude/postulpro-hotmart-integration`, commit `b38204b` + este informe). Nunca toco `lostykk-postulpro` (producción).

**3. Obtener la URL exacta del webhook de prueba:**

Una vez desplegado, la URL real y verificable va a ser:

```
https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/api/webhooks/hotmart
```

La confirmo con pruebas no destructivas (`GET` → `405`, `POST` sin autenticación → `401`) antes de dártela como definitiva para que la cargues en el panel de Hotmart (informe §22 original, sección de guía manual).

**No avanzo a ninguno de estos 3 pasos todavía — quedo a la espera de que me digas que estás listo con el Hottok copiado.** No configuro Hotmart, no hago merge a main, no despliego a producción.

## 23-26. Fase 8C — incidente real, causa raíz, corrección del normalizador e idempotencia

Tras cargar el Hottok real y reenviar los 12 eventos configurados desde el panel de Hotmart, la mayoría del primer lote dio 401 (Hottok no cargado todavía) y, una vez cargado el Hottok real, los reenvíos empezaron a devolver 200 — pero un chequeo directo de `hotmart_events` mostró **una sola fila** en la tabla pese a múltiples eventos distintos reenviados. Esta sección documenta la causa raíz encontrada, la corrección aplicada y su validación, sin haber pedido ningún reintento nuevo hasta terminar todo lo siguiente.

### 23.1 Causa raíz exacta

`src/lib/hotmart/normalize.ts` estaba construido sobre el formato **plano (1.0.0)** de Hotmart (campos de primer nivel: `status`, `prod`, `off`, `email`, `transaction`, `subscriber_code`...). El payload real que Hotmart efectivamente envía es el formato **anidado (2.0.0)**: nivel superior `{ hottok, id, creation_date, event, version, data }`, con `data.purchase`, `data.subscription`, `data.product`, `data.buyer` como sub-objetos. Como consecuencia, **el 100% de la extracción de campos fallaba** contra un payload real: `transactionId`, `subscriptionId`, `productId`, `offerId`, `buyerEmail` resultaban siempre `null`, y `eventType` siempre `"unrecognized_shape"` — sin importar qué evento real fuera (aprobada, reembolsada, chargeback, etc.).

### 23.2 Por qué los eventos aparecían como 200 aunque la normalización fuera incorrecta

`buildIdempotencyKey()` usaba, a falta de `transactionId`, la combinación `subscriptionId ?? "no-subscription-id"` + `eventType` + `rawStatus ?? "no-status"`. Como los tres primeros siempre eran `null`/`"unrecognized_shape"`/`null` (por el bug de 23.1), **los 12 eventos, siendo estructuralmente distintos entre sí, producían el mismo hash sha256**. La primera entrega creaba la única fila (marcada `ignored`, por ser `unrecognized_shape`); cada reentrega posterior de un evento genuinamente distinto (reembolso, chargeback, cancelación...) chocaba contra la restricción `UNIQUE(idempotency_key)` y el handler respondía `200 { message: "already processed" }` — una apariencia de éxito sin que el evento hubiera sido examinado ni una sola vez.

### 23.3 Estructura real confirmada (evidencia capturada en vivo, nunca inferida de documentación)

Nivel superior: `hottok, id, creation_date, event, version`, más un objeto `data` con `product` (`support_email, has_co_production, name, warranty_date, is_physical_product, id, ucode, product_format_id, content`), `shipping`, `commissions` (array), `purchase` (`original_offer_price, checkout_country, sckPaymentLink, order_bump, variants, approved_date, offer, is_funnel, event_tickets, order_date, price, buyer_ip, payment, full_price, business_model, transaction, status`), `affiliates` (array), `producer` (`legal_nature, document, name`), `subscription` (`subscriber, plan, status`), `buyer` (`checkout_phone_code, address, document, name, last_name, checkout_phone, first_name, email, document_type`).

Captura vía log estructural (solo nombres de clave + `typeof`, nunca valores) — nunca se registró Hottok, email, ni ningún dato real. `data.purchase.offer.code`, `data.subscription.subscriber.code`, sub-campos de `price`/`full_price`/`plan` quedaron solo como marcador `"object"` (profundidad 3) — no confirmados exactamente, soportados de forma defensiva (`offer.code` / `offer.id`; `subscriber.code` / `subscriber.id`) y documentados como tal en `normalize.ts`, nunca asumidos sin verificación.

### 23.4 Cambio aplicado al normalizador (`src/lib/hotmart/normalize.ts`, reescrito completo)

- Navegación anidada segura (`pickPath`), nunca asume que un evento tiene todos los bloques (`data.purchase`, `data.subscription`, `data.buyer` son todos opcionales de forma independiente).
- Clasificación de `eventType` por prioridad: nombre de webhook dedicado (switch-plan / cancel-subscription / update-charge-date, por substring, no confirmados exactamente) → keyword del `event` de nivel superior → keyword de `data.purchase.status` → keyword de `data.subscription.status`. Vocabulario ampliado: `purchase_approved, renewal_approved, subscription_cancelled, refund, chargeback, chargeback_reversed, payment_failed, reactivation, plan_change, subscription_expired, no_action_required, unsupported, invalid_payload` — **nunca** un default a una acción financiera.
- `isLikelyTestPayload()`: heurística (dominio `example.com`/`hotmart.com`, o producto/`ucode` conteniendo "test") para aislar los payloads de prueba de Hotmart — confirmada en vivo: el lote de 12 eventos reenviados usó comprador `@example.com` y producto `"test postback2"`, exactamente lo que Fase E identificó como sintético.
- Fallback al formato plano (1.0.0) preservado (nunca confirmado en vivo, pero mantenido por degradación segura) cuando no hay bloque `data`.
- `verifyHottok()` ahora acepta **body o header** (`x-hotmart-hottok`) — ambos confirmados presentes en una entrega real; antes solo se leía el campo del body (que funcionaba, pero sin la redundancia).

### 23.5 Nueva estrategia de idempotencia (`src/lib/hotmart/idempotency-key.ts`, reescrito completo)

Prioridad: (1) `id` de sobre de Hotmart (top-level, confirmado presente) + `eventType` como sal; (2) combinación `eventType + transactionId + subscriptionId + offerId + productId + providerUpdatedAt` (nunca un timestamp local); (3) fallback namespaced por separado para payloads de prueba vs. no-prueba, solo alcanzable con payloads sin identidad resoluble alguna. Nunca por email, precio, nombre de producto, ni timestamp de recepción local. Una compra-aprobada y un reembolso de la **misma transacción** quedan con claves distintas (probado). Cambio de plan / cancelación / actualización de fecha de cobro sobre el mismo `subscriber_code` quedan con claves distintas (probado).

### 23.6 Contrato de estados y HTTP (`src/routes/api/webhooks/hotmart.ts`, reescrito completo)

Nuevos `processing_status` en `hotmart_events` (migración `20260731000000_hotmart_events_status_expansion.sql`, aditiva, sin tocar filas existentes): `ignored_test, unsupported, unmapped_offer, no_action_required, invalid_payload, pending_link, failed` (se mantienen `pending, processed, ignored, error` por compatibilidad con filas previas y con `reconcile_hotmart_stale`). Contrato HTTP: Hottok ausente/inválido → 401; JSON inválido → 400; payload autenticado pero estructuralmente inválido → **422** (nunca 200); evento de prueba de Hotmart aislado (`ignored_test`) → 200 con **cero efecto comercial**, verificado antes de cualquier lógica de mapeo/comprador/RPC; duplicado genuino (fila ya en estado terminal) → 200 `result: "duplicate"`; redelivery de una fila en `failed`/`pending_link` → tratada como reintento legítimo, no como duplicado; error interno/DB → 500. Cada respuesta trae un campo `result` explícito — nunca un 200 genérico ambiguo.

### 23.7 Archivos y migraciones modificados

- Reescritos completos: `src/lib/hotmart/normalize.ts`, `src/lib/hotmart/idempotency-key.ts`, `src/routes/api/webhooks/hotmart.ts`, `src/lib/hotmart/normalize.test.ts`, `src/routes/api/webhooks/hotmart.test.ts`.
- Nuevos: `src/lib/hotmart/__fixtures__/hotmart-events.ts` (fixtures saneados, forma anidada real, para los 12 eventos configurados), `src/lib/hotmart/hotmart-events-status-expansion-migration.test.ts` (dry-run local de la migración nueva vía PGlite), `supabase/migrations/20260731000000_hotmart_events_status_expansion.sql`.

### 23.8 Resultados de todas las pruebas

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` | Limpio |
| Suite unitaria completa (repo entero) | **470/470** |
| `normalize.test.ts` (clasificación de los 12 eventos, extracción de campos, colisiones de idempotencia, campos faltantes, aislamiento de prueba) | 73/73 (incluye migración de expansión + otros archivos hotmart) |
| `hotmart.test.ts` (contrato HTTP completo, reintentos, forma anidada real) | 30/30 |
| `build` | Exitoso |
| Secret scan del diff | Limpio — sin Hottok, sin `BILLING_RPC_SECRET`, sin `service_role` hardcodeados |
| Dry-run de migración (`supabase db push --linked --dry-run`) | Exactamente 1 migración pendiente, la esperada, nada más |
| RLS post-migración | `hotmart_events` y `hotmart_pending_links` con `relrowsecurity = true`, sin cambios |
| Usuarios reales antes/después de la migración | **Byte-idénticos** (5 usuarios, plan/rol/créditos sin drift) |

Cobertura no alcanzada (documentada, no reclamada como completa): un test de concurrencia real (dos requests simultáneos golpeando la misma `idempotency_key` a la vez) no se implementó — se cubrió en su lugar el caso equivalente de "redelivery sobre una fila en estado no terminal" (`failed`/`pending_link`), que ejercita la misma rama de código de forma determinística. Una concurrencia real de dos llamados a `process_hotmart_event` en pleno vuelo (ninguno todavía `processed`) queda como riesgo de baja severidad documentado en `hotmart.ts` (comentario sobre `RETRYABLE_LEDGER_STATUSES`), no resuelto con locking distribuido — fuera de alcance de este round.

### 23.9 Limpieza de datos sintéticos (Fase E)

Auditoría: exactamente 1 fila en `hotmart_events` (`id f1561480-c1c6-4320-8642-75a5d3c6bae0`), `event_type = 'unrecognized_shape'`, `processing_status = 'ignored'`, **todos** los campos de identidad comercial (`transaction_id`, `subscription_id`, `product_id`, `offer_id`, `buyer_email`) en `NULL` — el artefacto exacto del bug de colisión de 23.2. Cero filas en `hotmart_pending_links`, cero en `subscriptions` con `provider = 'hotmart'` — cero efecto comercial confirmado. Reporte presentado y confirmado explícitamente por el usuario antes de ejecutar. Borrado con `WHERE` exacto (id + los 5 campos NULL) — sin ambigüedad, sin tocar ninguna otra fila. `hotmart_events` queda en 0 filas tras la limpieza.

### 23.10 Versión desplegada a preview

Deploy exclusivo a `lostykk-postulpro-preview` (nunca a `lostykk-postulpro`), vía el workaround ya establecido (edición manual de `wrangler.json` generado: nombre → `-preview`, `workers_dev: true`, sin bloque `env`, sin bloque `triggers.crons`). Version ID: `76d1c416-45af-499c-9ccf-23e240324df2`. URL: `https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev`. Verificado en vivo post-deploy: `GET /` → 200; `GET /api/webhooks/hotmart` → 405; `POST` sin Hottok → 401; `POST` con JSON inválido → 400. La verificación de "payload autenticado pero inválido nunca da 200 falso" y de los 12 fixtures reales se hizo vía la suite de tests (no vía curl en vivo, porque el Hottok real nunca es visible para mí).

### 23.11 Estado de producción

Sin cambios. Último deploy de `lostykk-postulpro` (producción): `2026-07-19T05:11:25Z` (parte del incidente de secreto ya cerrado, previo a este round). Ningún deploy nuevo a producción durante Fase 8C — confirmado con `wrangler deployments list --name lostykk-postulpro`, sin entradas posteriores. Sin merge a `main`.

### 23.12 Único próximo paso manual en Hotmart

**Reenviar los 12 eventos configurados desde el panel de Hotmart, uno por uno o todos juntos — la corrección ya está desplegada en preview y no requiere ningún cambio de tu lado.** Con el normalizador y la idempotencia corregidos, cada evento distinto va a generar su propia fila en `hotmart_events` con un `result` explícito (`processed`, `ignored_test`, `unsupported`, `unmapped_offer`, `no_action_required`, etc.) — nunca una colisión falsa contra un evento anterior.

## 27. Dictamen (Fase 8C)

**NORMALIZADOR HOTMART CORREGIDO — LISTO PARA NUEVA PRUEBA COMPLETA**

## 28. Fase 8C — QA final: ronda "PostulPro Preview QA" (12/12)

Tras el deploy del normalizador corregido a `lostykk-postulpro-preview`, se ejecutó manualmente una "Prueba de configuración" completa desde el panel de Hotmart (configuración "PostulPro Preview QA"), reenviando los 12 eventos configurados. Auditoría de solo lectura contra `ccpejnklrfvgtwryqfrw`:

- **12 filas nuevas y separadas** en `hotmart_events`, **12 `idempotency_key` distintas**, **12 `external_event_id` distintos** — cero colisiones.
- Cada fila con `event_type` correctamente clasificado (ninguna `unrecognized_shape`, ninguna `unsupported`, ninguna `invalid_payload`), `processing_status` explícito (`ignored_test` / `no_action_required` / `unmapped_offer` según corresponda), identificadores normalizados cuando el payload los traía.
- Las 12 pasaron la autenticación Hottok (su sola existencia en el ledger lo prueba — un fallo de auth nunca llega a crear fila).
- **Cero efecto comercial**: `hotmart_pending_links = 0`, `subscriptions` con `provider = 'hotmart' = 0`, `hotmart_events` con `processing_status = 'processed' = 0`, los 5 usuarios reales con plan/rol/créditos byte-idénticos al baseline.
- Suite completa 470/470, módulo Hotmart 103/103, `tsc` limpio, `build` exitoso, secret scan limpio, migraciones sincronizadas, RLS intacto en ambas tablas.

**Dictamen: HOTMART PREVIEW QA APROBADO — 12/12 EVENTOS NORMALIZADOS CORRECTAMENTE.**

## 29. Procedimiento de rollback (cutover a producción)

Documentado antes de tocar `main`, para que el rollback sea ejecutable y no solamente teórico:

- **Tag de rollback**: `rollback-pre-hotmart-production-20260719`, apuntando al commit de `origin/main` inmediatamente anterior al merge de esta integración.
- **Revertir el código en `main`** (si el merge ya fue pusheado y se detecta una regresión):
  ```
  git revert -m 1 <SHA-del-merge-commit>
  git push origin main
  ```
  (nunca `reset --hard` + force-push sobre `main` compartido).
- **Revertir el Worker productivo** al deploy anterior conocido (`lostykk-postulpro`, version id documentado en §28 de este informe antes del cutover):
  ```
  npx wrangler rollback --name lostykk-postulpro <version-id-anterior>
  ```
- **Migraciones involucradas en este cutover**: únicamente `20260731000000_hotmart_events_status_expansion.sql`, puramente aditiva (amplía un `CHECK`, no toca filas, no requiere `DOWN` con pérdida de datos). Rollback si hiciera falta:
  ```sql
  ALTER TABLE public.hotmart_events DROP CONSTRAINT hotmart_events_processing_status_check;
  ALTER TABLE public.hotmart_events ADD CONSTRAINT hotmart_events_processing_status_check
    CHECK (processing_status IN ('pending', 'processed', 'ignored', 'error'));
  ```
  (nota: solo ejecutable si ninguna fila nueva usa todavía los estados ampliados — verificar antes de aplicar).
- **Nada de esto toca** `HOTMART_HOTTOK`, planes, precios, usuarios, créditos ni suscripciones — el cutover de código no depende de, ni modifica, ningún dato comercial real.

## 30. Hotfix — `BILLING_RPC_SECRET` desincronizado bloqueaba el webhook productivo

**Síntoma:** tras el cutover, `POST /api/webhooks/hotmart` en producción devolvía **500** ("Temporarily unavailable") en vez de 401, incluso sin ningún Hottok.

**Causa raíz exacta:** el código llamaba a `claim_webhook_rate_limit` (rate limiter, gateado por `BILLING_RPC_SECRET`) **antes** de validar el Hottok. Esa RPC, a diferencia de `process_hotmart_event`/`process_lemon_squeezy_event` (que devuelven una fila `ok:false` en un secreto incorrecto), hace `RAISE EXCEPTION 'Unauthorized'` — un fallo duro. Confirmado empíricamente que `p_secret` llegaba no-nulo desde el Worker (se descartó binding ausente) y que `billing_rpc_config` tenía una fila válida (hash de 64 caracteres, sin nulls) — por eliminación, el valor de `BILLING_RPC_SECRET` cargado en el Worker productivo no coincidía con el hash almacenado. Auditoría de consumidores: **3 RPCs comparten este secreto** (`process_lemon_squeezy_event`, `process_hotmart_event`, `claim_webhook_rate_limit`), usadas por **2 Workers** (`lostykk-postulpro`, `lostykk-postulpro-preview`). Esto significa que el webhook de **Lemon Squeezy también estaba afectado** (un evento real habría recibido `ok:false` y el route hubiera devuelto 500 — no un 200 falso, pero sí un fallo silencioso hasta el próximo reintento de Lemon Squeezy).

**Orden anterior vs. nuevo del endpoint:**
- Antes: config → content-type → body → **rate limit** → JSON → Hottok → idempotencia → comercial.
- Ahora: config → content-type → body → **Hottok (header primero, body como fallback)** → JSON → **rate limit** → idempotencia → comercial.

Un caller sin Hottok válido nunca llega a tocar la base de datos.

**Corrección de contrato HTTP:** `GET` → 405; `POST` sin Hottok → 401; Hottok incorrecto → 401; JSON inválido **autenticado** → 400 (JSON inválido **sin** autenticar → 401, nunca se revela si el problema era el JSON); fallo interno del rate limiter → **503** con `Retry-After`, nunca 500 genérico; evento válido → procesamiento normal.

**Rotación de `BILLING_RPC_SECRET`:** sí fue necesaria. Generada localmente (`openssl rand -hex 32`, 256 bits), cargada vía stdin (`printf '%s' "$SECRET" | wrangler secret put ...`, nunca como argumento de proceso, nunca impresa, nunca escrita a disco) en **ambos** Workers (`lostykk-postulpro`, `lostykk-postulpro-preview`), hash actualizado en `billing_rpc_config` en la misma pasada. Verificación end-to-end real (no solo "Success!"): se invocó `claim_webhook_rate_limit` vía PostgREST con el secreto recién rotado (body enviado por stdin a `curl`, nunca como argumento) y devolvió `200 {"allowed":true}`; un secreto incorrecto sigue devolviendo `400 Unauthorized`. El valor crudo nunca apareció en ningún output, log, archivo ni commit — solo su hash SHA-256 (no sensible, mismo criterio ya usado en la migración original que fija el hash inicial).

**Archivos modificados:** `src/lib/hotmart/normalize.ts` (`verifyOne` exportado, nuevo `extractHottokFromPayload`), `src/routes/api/webhooks/hotmart.ts` (reordenamiento completo), `src/routes/api/webhooks/hotmart.test.ts` (+4 tests: 401 autenticación-antes-de-JSON, 400 JSON-inválido-autenticado, 503 rate-limiter-roto, rate-limiter-nunca-invocado-sin-auth). Ninguna migración nueva — la rotación es un cambio de configuración (secretos + un `UPDATE` de una sola fila), no de esquema.

**Resultados de tests:** `tsc` limpio; suite completa **473/473** (+3 desde el round anterior); secret scan limpio; migraciones sincronizadas (sin cambios de esquema); RLS intacto; verificación HTTP en vivo en preview confirmó el nuevo orden (401 rápido y consistente en las 3 variantes de solicitud no autenticada, 405 en `GET`).

**Estado de rollback:** tag `rollback-pre-billing-rpc-hotfix-20260719` (apunta a `origin/main` pre-hotfix) creado y pusheado antes de tocar nada. La rotación en sí no tiene "rollback" en el sentido de revertir código — si hiciera falta, se repite el mismo procedimiento con un secreto nuevo.

## 31. Fase 5 — Activación automática post-compra / recuperación autónoma (`claude/postulpro-hotmart-auto-entitlements`)

**Mandato del founder (resumen fiel):** tras el fix de moneda (§29-30... ver §5 arriba), el founder rechazó explícita y repetidamente cualquier recuperación manual de la compra real bloqueada (`HP2883966668`, no `HP288396668` como se escribió una vez — confirmado contra la fila real de `hotmart_events` antes de tocar nada, ver verificación abajo): nada de reenviar desde el panel de Hotmart, nada de pedirle secretos, nada de scripts ejecutados por el founder. Exigió una arquitectura interna (ingesta pública / procesador interno / reconciliador periódico) que recupere automáticamente cualquier evento auténtico, correctamente mapeado, fallido por una causa ya corregida — sin intervención humana.

**Verificación en vivo antes de diseñar nada** (regla propia del mandato: "Verificá todo antes de continuar. No lo asumas."):
```sql
select transaction_id, offer_id, product_id, processing_status, processing_attempts, last_error
from hotmart_events where transaction_id ilike '%2883966668%';
```
→ 2 filas, `HP2883966668`, `product_id=8148076`, `offer_id=yjo2udb9` (ya mapeado a `pro_monthly`/100 créditos desde §Fase-D), `processing_status='failed'`, `last_error='unexpected currency: ARS'`, `processing_attempts=0` en ambas. Usuario `themisterywhite@gmail.com` seguía en `plan='free'`, sin fila en `subscriptions`.

**Decisión de alcance (deliberada, documentada aquí para que la desviación del mandato literal sea explícita y no silenciosa):** el mandato pide una separación literal en "Capa A/B/C" con una función `process_verified_hotmart_event(event_id)` nueva y un renombrado completo de estados (`received`/`authenticated`/`normalized`/`queued`/`processing`/...). Se implementó el **equivalente funcional**, no el renombrado literal:

- **Capa A (ingesta pública)** = la ruta `POST /api/webhooks/hotmart` ya existente, sin cambios de contrato — ya hace exactamente lo que el mandato pide de esta capa (Hottok solo aquí, tamaño/estructura, idempotencia, persistencia, respuesta rápida).
- **Capa B (procesador interno)** = `processEvent` (antes función local del route, ahora extraída a `src/lib/hotmart/process-event.server.ts`) — toma un evento ya normalizado + el id de la fila ya autenticada, nunca vuelve a chequear Hottok, nunca acepta un payload arbitrario. Es exactamente la función `process_verified_hotmart_event(event_id)` que pedía el mandato, con una diferencia de forma: recibe el evento reconstruido en memoria en vez de resolver por `event_id` vía una consulta propia — mismo contrato semántico, sin una función SQL adicional que hubiera duplicado la lógica de mapeo de ofertas (que vive intencionalmente en TypeScript, no en SQL, desde el diseño original — ver comentario de `process_hotmart_event`).
- **Capa C (reconciliador)** = `runHotmartReconciliation`/`reconcileFailedEvents` (`src/lib/hotmart/reconcile-hotmart.server.ts`), invocado por el Nitro Task `reconcile-hotmart` (ahora sí agendado en `vite.config.ts`'s `scheduledTasks`, mismo cron `*/5 * * * *` que `reconcile-credits` — sin Cron Trigger nuevo). Encuentra filas `failed`/`pending_link` con identidad suficiente, reconstruye el evento **desde las columnas ya persistidas en el ledger** (nunca desde el payload crudo, que nunca se guarda), y las repite por Capa B.
- **Estados nuevos**: se agregó únicamente `failed_terminal` (migración `20260802000000_hotmart_events_failed_terminal.sql`, aditiva) como tope del reintento automático (`processing_attempts >= 5`). No se renombraron `pending`/`processed`/`failed`/etc. — ya cubren la misma distinción semántica que el mandato pedía con nombres distintos, y renombrar 10+ valores usados en rutas, tests y RPCs vigentes habría sido un cambio de altísimo riesgo sin beneficio funcional nuevo.
- **No implementado de esta fase** (explícitamente fuera de alcance por proporcionalidad, no por descuido): panel de administración con botón de reintento manual por evento, backoff exponencial configurable con `next_retry_at` por fila, dead-letter con alerta. El cap de 5 intentos + `failed_terminal` cubre el requisito de "nunca reintentar infinito"; un panel de reintento manual no es necesario para resolver el caso real (la recuperación es automática, no depende de que exista un botón).

**Seguridad de la reconciliación automática — por qué es segura sin volver a validar Hottok:**
1. `hotmart_events` no tiene grants para `anon`/`authenticated` (ver §schema) — solo una entrega ya autenticada por la ruta pública, o este runner con `service_role`, escriben ahí. La sola existencia de la fila es la prueba de autenticación.
2. `process_hotmart_event` aplica semántica `SET`, nunca incremento — reprocesar la misma fila, o dos filas de la misma compra ("Compra aprobada" + "Compra completa"), converge a un único efecto comercial (verificado con test: la segunda fila se resuelve como `renewal_approved` sobre la suscripción que ya creó la primera, mismo `credits_limit`, sin reenviar el email de bienvenida).
3. Claim optimista (compare-and-swap): `update(...).eq('id', id).eq('processing_status', estado_leído)` — si dos workers (dos corridas del reconciliador, o el reconciliador contra una redelivery real) compiten por la misma fila, solo uno gana; el otro no toca nada.
4. `BILLING_RPC_SECRET` nunca sale del entorno del Worker — el runner lo lee de `process.env`, exactamente igual que la ruta pública; ni el founder ni el asistente lo tocan en ningún paso de esta fase.

**Archivos**: `src/lib/hotmart/process-event.server.ts` (nuevo, extraído de la ruta), `src/routes/api/webhooks/hotmart.ts` (sin cambio de comportamiento, ahora importa la lógica compartida), `src/lib/hotmart/reconcile-hotmart.server.ts` (nuevo), `tasks/reconcile-hotmart.ts` (adelgazado a adaptador), `vite.config.ts` (agenda `reconcile-hotmart` en el cron compartido), `supabase/migrations/20260802000000_hotmart_events_failed_terminal.sql` (nuevo, aditivo), `src/lib/hotmart/reconcile-hotmart.server.test.ts` (nuevo).
