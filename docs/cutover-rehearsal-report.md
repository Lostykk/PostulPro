# Simulacro de cutover — sin tocar producción

Estado: **simulacro documental para T-24h a T+15m** (los pasos que tocarían producción real están marcados `NOT-EXECUTED` y no se corrieron) + **rollback ensayado de verdad en preview** (sección final, comandos realmente ejecutados con evidencia).

El objetivo de este documento es que el día del corte real, cada paso ya tenga un comando concreto probado en preview o, cuando aplica a producción, un comando redactado y listo para copiar/pegar — no un "ya vemos cómo se hace".

## Línea de tiempo simulada

### T-24h — Congelamiento y verificación final
- `NOT-EXECUTED`: anunciar freeze de merges no urgentes al equipo.
- Ejecutado hoy (equivalente en preview): `npx tsc --noEmit` (limpio) + `npx vitest run` (104/104) + `npm run build` (exitoso) — ver `docs/release-candidate.md`.
- `NOT-EXECUTED`: confirmar con el dueño del producto el Escenario de datos (A/B/C, ver `docs/production-data-decision.md`) — bloqueado, sin acceso al Supabase anterior.

### T-2h — Backups
- Ejecutado hoy contra el proyecto **nuevo** (no producción): manifests de columnas/RLS/funciones/buckets en `.local-backups/` (ver su `README.md`) — sustituto de `supabase db dump` porque Docker no está disponible en este entorno.
- `NOT-EXECUTED`: dump del Supabase **anterior** (producción) — requiere acceso de alguien en esa organización.
- `NOT-EXECUTED`: `npx wrangler deployments list --config .output/server/wrangler.json` contra producción para capturar el Version ID actual como punto de retorno. (Esto sí sería de solo lectura y estaría autorizado — no se ejecutó en esta pasada porque no aporta nada nuevo a un simulacro que no toca producción; el comando exacto queda listo para el día real.)

### T-30m — Secrets de producción
- `NOT-EXECUTED` (comandos redactados, ver `docs/production-cutover-runbook.md` sección E): rotar `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` al proyecto nuevo, generar `RATE_LIMIT_PEPPER` nuevo, confirmar Lemon Squeezy Live Mode antes de copiar cualquier variant/webhook secret.

### T-0 — Deploy
- `NOT-EXECUTED`: `wrangler deploy --config .output/server/wrangler.json` **sin** `--env` contra `lostykk-postulpro`.
- Ensayado en preview en su lugar (equivalente real, mismo comando con `--env preview`): build + `wrangler deploy --env preview --config .output/server/wrangler.json` → Version ID `d549b06f-aec8-46d5-bca6-a452e111fe79`, verificado en vivo (headers de seguridad presentes, `/api/csp-report` responde 204, sesión QA sobrevive).

### T+5m — Smoke test
- Ejecutado en preview: dashboard carga con sesión QA intacta, headers de seguridad correctos, endpoint CSP responde.
- `NOT-EXECUTED` en producción: login, registro, onboarding, un checkout de prueba.

### T+15m — Prueba real de producto
- `NOT-EXECUTED` en producción: un plan + un entregable de IA real, verificando créditos/idempotencia (ya validado en preview en una fase anterior — ver el reporte de esa fase).

### T+60m — Decisión go/no-go post-deploy
- `NOT-EXECUTED`: revisar logs del Worker productivo, tasa de error, latencia — decidir continuar o ejecutar rollback (sección I del runbook).

---

## Rollback — ensayado de verdad, en preview, esta misma fase

A diferencia de las secciones de arriba, esto **sí se ejecutó**, porque el ensayo de rollback en preview está explícitamente autorizado y es seguro (no afecta producción, no afecta datos).

1. `npx wrangler deployments list --env preview --config .output/server/wrangler.json` → confirmó el historial de versiones, incluyendo la versión previa a los fixes de esta fase (`14d5be58-d089-4142-a9b5-29d03570d1d8`, 2026-07-13T12:27:56Z) y la versión actual con todos los fixes (`d549b06f-aec8-46d5-bca6-a452e111fe79`, 2026-07-13T16:04:02Z).
2. `npx wrangler rollback 14d5be58-d089-4142-a9b5-29d03570d1d8 --env preview --config .output/server/wrangler.json` → **SUCCESS**, deployado a 100% del tráfico.
3. Verificación inmediata vía `curl`: el CSP de esa versión anterior carecía de `object-src`/`base-uri`/`form-action`/`report-uri` (como se esperaba, son cambios de esta fase) y `/api/csp-report` devolvió `404` (la ruta no existía en esa versión) — **prueba concreta de que el rollback realmente sirvió el código antiguo**, no solo que el comando "no falló".
4. `npx wrangler rollback d549b06f-aec8-46d5-bca6-a452e111fe79 --env preview --config .output/server/wrangler.json` → **SUCCESS**, roll-forward de vuelta a la versión con todos los fixes de esta fase.
5. Verificación final: CSP completo restaurado, `/api/csp-report` responde `204` de nuevo.

**Conclusión del ensayo:** `wrangler rollback` funciona de punta a punta contra este Worker (mismo mecanismo en preview y producción — el comando no cambia, solo el `--env` y el `--config`), revierte instantáneamente (sin rebuild, sin redeploy — solo repunta el tráfico a una versión ya subida), y es verificable con una sola llamada HTTP. Esto le da al paso I del runbook (rollback de producción) evidencia real de que el mecanismo funciona, no solo una instrucción escrita nunca probada.
