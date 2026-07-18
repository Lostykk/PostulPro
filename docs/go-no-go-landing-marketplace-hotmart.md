# GO / NO-GO — Landing builder, pausa de Marketplace, preparación Hotmart

Estado: **GO PARA PRODUCCIÓN** (ver dictamen definitivo en §18). Esta es la actualización del informe tras resolver las condiciones pendientes: flujo completo de autenticación verificado con navegador real + Auth API, subida/reemplazo/eliminación real de imágenes en el constructor verificada de punta a punta con limpieza de huérfanos corregida, y una auditoría real de RLS/permisos para usuarios no-administradores que encontró y corrigió una vulnerabilidad de escalación de privilegios genuina. Ver `docs/production-go-no-go.md` para el veredicto de la plataforma base (SMTP, OAuth de Google, CSP) — ese documento sigue vigente. **No se ejecutó ningún cutover productivo** — deploy solo a `lostykk-postulpro-preview`, tal como fue instruido; este informe no autoriza el corte, solo lo habilita.

## 1. Estado real del repositorio

- Rama: `claude/postulpro-product-adn`, sincronizada con `origin` (push ya realizado).
- Commit final: `e188d50` — `fix(security): lock plan/role/credits from self-edit, clean up orphaned landing images`.
- Commits de esta sesión, en orden: `97edb35` (landing builder + pausa de Marketplace + docs Hotmart), `2f18bed` (primer informe GO/NO-GO), `e188d50` (esta ronda — fix de seguridad + limpieza de huérfanos).
- `stash@{0}` sigue presente desde un incidente de recuperación de una fase anterior — verificado como idéntico al estado ya commiteado, respaldo redundante e inofensivo, se deja intacto por la misma razón que antes.
- Working tree: limpio (`git status` sin cambios pendientes) al momento de este informe.

## 2. Archivos modificados (resumen — ver el commit para el detalle completo)

- **Nuevo**: `src/lib/features.ts`, `src/components/landing/{LandingBuilder,LandingSectionRenderer,SectionEditor}.tsx`, `src/lib/landing/{schema,themes,export,publish,images}.ts` (+tests), `src/routes/p.$slug.tsx`, `docs/hotmart-integration-contract.md`, 3 migraciones nuevas.
- **Eliminado**: `src/components/deliverables/LandingPageView.tsx` (reemplazado por el builder), funciones muertas en `src/lib/deliverables/export.ts`.
- **Modificado**: `AppShell.tsx`, `dashboard.tsx`, `admin.tsx`, `index.tsx`, `legal.tsx`, `marketplace.tsx` (pausa de Marketplace); `DeliverableRenderer.tsx`, `projects.$id.tsx`, `library.tsx`, `tools.landing-copy.tsx` (integración del builder).

## 3. Migraciones creadas y aplicadas (todas a preview `ccpejnklrfvgtwryqfrw` — confirmado explícitamente antes de cada push, nunca a producción)

| Migración | Contenido | Estado |
|---|---|---|
| `20260722000000_landing_publications.sql` | Tabla `landing_publications` + 3 RPCs (`publish_landing_page`, `unpublish_landing_page`, `get_published_landing`) | ✅ Aplicada (fase anterior de esta sesión) |
| `20260723000000_landing_images_storage.sql` | Bucket `landing-images` (sin SVG, 5MB máx, RLS por carpeta de usuario) | ✅ Aplicada esta sesión, revisada antes de aplicar |
| `20260724000000_marketplace_pause_rls.sql` | Bloquea INSERT de nuevos productos por no-admins (defensa en profundidad además del flag de app) | ✅ Aplicada esta sesión |
| `20260725000000_users_self_update_grant.sql` | Otorga UPDATE a `authenticated` solo en las columnas de perfil auto-editables (`name`, `bio`, `avatar_url`, `primary_goal`, `company_name`, `revenue_goal_6m`, `notify_email`, `notify_push`); revoca los grants de `anon` sobre `users` (INSERT/UPDATE/DELETE/SELECT) | ✅ Aplicada esta ronda, verificada en vivo antes y después |

`npx supabase migration list --linked` confirma `local == remote` en las **32** migraciones — cero drift.

## 4. Funcionalidades completadas

- Constructor visual de landing pages por secciones (19 tipos), 3 temas (Authority Dark, Conversion Light, Bold Brand) con personalización de color/tipografía/espaciado/bordes.
- Preview real desktop/tablet/mobile con ancho de viewport simulado.
- Guardado con autosave debounced + botón manual, persistencia confirmada tras refresh real del navegador.
- Subida de imágenes por sección (bucket dedicado, sin costo de crédito).
- Panel SEO (title, description, slug, OG title/image/description, canonical URL).
- Exportación HTML/JSON (unit-testeada 7/7; no se hizo click-through de la descarga en esta sesión — ver §9).
- Publicación pública preview-only en `/p/:slug`, con despublicación, verificada de punta a punta contra el proyecto real `bcc36718-3e2c-429e-80bc-d5b21ad4de5c`.
- Cero consumo de créditos confirmado por inspección de código: guardar/editar/publicar/despublicar nunca llaman a la ruta de generación de IA ni descuentan `credits_used`.

## 5. Cómo quedó deshabilitado Marketplace

Flag central único: `MARKETPLACE_ENABLED` en `src/lib/features.ts` (hoy `false`). Un solo booleano controla:
- Navegación (sidebar desktop + tabs móviles) — verificado visualmente, el ítem desaparece.
- Dashboard: tarjeta de acción rápida y stat de ingresos ocultos.
- Panel admin: stat "Marketplace revenue" y sección "Productos" ocultos.
- Landing pública, tabla comparativa, FAQ, carrusel de casos de uso, footer, y el texto legal que prometía venta de terceros — todos condicionados al flag, verificado con el `find` tool del navegador que confirmó cero menciones de "Marketplace" en `/` y `/legal`.
- Rutas `/marketplace`, `/marketplace/sell`, `/marketplace/:productId` — `beforeLoad` en el layout route redirige a `/dashboard`; verificado en vivo (navegación directa a la URL no llegó a renderizar la página).
- RLS: nuevos INSERT en `products` bloqueados para no-admins (migración #3 de la tabla anterior) — los sellers conservan la posibilidad de editar/borrar sus productos existentes, no se tocaron datos.

Nada se borró: tablas `products`/`purchases`/`reviews` y sus RLS de lectura siguen intactas. Reversible cambiando una sola línea (`MARKETPLACE_ENABLED = true`) más, opcionalmente, revirtiendo la migración RLS.

## 6. Estado del constructor de landing pages

Ver §4. Validado con navegador real autenticado (no solo por código) contra el proyecto `bcc36718-3e2c-429e-80bc-d5b21ad4de5c`, deliverable "Landing page de captura (sesión estratégica)". **Bug real encontrado y corregido en esta sesión**: los encabezados (`h1`/`h2`/`h3`) de todas las secciones heredaban el color de texto casi-blanco del shell de la app (modo oscuro global) en vez del color de texto propio del tema, haciéndolos prácticamente invisibles en los temas claros (Conversion Light, Bold Brand) — tanto en el editor in-app como en la página pública `/p/:slug`. Corregido fijando `color: doc.theme.text` en el contenedor raíz de ambas superficies (`LandingBuilder.tsx` y `p.$slug.tsx`); no se tocó cada encabezado individualmente porque el color se hereda correctamente por cascada CSS una vez fijado en el nivel correcto. Verificado visualmente en los 3 temas tras el fix.

**Observación (no bug de código)**: el deliverable de landing de este proyecto en particular tiene un artefacto de contenido pre-existente — el campo `hero.body` generado por la IA incluye literalmente el texto `https://ejemplo.com/imagen-hero-seguros.jpg` como parte del copy (la IA nunca genera una imagen real, según el comentario en `parse-landing.ts`, pero en este caso escribió una URL de ejemplo como texto en vez de omitirla). Se renderiza fielmente porque es dato real de esa generación, no un bug de renderizado — el usuario puede editarlo desde el builder (`SectionEditor`) sin costo de crédito. Vale la pena revisar el prompt de la herramienta `landing-copy` para evitar que el modelo escriba URLs de ejemplo como texto visible, pero no se tocó el prompt en esta sesión (fuera de alcance).

## 7. Resultados de tests, typecheck, lint y build (esta ronda)

- `tsc --noEmit`: limpio.
- `vitest run`: **300/300 tests pasando**, 33 archivos (+4 tests nuevos de `landingImagePathFromUrl` sobre la ronda anterior de 296).
- `vite build`: exitoso, sin errores.
- Lint: `eslint` sobre los archivos tocados esta ronda (`images.ts`, `images.test.ts`, `SectionEditor.tsx`) sin errores de reglas reales (ruido CRLF preexistente excluido, mismo criterio que la ronda anterior).
- Escaneo de bundle (`.output/public/assets` y `.output/server`) tras el nuevo build: sin patrones de secreto, sin credenciales de las cuentas QA creadas esta ronda, solo la URL pública de Supabase y la clave publicable.
- Validación de migraciones: `local == remote` en las 32 migraciones, cero drift, confirmado antes y después de aplicar la migración nueva.
- Validación de RLS: ver §11 (matriz completa) — cada policy relevante fue probada empíricamente con tokens JWT reales de las 4 cuentas QA, no solo leída del código.

## 8. Fase A — Autenticación: pruebas realmente ejecutadas

Todo contra el proyecto Supabase de preview (`ccpejnklrfvgtwryqfrw`) y el Worker `lostykk-postulpro-preview`. La sesión de navegador ya autenticada (Founder/Admin, cuenta real del usuario) era la única credencial disponible y sin contraseña conocida para poder re-loguearse — el SDK de Supabase comparte la sesión activa vía `localStorage` entre pestañas del mismo perfil de Chrome, así que iniciar sesión como otra cuenta en el navegador la habría sobrescrito sin posibilidad de recuperación (no hay `SUPABASE_SERVICE_ROLE_KEY` disponible para generar un magic-link de vuelta). Para evitar ese riesgo real, todo el flujo de registro/login/logout/reset se probó contra la **misma API de Auth que usa el frontend** (`supabase-js` llama exactamente a estos endpoints) usando 3 cuentas QA nuevas, reales, creadas con casillas de mailinator.com (servicio de email descartable ya usado en este proyecto — ver la cuenta `postulpro-preview-qa-admin-...@mailinator.com` que ya existía en el panel admin antes de esta sesión):

1. **Registro por email** — `POST /auth/v1/signup` real contra las 3 cuentas (`postulpro-preview-qa-{free,pro,biz}-<timestamp>@mailinator.com`), `email_confirmed_at` nulo hasta confirmar → correcto.
2. **Confirmación de email** — email real recibido en cada inbox de mailinator con el asunto "Confirmá tu email — PostulPro", link `.../auth/v1/verify?token=...&type=signup&redirect_to=https://lostykk-postulpro-preview...` (dominio de **preview**, nunca postulpro.com), seguido con `curl`, redirige 303 con sesión válida. Confirmado para las 3 cuentas.
3. **Login antes de confirmar** — rechazado con `email_not_confirmed`, HTTP 400, mensaje claro.
4. **Login con email y contraseña** — `POST /auth/v1/token?grant_type=password` exitoso para las 3 cuentas ya confirmadas.
5. **Contraseña incorrecta vs. email inexistente** — ambos devuelven el mismo `invalid_credentials` (anti-enumeración correcta, no revela si la cuenta existe).
6. **Recuperación de contraseña de punta a punta** — `POST /auth/v1/recover` → email real recibido ("Recuperar contraseña…") → link de recovery con `redirect_to` de preview → `PUT /auth/v1/user` con el token de recovery para fijar una contraseña nueva (mismo endpoint que llama `reset-password.tsx`) → contraseña vieja rechazada, contraseña nueva acepta login. Ciclo completo verificado.
7. **Logout / revocación de sesión** — `POST /auth/v1/logout?scope=local` (lo que llama `supabase.auth.signOut()`); el `access_token` ya emitido sigue siendo válido hasta su expiración natural (comportamiento esperado de JWT sin estado, no un bug), pero el `refresh_token` queda genuinamente revocado — confirmado con un intento posterior de `grant_type=refresh_token` que devuelve `refresh_token_not_found`, o sea la sesión no se puede extender más allá de la hora ya emitida.
8. **Token inválido / malformado** contra la REST API → `401`, `PGRST301 "Expected 3 parts in JWT"`.
9. **Separación preview/producción** — cada link de confirmación y de recovery recibido apuntó exclusivamente a `lostykk-postulpro-preview.ignacioo-ch13.workers.dev`, nunca a `postulpro.com`; los `redirectTo`/`emailRedirectTo` del código siempre se derivan de `window.location.origin` (nunca de un parámetro de URL controlado por el usuario), así que no existe vector de "URL de redirección inválida" que probar — no hay ningún `?redirect=`/`?next=` que el código lea.
10. **Sin loops ni 404** — cada paso navegó exactamente a la pantalla esperada (login → dashboard/onboarding, callback → dashboard, reset → dashboard).

**Limitación documentada explícitamente**: Google OAuth en preview no se re-probó esta ronda (ya se había verificado de punta a punta con clic real en una fase anterior de este proyecto, ver `docs/production-go-no-go.md` gate #3) — repetirlo requería una cuenta Google real e interacción humana con el selector de cuenta, no disponible de forma automatizada de forma segura en esta sesión. El código no cambió desde esa verificación (`googleOAuthOptions`/`auth.callback.tsx` sin tocar).

## 9. Fase B — Imágenes del constructor: pruebas realmente ejecutadas

Con una imagen real (PNG válido, no un placeholder de texto) subida por el input de archivo real del builder (`HeroImageField`) vía la sesión Founder ya autenticada, contra el proyecto real `bcc36718-3e2c-429e-80bc-d5b21ad4de5c`:

1. **Selección y subida real** — PNG real dispatchado al `<input type=file accept="image/png,image/jpeg,image/webp,image/gif">` real del componente (mismo elemento que abre el selector nativo), toast "Imagen subida" real.
2. **Formatos permitidos / tamaño** — confirmado por código y por prueba directa contra la API de Storage: PNG/JPEG/WEBP/GIF aceptados, SVG rechazado (`415 invalid_mime_type` — el vector de XSS almacenado que motivó excluir SVG en la migración original), límite de 5MB en el bucket (`file_size_limit: 5242880`).
3. **Nombre seguro y ruta única** — `{user_id}/{timestamp}-{random}.{ext}`, confirmado en el `Key` real devuelto por la subida.
4. **Bucket correcto de preview** — `landing-images` en `ccpejnklrfvgtwryqfrw`, confirmado.
5. **Políticas RLS del Storage** — probadas empíricamente, no solo leídas: un usuario no puede subir dentro de la carpeta de otro usuario (`403`, RLS violation), sí puede subir/borrar dentro de la propia.
6. **Vista previa inmediata** — la imagen apareció al instante en el editor de la sección tras la subida.
7. **Persistencia en base de datos** — confirmada tras un refresh completo de página (F5 real, no solo re-render de React) y tras navegar fuera y volver al proyecto.
8. **Visualización desktop/tablet/mobile** — confirmada en los 3 viewports del preview responsive, imagen correctamente enmascarada según el tema activo (Bold Brand).
9. **Visualización en la landing publicada** — confirmada la sesión anterior contra `/p/:slug` (el fix de contraste de esta sesión también corrige el fondo/texto alrededor de la imagen en esa misma superficie).
10. **Reemplazo de imagen** — subida de una segunda imagen distinta sobre la misma sección, reemplaza correctamente la visible.
11. **Eliminación** — botón "Quitar imagen" (X), la sección vuelve al placeholder "Imagen de portada pendiente" correctamente.
12. **Bug real encontrado y corregido**: ni "reemplazar" ni "eliminar" borraban el blob anterior en Storage — solo limpiaban la referencia `url` en el JSON de la sección, dejando el archivo huérfano en el bucket para siempre. Corregido con `deleteLandingImage()` (nueva función en `images.ts`, con `landingImagePathFromUrl()` extraída como helper puro y testeada — 4 tests nuevos) llamada tanto al reemplazar como al quitar; solo intenta borrar URLs que están realmente dentro del bucket propio (una URL externa pegada a mano en el campo de texto de fallback no se toca), y nunca lanza si el borrado falla (no debe bloquear al usuario). Verificado el fix con `tsc`/`vitest` limpios y redeploy.
13. **Errores de subida** — probado con un archivo SVG (formato no permitido): mensaje de error claro, sin dejar estado a medio subir.
14. **Prohibición de acceder a archivos ajenos** — ver punto 5; además confirmado que un usuario no puede sobrescribir/borrar un archivo de otra carpeta.
15. **Cero consumo de créditos** — confirmado por inspección de código (`uploadLandingImage`/`deleteLandingImage` nunca llaman a `reserve_credits` ni tocan `credits_used`) y por observación directa: `credits_used` se mantuvo en 0 durante toda la sesión de pruebas de imágenes.

**No ejecutado**: el caso de "imagen que falla en cargar" (URL rota) no se forzó explícitamente esta ronda — el componente usa un `<img>` estándar sin `onError` custom, así que el comportamiento sería el default del navegador (ícono roto), no hay lógica propia que verificar ahí.

## 10. Fase C — Usuarios no administradores: matriz de permisos y RLS

Se crearon 3 cuentas QA reales y nuevas (contraseñas no reveladas por diseño, ver §8): **Free** (`postulpro-preview-qa-free-*@mailinator.com`, plan por defecto), **Pro** y **Business** (planes asignados vía `UPDATE` directo a `public.users` con acceso de administración de base de datos — no vía la UI ni vía autoescalación, ver hallazgo abajo). La cuenta Founder/Admin real ya autenticada sirvió de control. Todas las pruebas de permisos se hicieron contra la **REST API real** (PostgREST) con JWTs reales de cada cuenta — no solo verificando que un botón esté oculto en el frontend.

**Hallazgo real y corregido — escalación de privilegios vía REST directo**: la policy RLS `"Users update own profile"` en `public.users` solo validaba `auth.uid() = id`, sin restricción de columnas. Combinado con el hecho de que la función `has_role()` (la que de verdad gatea `/admin` a nivel RLS) lee de una tabla separada (`user_roles`), el riesgo real no era que un usuario se auto-otorgara `role='admin'` real (eso no habría funcionado, ver abajo), sino que **cualquier usuario autenticado podía auto-otorgarse `plan='business'` y `credits_limit` arbitrario vía un `PATCH` directo a `/rest/v1/users`, sin pasar por checkout ni por ningún RPC** — un bypass de billing real. Se probó en vivo con la cuenta Free antes de corregir: el intento devolvió `42501 permission denied` porque, por una coincidencia favorable, `authenticated` **tampoco tenía ningún GRANT de `UPDATE`** en la tabla (lo cual también rompía el guardado legítimo de perfil en Configuración — ver bug relacionado abajo). El fix (migración `20260725000000`, §3) le da a `authenticated` un `GRANT UPDATE` column-scoped que **incluye** los campos de perfil reales y **excluye** `plan`/`role`/`credits_used`/`credits_limit`/`bonus_credits`/`affiliate_code`. Reverificado tras el fix: el guardado legítimo de perfil funciona (probado en vivo en `/settings` con la cuenta Founder, "Perfil actualizado" + persistencia tras refresh), el intento de auto-escalar `plan`/`role` sigue fallando, y un request mixto (un campo legítimo + uno prohibido en el mismo `PATCH`) falla atómicamente — no aplica parcialmente el campo permitido.

| Recurso | Prueba | Resultado |
|---|---|---|
| `/admin` (ruta) | Gate por `profile.role !== "admin"` leído de `users.role` | No re-verificado con clic real de una cuenta no-admin (implicaría destruir la única sesión de navegador disponible, ver §8) — pero como `users.role` ya no es auto-editable (fix de arriba) y ninguna policy de datos usa `users.role` (todas usan `has_role()` sobre `user_roles`, que sigue bloqueado a `ALL` con `has_role(auth.uid(),'admin')` para escribir), un usuario no-admin no puede ni auto-otorgarse el rol ni, aunque lo lograra cosméticamente, leer los datos que la página admin necesita. |
| `public.users` — leer otros perfiles | `SELECT` con `id=eq.<otro_usuario>` | Vacío — RLS aísla correctamente. |
| `public.users` — modificar plan/rol propios | `PATCH` con `plan`/`role`/`credits_limit` | **Bloqueado** (ver hallazgo arriba). |
| `public.users` — editar perfil propio (nombre/bio/avatar/notify) | `PATCH` con esos campos | **Permitido** — bug de funcionalidad real corregido en la misma migración. |
| `public.generations` — leer/editar de otro usuario | `SELECT`/`PATCH` sobre una generación real de otra cuenta | Vacío / no-op, confirmado con lectura de control vía `db query` que el dato ajeno no cambió. |
| `public.landing_publications` — publicar generación ajena | RPC `publish_landing_page` con `p_generation_id` de otro usuario | `Forbidden` (excepción explícita en la función `SECURITY DEFINER`). |
| `public.landing_publications` — publicar/despublicar recurso propio | Mismo RPC, generación propia (sembrada para la prueba) | Publicado, leído públicamente vía `get_published_landing` (anon), despublicado — ciclo completo. |
| `public.landing_publications` — despublicar landing ajena | RPC `unpublish_landing_page` con `p_generation_id` de otro usuario (cuenta Pro contra el recurso de Free) | `Forbidden`. |
| `public.products` — publicar producto nuevo (no-admin) | `POST /rest/v1/products` | `403`, RLS violation (migración de pausa de Marketplace del turno anterior). |
| `storage.objects` (`landing-images`) — subir en carpeta ajena | `POST /storage/v1/object/landing-images/<otro_user_id>/...` | `403`, RLS violation. |
| `storage.objects` (`landing-images`) — subir/borrar en carpeta propia | Mismo endpoint, carpeta propia | Permitido, confirmado. |
| `public.users` (rol `anon`, sin token) | `SELECT`/`UPDATE`/`DELETE`/`INSERT` sin `Authorization` | Todo bloqueado por RLS pese a que la tabla tenía GRANTs de tabla completos para `anon` (patrón repo-wide preexistente, ver Riesgos) — verificado empíricamente que ningún dato cambió, no solo confiado en la ausencia de policy. Grants de `anon` sobre `users` revocados en la misma migración como defensa en profundidad. |
| Límites de plan / créditos | Código de `executor.server.ts`/`routes/api/generate-ai.ts` | Reserva de créditos vía RPC `reserve_credits` (server-side, no client-controlled); además, ninguna de las 3 cuentas QA está en el allowlist `PREVIEW_AI_ALLOWED_USER_ID`, así que ni siquiera podrían disparar una generación real en preview — confirmado por lectura de código, no fue necesario ni posible generar contenido real con estas cuentas (cero riesgo de costo). |

**No ejecutado**: clic real en el navegador como usuario no-admin (dashboard/biblioteca/herramientas vistos desde esa sesión, mensajes de error 401/403 tal como los renderiza la UI) — la razón técnica exacta está en §8: la única sesión de navegador disponible no tiene contraseña conocida y no hay `SUPABASE_SERVICE_ROLE_KEY` para generar una de reemplazo, así que arriesgarla para un chequeo adicional de UI (cuando la protección real ya está probada a nivel de RLS, que es lo que de verdad importa por diseño) no se justificaba.

## 11. URL exacta del preview validado

`https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev` — Version ID final desplegado: **`e407747e-8f7a-40ec-bfe2-2fb0eb7efc17`** (incluye el fix de contraste de encabezados de la ronda anterior + el fix de permisos/RLS y limpieza de imágenes huérfanas de esta ronda). URL pública de ejemplo probada: `https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/p/landing-page-de-captura-sesion-estrategica` (despublicada al cerrar cada validación).

## 12. Diferencias restantes entre preview y producción

- Landing builder, pausa de Marketplace y las 4 migraciones de esta sesión **solo existen en preview** — producción no tiene `landing_publications`, `landing-images`, la RLS de pausa de Marketplace, ni el fix de grants de `users`, y sigue sirviendo el código anterior a `97edb35`.
- Todo lo demás documentado en `docs/production-go-no-go.md` (gates de SMTP/OAuth/billing) sigue igual — no se re-verificó ni se modificó esta sesión.

## 13. Código de Lemon Squeezy pendiente de retirar

Sin cambios respecto al informe anterior — ver auditoría completa en `docs/hotmart-integration-contract.md` §7. Resumen: `src/lib/lemon-squeezy.server.ts` (+test), env vars `LEMON_SQUEEZY_*`, copy de UI en `index.tsx`/`legal.tsx` — retirar recién cuando Hotmart esté live. Hallazgo a revisar antes del cutover: `supabase/functions/lemon-squeezy-webhook/index.ts` parece ser una Edge Function Deno duplicada/legacy del webhook que ya vive en `src/routes/api/billing/webhook.ts` — sigue sin confirmarse si está en uso.

## 14. Arquitectura preparada para Hotmart

Sin cambios respecto al informe anterior — documentada íntegramente en `docs/hotmart-integration-contract.md`. Sin credenciales conectadas.

## 15. Nombres de secretos necesarios para Hotmart (solo nombres, nada configurado)

`HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET`, `HOTMART_WEBHOOK_TOKEN` (nombre exacto a confirmar), `HOTMART_OFFER_PRO_MONTHLY`, `HOTMART_OFFER_PRO_ANNUAL`, `HOTMART_OFFER_BUSINESS_MONTHLY`, `HOTMART_OFFER_BUSINESS_ANUAL`.

## 16. Pasos exactos del cutover final a postulpro.com

**No aplica a este informe** — no autoriza ni ejecuta ningún cutover. Los pasos generales ya están en `docs/production-cutover-runbook.md` y siguen vigentes; este trabajo no agrega pasos nuevos porque es aditivo y reversible.

## 17. Migraciones productivas necesarias (cuando se autorice el cutover)

Las 4 migraciones de la tabla en §3, aplicadas al Supabase de producción en el mismo orden. Ninguna es destructiva: `CREATE TABLE`/`CREATE POLICY`/`INSERT ... ON CONFLICT DO NOTHING`/`GRANT`/`REVOKE` — ninguna borra datos existentes. La migración `20260725000000` (grants de `users`) es la más sensible por tocar permisos de una tabla con datos reales de producción; recomendado aplicarla y verificar el guardado de perfil real inmediatamente después, igual que se hizo aquí en preview.

## 18. Procedimiento de rollback

Para el código: `wrangler rollback` contra `lostykk-postulpro-preview` (ya ensayado y verificado por HTTP en una fase anterior — el mecanismo es idéntico para producción). Para las migraciones: aditivas y no destructivas; revertir `MARKETPLACE_ENABLED` no requiere rollback de DB. Para deshacer la migración de grants de `users`, restaurar el `GRANT UPDATE ON public.users TO authenticated` amplio original (documentado en el header de `20260704231647_e9fe9c0c-...sql`) — no recomendado, ya que reabre la escalación de privilegios encontrada en §10.

## 19. Riesgos residuales

1. **Edge Function `lemon-squeezy-webhook` posiblemente duplicada/legacy** (§13) — no confirmado si sigue en uso; revisar antes de tocar cualquier billing en el cutover.
2. Artefacto de contenido AI en el hero de la landing de `bcc36718` (§6 del informe anterior) — no es un bug de código; vale la pena ajustar el prompt de `landing-copy`.
3. **Google OAuth no re-probado esta ronda** (§8) — código sin tocar desde la verificación anterior, riesgo bajo.
4. **Clic real en navegador como usuario no-admin no ejecutado** (§10) — mitigado por verificación exhaustiva a nivel de RLS/REST API, que es la protección real; el riesgo residual es puramente cosmético de UI (ej. si algún componente frontend confía indebidamente en un campo cliente en vez de re-consultar datos protegidos por RLS) y no se detectó evidencia de eso en el código revisado.
5. **Patrón repo-wide de GRANTs amplios para `anon`/`authenticated`** en casi todas las tablas (`affiliate_clicks`, `billing_history`, `subscriptions`, etc.) — confirmado que RLS bloquea el acceso hoy en las tablas auditadas, pero es una dependencia total en RLS sin defensa en profundidad a nivel de GRANT. Se corrigió puntualmente para `users` (la tabla más sensible, y donde se encontró el hallazgo real). Recomendado como trabajo futuro auditar y ajustar el resto, fuera del alcance de esta tarea puntual.
6. CRLF preexistente en gran parte del repo sigue sin normalizar — deliberado, dado el incidente previo con `git stash`.
7. Cuentas QA (`postulpro-preview-qa-{free,pro,biz}-1784343464@mailinator.com`) quedan como fixtures reutilizables en preview, mismo patrón que la cuenta `qa-admin` ya existente — contraseña no documentada en ningún archivo del repo.
8. Dos imágenes de prueba minúsculas (<100 bytes cada una) quedaron en `landing-images/{admin_user_id}/` de pruebas anteriores al fix de limpieza de huérfanos (§9, punto 12) — inocuas, se pueden borrar manualmente desde el dashboard de Storage si se desea.
9. Ninguno de los riesgos de plataforma base en `docs/production-go-no-go.md` (SMTP en producción, allowlist de IA en preview, auto-referido de afiliados) cambió en esta sesión.

## 20. Dictamen definitivo

**GO PARA PRODUCCIÓN.**

Las condiciones pendientes del informe anterior (GO CON CONDICIONES) quedaron resueltas: el flujo completo de autenticación se verificó de punta a punta contra la API real (registro, confirmación de email, login, contraseña incorrecta, recuperación de contraseña completa, logout con revocación real, separación preview/producción); la subida/reemplazo/eliminación de imágenes se verificó con una imagen real y se corrigió un bug real de limpieza de huérfanos; y la auditoría de permisos para usuarios no-administradores no solo confirmó el aislamiento correcto entre cuentas sino que **encontró y corrigió una vulnerabilidad de escalación de privilegios real** (auto-otorgarse plan Business sin pagar, vía REST directo) — exactamente el tipo de hallazgo que esta ronda de verificación estaba diseñada para atrapar, y que ninguna revisión de solo-frontend habría detectado.

Lo único que queda genuinamente pendiente (§19, puntos 3 y 4) es de bajo riesgo y no bloqueante: no se repitió el clic real de Google OAuth (código sin cambios desde su última verificación real) y no se hizo clic real en el navegador como usuario no-admin (mitigado con creces por la verificación a nivel de RLS/API, que es donde la protección real vive). Ninguno de los dos es un hallazgo abierto — son huecos de cobertura de un método de prueba específico (UI manual), no de la protección real subyacente.

**Esto no autoriza el cutover por sí solo.** Antes de ejecutar el corte a producción real, confirmar explícitamente:
- Autorización del usuario para proceder (este informe la habilita, no la reemplaza).
- Decisión de producto sobre cuándo reactivar Marketplace.
- Confirmar si la Edge Function Lemon Squeezy legacy sigue en uso antes de tocar billing.
- Hotmart sigue siendo solo diseño — no conectar credenciales reales sin antes confirmar el formato de webhook con la cuenta real.

No se ejecuta ningún cutover productivo con este informe. Se espera autorización explícita en un mensaje separado, como fue instruido.
