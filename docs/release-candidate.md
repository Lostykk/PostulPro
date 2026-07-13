# Release candidate — Fase 5

Rama: `claude/postulpro-product-adn` · HEAD: `e5950c7` · Generado: 2026-07-13.

Este documento describe el estado técnico del candidato a producción tal como queda al final de esta fase. No es un GO — ver `docs/production-go-no-go.md` para el veredicto gate por gate.

## Validación técnica

- `npx tsc --noEmit`: limpio, sin errores.
- `npx vitest run`: **104/104 tests pasando**, 10 archivos de test (subieron de 87 al inicio de esta fase a 104 — 17 tests nuevos: 7 de `lemon-squeezy.server.ts`, 3 de `csp-report.ts`, 7 de `billing/webhook.ts`).
- Build de producción (`npm run build`) exitoso, desplegado a preview (`lostykk-postulpro-preview`, Version ID `d549b06f-aec8-46d5-bca6-a452e111fe79`), verificado en vivo: headers de seguridad presentes, endpoint `/api/csp-report` responde 204, sesión QA existente sobrevive el redeploy sin corrupción.
- 22 migraciones de Supabase aplicadas al proyecto nuevo (`ccpejnklrfvgtwryqfrw`), confirmadas en sync local↔remoto.

## Bugs reales encontrados y corregidos esta fase

1. **Password reset completamente roto de punta a punta** (`fix(auth)`, commit `63306f6`): el link de recuperación redirigía a una página que solo mostraba el formulario de "pedir un link", sin ninguna UI para efectivamente fijar la nueva contraseña. El único cambio de contraseña que funcionaba requería ya estar logueado — inútil para alguien que perdió el acceso. Corregido: la misma ruta ahora detecta el evento `PASSWORD_RECOVERY` y muestra el formulario correcto.
2. **`BILLING_RPC_SECRET` nunca se rotó del placeholder literal** (`fix(billing)`, commit `bb6654a`): `process_lemon_squeezy_event()` rechazaba toda llamada real como `unauthorized` desde que se creó. Corregido vía migración, con el valor real configurado como secret de Cloudflare solo en preview.
3. **Borrar la cuenta no cancelaba la suscripción real de Lemon Squeezy** (`fix(billing)`, commit `9571f12`): la fila local se borraba en cascada, pero la suscripción remota seguía activa y seguía cobrando a un método de pago que el usuario ya no podía gestionar. Corregido: ahora se cancela remotamente primero, y si falla, se aborta todo el borrado.
4. **CSP Report-Only sin recolección** (`security(csp)`, commit `283b289`): no había ningún `report-uri`, así que el modo Report-Only nunca generó evidencia real de que fuera seguro pasar a enforcing. Se agregó el endpoint de recolección y las directivas `object-src`/`base-uri`/`form-action` que faltaban.
5. **Buckets de Storage sin límites** (`security(storage)`, commit `a0c0e29`): ninguno de los 3 buckets tenía `file_size_limit` ni `allowed_mime_types` — un vector de XSS almacenado real en los dos buckets públicos (avatar/thumbnail como SVG con `<script>`). Corregido vía migración.

## Gaps reales encontrados, documentados, NO corregidos (requieren decisión humana o credencial)

- **Delete-account**: sin re-autenticación antes de borrar (solo un `AlertDialog` de confirmación del lado del cliente); `billing_history.user_id` no tiene FK y queda huérfano tras el borrado (podría ser intencional para retención contable — es una decisión de producto, no un bug obvio).
- **Afiliados**: nada impide que la misma persona se refiera a sí misma con una segunda cuenta/email para cobrar comisión recurrente indefinida sobre su propio dinero — el guard actual solo bloquea el auto-referido literal (`referrer_id <> referred_id`), no detecta dos cuentas de la misma persona.
- **3 de 6 tipos de email nunca se invocan** (`sendWelcomeEmail`, `sendLowCreditsEmail`, `sendWeeklySummaryEmail` — código muerto, sin call site) y `RESEND_API_KEY` no está configurada en ningún entorno, así que hoy no se envía ningún email transaccional de marca en absoluto (Supabase sigue enviando sus propios emails default de confirmación/reset).
- **Google OAuth completamente roto en el Worker de Cloudflare** (confirmado por click-through real, no solo lectura de código): depende de un proxy de borde propio de Lovable que solo existe en `*.lovable.app`/`*.lovableproject.com`, ausente en un Worker desplegado directamente. Email/password no se ve afectado.
- **Checkout/webhook/delete-account no probables end-to-end en preview hoy**: faltan `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, las 5 variant IDs, `LEMON_SQUEEZY_WEBHOOK_SECRET`, y `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` — ver `docs/production-environment-manifest.md`.
- **Proyecto Supabase anterior**: sin acceso desde esta sesión (organización distinta) — ver `docs/production-data-decision.md`.

## Qué NO cambió esta fase (verificado, no tocado)

- `postulpro.com` / `www.postulpro.com` — sin cambios de DNS, rutas, ni Custom Domains.
- Worker `lostykk-postulpro` (producción) — sin deploy, sin cambio de secrets, el secret accidental `PostulPro Preview` sigue intacto (ver `docs/production-secret-cleanup.md`).
- Lemon Squeezy Live Mode — no se activó ni se usó ninguna credencial Live.
- `main` — sin merge.
- Proyecto Supabase anterior — sin acceso, sin intento de acceso.
