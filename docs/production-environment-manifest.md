# Manifest de variables de entorno — solo nombres, nunca valores

Generado leyendo el código fuente (`process.env.*`) y comparando `wrangler secret list` (nombres únicamente, sin `--env`, sin `--env preview`) contra ambos Workers. Ningún valor de secreto aparece en este documento ni fue impreso en ninguna consola durante su generación.

## Cómo se generó

```
grep -rhoE "process\.env\.[A-Z_][A-Z0-9_]*" src/ | sort -u
npx wrangler secret list --config .output/server/wrangler.json                 # producción, solo nombres
npx wrangler secret list --env preview --config .output/server/wrangler.json   # preview, solo nombres
```

## Tabla completa

| Variable | Usada en | Preview (`lostykk-postulpro-preview`) | Producción (`lostykk-postulpro`) | Notas |
|---|---|---|---|---|
| `SUPABASE_URL` | toda la app | ✅ configurada | ✅ configurada | |
| `SUPABASE_PUBLISHABLE_KEY` | toda la app | ✅ configurada | ✅ configurada | |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | `api/delete-account.ts` (admin API) | ❌ ausente | ❌ ausente | **delete-account devuelve 501 "no disponible" en ambos entornos hoy** — no es un bug de código, es config faltante en los dos lados |
| `ANTHROPIC_API_KEY` | `lib/ai/call-model.server.ts` | ✅ configurada | ✅ configurada | |
| `OPENAI_API_KEY` | `lib/ai/call-model.server.ts` | ✅ configurada | ✅ configurada | |
| `APP_ENV` | `lib/ai/preview-guard.server.ts` | ✅ (`preview`) | ❌ ausente (correcto — no debe existir en producción) | |
| `AI_GENERATION_ENABLED` | `lib/ai/preview-guard.server.ts` | ✅ configurada | ❌ ausente (correcto) | Kill switch exclusivo de preview |
| `PREVIEW_AI_ALLOWED_USER_ID` | `lib/ai/preview-guard.server.ts` | ✅ configurada | ❌ ausente (correcto) | Allowlist de un solo usuario, exclusivo de preview |
| `RATE_LIMIT_PEPPER` | `lib/rate-limit.server.ts` | ✅ configurada | ❌ ausente | Sin pepper, el hash HMAC del rate limiting pierde su propiedad de no-reversibilidad — confirmar si producción usa otro mecanismo o si esto es una brecha real |
| `PLAN_RATE_LIMIT_WINDOW_SECONDS` / `_MAX_REQUESTS` / `_DAILY_MAX` | `lib/rate-limit.server.ts` | no configuradas (usa defaults del código) | no configuradas (usa defaults del código) | Tienen default hardcodeado — ausencia no es un error, es una decisión implícita de usar el default |
| `BILLING_RPC_SECRET` | `api/billing/webhook.ts`, RPC `process_lemon_squeezy_event` | ✅ configurada esta fase (ver commit `fix(billing): set real BILLING_RPC_SECRET hash`) | ✅ ya configurada | El hash correspondiente en el proyecto Supabase **nuevo** se corrigió esta fase; el hash de producción (proyecto Supabase **anterior**) no fue tocado ni verificado — pertenece a la organización sin acceso |
| `LEMON_SQUEEZY_API_KEY` | `lib/lemon-squeezy.server.ts` (`createCheckout`, `getSubscription`, `cancelSubscription`) | ❌ ausente | ✅ configurada | **Checkout, portal y la nueva cancelación-antes-de-borrar no funcionan en preview hoy** — gate humano para probar Test Mode end-to-end |
| `LEMON_SQUEEZY_STORE_ID` | `lib/lemon-squeezy.server.ts` (`createCheckout`) | ❌ ausente | ✅ configurada | |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | `api/billing/webhook.ts` | ❌ ausente | ✅ configurada | Ver `docs/production-secret-cleanup.md` — bloqueado por la sesión de Lemon Squeezy que expiró a mitad de esta fase |
| `LEMON_SQUEEZY_VARIANT_PRO_MONTHLY` / `_PRO_ANNUAL` / `_BUSINESS_MONTHLY` / `_BUSINESS_ANNUAL` / `_CREDITS_100` | `lib/lemon-squeezy.server.ts` (`resolveVariantId`, `findMappingByVariantId`) | ❌ ausentes (las 5) | ✅ configuradas (las 5) | Sin estas, ningún checkout puede iniciarse en preview |
| `RESEND_API_KEY` | `lib/resend.server.ts` (código propio de la app: `sendWelcomeEmail`, `sendLowCreditsEmail`, `sendWeeklySummaryEmail`, y los 3 emails de billing ya existentes) | ✅ configurada esta fase (Worker Secret, restringida por dominio a `auth.postulpro.com`) | ❌ ausente | **Activada y validada end-to-end solo en preview esta fase — ver sección siguiente.** Producción sigue sin este secret; es una decisión deliberada del corte, no un olvido. **No confundir con el Custom SMTP de Supabase Auth (ver abajo), que es un mecanismo distinto y ya estaba configurado y validado antes de esta fase.** |

## Custom SMTP de Supabase Auth (distinto de `RESEND_API_KEY` del Worker)

No es una variable de entorno del Worker — es una configuración del proyecto Supabase nuevo (`ccpejnklrfvgtwryqfrw`, Auth → Emails → SMTP Settings), independiente del código de la app. Gobierna los emails que Supabase Auth envía directamente (confirmación de signup, recuperación de contraseña, magic link, etc.), no los que la app dispara por código.

- **Estado: habilitado y validado end-to-end esta fase.** Sender `no-reply@auth.postulpro.com` (dominio `auth.postulpro.com` verificado en Resend), host `smtp.resend.com`, puerto 465, intervalo mínimo 60s por usuario.
- Verificado con un registro real en preview con una cuenta de email QA controlada por el usuario: email de confirmación entregado (Resend: `Delivered`), enlace real clickeado, cuenta confirmada; luego un flujo de recuperación de contraseña completo (email entregado, enlace clickeado, contraseña nueva establecida y funcionando, la anterior ya no sirve). Ver `docs/production-go-no-go.md` gate #2.
- Plantillas de "Confirm signup" y "Reset password" actualizadas con branding de PostulPro en español (antes eran el default de Supabase en inglés, sin marca) — cambio mínimo de `Subject`/`Body`, sin tocar las variables oficiales (`{{ .ConfirmationURL }}`).
- Sigue sin tocarse: Site URL de producción (sigue apuntando a preview, no a `postulpro.com` — cambio pendiente para el día del corte).

## Emails propios de la app vía `RESEND_API_KEY` (distinto del Custom SMTP de arriba)

Activados y validados esta fase, solo en preview (`lostykk-postulpro-preview`). Sender fijo `PostulPro <notificaciones@auth.postulpro.com>` (mismo dominio verificado que el Custom SMTP, pero un mecanismo de envío completamente distinto: llamadas directas a la API de Resend desde `lib/resend.server.ts`, no SMTP de Supabase Auth).

- **Welcome** (`sendWelcomeEmail`, disparado desde `routes/_authenticated/onboarding.tsx` al completar el wizard vía `POST /api/notifications/welcome`): **verificado real en preview** con la cuenta QA — Resend confirma `Sent → Delivered`, sender/subject/destinatario correctos, un segundo intento inmediato fue bloqueado por idempotencia (`already_sent`, cero duplicados). Idempotency key `welcome/{user_id}`, persistida en `public.sent_notifications` vía la RPC `claim_notification` (`SECURITY DEFINER`, `auth.uid()`-scoped).
- **Low-credits** (`sendLowCreditsEmail`, disparado desde `api/generate-ai.ts` y `lib/projects/executor.server.ts` tras una reserva de créditos real que cruza el umbral): cubierto por 8 tests automatizados (cruce, ya-debajo, no-repetir, `notify_email=false`, perfil sin email, fallo de envío no propaga, compra posterior no re-dispara). **No verificado con un envío real esta fase** — el único camino real para dispararlo es una generación de IA real, y la cuenta QA no está en el allowlist `PREVIEW_AI_ALLOWED_USER_ID` que gatea la generación de IA en preview (mecanismo ya existente, reusado tal cual). Intentarlo forzando `credits_used` cerca del umbral confirmó el 403 esperado (`ai_restricted_in_preview`) y no dejó cambios permanentes (se revirtió `credits_used` a 0 de inmediato). Umbral por defecto 20% restante (`LOW_CREDITS_THRESHOLD_PERCENT`, configurable) — **placeholder, no es un número de producto confirmado**.
- **Weekly summary** (`sendWeeklySummaryEmail`): **el cron real permanece deshabilitado por diseño** — no existe ningún job/cron que lo dispare automáticamente en ningún entorno. Existe únicamente `POST /api/notifications/weekly-summary-qa`, gateado por el mismo allowlist `PREVIEW_AI_ALLOWED_USER_ID` + `APP_ENV=preview` (falla cerrado: 503 fuera de preview, 403 para cualquier usuario no allowlisted — ambos comportamientos verificados en vivo esta fase). Respeta `notify_email`. Datos reales (generaciones + tokens del propio usuario), sin inventar cifras de créditos. **No verificado con un envío real** por el mismo motivo que low-credits (cuenta QA fuera del allowlist).
- Todas las funciones tienen timeout de 10s, nunca exponen la API key en errores, y no aceptan `from`/`to`/`template` controlados por el cliente.

## Hallazgo transversal

Dos capacidades completas — **borrar cuenta** y **checkout/portal/cancelación de Lemon Squeezy** — siguen sin configurar en preview, y una de ellas (`SUPABASE_SECRET_KEY`/`SERVICE_ROLE_KEY`) tampoco está en producción. Esto no bloquea el resto de la auditoría (el código fail-closed correctamente: 501 explícito, nunca un 500 silencioso). El tercer punto que figuraba acá — emails transaccionales propios de la app — se activó y se validó parcialmente esta fase (ver sección anterior); el Custom SMTP de Supabase Auth ya estaba resuelto de una fase previa.

## Acción humana concreta

Para desbloquear #131 (checkout/webhook Test Mode en preview) hace falta, como mínimo:
1. Volver a autenticar la pestaña de Lemon Squeezy (la sesión expiró durante esta fase).
2. Copiar a preview (nunca reusar los valores de producción, aunque estén en Test Mode del mismo store): `LEMON_SQUEEZY_API_KEY` (Test Mode), `LEMON_SQUEEZY_STORE_ID`, las 5 variant IDs de Test Mode, y crear un webhook Test-Mode-only apuntando a la URL de preview para obtener su propio `LEMON_SQUEEZY_WEBHOOK_SECRET`.
2. Para probar `delete-account` end-to-end en preview: generar un `SUPABASE_SECRET_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`) del proyecto Supabase nuevo y configurarlo solo en el Worker preview.
