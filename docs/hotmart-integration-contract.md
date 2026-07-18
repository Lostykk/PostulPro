# Contrato de integración Hotmart (Fase 5 — diseño, sin conectar)

Estado: **diseñado, no implementado, no conectado**. Este documento no crea ninguna credencial, webhook activo, ni endpoint público nuevo. Es la referencia para implementar Hotmart cuando se decida el cutover de billing, reemplazando a Lemon Squeezy (descartado porque rechazó el modelo anterior de marketplace).

## 1. Por qué Hotmart puede reusar casi toda la arquitectura actual

La arquitectura de billing existente (`src/lib/lemon-squeezy.server.ts`, `src/routes/api/billing/*`, `process_lemon_squeezy_event` RPC, tablas `users`/`subscriptions`/`billing_history`) ya separa "lógica de negocio de suscripciones" de "cliente HTTP del proveedor". Lo reusable tal cual:

- Esquema `users.plan` / `subscriptions.plan` (`free | pro | business`) y `billing_interval` (`month | year`) — Hotmart mapea a los mismos 4 planes reales (Pro Mensual, Pro Anual, Business Mensual, Business Anual), no hace falta un enum nuevo.
- `bonus_credits`, `credits_limit`, reglas de downgrade/refund, comisión de afiliados — provider-agnostic, no tocan Lemon Squeezy directamente.
- Forma de las rutas `/api/billing/checkout` y `/api/billing/portal` — solo cambia el cliente HTTP interno que llaman.
- El patrón de ledger de eventos + RPC transaccional con `INSERT ... EXCEPTION unique_violation` para idempotencia.
- El guard de "evento fuera de orden" (`provider_updated_at`, ver `20260711000000_subscription_recency_guard.sql`) — Hotmart también puede reenviar eventos fuera de orden.

Lo que **no** se reusa: `lemon-squeezy.server.ts` (cliente HTTP específico de LS), la verificación HMAC específica de LS, y el mapeo de variant IDs de LS.

## 2. Mapeo de planes

| Producto PostulPro | `plan` | `billing_interval` | Hotmart product/offer (a completar en cutover) |
|---|---|---|---|
| PostulPro Pro Mensual | `pro` | `month` | *pendiente — ID de oferta Hotmart* |
| PostulPro Pro Anual | `pro` | `year` | *pendiente — ID de oferta Hotmart* |
| PostulPro Business Mensual | `business` | `month` | *pendiente — ID de oferta Hotmart* |
| PostulPro Business Anual | `business` | `year` | *pendiente — ID de oferta Hotmart* |

No se inventan IDs de producto/oferta de Hotmart — quedan explícitamente pendientes hasta tener acceso a la cuenta real de Hotmart. El mapeo se resuelve por variable de entorno (mismo patrón que `LEMON_SQUEEZY_VARIANT_PRO_MONTHLY`, ver §4), nunca hardcodeado.

## 3. Contrato de eventos (a implementar como `process_hotmart_event` RPC + ruta webhook)

Hotmart notifica compras vía webhook (Hotmart lo llama "Notificação de Compra"). **Los nombres exactos de campo/evento de Hotmart no están confirmados en este documento** — Hotmart tiene distintos formatos según el tipo de notificación configurada (histórico vs. nuevo formato). Antes de implementar, alguien con acceso a la cuenta Hotmart debe:
1. Confirmar el formato de payload real (headers de autenticación, nombre de campo del estado de la compra, formato de fecha).
2. Confirmar si Hotmart firma el webhook (HMAC) o usa un token estático en la URL/header — afecta cómo se implementa la verificación (hoy LS usa HMAC sobre el raw body).

Con esa salvedad, el contrato lógico (independiente del payload exacto) es:

| Evento lógico | Acción sobre `users`/`subscriptions` | Equivalente actual en LS |
|---|---|---|
| Compra aprobada | Crear/actualizar `subscriptions` (status `active`), fijar `users.plan` + `credits_limit` según el mapeo de §2, enviar email de confirmación | `subscription_created` / `subscription_updated` |
| Renovación | Igual que compra aprobada, sin re-enviar email de bienvenida | `subscription_payment_success` |
| Cancelación | `subscriptions.status = 'cancelled'`, mantiene acceso hasta fin de período pagado (no downgrade inmediato) | `subscription_cancelled` |
| Reembolso | Revertir créditos otorgados por esa compra o downgrade a `free`, según si es plan recurrente o compra de créditos puntual | `order_refunded` / `subscription_payment_refunded` |
| Chargeback | Downgrade inmediato a `free` (más agresivo que reembolso — riesgo de fraude), marcar `subscriptions.status = 'chargeback'` para que soporte lo vea | Sin equivalente directo hoy — **nuevo estado a agregar al CHECK constraint de `subscriptions.status`** |
| Vencimiento / morosidad | Si Hotmart informa el pago recurrente fallido antes de cancelar, enviar email de aviso (sin downgrade inmediato); si expira sin pago, downgrade a `free` | `subscription_payment_failed` (aviso) + `subscription_expired` (downgrade) |

## 4. Idempotencia y localización de usuario (diseño)

Mismo patrón que Lemon Squeezy, generalizado:

- **Ledger de eventos**: tabla nueva `hotmart_events` (o generalizar `lemon_squeezy_events` a `billing_events` con columna `provider`) con clave única = `sha256(evento + id_transacción_hotmart + timestamp_evento)`. No usar `sha256(raw body)` — ese fue el bug real encontrado en la validación de LS (`docs/lemon-squeezy-test-validation.md`): un "Resend" oficial cambia bytes del body y rompe la dedupe.
- **Localizar/crear usuario**: igual que hoy — el `user_id` interno se pasa como dato custom en la URL de checkout que el usuario ya autenticado genera desde `/api/billing/checkout` (no se confía en ningún email/nombre que venga en el webhook para identificar la cuenta). Si Hotmart no soporta un campo "custom data" propagado al webhook igual que LS, la alternativa es un mapeo `hotmart_transaction_id -> user_id` guardado en el momento del checkout, antes de redirigir al usuario a Hotmart.
- **Prevenir duplicados**: mismo patrón `INSERT ... ON CONFLICT / EXCEPTION unique_violation` dentro de la misma transacción que la mutación de plan, no dos pasos separados.
- **Revocar/degradar acceso de forma segura**: nunca borrar la fila de `subscriptions`, solo cambiar `status`; el downgrade de `users.plan` a `free` es la única acción irreversible-visible, y solo ocurre en cancelación expirada, reembolso o chargeback — nunca en un evento no reconocido (fail-closed: evento desconocido se loguea y no se aplica).

## 5. Nombres de secretos necesarios (solo nombres — sin valores, sin configurar todavía)

- `HOTMART_CLIENT_ID`
- `HOTMART_CLIENT_SECRET`
- `HOTMART_WEBHOOK_TOKEN` (o `HOTMART_HOTTOK`, según el mecanismo real de verificación que Hotmart use — a confirmar, ver §3)
- `HOTMART_OFFER_PRO_MONTHLY`, `HOTMART_OFFER_PRO_ANNUAL`, `HOTMART_OFFER_BUSINESS_MONTHLY`, `HOTMART_OFFER_BUSINESS_ANUAL` (equivalentes a los `LEMON_SQUEEZY_VARIANT_*` actuales)

Ninguno de estos nombres está configurado en preview ni producción por este cambio. Se documentan para que quien tenga acceso a la cuenta Hotmart sepa exactamente qué crear.

## 6. Qué falta para implementar (no incluido en esta fase)

- Confirmar el formato real de payload/autenticación del webhook de Hotmart (§3, punto pendiente crítico).
- Crear `src/lib/hotmart.server.ts` (cliente HTTP, análogo a `lemon-squeezy.server.ts`) — no creado todavía porque implementarlo contra un payload adivinado es el tipo de trabajo que esta fase explícitamente pidió evitar.
- Nueva migración: tabla `hotmart_events` o generalización de `lemon_squeezy_events`, y el valor `chargeback` al CHECK constraint de `subscriptions.status`.
- Nueva RPC `process_hotmart_event`, análoga a `process_lemon_squeezy_event`.
- Nueva ruta `src/routes/api/billing/webhook-hotmart.ts` (mantener la de Lemon Squeezy activa en paralelo durante la ventana de migración dual-provider, no reemplazarla de entrada).
- Actualizar `/api/billing/checkout` para elegir el proveedor (por flag o por plan), sin romper el checkout de Lemon Squeezy mientras siga siendo el proveedor live.
- Retirar copy de Lemon Squeezy de `index.tsx`/`legal.tsx` recién cuando Hotmart esté realmente live (no antes — hoy Lemon Squeezy sigue siendo el proveedor real en preview).

## 7. Código de Lemon Squeezy — qué se puede retirar y cuándo (auditoría de esta fase)

- **Retirar recién cuando Hotmart esté live**: `src/lib/lemon-squeezy.server.ts` (+test), env vars `LEMON_SQUEEZY_*`, copy de UI en `index.tsx:345,998` y `legal.tsx:68,116`.
- **Mantener durante la ventana dual-provider**: columnas `subscriptions.provider`/`provider_subscription_id`, guard de duplicados en checkout, patrón de RPC transaccional, `subscriptions_recency_guard`.
- **Revisar antes de decidir**: `supabase/functions/lemon-squeezy-webhook/index.ts` — Edge Function Deno que duplica la lógica del webhook Worker (`src/routes/api/billing/webhook.ts`) contra la misma DB con service-role key, documentada en su propio header como "mantenida en sync a mano". Parece código paralelo/legacy que puede ya no estar en uso, pero **no se tocó ni se confirmó si sigue invocada** en esta fase — cualquier cambio a webhooks de billing es fuera del alcance permitido aquí (no se debe modificar Lemon Squeezy en producción). Queda como riesgo documentado para la Fase 9 (informe GO/NO-GO).
