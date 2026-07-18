# GO / NO-GO — Landing builder, pausa de Marketplace, preparación Hotmart

Estado: **GO CON CONDICIONES** para promover este trabajo a producción cuando se autorice el cutover general. Ver `docs/production-go-no-go.md` para el veredicto de la plataforma base (auth, SMTP, OAuth, storage, CSP) — ese documento sigue vigente y no fue re-verificado en esta sesión porque nada de este trabajo tocó esas áreas. Este informe cubre exclusivamente lo pedido en esta tarea: constructor de landing pages, pausa de Marketplace, y preparación de arquitectura Hotmart. **No se ejecutó ningún cutover productivo** — deploy solo a `lostykk-postulpro-preview`.

## 1. Estado real del repositorio

- Rama: `claude/postulpro-product-adn`, sincronizada con `origin` (push ya realizado).
- Commit final: `97edb35` — `feat(landing): section-based visual builder, publish preview, Marketplace pause, Hotmart-ready billing docs` (53 archivos, +5869/-808).
- Commit anterior (ya en `main`-bound history de esta rama, no tocado): `a091b39`.
- `stash@{0}` sigue presente desde un incidente de recuperación de una sesión anterior — verificado esta sesión como idéntico al estado ya commiteado (byte a byte, confirmado por `git diff stash@{0}` vacío en una verificación previa). Es un respaldo redundante e inofensivo; no se descartó porque una aprobación anterior del usuario cubrió solo el método de recuperación por `checkout`, no el `drop` del stash.
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

`npx supabase migration list --linked` confirma `local == remote` en las 31 migraciones — cero drift.

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

## 7. Resultados de tests, typecheck, lint y build

- `tsc --noEmit`: limpio.
- `vitest run`: **296/296 tests pasando**, 33 archivos (incluye 12 tests de `schema.ts`, 7 de `export.ts`, 5 de `images.ts`, más los ya existentes de PDF/rich-content/deliverables).
- `vite build`: exitoso, sin errores; regeneró `routeTree.gen.ts` incluyendo `/p/$slug`.
- Lint: `eslint` sobre los archivos tocados no arrojó errores de reglas reales — el único ruido son ~1700 errores `prettier/prettier` de fin de línea CRLF que son **preexistentes en todo el repo** (confirmado corriendo lint sobre `settings.tsx`, un archivo no tocado esta sesión, con el mismo tipo de error), no algo introducido ahora. No se normalizó CRLF→LF de forma masiva porque un intento similar en una fase anterior de esta misma sesión causó un incidente real de `git stash pop` — se dejó fuera de alcance deliberadamente.
- Escaneo de bundle: `.output/public/assets` no contiene ningún patrón de secreto (`sk_live_`, `sk_test_`, `whsec_`, `service_role`, nombres de env vars de Lemon Squeezy/Resend/billing) — solo la URL pública de Supabase y la clave `sb_publishable_*` (segura de exponer por diseño). `.output/server` tampoco contiene patrones de secretos ni bloques PEM.
- Escaneo de secretos en código fuente: únicas coincidencias de `whsec_` son fixtures de test (`"whsec_test"`, `"whsec_test_secret"`), no secretos reales.

## 8. Pruebas visuales realmente ejecutadas (navegador autenticado real, sesión ya logueada como Miguel/Founder/Business)

Ejecutadas y confirmadas:
1. Sesión ya autenticada (no se probó login/logout esta sesión — cubierto en fase anterior, ver `docs/production-go-no-go.md` gate #1).
2. Dashboard — cargó correctamente, sin Marketplace.
3. Navegación a proyecto real `bcc36718-3e2c-429e-80bc-d5b21ad4de5c` — 5 entregables, 80% completado.
4. Apertura del deliverable "Landing page de captura" → renderiza vía `LandingBuilder`.
5. Modo Pantalla completa del builder.
6. Cambio entre los 3 temas (Authority Dark, Conversion Light, Bold Brand) — contraste correcto tras el fix.
7. Preview desktop/tablet/mobile — confirmado el ancho de viewport cambia y el layout responde (grid a columna única en mobile).
8. Panel SEO — campos poblados con datos reales generados por IA.
9. Guardado + refresh completo de página — cambio de tema persistió, badge "Editado" + "Restaurar versión generada" presentes.
10. Publicación en preview → URL pública real `/p/landing-page-de-captura-sesion-estrategica` cargó correctamente con el tema y contenido correctos, título de pestaña tomado del SEO title.
11. Despublicación → toast de confirmación, acción reversible confirmada.
12. Ausencia de Marketplace: nav desktop, dashboard (stat + quick action), admin (stat + sección Productos), landing pública (`find` tool: cero menciones), `/legal` (cero menciones), redirect de `/marketplace` a `/dashboard` por URL directa.
13. Rol Founder/Admin/Business: confirmado por la UI (badge "Founder", acceso a `/admin`, plan "BUSINESS" visible) — no se probó explícitamente un usuario `role=user` sin admin esta sesión.

**No ejecutadas en esta sesión** (fuera del tiempo disponible, no bloqueantes para el veredicto de esta fase):
- Login/logout completo, "Construir con IA" de punta a punta generando un proyecto nuevo, modo guiado vs. automático, subida real de un archivo de imagen (se vio el placeholder y el botón, no se completó una subida real), click-through de descarga HTML/JSON, copiar copy al portapapeles, estados de error/reintento forzados, validación explícita con un usuario `role=user` no-admin.

## 9. URL exacta del preview validado

`https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev` — Version ID final desplegado: **`6d1243bb-dbf6-4d30-83f6-709bf7864a61`** (incluye el fix de contraste de encabezados). URL pública de ejemplo probada: `https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev/p/landing-page-de-captura-sesion-estrategica` (despublicada al cerrar la validación).

## 10. Diferencias restantes entre preview y producción

- Landing builder, pausa de Marketplace y las 3 migraciones de esta sesión **solo existen en preview** — producción no tiene `landing_publications`, `landing-images`, ni la RLS de pausa de Marketplace, y sigue sirviendo el código anterior a `97edb35`.
- Todo lo demás documentado en `docs/production-go-no-go.md` (gates de auth/SMTP/OAuth/billing) sigue igual — no se re-verificó ni se modificó esta sesión.

## 11. Código de Lemon Squeezy pendiente de retirar

Ver auditoría completa en `docs/hotmart-integration-contract.md` §7. Resumen: `src/lib/lemon-squeezy.server.ts` (+test), env vars `LEMON_SQUEEZY_*`, copy de UI en `index.tsx`/`legal.tsx` — retirar recién cuando Hotmart esté live, no antes (Lemon Squeezy sigue siendo el proveedor real en preview hoy). Hallazgo a revisar antes del cutover: `supabase/functions/lemon-squeezy-webhook/index.ts` parece ser una Edge Function Deno duplicada/legacy del mismo webhook que ya vive en `src/routes/api/billing/webhook.ts` — no se tocó ni se confirmó si sigue en uso, marcado como riesgo pendiente (§18).

## 12. Arquitectura preparada para Hotmart

Documentada íntegramente en `docs/hotmart-integration-contract.md`: mapeo de los 4 planes reales (Pro/Business × Mensual/Anual) a `plan`/`billing_interval`, contrato lógico de eventos (compra aprobada, renovación, cancelación, reembolso, chargeback, vencimiento/morosidad) mapeado a las acciones equivalentes de Lemon Squeezy ya implementadas, diseño de idempotencia (ledger de eventos + RPC transaccional, mismo patrón ya probado), sin conectar ninguna credencial real. **No se construyó ninguna integración basada en suposiciones de payload** — el formato exacto de webhook de Hotmart queda explícitamente marcado como pendiente de confirmar con acceso real a la cuenta Hotmart antes de escribir el cliente HTTP.

## 13. Nombres de secretos necesarios para Hotmart (solo nombres, nada configurado)

`HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET`, `HOTMART_WEBHOOK_TOKEN` (nombre exacto a confirmar según el mecanismo real de Hotmart), `HOTMART_OFFER_PRO_MONTHLY`, `HOTMART_OFFER_PRO_ANNUAL`, `HOTMART_OFFER_BUSINESS_MONTHLY`, `HOTMART_OFFER_BUSINESS_ANUAL`.

## 14. Pasos exactos del cutover final a postulpro.com

**No aplica a esta fase** — este informe no autoriza ni ejecuta ningún cutover. Los pasos generales de cutover (Site URL, Redirect URLs, secrets de producción, DNS) ya están documentados en `docs/production-cutover-runbook.md` de una fase anterior y siguen vigentes; este trabajo no agrega pasos nuevos al runbook porque nada de lo hecho aquí requiere tocar producción — es aditivo (nuevas tablas/rutas) y reversible (flag de Marketplace).

## 15. Migraciones productivas necesarias (cuando se autorice el cutover)

Las mismas 3 migraciones de la tabla en §3, aplicadas al Supabase de producción en el mismo orden. Ninguna es destructiva (todas son `CREATE TABLE`/`CREATE POLICY`/`INSERT ... ON CONFLICT DO NOTHING`), ninguna borra datos existentes.

## 16. Procedimiento de rollback

Para el código: `wrangler rollback` contra `lostykk-postulpro-preview` (ya ensayado y verificado por HTTP en una fase anterior, ver `docs/cutover-rehearsal-report.md` — el mecanismo es idéntico para producción). Para las migraciones: son aditivas y no destructivas; revertir el flag `MARKETPLACE_ENABLED` no requiere rollback de DB. Si se necesitara deshacer la migración de pausa de RLS, restaurar la policy original `"Seller manage own products"` documentada en el header de `20260724000000_marketplace_pause_rls.sql`.

## 17. Riesgos pendientes

1. **Edge Function `lemon-squeezy-webhook` posiblemente duplicada/legacy** (§11) — no confirmado si sigue en uso; revisar antes de tocar cualquier billing en el cutover.
2. Artefacto de contenido AI en el hero de la landing de `bcc36718` (§6) — no es un bug de código, pero vale la pena ajustar el prompt de `landing-copy` para que el modelo no escriba URLs de ejemplo como texto visible.
3. Fase 7 de validación visual quedó parcial (§8) — login/logout, flujo completo de generación de IA, subida real de imagen, y validación con rol `user` no-admin no se ejecutaron esta sesión.
4. CRLF preexistente en gran parte del repo sigue sin normalizar (§7) — deliberado, dado el incidente previo con `git stash`.
5. Ninguno de los riesgos de plataforma base documentados en `docs/production-go-no-go.md` (SMTP en producción, allowlist de IA en preview, auto-referido de afiliados) cambió en esta sesión.

## 18. Dictamen

**GO CON CONDICIONES.**

Lo nuevo de esta sesión (landing builder, pausa de Marketplace, documentación Hotmart) está funcionalmente completo, verificado por tests automatizados (296/296) y por navegación real contra datos reales de producción-preview, con un bug real de accesibilidad encontrado y corregido durante la propia validación. Es seguro de mantener desplegado en preview indefinidamente — no toca producción, es aditivo y reversible.

Condiciones antes de considerarlo parte de un cutover real:
- Completar la Fase 7 de validación visual pendiente (§8, punto 3).
- Confirmar si la Edge Function Lemon Squeezy legacy sigue en uso (§17, punto 1) antes de tocar billing en el cutover.
- Decisión de producto sobre cuándo reactivar Marketplace (`MARKETPLACE_ENABLED = true`) — hoy queda deliberadamente apagado.
- Hotmart sigue siendo solo diseño — no ejecutar el cutover de billing sin antes confirmar el formato real de webhook con acceso a la cuenta Hotmart.

No se ejecuta ningún cutover productivo con este informe. Se espera autorización explícita en un mensaje separado, como fue instruido.
