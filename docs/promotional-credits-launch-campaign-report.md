# Créditos promocionales desde Admin + cupón Hotmart POSTULPRO30

Estado: **en desarrollo, sin aplicar a ningún entorno todavía.** No se hizo merge a `main`, no se aplicó ninguna migración, no se desplegó a preview ni producción, no se configuró nada en el panel de Hotmart, no se otorgó ningún crédito real.

## 1. Precondición — estado verificado antes de empezar

- Rama de partida: `main`, SHA `7b46df52f025e602d082ac48010e33eb5f708a07` (idéntico a `origin/main`, sin divergencia).
- Working tree: limpio salvo el ruido CRLF/LF preexistente y documentado en `src/server.ts`/`src/routeTree.gen.ts` (sin contenido real).
- Producción estable: `postulpro.com` → 200, `GET /api/webhooks/hotmart` → 405, `POST` sin Hottok → 401 (webhook productivo operativo, sin cambios).
- Suite completa: **473/473** antes de tocar código.

## 2. Auditoría del sistema de créditos existente — hallazgo importante

El prompt asume que existe "un sistema de créditos y ledger" ya formado. Esto es **parcialmente cierto** — existe un sistema de créditos maduro, pero **no existe un ledger de otorgamiento** (solo un ledger de *consumo*). El diseño de abajo respeta esto: extiende lo que existe, no inventa un balance paralelo, pero sí necesita una tabla nueva porque no había ninguna para este propósito específico.

Arquitectura real, confirmada leyendo las migraciones (no asumida):

- **`public.users.credits_used` / `credits_limit`** — balance corriente, dos enteros. `credits_limit` no es fijo por plan: se recalcula en cada evento comercial (Hotmart, Lemon Squeezy, resolución admin de pending links) como `plan_base + bonus_credits`.
- **`public.users.bonus_credits`** (migración `20260711010000_preserve_bonus_credits.sql`) — el mecanismo YA EXISTENTE para "créditos extra por encima del plan, que sobreviven cambios de plan/renovación/reembolso". Hoy solo lo alimenta la compra del producto "Credits-100" de Lemon Squeezy (+100 fijo). Es exactamente el patrón que necesita un crédito promocional no recurrente y sin vencimiento — así que **la asignación promocional va a incrementar `bonus_credits`**, reutilizando el mecanismo, no duplicándolo.
- **`public.credit_reservations`** (migración `20260727000000_credit_reservations_idempotent_refund.sql`) — esto SÍ es un ledger, pero de **consumo** (reserve → consumed/refunded) para las generaciones de IA, con lock de fila para idempotencia. No tiene ninguna noción de "otorgamiento" ni de campañas.
- **`public.billing_history`** — log de auditoría de eventos comerciales (`event_type` + `reason` libres), pero su única política RLS es `auth.uid() = user_id` — **un admin no puede leerla de otros usuarios vía cliente**, solo el propio usuario. Sirve para registrar el evento, no para que el panel Admin lo liste directamente.
- **Patrón RPC admin ya establecido** (`admin_update_user_plan`, `admin_resolve_hotmart_pending_link`): `SECURITY DEFINER`, `has_role(auth.uid(),'admin')` como único gate, `FOR UPDATE` + chequeo de estado para idempotencia, nunca un balance negativo, siempre una fila en `billing_history`.
- **Consumo no es por lotes**: `reserve_credits_v2` solo compara `credits_used + costo <= credits_limit` — un pool único, sin atribución de qué "lote" de créditos se gasta primero. Por eso `credits_remaining` por grant (mencionado como opcional en el prompt, "únicamente si el sistema usa lotes") **no se implementa** — documentado como limitación aceptada, no simulada.
- **Costos reales por herramienta** (`src/lib/ai/tools-config.server.ts`): copywriter=1, consultant=2, sales-email=2, landing-copy=2, social-pack=3, email-sequences=3, business-plan=5. No existe generador de video todavía (confirmado — mencionado en el prompt como algo futuro). No hay ningún dato de costo monetario real por proveedor en el código — no se va a inventar una equivalencia en USD.
- **Panel Admin actual** (`src/routes/_authenticated/admin.tsx`, 351 líneas): página única, sin pestañas, con tabla de usuarios + selector de plan (vía `admin_update_user_plan`), gráfico de planes, ranking de afiliados, logs de generaciones. No tiene ninguna herramienta de créditos hoy.

## 3. Decisión de diseño (documentada antes de implementar, no después)

1. **No se crea un balance paralelo.** El otorgamiento incrementa `users.bonus_credits` (y por lo tanto `credits_limit`) usando la fórmula ya establecida, vía una RPC nueva y aislada — **no se toca `process_hotmart_event`, `process_lemon_squeezy_event`, `reserve_credits*`, `refund_credits`, ni el normalizador de Hotmart.**
2. **Sí se crean dos tablas nuevas** (`promotional_credit_campaigns`, `promotional_credit_grants`) porque no existe ninguna estructura para rastrear campañas/otorgamientos con idempotencia, límite de destinatarios, atribución de administrador y reversión — esto no es "una arquitectura paralela de balance", es el ledger de *otorgamiento* que genuinamente falta.
3. **Sin vencimiento por lote**, tal como autoriza el prompt ante esta situación: el sistema no soporta lotes de consumo, así que implementar `expires_at` sería simular un control que no se puede hacer cumplir de verdad. Se documenta como limitación, no se finge.
4. **La entrega es 100% manual desde Admin en esta fase** — ningún webhook de Hotmart otorga créditos automáticamente. `promotional_credit_grants` puede opcionalmente guardar una referencia de transacción Hotmart (texto libre, para trazabilidad humana), nunca dispara nada automático.
5. **Auditoría dual**: cada grant/reversión escribe tanto en `promotional_credit_grants` (fuente de verdad, con RLS admin-only) como en `billing_history` (consistente con el patrón existente, aunque su lectura desde Admin no depende de esa tabla por la limitación de RLS ya mencionada).

## 4. Riesgos identificados (ninguno bloqueante, todos mitigados en el diseño)

- **Concurrencia**: dos admins otorgando al mismo usuario/campaña a la vez → mitigado con `FOR UPDATE` sobre la fila de campaña (serializa el conteo) + `UNIQUE (campaign_id, user_id)` en `promotional_credit_grants` (defensa en profundidad, nunca depende solo del lock).
- **Reversión con crédito ya consumido**: dado que el pool es único (no hay lotes), revertir un grant cuyo crédito ya se gastó bajaría `bonus_credits` sin poder distinguir "qué crédito específico" se usó. Mitigado exactamente como pide el prompt: nunca se descuenta crédito regular sin una confirmación explícita separada, y se le informa al admin cuánto del bono ya fue consumido antes de confirmar.
- **Doble entrega por error humano**: mitigado con el `UNIQUE (campaign_id, user_id)` — la RPC devuelve "ya otorgado" en vez de duplicar, nunca un segundo grant silencioso.

Ninguna inconsistencia crítica bloqueante encontrada. Se procede a implementar.

## 5. Hotmart multimoneda — hallazgo real durante la compra de prueba controlada (2026-07-20)

Tras corregir el mapeo de `offer_id` para el cupón POSTULPRO30 (`yjo2udb9`→pro_monthly, `oa0kfv5m`→business_monthly) y desplegarlo a producción, el fundador realizó la única compra real controlada autorizada: Pro Mensual, cupón POSTULPRO30, cuenta `themisterywhite@gmail.com` (cuenta preexistente en plan `free`).

**Evidencia capturada (sanitizada):**

| Campo | Fila 1 | Fila 2 |
|---|---|---|
| `external_event_id` | `c852155d-...` | `dfb1fe46-...` |
| `event_type` | purchase_approved | purchase_approved |
| `processing_status` | **failed** | **failed** |
| `transaction_id` | `HP2883966668` (misma transacción en ambas) | |
| `subscription_id` | `86WFIQ22` (misma en ambas) | |
| `product_id` / `offer_id` | `8148076` / `yjo2udb9` — **reconocidos correctamente** | igual |
| `last_error` | `unexpected currency: ARS` | `unexpected currency: ARS` |
| `user_id` | `NULL` — nunca vinculado | `NULL` |
| `idempotency_key` | distinta en cada fila (basada en `external_event_id`, ver diseño Fase 8C) | |

**Causa raíz:** Hotmart cobró la compra en ARS (localización automática por IP del comprador), no en USD. El webhook rechazó el evento con un bloqueo duro de moneda (`mapping.expectedCurrency !== event.currency`) — diseñado originalmente para evitar otorgar acceso a un precio nunca aprobado, pero: (a) el precio (`expectedPrice`) **nunca se valida realmente** en el código — solo la moneda; (b) el `offer_id` ya es, por sí solo, la fuente de verdad de qué plan corresponde; (c) Hotmart localiza moneda para la mayoría de compradores no-US, por lo que este bloqueo afectaría a la mayoría de compradores reales de un producto en español orientado a LATAM.

**Confirmado sin efecto comercial:** `users.plan` sigue `free`, `bonus_credits=0`, `credits_limit=60`, 0 filas en `subscriptions` con `provider='hotmart'`, 0 entradas en `billing_history` para este usuario. La compra real ya fue pagada y cobrada por Hotmart; PostulPro nunca la acreditó.

**Decisión del fundador:** eliminar el bloqueo duro por moneda (nunca fue una validación de precio real), mantenerlo como señal de observabilidad, y reprocesar esta compra real a través del pipeline oficial una vez desplegado el fix — ver §6 en adelante para la implementación.
