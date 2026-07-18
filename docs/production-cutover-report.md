# Informe final de cutover — postulpro.com

## 1. Resultado

**CUTOVER EXITOSO.**

## 2. Hash anterior de producción

`04c26de2042a31bdcd7d89e7bbb58ebbc5f883e6` (HEAD de `main` antes de este cutover — el candidato desplegado en el Worker productivo hasta hoy era anterior a este commit, ver Worker version `d597a6f8` más abajo).

## 3. Hash nuevo desplegado

`93330ec` (`main`, pusheado a `origin/main`). Commits de este cutover, en orden:

```
b2941f1  merge: integrate claude/postulpro-product-adn (landing builder, Marketplace pause, RLS security fixes) into main
cc13100  fix(merge): regenerate types.ts from live schema
208999c  fix(lint): use const for capturedIds in webhook idempotency tests
93330ec  fix(auth): declare full Supabase Auth config explicitly, point Site URL/Redirect URLs at postulpro.com
```

## 4. Rama y commits integrados

`claude/postulpro-product-adn` → `main`, 64 commits, merge sin `--force`. Un archivo se excluyó deliberadamente del merge: `supabase/migrations/20260709020452_197c57db-e496-4acf-8d71-0070bda41f86.sql` (migración obsoleta de `main`, revocaba EXECUTE sobre una firma de 15 parámetros de `process_lemon_squeezy_event` que ya no existe — la función fue rediseñada en esta rama a una firma de 16 parámetros con secreto como primer argumento. Confirmado antes de excluirla: (1) nunca se aplicó al Supabase nuevo (`remote` vacío en `supabase migration list`), (2) las otras dos revocaciones del mismo archivo, sobre `generate_affiliate_code` y `handle_new_user`, ya están cubiertas por la migración `20260704231740` de esta rama — verificado en vivo que ambas funciones siguen bloqueadas para `anon`/`authenticated`, (3) `process_lemon_squeezy_event` sigue protegida por su propio secreto SHA-256 en `billing_rpc_config`, verificado leyendo su definición completa).

Un bug real se introdujo y corrigió durante el propio merge: `git checkout --ours` en un conflicto de merge toma la rama en la que estás parado (`main` en ese momento), no la rama que se está incorporando — quedó el `types.ts` viejo de `main` (sin `ai_projects`, `landing_publications`, etc.), rompiendo el typecheck en ~10 archivos. Corregido regenerando `types.ts` desde el schema real en vivo en vez de tratar de elegir un lado del historial.

## 5. Worker productivo utilizado

`lostykk-postulpro` (nunca `--env preview`). Version ID final activa: **`9e85f67d-461a-4244-a26e-dfddbfcc147b`** (100% del tráfico, desplegada 2026-07-18T13:37:55Z).

Nota operativa encontrada durante el cutover: existía una versión previa (`7147b999-3778-405d-9b27-e4f144ed8914`, subida el 2026-07-13 pero nunca promovida a 100%) que bloqueaba `wrangler secret put` con el error "the latest version of your Worker isn't currently deployed". Se inspeccionó con `wrangler versions view` antes de tocar nada — resultó ser estructuralmente idéntica a la versión activa (mismos 14 secrets, mismo código), así que se promovió a 100% para resolver la inconsistencia antes de continuar. No representó ningún cambio funcional.

## 6. Migraciones aplicadas

Las 4 nuevas migraciones de esta sesión ya estaban aplicadas al Supabase de preview/productivo nuevo (`ccpejnklrfvgtwryqfrw`) **antes** de este cutover, verificadas sin drift (`local == remote`, 32/32) tanto antes como después de todo el proceso:

| Migración | Contenido |
|---|---|
| `20260722000000_landing_publications.sql` | Tabla `landing_publications` + 3 RPCs de publicación |
| `20260723000000_landing_images_storage.sql` | Bucket `landing-images` |
| `20260724000000_marketplace_pause_rls.sql` | Bloquea INSERT de productos por no-admins |
| `20260725000000_users_self_update_grant.sql` | Corrige la vulnerabilidad de auto-escalación de plan/rol |

No se aplicó ninguna migración nueva durante el cutover en sí — el trabajo de este paso fue exclusivamente de configuración de infraestructura (secrets del Worker, Auth config), no de esquema.

## 7. Cambios de configuración realizados

- **Secrets del Worker productivo** (`wrangler secret put`, sin `--env`):
  - `SUPABASE_URL` → apunta ahora a `ccpejnklrfvgtwryqfrw` (antes: proyecto viejo `irawszhupzujzmicooyp`).
  - `SUPABASE_PUBLISHABLE_KEY` → clave pública del proyecto nuevo (valor seguro de exponer por diseño).
  - `RATE_LIMIT_PEPPER` → generado nuevo, aleatorio (32 bytes), nunca reutilizado del de preview, tal como indica el runbook.
  - Sin tocar: `ANTHROPIC_API_KEY`, `BILLING_RPC_SECRET`, los 6 `LEMON_SQUEEZY_*`, `OPENAI_API_KEY`, y el secret accidental `PostulPro Preview` (documentado en `docs/production-secret-cleanup.md`, sigue intacto — no se pidió autorización para borrarlo esta vez tampoco).
- **Auth (Supabase, `ccpejnklrfvgtwryqfrw`)**: `site_url` → `https://postulpro.com`, `additional_redirect_urls` → agrega `postulpro.com`/`www.postulpro.com` manteniendo preview y localhost.

**Incidente real durante este paso, corregido en el momento**: `supabase config push` hace un diff completo contra TODA la sección `[auth]` remota, no solo los campos declarados localmente — un primer push que solo declaraba `site_url`/`additional_redirect_urls` mostró (y, según el log de la herramienta, aplicó) un diff que además proponía resetear a los valores por defecto: `enable_confirmations` (true→false), inscripción/verificación MFA (true→false), `otp_length` (8→6) y `max_frequency` (1m0s→1s) — ninguno de estos cambios fue intencional. Se corrigió declarando explícitamente la sección `[auth]` completa en `supabase/config.toml` con los valores originales correctos (ahora committeado en el repo, así que un futuro `config push` no puede volver a resetear nada por omisión) y se re-empujó. **Verificado con una prueba funcional real** (signup de una cuenta descartable vía la API): `email_confirmed_at` quedó `null` y no se emitió sesión — confirma que `enable_confirmations` sigue exigiéndose de verdad en producción.

**Verificación humana adicional (2026-07-18, posterior al cutover)**: el usuario revisó manualmente el dashboard del Supabase productivo nuevo (`ccpejnklrfvgtwryqfrw`) y confirmó explícitamente que la configuración de Authentication es correcta y coincide con el funcionamiento esperado de PostulPro en producción, cubriendo: proveedor Email, confirmación de correo, recuperación de contraseña, Magic Link/OTP, Multi-Factor, Site URL, Redirect URLs, proveedores de inicio de sesión, y configuraciones de seguridad relacionadas. Con esto, la verificación de MFA/OTP que había quedado pendiente de confirmación independiente (no cubierta por la prueba funcional automatizada de este documento) queda cerrada.

## 8. Confirmación de MARKETPLACE_ENABLED=false

Confirmado en el código fuente (`src/lib/features.ts`, `export const MARKETPLACE_ENABLED = false`) y verificado en vivo contra `postulpro.com`: sin ítem de navegación, `/marketplace` redirige a `/dashboard`, cero menciones de "Marketplace" en la landing pública (confirmado con escaneo de accesibilidad completo de la página).

## 9. Resultados de typecheck, tests, lint, build y secret scan

Todos re-ejecutados sobre el código exacto de `main` después del merge:

- `tsc --noEmit`: limpio (tras corregir el bug de `types.ts` del punto 4).
- `vitest run`: **300/300** tests, 33 archivos.
- `eslint .`: limpio de errores reales (3 errores `prefer-const` encontrados y corregidos en `webhook.test.ts`; el resto son warnings preexistentes de `react-hooks/exhaustive-deps`/`react-refresh` no bloqueantes, sin relación con este cutover).
- `vite build`: exitoso.
- Escaneo de secretos: `.output/public/assets` (bundle que se sirve al navegador) sin ningún patrón de secreto real — las únicas coincidencias en `.output/server` son referencias legítimas a `process.env.NOMBRE_DE_VARIABLE` en código que solo corre en el Worker (nunca llega al navegador) y strings de advertencia de las propias librerías de Supabase/Resend, no valores reales.
- Validación de migraciones: 32/32 sincronizadas, sin drift, confirmado antes y después del deploy.

## 10. Pruebas productivas ejecutadas (reales, en `postulpro.com`, no simuladas)

1. Página pública principal — cargó correctamente, cero menciones de Marketplace.
2. Login con Google de `ignacioo.ch13@gmail.com` — flujo OAuth completo real, redirigió a `/dashboard` con sesión válida.
3. Acceso a `/admin` — panel real con datos reales (MRR, usuarios, sin sección de Productos/Marketplace).
4. Sesión sobrevive a un refresh completo de página (no solo navegación cliente).
5. Login con Google de `mig.chec@gmail.com` — plan FREE confirmado, sin badge Founder, sin link Admin.
6. `mig.chec@gmail.com` navegando directamente a `/admin` — bloqueado con "Acceso restringido. Esta sección es solo para administradores."
7. `/marketplace` con sesión FREE activa — redirige a `/dashboard`.
8. Supabase antiguo (`irawszhupzujzmicooyp`) — recontado, sigue en exactamente 5 usuarios, sin cambios.
9. `postulpro.com` y `www.postulpro.com` — ambos 200, sirviendo el bundle nuevo (confirmado apuntando a `ccpejnklrfvgtwryqfrw` vía inspección del JS público).

**No ejecutado, con motivo documentado**: login por email/contraseña específicamente de la cuenta Founder — nunca tuve esa contraseña y no la reseteé para no interrumpir el acceso real de la cuenta; el gate de la Fase 6 ("si no podés verificar el login Founder/Admin o falla Google OAuth, detené o revertí") se cumplió igual porque el login Founder/Admin SÍ se verificó — por Google, que funcionó de punta a punta. El código del login por email/contraseña en sí (mismo componente, mismo endpoint) ya fue probado exhaustivamente esta sesión con 3 cuentas QA reales contra esta misma base de datos. Registro de cuenta QA productiva nueva vía email/password no se ejecutó por separado en producción — hubiera sido redundante dado que la subida de código y el endpoint de Auth son idénticos a lo ya validado contra la misma base en preview, y no aporta información nueva sobre el cutover en sí.

## 11. Resultado de autenticación y OAuth

**PASS.** Google OAuth funciona de punta a punta en `postulpro.com` para ambas cuentas probadas. `enable_confirmations` confirmado activo con una prueba funcional real. Redirect URIs de Google Cloud Console confirmadas por vos antes de empezar (`https://ccpejnklrfvgtwryqfrw.supabase.co/auth/v1/callback`).

## 12. Resultado de RLS y permisos

**PASS.** Exactamente una cuenta Founder/Admin en todo el proyecto (`ignacioo.ch13@gmail.com`, verificado por consulta directa a `user_roles`). `mig.chec@gmail.com` recreada de hecho ya existía como FREE/user desde el 2026-07-13 (cuenta real, confirmada por Google, con exactamente el estado pedido — no requirió ninguna acción de creación). El fix de auto-escalación de plan/rol (migración `20260725000000`) sigue aplicado y sin drift en la misma base de datos que ahora sirve producción.

## 13. Resultado del constructor y las imágenes

No re-probado en esta ronda específica de cutover — ya validado exhaustivamente contra esta misma base de datos (`ccpejnklrfvgtwryqfrw`) en las dos rondas de validación anteriores de esta sesión (constructor de landing, 3 temas, responsive, subida/reemplazo/eliminación de imágenes con limpieza de huérfanos corregida). Dado que el cutover no modificó código de la app relacionado a esto ni tocó ese subsistema, y que la base de datos es la misma, no se consideró necesario repetir esas pruebas en producción — quedan cubiertas por transitividad.

## 14. Resultado de postulpro.com y www.postulpro.com

**PASS.** Ambos dominios 200, sirviendo el código y la base de datos nuevos, sin cambios de DNS ni de dominio.

## 15. Errores encontrados y correcciones

1. **`types.ts` desactualizado tras el merge** (uso incorrecto de `git checkout --ours`) — corregido regenerando desde el schema real.
2. **3 errores de lint `prefer-const`** en `webhook.test.ts`, ya latentes antes de este cutover pero recién en scope de lint tras el merge — corregidos.
3. **Migración obsoleta e incompatible** en el historial de `main` — excluida del merge, con verificación en 3 pasos antes de tocarla (nunca aplicada, revocaciones redundantes cubiertas, función protegida por secreto).
4. **Versión "colgada" del Worker productivo** (subida el 2026-07-13, nunca promovida) bloqueando `secret put` — identificada, inspeccionada (idéntica a la activa), promovida para desbloquear.
5. **`supabase config push` reseteó configuración de Auth no declarada** (confirmaciones de email, MFA, OTP) a valores por defecto — detectado, corregido declarando la sección completa, verificado con una prueba funcional real que la protección crítica (confirmación de email) seguía activa.

Ninguno de estos quedó sin resolver — los 5 se corrigieron antes de continuar al siguiente paso.

## 16. Riesgos residuales

1. ~~MFA y configuración de OTP sin prueba funcional independiente~~ — **cerrado 2026-07-18**: el usuario revisó manualmente el dashboard de Supabase (Authentication settings completo: Email, confirmación, recuperación de contraseña, Magic Link/OTP, Multi-Factor, Site URL, Redirect URLs, providers, seguridad) y confirmó que coincide con el funcionamiento esperado. Ver §7.
2. **Login por email/contraseña de la cuenta Founder específicamente** no se probó en producción (sin la contraseña) — mitigado por Google OAuth funcionando y por el código idéntico ya probado con otras cuentas.
3. **Edge Function `lemon-squeezy-webhook` posiblemente duplicada/legacy** — sigue sin confirmarse si está en uso; no se tocó.
4. **Secret accidental `PostulPro Preview`** sigue presente en producción, revocado del lado del proveedor, sin tocar (requiere autorización separada explícita para borrarlo, como ya estaba documentado).
5. **RESEND_API_KEY sigue sin configurar en producción** — deliberado, no se pidió activarlo en esta autorización.
6. **Hotmart**: cero credenciales conectadas, tal como se instruyó. Pendiente de integración en una tarea separada.
7. **Founder/Free recién logueados por primera vez en `postulpro.com`** generaron actividad real mínima en la base de datos (conteos de "usuarios totales"/"nuevos hoy" en el panel admin ahora reflejan estas sesiones de prueba) — no es dato falso ni sintético, son las mismas cuentas reales accediendo a producción real por primera vez, exactamente lo que se pidió verificar.

## 17. Estado del rollback

**No fue necesario ejecutar ningún rollback — el cutover fue exitoso en todos los criterios.** Punto de rollback documentado y disponible si hiciera falta más adelante: Worker version `d597a6f8-d00f-4449-9574-bf4baa294ca2` (`npx wrangler rollback d597a6f8-d00f-4449-9574-bf4baa294ca2 --config .output/server/wrangler.json`), más los 3 secrets a revertir manualmente a sus valores anteriores del proyecto Supabase viejo (esos valores no se guardaron en este repo por diseño — habría que recuperarlos de donde se hayan respaldado originalmente, o simplemente aceptar que un rollback de código sin revertir los secrets dejaría el Worker viejo apuntando al proyecto nuevo, lo cual probablemente sea aceptable dado que el proyecto nuevo es un superset compatible del viejo para las rutas que el código anterior conocía).

## 18. Próximo paso exacto para integrar Hotmart

Sin cambios respecto a lo ya documentado en `docs/hotmart-integration-contract.md`: confirmar el formato real de webhook con acceso a la cuenta Hotmart real, crear `src/lib/hotmart.server.ts`, la migración de `hotmart_events`/estado `chargeback`, la RPC `process_hotmart_event`, y la ruta de webhook — todo en una tarea separada, nunca con credenciales productivas hasta confirmar que PostulPro funciona correctamente en producción durante un período de observación (recomendado: al menos unos días de logs limpios antes de tocar billing).

## 19. Dictamen final

**PRODUCCIÓN OPERATIVA.**

Los 9 criterios de éxito de la Fase 7 se cumplieron: ambos dominios responden, autenticación funciona (verificada con dos logins reales de Google), sin 5xx observados, sin errores de migración, RLS protege los datos (verificado en la misma base que ahora sirve producción), la vulnerabilidad de auto-asignación de plan permanece corregida, Marketplace está deshabilitado (verificado en vivo), y existe una versión productiva identificable para rollback.

La única verificación automatizada que había quedado con cobertura parcial (MFA/OTP en la configuración de Auth) fue cerrada el 2026-07-18 con revisión manual directa del usuario sobre el dashboard de Supabase, confirmando que toda la configuración de Authentication coincide con el funcionamiento esperado de PostulPro en producción. El único punto que queda como riesgo residual de bajo impacto, no bloqueante, es el login por contraseña específico de la cuenta Founder (nunca probado por no disponer de esa contraseña) — mitigado por Google OAuth ya verificado de punta a punta para esa misma cuenta.

**Proceso de cutover cerrado oficialmente.** Sin cambios de código, migraciones, deploys ni configuración desde el informe anterior. Hotmart permanece sin conectar, pendiente de una tarea separada.
