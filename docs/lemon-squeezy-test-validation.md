# Lemon Squeezy Test Mode — validación end-to-end en preview

Estado: **COMPLETO.** Checkout, webhook, firma, idempotencia y reflejo en UI validados con evidencia real contra Lemon Squeezy Test Mode y el Worker preview. Cero actividad Live en ningún momento.

## 1. Test Mode confirmado inequívocamente

- Badge "Test mode" visible junto al nombre de la tienda en cada pantalla de Lemon Squeezy usada.
- Banner explícito "Your application has been received and will be reviewed as soon as possible" — Live Mode ni siquiera está aprobado todavía para esta cuenta, cero riesgo de que un checkout cobre dinero real.
- Página de checkout mostró literalmente "Test mode is currently enabled." en ambas transacciones generadas.
- Texto de autorización del checkout: "By subscribing, you authorize **Lemon Squeezy Test Mode** to charge you according to the terms until you cancel."

## 2. Store, productos y variants

Dos stores existen en la cuenta: `425912` (`postulpro.lemonsqueezy.com`, 0 productos) y `425914` (`postulproapp.lemonsqueezy.com`, los 3 productos reales). El código usa `425914` — confirmado cruzando los product IDs devueltos por la API contra los que aparecen en la UI de Products.

| Producto | Variant | ID | Precio | Interval | Mapeo esperado (código) | Coincide |
|---|---|---|---|---|---|---|
| PostulPro PRO | Monthly | `1879841` | $29.00 | month | `pro_monthly` → plan pro, month | ✅ |
| PostulPro PRO | Annual | `1879894` | $276.00 | year | `pro_annual` → plan pro, year | ✅ |
| PostulPro BUSINESS | Monthly | `1882316` | $99.00 | month | `business_monthly` → plan business, month | ✅ |
| PostulPro BUSINESS | Annual | `1882302` | $948.00 | year | `business_annual` → plan business, year | ✅ |
| PostulPro Credits — 100 | One-time | `1882329` | $9.00 | — | `credits_100` → 100 créditos | ✅ |

Ningún mensual/anual invertido, ningún PRO apuntando a BUSINESS, ninguna moneda distinta de USD, ninguna variant Live mezclada (los 5 IDs fueron leídos vía API con una API key explícitamente Test Mode — solo puede ver datos Test).

## 3. Credenciales configuradas en preview (solo nombres)

`LEMON_SQUEEZY_API_KEY` (nueva, creada exclusivamente para esto — "PostulPro Preview Worker (Fase 5)", Test Mode), `LEMON_SQUEEZY_STORE_ID`, las 5 `LEMON_SQUEEZY_VARIANT_*`, `LEMON_SQUEEZY_WEBHOOK_SECRET` (generado localmente, nunca impreso, transferido a Lemon Squeezy y a Cloudflare vía clipboard del sistema operativo, no vía texto en ningún prompt o commit). Ninguna credencial de producción fue leída, copiada o reutilizada. Confirmado después de cada cambio: producción sigue con sus mismos 14 secrets (nombres), sin `--env` usado nunca fuera de `preview`.

## 4. Webhook Test Mode para preview

Creado apuntando a `https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/api/billing/webhook` (la ruta real del código, no inventada), con los 12 eventos que el handler realmente procesa (`order_created`, `order_refunded`, `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`, `subscription_expired`, `subscription_paused`, `subscription_unpaused`, `subscription_payment_success`, `subscription_payment_failed`, `subscription_payment_refunded`) — ni uno más, ni uno menos. El webhook de producción (`postulpro.com/api/billing/webhook`) permaneció sin tocar durante todo el proceso.

## 5. Checkout Test Mode generado desde la cuenta QA real

Vía `POST /api/billing/checkout` con el bearer token real de la sesión QA (`kind: "subscription"`, `priceKey: "pro_monthly"`). Respuesta 200 con una URL de checkout de `postulproapp.lemonsqueezy.com` (la store correcta). Al abrir la URL: producto "PostulPro PRO", plan Monthly preseleccionado, $29.00, USD, banner de Test Mode visible, `redirect_url` apuntando de vuelta a `/dashboard?checkout=success` (la URL de preview, no la de producción).

## 6. Transacción oficial de prueba completada

Una única transacción, con la tarjeta de prueba estándar `4242 4242 4242 4242` (Test Mode de Lemon Squeezy usa Stripe como procesador subyacente; este es el número de prueba documentado oficialmente, no una tarjeta real). Resultado: "Thanks for your order! Woohoo! Your payment was successful, and your order is complete." — sin cargo real posible, 100% Test Mode. Cero transacciones Live, máximo 1 transacción Test (cumplido).

## 7. Validación del evento real

- **Lemon Squeezy**: 4 eventos entregados a la URL de preview — `order_created`, `subscription_created`, `subscription_updated`, `subscription_payment_success` — cada uno con **Response: 200 / ok**.
- **Worker preview**: cada entrega verificó la firma HMAC correctamente (de lo contrario habría sido 400, no 200) y devolvió `ok` sin filtrar secretos ni PII en la respuesta.
- **Supabase (proyecto nuevo)**:
  - `public.users` para el usuario QA: `plan = 'pro'`, `credits_limit = 100` (correcto para PRO), `credits_used` sin alterar (seguía en 1, de una generación de IA de una fase anterior).
  - `public.subscriptions`: una fila, `provider = 'lemon_squeezy'`, `provider_subscription_id = '2340162'` (coincide exactamente con el `subscription_id` del payload real), `status = 'active'`, `billing_interval = 'month'`, `cancelled = false`.
  - `public.lemon_squeezy_events`: 4 filas nuevas (una por tipo de evento), consistente con exactamente 4 eventos reales sin duplicados.
- **UI**: dashboard mostró "Plan actual: PRO", "Créditos restantes: 99" (100 − 1 usado), "Generaciones 1/100" inmediatamente después del redirect de éxito, y **persistió correctamente tras un refresh completo de página**.

## 8. Hallazgo real encontrado y corregido: idempotencia no sobrevivía a "Resend"

Al usar la función oficial "Resend" de Lemon Squeezy (mencionada explícitamente en la sección 13 de la consigna) sobre la entrega `subscription_payment_success` ya procesada:

1. **Antes del fix**: `lemon_squeezy_events` pasó de 4 a 5 filas — la idempotencia (`sha256(raw body)`) falló, porque Lemon Squeezy re-envuelve el mismo evento lógico con URLs firmadas nuevas (`expires`/`signature` distintos) en cada resend, cambiando el cuerpo crudo byte a byte aunque el evento sea el mismo. Para este tipo de evento (`subscription_payment_success`, sin referido) el efecto fue inerte, pero el mismo mecanismo habría otorgado créditos o cambiado de plan dos veces para `order_created`/`subscription_created`.
2. **Fix aplicado** (commit `fix(billing): make webhook idempotency survive Lemon Squeezy's Resend`): la clave de idempotencia pasó a ser `sha256(event_name + resource_id + updated_at/created_at del propio recurso)` — estable entre reenvíos del mismo estado, pero distinta para un evento genuinamente nuevo sobre el mismo recurso.
3. **Verificado después del fix, en vivo**: un primer resend post-fix creó una fila nueva (esperado — las filas previas usaban el esquema de clave viejo, nada que igualar todavía). Un **segundo** resend post-fix, con la fila de esquema nuevo ya existente, **no creó una fila nueva** — la cuenta se mantuvo en 6, confirmando que la deduplicación funciona correctamente de ahora en adelante.
4. Sin duplicados de suscripción (`sub_count = 1` verificado después de los 3 resends) ni de créditos.

Este es exactamente el tipo de bug que solo un test end-to-end contra el proveedor real —no un mock— podía revelar; ningún test unitario con datos sintéticos habría capturado el comportamiento real de "Resend".

## 9. Afiliados

Sin regresión: la cuenta QA usada no tiene referente (`affiliate_referrals` sin filas nuevas), y el código de afiliados no fue tocado en este ciclo. El riesgo de auto-referido documentado en la auditoría de código de afiliados (ver informe de la fase anterior) sigue sin resolver — no estaba en el alcance de esta tarea puntual.

## 10. Estado de producción

Sin cambios: 14 secrets (mismos nombres), `postulpro.com` y `www.postulpro.com` responden 200, secret accidental `PostulPro Preview` intacto, Live Mode nunca tocado, cero compras reales.
