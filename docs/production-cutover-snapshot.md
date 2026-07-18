# Snapshot pre-cutover — punto de retorno

Generado: 2026-07-14, en modo solo lectura. Ningún comando de este documento escribió sobre `lostykk-postulpro` (producción), sobre el Supabase anterior, ni sobre DNS/dominios/Google/Lemon Squeezy. Ningún valor de secreto aparece aquí — solo nombres, IDs de deployment y conteos agregados.

Este archivo es el complemento operativo de `docs/production-go-no-go.md` (veredicto) y `docs/production-cutover-runbook.md` (plan). Su único propósito es responder, el día del corte: **¿qué había exactamente antes de tocar nada, y a qué versión/config volver si algo sale mal?**

---

## 1. Git

| Campo | Valor |
|---|---|
| Repositorio | `Lostykk/PostulPro` |
| Rama de trabajo | `claude/postulpro-product-adn` |
| HEAD | `573cbf667d52f2b9ce42330fb2666f75604d78f7` (`573cbf6`) |
| Fecha del commit | 2026-07-14 18:05:35 -03:00 |
| Working tree | limpio, sin cambios pendientes |
| Estado vs. remoto | `up to date with origin/claude/postulpro-product-adn` |
| `main` | sin tocar, sin merge |

Commits que componen el candidato (últimos 5):

```
573cbf6 test(email): cover idempotency and notification safeguards
4298b01 feat(email): activate transactional PostulPro emails with Resend
0ec8436 feat(auth): validate production SMTP and transactional email flows
748092c docs(release): confirm native Google OAuth already works end-to-end in preview
ee0dda4 docs(release): resolve old-Supabase access gate, confirm QA-only subscription
```

## 2. Candidato — validación técnica (repetida hoy, no solo heredada de la fase anterior)

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` | limpio, sin errores |
| `npx vitest run` | **194/194 tests**, 22 archivos (subió de 104/10 archivos el 2026-07-13 — 90 tests nuevos de la activación de emails transaccionales) |
| `npm run build` | exitoso, sin warnings nuevos |
| Bundle | sin secretos embebidos (mismo patrón de auditoría de fases anteriores, sin hallazgos nuevos) |

## 3. Cloudflare — Worker productivo (`lostykk-postulpro`)

| Campo | Valor |
|---|---|
| Dominios | `https://postulpro.com` → 200, `https://www.postulpro.com` → 200 |
| Versión activa (100% tráfico) | `d597a6f8-d00f-4449-9574-bf4baa294ca2` |
| Creada | 2026-07-13T10:24:13.093Z |
| Mensaje del deployment | "Updated secret: PostulPro Preview" (evento de secret, no un deploy de código nuevo) |
| **Punto de rollback** | Si el cutover falla, la versión a la que volver es esta: `d597a6f8-d00f-4449-9574-bf4baa294ca2`. Comando: `npx wrangler rollback d597a6f8-d00f-4449-9574-bf4baa294ca2 --config .output/server/wrangler.json` |

Historial reciente de versiones (más antigua → más nueva):

| Versión | Creada | Nota |
|---|---|---|
| `a9a1c35d-b2cc-4670-95d9-251f1a54705b` | 2026-07-11T20:05:14Z | |
| `472ef8d4-71e7-4b6d-9637-49fd8a219292` | 2026-07-11T20:58:11Z | |
| `54eca50e-4e1a-4be7-9fee-051593bc61f9` | 2026-07-11T21:49:19Z | |
| `e8cc0311-e859-4433-898d-da1b9bd4a957` | 2026-07-12T01:14:19Z | |
| `d597a6f8-d00f-4449-9574-bf4baa294ca2` | 2026-07-13T10:24:13Z | **activa hoy (100%)** |

Secrets presentes en producción hoy (14 nombres, sin valores):

```
ANTHROPIC_API_KEY
BILLING_RPC_SECRET
LEMON_SQUEEZY_API_KEY
LEMON_SQUEEZY_STORE_ID
LEMON_SQUEEZY_VARIANT_BUSINESS_ANNUAL
LEMON_SQUEEZY_VARIANT_BUSINESS_MONTHLY
LEMON_SQUEEZY_VARIANT_CREDITS_100
LEMON_SQUEEZY_VARIANT_PRO_ANNUAL
LEMON_SQUEEZY_VARIANT_PRO_MONTHLY
LEMON_SQUEEZY_WEBHOOK_SECRET
OPENAI_API_KEY
PostulPro Preview   <- secret accidental, revocado del lado del proveedor, ver docs/production-secret-cleanup.md — NO se tocó hoy
SUPABASE_PUBLISHABLE_KEY
SUPABASE_URL
```

Sin cambios respecto al manifest de la fase anterior (`docs/production-environment-manifest.md`): mismos 14 nombres, mismo secret accidental intacto. **Producción sigue apuntando al Supabase anterior** (no al `ccpejnklrfvgtwryqfrw`) — confirmado indirectamente por la ausencia de `RATE_LIMIT_PEPPER`/`RESEND_API_KEY`/variantes que solo existen en el proyecto nuevo, y por el hallazgo ya documentado de fases previas (ref `irawszhupzujzmicooyp` vía bundle público).

## 4. Cloudflare — Worker preview (`lostykk-postulpro-preview`)

| Campo | Valor |
|---|---|
| URL | `https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev` → 200 |
| Versión activa (100% tráfico) | `dcd3223f-9f3f-4ec4-946f-e08a3548674b` |
| Creada | 2026-07-14T19:51:36.114Z |

Secrets presentes en preview hoy (18 nombres):

```
AI_GENERATION_ENABLED
ANTHROPIC_API_KEY
APP_ENV
BILLING_RPC_SECRET
LEMON_SQUEEZY_API_KEY
LEMON_SQUEEZY_STORE_ID
LEMON_SQUEEZY_VARIANT_BUSINESS_ANNUAL
LEMON_SQUEEZY_VARIANT_BUSINESS_MONTHLY
LEMON_SQUEEZY_VARIANT_CREDITS_100
LEMON_SQUEEZY_VARIANT_PRO_ANNUAL
LEMON_SQUEEZY_VARIANT_PRO_MONTHLY
LEMON_SQUEEZY_WEBHOOK_SECRET
OPENAI_API_KEY
PREVIEW_AI_ALLOWED_USER_ID
RATE_LIMIT_PEPPER
RESEND_API_KEY
SUPABASE_PUBLISHABLE_KEY
SUPABASE_URL
```

Coincide exactamente con `docs/production-environment-manifest.md`. Ningún secret de preview fue copiado a producción hoy ni en ninguna fase anterior.

## 5. Supabase nuevo (`ccpejnklrfvgtwryqfrw`) — candidato a producción

| Campo | Valor |
|---|---|
| Estado | `ACTIVE_HEALTHY`, región `sa-east-1`, Postgres 17.6.1 |
| Migraciones | 23 archivos locales, **23/23 sincronizadas con remoto** (`local == remote` en las 23, sin drift) |
| Migración más reciente | `20260716010000_notification_idempotency.sql` |
| Linked | sí, vía `supabase/config.toml` |

Este es el único proyecto Supabase visible vía CLI en esta sesión (`npx supabase projects list` devuelve un único resultado) — consistente con lo ya documentado: el Supabase anterior no es accesible por este canal, solo vía Lovable Cloud MCP (ver `docs/production-data-decision.md`).

## 6. Supabase anterior (`irawszhupzujzmicooyp`) — el que sirve producción hoy

No re-auditado hoy (sin cambios esperados ni necesidad de volver a leerlo — el inventario de `docs/production-data-decision.md`, generado 2026-07-13, ya es la referencia: 4 `auth.users`, 3 `subscriptions` [1 activa clasificada como QA interna], 0 `ai_projects`/`purchases`/`affiliate_*`/`reviews`, 3 migraciones aplicadas). Nada en el estado de producción (sección 3, sin deploys desde el 2026-07-13) sugiere que esto haya cambiado.

## 7. Auth (Supabase nuevo) — estado actual, no modificado hoy

- Site URL: sigue apuntando al preview (no a `postulpro.com`) — sin cambios.
- Redirect URLs: incluyen el preview y localhost; **no** incluyen `postulpro.com`/`www.postulpro.com` todavía.
- Google OAuth: provider configurado y validado end-to-end en preview (ver `docs/production-go-no-go.md` gate #3) — sin cambios.
- Custom SMTP (`smtp.resend.com`, sender `no-reply@auth.postulpro.com`): activo, sin cambios.

Valores finales esperados para el día del corte (no aplicados):

```
Site URL:        https://postulpro.com
Redirect URLs:   https://postulpro.com/**
                 https://www.postulpro.com/**
                 https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/**
                 http://localhost:5173/**
                 http://localhost:3000/**
```

## 8. Lemon Squeezy

Sin cambios desde `docs/lemon-squeezy-test-validation.md`: tienda `425914` en **Test Mode**, Live Mode todavía "received, pending review". Cero actividad Live verificada hoy (no se volvió a entrar al dashboard en esta pasada — sin motivo para esperar cambios, y entrar sin necesidad no aporta nada a un snapshot de solo-lectura).

## 9. Cómo usar este documento el día del corte

1. Antes de desplegar: releer la sección 3 (versión activa de producción) — ese es el número exacto para el comando de rollback si algo falla.
2. Antes de cambiar secrets: comparar contra la lista de la sección 3 — cualquier nombre que aparezca ahí y no se toque deliberadamente, debe seguir intacto después.
3. Antes de cambiar Site URL/Redirect URLs: la sección 7 tiene el valor "antes" (para poder revertir) y el valor "después" esperado (ya redactado, listo para pegar).
4. Después del corte: repetir los mismos comandos de la sección 2 (deployments list + secret list, ambos de solo lectura) contra producción y comparar — cualquier diferencia no explicada por el propio cutover es una señal de alerta.

## 10. Confirmación

- Producción (`postulpro.com` / `www.postulpro.com` / Worker `lostykk-postulpro`) sin cambios durante la generación de este snapshot.
- Ningún secret, DNS, ruta, dominio, Site URL, Redirect URL, credencial OAuth ni configuración de Lemon Squeezy fue modificado.
- Todos los comandos ejecutados para producir este documento fueron de solo lectura (`deployments list`, `secret list`, `migration list`, `curl` de status HTTP, `projects list`).
