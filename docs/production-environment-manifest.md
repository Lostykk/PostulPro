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
| `RESEND_API_KEY` | `lib/resend.server.ts` | ❌ ausente | ❌ ausente | **Ningún email transaccional se envía en ningún entorno hoy** — confirmado ya en fases anteriores, sigue igual |

## Hallazgo transversal

Tres capacidades completas — **borrar cuenta**, **checkout/portal/cancelación de Lemon Squeezy**, y **emails transaccionales de marca** — están sin configurar en preview, y dos de ellas (`SUPABASE_SECRET_KEY`/`SERVICE_ROLE_KEY` y `RESEND_API_KEY`) tampoco están en producción. Esto no bloquea el resto de la auditoría (el código fail-closed correctamente: 501 explícito, nunca un 500 silencioso), pero sí bloquea poder decir "probado end-to-end" para billing (#131) y confirma que el hallazgo de `sendWelcomeEmail`/`sendLowCreditsEmail`/`sendWeeklySummaryEmail` nunca invocados (ver informe final, sección de SMTP) es consistente con que la clave ni siquiera existe todavía.

## Acción humana concreta

Para desbloquear #131 (checkout/webhook Test Mode en preview) hace falta, como mínimo:
1. Volver a autenticar la pestaña de Lemon Squeezy (la sesión expiró durante esta fase).
2. Copiar a preview (nunca reusar los valores de producción, aunque estén en Test Mode del mismo store): `LEMON_SQUEEZY_API_KEY` (Test Mode), `LEMON_SQUEEZY_STORE_ID`, las 5 variant IDs de Test Mode, y crear un webhook Test-Mode-only apuntando a la URL de preview para obtener su propio `LEMON_SQUEEZY_WEBHOOK_SECRET`.
2. Para probar `delete-account` end-to-end en preview: generar un `SUPABASE_SECRET_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`) del proyecto Supabase nuevo y configurarlo solo en el Worker preview.
