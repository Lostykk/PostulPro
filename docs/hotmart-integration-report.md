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
