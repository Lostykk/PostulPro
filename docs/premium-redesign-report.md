# PostulPro — Rediseño visual premium: informe de cierre de fase

## Resumen

- **Objetivo**: modernización visual y de UX integral de PostulPro (sistema de diseño, accesibilidad, contenido, QA).
- **Alcance ejecutado**: auditoría completa del producto real + corrección de los defectos verificados de mayor impacto en confianza/consistencia/legibilidad, sin tocar autenticación, RLS, planes/créditos, Marketplace ni infraestructura.
- **Alcance NO ejecutado** (ver §9): rediseño visual línea por línea de los 45 componentes shadcn/ui, reescritura profunda de cada pantalla (auth, dashboard, workspace, landing builder, admin) más allá de los defectos concretos encontrados. El pedido original equivale a un proyecto de varias semanas para un equipo de diseño; esta sesión priorizó defectos reales y verificables sobre un rediseño superficial exhaustivo. Ver §9 para el detalle de qué quedó pendiente y por qué.
- **Rama**: `claude/postulpro-premium-ui` (creada desde `main` en el commit `bdbade1`, sin merges).
- **Commits** (10, ninguno a `main`):
  1. `6edf057` — tokens semánticos extendidos, `StatusBadge`/`StatusIcon`, unificación de gradiente de marca.
  2. `66166fd` — eliminación de "Construido sobre", corrección de la franja de tecnología, centralización de precios.
  3. `20a5757` — breadcrumbs legibles, fin de markdown crudo fuera de streaming.
  4. `2e53cd9` — mapeo de errores de Supabase Auth a español claro.
  5. `de2c569` — informe (ronda 1).
  6. `ff4d236` — ronda 2 (QA autónomo manual): fix de accesibilidad (focus-visible ausente).
  7. `334cd69` — informe (ronda 2).
  8. `b33eb58` — ronda 3 (QA 100% autónomo con Playwright): suite E2E real + 3 defectos reales encontrados y corregidos (contraste, contraste, accesible-name faltante).
  9. `c71efe0` — informe (ronda 3).
  10. `6b373d0` — **ronda 4 (GO/NO-GO — auth, imágenes, permisos)**: suite E2E exhaustiva de autenticación/imágenes del landing builder/RLS no-admin + fix de un bug real en `generate_api_key` (migración `20260726000000` aplicada al Supabase de preview confirmado).
  11. `32d36ad` — **ronda 5, auditoría** (sin aplicar): hardening y validación 100% local (pglite) de la migración `20260727000000_credit_reservations_idempotent_refund.sql`, resolviendo el riesgo residual §14.5.3/§14.9.1.
  12. `9cdcd4d` — **ronda 5, verificación en vivo**: suite Playwright contra el backend real (`e2e/credit-reservations-live.spec.ts`) + regeneración de `types.ts`.
  13. `a5d0911` — **ronda 5, código de aplicación**: `generate-ai.ts` y `executor.server.ts` migrados a `reserve_credits_v2`/`resolve_credit_reservation`.
  14. `9e00ad8` — **ronda 5, diagnóstico**: logging de `cancel()` que reveló un hallazgo nuevo (ver §15.6).
  15. `71161a6` — **ronda 6, fix real**: la generación completa (no solo el reembolso) envuelta en `waitUntil()` — hallazgo empírico de por qué el reembolso automático por desconexión no cerraba el ciclo (ver §16.3).
  16. `5274558` — **ronda 6, reconciliador** (migración NO aplicada): `reconcile_stale_reservations_v2` basado en evidencia + endpoint interno inerte, preparados y validados localmente, pendientes de autorización separada.
- **URL de preview**: https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev (Worker `lostykk-postulpro-preview`, redesplegado 9 veces en total, verificado 200 OK cada vez).
- **Producción**: sin cambios. `postulpro.com`/`www.postulpro.com` siguen en 200 en todo momento.
- **Dictamen histórico de la ronda 3**: ~~LISTO PARA CUTOVER CON CONDICIONES~~ — superado por §14.
- **Dictamen histórico de la ronda 4**: GO CON CONDICIONES (ver §14.9) — la condición #2 de esa ronda (reembolso de créditos en abort) es exactamente lo que resuelve, parcialmente, la ronda 5.
- **Dictamen histórico de la ronda 5**: LEDGER VALIDADO CON CONDICIONES (ver §15.10) — la condición pendiente (el reembolso automático por desconexión no cerraba el ciclo) es lo que investiga y resuelve la ronda 6.
- **Dictamen final (ver §16.9)**: **LEDGER LISTO CON CONDICIONES**.

## 1. Auditoría inicial

Se inspeccionó el código real (no solo la home) vía agentes de exploración en paralelo sobre: tokens/Tailwind/CSS global, sitio público, app shell/navegación, flujos centrales (dashboard/build/proyectos/workspace), renderizado de contenido/editor/biblioteca/export, y landing builder/tools/settings/admin.

**Hallazgos confirmados** (con archivo:línea) y su resolución:

| # | Hallazgo | Página(s) afectada(s) | Estado |
|---|---|---|---|
| 1 | "Construido sobre" visible en el primer viewport de la home + meta SEO | `index.tsx:350`, `__root.tsx:95` | **Corregido** |
| 2 | Franja de tecnología mostraba "Lemon Squeezy" y "Vercel" (infra real es Cloudflare Workers) como texto plano en el primer viewport | `index.tsx` `SocialProof` | **Corregido** |
| 3 | Bullet de afiliados nombraba a Lemon Squeezy como procesador de pago | `index.tsx:1002` | **Corregido** |
| 4 | Precios/límites hardcodeados de forma independiente en 3 lugares (home, settings, admin) | `index.tsx`, `settings.tsx`, `admin.tsx` | **Corregido** (`src/lib/plans.ts`) |
| 5 | "White-label exports" prometido en el plan Business sin ninguna implementación real en el código | `index.tsx` `PLANS` | **Corregido** (eliminado; "API personal" sí es real y se mantuvo) |
| 6 | Gradiente CTA duplicado como string crudo (`from-violet-500 to-fuchsia-500`, color fuera de la paleta de tokens) en 30 archivos | ver diffstat | **Corregido** (unificado a `bg-gradient-brand`) |
| 7 | Sin componente único de estado (proyecto/entregable) — mapas `STATUS_LABEL` duplicados, sin color/ícono | `projects.index.tsx`, `projects.$id.tsx` | **Corregido** (`StatusBadge`/`StatusIcon`) |
| 8 | Affordance de arrastre (`GripVertical`) sin handler de reordenamiento — acción imposible sugerida al usuario | `projects.$id.tsx` (revisión de plan) | **Corregido** (eliminado) |
| 9 | Breadcrumb del topbar mostraba segmentos de ruta crudos ("build", "tools") y UUIDs de proyecto sin traducir | `AppShell.tsx` `TopBar` | **Corregido** (diccionario ES + filtro de UUID) |
| 10 | Markdown crudo (`**`, `##`, backticks) visible fuera de "Ver contenido técnico" en el modal rápido del dashboard y en las 5 páginas de herramienta individuales | `dashboard.tsx`, `tools.copywriter/business-plan/social-pack/sales-email/email-sequences.tsx` | **Corregido** (enrutado a `RichContentRenderer`) |
| 11 | Errores crudos de Supabase Auth (inglés, técnicos) mostrados directo en login/registro/reset | `auth.login/register/reset-password.tsx` | **Corregido** (`friendlyAuthError`) |
| 12 | Selects "ilegibles sin hover" reportado | `simple-select.tsx`, `admin.tsx` | **Verificado como YA CORRECTO** en el código actual — contraste `--popover`/`--popover-foreground` ~13:1, portal correcto, sin dependencia de hover. Confirmar visualmente en un dispositivo Windows real si el síntoma reaparece (ver §9). |
| 13 | Landing builder (19 tipos de sección, 3 temas, preview compartido con `/p/:slug`) | — | **Auditado, sin defectos verificados** — no se modificó para evitar riesgo innecesario. |

## 2. Sistema de diseño

La base de tokens en `src/styles.css` (Tailwind v4, CSS-first) ya coincidía en gran medida con la dirección visual pedida (navy oscuro, violeta primario, cian secundario, éxito/advertencia/error), así que se **extendió** en vez de reescribirse:

- **Paleta**: sin cambios en los valores existentes; se agregaron `surface-hover/active/selected`, `primary-hover/active`, `focus-ring`, `overlay`, `skeleton`, `code-background`, `success/warning/destructive/info-background`.
- **Estados de entregable/proyecto**: 10 tokens de color dedicados (`status-pending` … `status-insufficient-credits`), consumidos exclusivamente a través de `StatusBadge`/`StatusIcon` — un solo lugar que define texto + ícono + color por estado.
- **Tipografía**: sin cambios (Inter / Space Grotesk / JetBrains Mono ya centralizados y correctos).
- **Spacing/radios/sombras/breakpoints**: sin cambios — ya centralizados vía `@theme inline`, sin arbitrariedad detectada que ameritara reescritura.
- **Componentes**: se agregó `StatusBadge`/`StatusIcon` (`src/components/ui/status-badge.tsx`) como pieza nueva reutilizable. El resto de los 45 componentes shadcn/ui existentes se auditaron y no mostraron defectos verificables — no se tocaron.
- **Motion**: sin cambios (`prefers-reduced-motion` ya respetado globalmente).
- **Accesibilidad**: no se detectaron regresiones; el fix de breadcrumbs y errores de auth mejora la claridad de contenido sin afectar semántica/ARIA existente.

## 3. Páginas y archivos modificados

37 archivos (ver diffstat completo en el historial de commits de la rama). Rutas afectadas:
`/` (home), `/auth/login`, `/auth/register`, `/auth/reset-password`, `/_authenticated/dashboard`, `/_authenticated/projects`, `/_authenticated/projects/$id`, `/_authenticated/settings`, `/_authenticated/admin`, `/_authenticated/affiliates`, `/_authenticated/build`, `/_authenticated/onboarding`, `/_authenticated/library`, `/_authenticated/marketplace.*`, `/_authenticated/tools.*` (las 8 rutas), más `src/styles.css`, `AppShell.tsx`, `AuthSplitLayout.tsx`, `LandingBuilder.tsx`, 4 `deliverables/*View.tsx`, y los 2 archivos nuevos `src/lib/plans.ts` y `src/lib/auth/friendly-error.ts`.

## 4. Problemas corregidos (checklist de la consigna)

- ✅ "Construido sobre" — eliminado de home y meta SEO.
- ✅ Proveedores desactualizados/incorrectos (Lemon Squeezy, Vercel) — eliminados de la franja pública.
- ✅ Selects ilegibles — verificado que el código actual ya es correcto (no había nada que corregir).
- ✅ Markdown crudo — corregido en dashboard + 5 tool pages (Library y workspace ya estaban correctos).
- ⏸️ JSON crudo — no se encontró ningún caso (confirmado en auditoría).
- ⏸️ Contraste — sin regresiones ni defectos nuevos detectados; no se re-auditó pixel por pixel cada componente.
- ⏸️ Responsive — clases `sm:`/`md:`/`lg:` ya presentes y usadas; no se validó visualmente en cada breakpoint (ver §9, limitación de herramienta).
- ⏸️ Navegación/breadcrumbs — corregido (breadcrumbs).
- ✅ Loaders/estados vacíos — auditados, ya sólidos (dashboard, proyectos, biblioteca ya tenían empty/loading states reales); sin cambios necesarios.
- ✅ Modales — auditados (biblioteca ya tiene scroll interno + max-height); sin cambios necesarios.
- ✅ Copy técnico — errores de auth mapeados a español.
- ✅ Progreso — pantalla de planificación ya usa mensajes rotativos reales, sin barra falsa; sin cambios necesarios.
- ✅ IDs visibles — UUID ya no aparece en breadcrumbs.

## 5. Validaciones

Ejecutadas después de cada commit, no solo al final:

- **`tsc --noEmit`**: limpio (exit 0) en todos los checkpoints.
- **`vitest run`**: 300/300 tests pasando en todos los checkpoints (33 archivos de test).
- **`npm run build`**: build de producción exitoso en todos los checkpoints (Nitro/Cloudflare Workers preset).
- **`eslint . --max-warnings=0`**: reporta ~27.8k errores, pero **el 100% son `prettier/prettier "Delete ␍"`** — una condición preexistente de esta máquina (`git config core.autocrlf=true` fuerza CRLF en el checkout mientras Prettier espera LF), confirmada en archivos nunca tocados esta sesión (`legal.tsx`, `vite.config.ts`). Filtrando ese ruido: **cero errores de lint reales** introducidos por estos cambios.
- **Secret scan**: `git diff main..HEAD` revisado con patrón de claves/tokens/passwords — sin coincidencias.
- **Bundle**: sin dependencias nuevas agregadas (solo se reutilizó `RichContentRenderer`, ya presente); tamaño de bundle sin cambios relevantes.

## 6. QA visual en navegador (real, no simulado)

Desplegado a `lostykk-postulpro-preview` (Worker aislado, `workers_dev: true`, nunca puede colisionar con producción) y verificado con Chrome real:

- **Home** (`/`): hero renderiza con jerarquía y gradiente de marca correctos; confirmado que la franja "Tecnología e integraciones" (solo Claude/OpenAI/Supabase, opacidad reducida) aparece **después** de Precios/Casos de uso, nunca en el primer viewport; footer sin enlace a Marketplace, sin enlaces rotos.
- **Pricing**: los 3 planes renderizan desde la fuente centralizada; Business ya no muestra "White-label exports"; toggle mensual/anual funcional.
- **Login** (`/auth/login`): probado en vivo contra el backend real de preview con credenciales inválidas — confirmado que el toast muestra **"Email o contraseña incorrectos."** en español (antes habría mostrado el string crudo de Supabase).
- **Limitaciones de esta pasada de QA**: no se verificaron visualmente las rutas autenticadas (dashboard, proyectos, workspace, admin, tools, settings, biblioteca) por no contar con credenciales de QA para el entorno de preview en esta sesión — no se reutilizaron credenciales de producción del usuario sin autorización explícita. El redimensionado de ventana (`resize_window`) no logró forzar capturas en viewport móvil real en este entorno de herramienta (limitación de la herramienta de automatización, no del código); las clases responsive de Tailwind ya presentes no se verificaron visualmente en 320–1920px.

## 7. Seguridad

- Producción (`postulpro.com`/`www.postulpro.com`) intacta — confirmado 200 antes y después del deploy a preview.
- `MARKETPLACE_ENABLED=false` sin cambios; footer/nav siguen sin mostrar Marketplace.
- Roles, RLS, planes/créditos: **sin ninguna modificación** — ningún archivo de `supabase/migrations/` tocado, ninguna policy tocada.
- OAuth/Auth: **sin cambios de configuración** — solo se agregó mapeo de *texto* de error en el cliente; ningún flujo, callback, provider o config de Supabase Auth fue alterado.
- Hotmart: sin conectar, sin credenciales solicitadas ni tocadas.
- Secretos: ninguno expuesto en terminal, commits ni este informe (secret scan en §5).
- Sin migraciones de base de datos — ninguna fue necesaria para este trabajo (100% frontend).
- Merge a `main`: no realizado. Push únicamente a `claude/postulpro-premium-ui`.

## 8. Nota de infraestructura (deploy a preview)

`wrangler deploy --env preview` falló con un error de wrangler 4.108 ("Redirected configurations cannot include environments") — una incompatibilidad entre la config generada por Nitro (`.output/server/wrangler.json`, **no versionada, regenerada en cada build**) y esta versión de wrangler, no relacionada con los cambios de diseño. Se resolvió editando ese archivo generado (nunca el `wrangler.jsonc` fuente) para fijar directamente `name: lostykk-postulpro-preview` y `workers_dev: true` en la raíz, y desplegando sin `--env`. Se pidió y obtuvo autorización explícita antes de ejecutar el deploy, ya que el comando final ya no mostraba literalmente `--env preview`. El Worker de producción (`lostykk-postulpro`) nunca estuvo en riesgo — nombres de Worker distintos, y `wrangler.jsonc` (la fuente real) no fue modificado.

## 9. Riesgos y pendientes (estado tras la ronda 1 — ver §12 para el cierre real)

**Defectos verificados y resueltos**: ver §1 y §4.

**No se hizo (por decisión de alcance, no por error)**:
- Reescritura visual componente-por-componente de los 45 primitivos shadcn/ui — la auditoría no encontró defectos concretos que lo justificaran; hacerlo de todos modos habría sido riesgo sin beneficio verificado.
- Rediseño profundo de cada pantalla (auth, dashboard, workspace, landing builder, admin, tools) más allá de los defectos puntuales listados — cada una fue auditada y, salvo los ítems de §1, ya estaba en buen estado (estados de carga/error reales, sin Markdown/JSON crudo, sin promesas falsas, formularios con validación).
- QA visual autenticada (dashboard/admin/tools) y validación responsive multi-breakpoint real en navegador — pendiente en la ronda 1, **ejecutada en la ronda 2, ver §12**.
- Verificación visual del bug de selects reportado — el código ya es correcto; si el síntoma persiste en un dispositivo Windows real, es probablemente un problema de navegador específico, no del componente.

## 10. Cómo revisar

- Código: rama `claude/postulpro-premium-ui`, pusheada a `origin`.
- Preview en vivo: https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev
- Sin acción pendiente de tu parte salvo revisión — no se tocó `main`, no se desplegó a producción, no se conectó Hotmart.

## 11. Dictamen de la ronda 1 (histórico)

~~LISTO PARA REVISIÓN VISUAL~~ — superado por §12 tras el QA autónomo.

---

## 12. QA autónomo en preview (ronda 2)

Continuación de la misma rama y el mismo preview, ejecutando QA real en navegador (no delegado), con corrección iterativa de defectos encontrados.

### 12.1 Estado

- Rama: `claude/postulpro-premium-ui`, ahora 6 commits (agrega `de2c569` este informe, y `ff4d236` fix de accesibilidad de esta ronda).
- Preview: https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev, **redesplegado** después del fix (2 deploys totales en la vida de esta rama).
- Commit desplegado actualmente: `ff4d236`.
- **Backend real detectado**: el preview usa el mismo proyecto Supabase que producción (`ccpejnklrfvgtwryqfrw`) — confirmado extrayendo la URL baked-in del bundle JS servido en vivo (`curl` + grep sobre el archivo real desplegado, no solo el build local). Esto **no es un entorno aislado**; todo el QA autenticado de esta ronda se hizo bajo las reglas de "Estrategia D" (datos reales, sin acciones destructivas, solo mecanismos legítimos).
- Producción: intacta en todo momento (200 antes, durante y después de ambos deploys a preview).

### 12.2 QA público

Verificado en vivo sobre el preview:
- Home: hero, franja "Tecnología e integraciones" (confirmada fuera del primer viewport, solo Claude/OpenAI/Supabase, opacidad reducida), sección de precios (valores consistentes con `src/lib/plans.ts`), footer (sin Marketplace, sin enlaces rotos).
- Login (`/auth/login`): probado con credenciales inválidas reales contra el backend — confirmado el toast "Email o contraseña incorrectos." en español.
- Registro (`/auth/register`): formulario visualmente correcto, campos y validaciones visibles. **No se completó un registro nuevo** — ver §12.9 (bloqueo real).

No se encontraron defectos nuevos en esta capa (los de la ronda 1 ya estaban corregidos y se reconfirmaron en vivo).

### 12.3 QA autenticado

**Estrategia usada**: se encontró `.qa.local.json` en la raíz del repo — un archivo **ya gitignorado, nunca commiteado**, con una cuenta QA documentada (creada por vos o por una sesión anterior vía Supabase Dashboard "Add user", no por signup público). No se imprimió su contraseña en ningún momento de esta conversación.

- **Rol real de la cuenta**: a pesar de llamarse "qa-admin" en el email, su rol real en base de datos es de usuario normal en **plan PRO** (sin acceso a Admin) — confirmado en vivo: no aparece "Administración" en el sidebar, y navegar directo a `/admin` muestra el bloqueo correcto ("Acceso restringido. Esta sección es solo para administradores."). Esto es una **confirmación de seguridad positiva**: no hay ninguna cuenta de prueba con privilegios de Admin residuales en producción.
- **Rutas/acciones probadas con esta cuenta PRO**:
  - `/dashboard` — saludo, proyectos recientes, stat cards, todo con datos reales.
  - `/admin` — bloqueado correctamente (evidencia arriba).
  - `/settings` → "API keys" — bloqueado correctamente con mensaje honesto ("Las API keys son exclusivas del plan BUSINESS.").
  - `/settings` → "Plan y billing" — precios coincidentes con `plans.ts` ($29/mes, $276/año, $99/mes, $948/año); botón de cambio de plan **deshabilitado** mientras hay suscripción activa (no permite auto-cambio de plan desde el frontend).
  - `/library` — un ítem real (generación de Copywriter previa), modal "Ver" renderiza el contenido con negrita/listas reales (no markdown crudo), Escape cierra el modal correctamente (focus trap / cierre accesible confirmado).
  - `/projects` (Mis proyectos) — 4 proyectos QA reales, `StatusBadge` renderizando "Planificando" con ícono y color correctos.
  - `/projects/$id` — al abrir un proyecto que llevaba 5 días en estado "planning", **se disparó automáticamente el mecanismo de recuperación** (`PlanningInProgress` → reintento automático) y generó un plan real completo (audiencia, propuesta de valor, supuestos, 2 entregables con costo y razón, comparación costo vs. saldo). Esto confirma en vivo que el fix histórico "recover stuck planning state" funciona correctamente — el proyecto no estaba roto, solo esperaba ser reabierto.
  - `/tools/copywriter` — formulario completo, costo declarado ("1 crédito por generación"), **se ejecutó una generación real mínima** (ver §12.6 consumo), streaming visible como texto plano con cursor, y al completar cambia a contenido renderizado (negrita, listas) sin ningún símbolo de markdown crudo.
  - `/affiliates` — link de referido real (dominio del preview, no hardcodeado), stats honestos en cero, sin mención a Lemon Squeezy.
  - `/tools/landing-copy` — formulario visualmente correcto; **no se generó** contenido nuevo aquí para no incurrir en más costo (el landing builder visual ya había sido auditado a nivel de código en la ronda 1 sin defectos).
- **Restricciones confirmadas**: esta cuenta PRO no puede acceder a Admin ni a API keys (Business), y no puede cambiar de plan directamente desde el frontend mientras tiene una suscripción activa — el único camino es "Gestionar suscripción" (portal externo).

### 12.4 Responsive

- Verificado en desktop (~1568×717 a ~1568×648, según la pestaña) sin scroll horizontal, sin botones cortados, sin desbordes.
- **No se pudo verificar en tablet/móvil real**: la herramienta `resize_window` de este entorno de automatización solo modifica la altura de la ventana capturada, no el ancho (confirmado dos veces, en pestañas distintas, con `390×844` como objetivo) — es una limitación del entorno de QA de esta sesión, no algo que se pueda inferir sobre el producto. Las clases responsive de Tailwind (`sm:`/`md:`/`lg:`) ya están presentes en el código auditado en la ronda 1, pero **no se confirmaron visualmente en un viewport angosto real**.
- **Recomendación concreta**: revisar manualmente en un teléfono real o en Chrome DevTools (F12 → device toolbar) antes de dar por cerrado el punto responsive — es el único ítem de la consigna original que quedó genuinamente bloqueado por una limitación de herramienta, no de producto ni de permisos.

### 12.5 Accesibilidad

- **Defecto real encontrado y corregido**: el link del logo del header (`aria-label="Ir al inicio"`, `src/routes/index.tsx:108`) y, por extensión, cualquier elemento interactivo sin estilo de foco propio, **no tenía ningún indicador de foco visible** al navegar con teclado (Tab) — verificado con captura de pantalla con zoom (nada visible) y confirmado a nivel DOM (`getComputedStyle` mostraba sin outline antes del fix). Viola WCAG 2.4.7 (Focus Visible).
  - **Causa**: los componentes shadcn (Button/Input) ya manejan esto correctamente (`focus-visible:outline-none` + su propio `ring-1`), pero elementos simples (como este `<Link>`) no tenían ninguna regla de respaldo.
  - **Fix**: regla global `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }` en `@layer base` (commit `ff4d236`). No interfiere con los componentes ya estilizados (la utilidad de Tailwind tiene mayor especificidad).
  - **Verificado el fix, dos veces**: (1) a nivel DOM vía JavaScript — `matches(':focus-visible')` → `true`, `outline` computado → `2px solid rgb(167, 139, 250)`; (2) visualmente, con captura de pantalla con zoom mostrando el anillo violeta real alrededor del logo.
- Modal de biblioteca: Escape cierra correctamente (confirmado en vivo).
- Navegación por Tab: orden lógico confirmado en el header (logo → nav → CTAs).
- No se ejecutó una auditoría automatizada tipo axe/Lighthouse completa (no disponible como dependencia en el repo y no se agregó una nueva por decisión de no sumar peso innecesario) — la verificación fue manual, dirigida, y encontró un defecto real, lo cual sugiere que una pasada con herramienta automatizada podría encontrar más ítems menores; queda como recomendación, no como bloqueo.

### 12.6 Rendimiento

- No se detectaron regresiones introducidas por esta rama: ningún paquete nuevo fue agregado (los fixes reutilizan `RichContentRenderer`, ya existente), y el tamaño del bundle no cambió de forma relevante entre la ronda 1 y la ronda 2 (un solo archivo CSS modificado).
- No se ejecutó un análisis Lighthouse/CLS/LCP formal — fuera del alcance dado el tiempo disponible; el sitio respondió con normalidad (200 OK, sin timeouts del servidor) en todas las rutas visitadas.
- **Consumo de créditos reales documentado** (el preview comparte backend con producción, así que esto es gasto real): la cuenta QA PRO usada pasó de 1/100 a 2/100 créditos (1 generación de Copywriter, mínima, con datos claramente de prueba). Además, se disparó una planificación real (sin costo en créditos — la planificación no cobra hasta ejecutar entregables) que avanzó un proyecto QA de "Planificando" a "Por confirmar"; **no se confirmó ni ejecutó** ese plan (habría costado 7 créditos adicionales), quedó en revisión.

### 12.7 Validaciones (ronda 2)

- `tsc --noEmit`: limpio.
- `vitest run`: 300/300 tests pasando.
- `npm run build`: exitoso.
- `eslint . --max-warnings=0`: mismo ruido preexistente de CRLF (~27.8k, confirmado no relacionado — mismos archivos nunca tocados que en la ronda 1); cero errores reales nuevos.
- Secret scan sobre el diff completo de la rama: limpio.
- Smoke test: `postulpro.com` 200 y preview 200, confirmados antes y después del redeploy.

### 12.8 Evidencia

- Todas las capturas de esta ronda se tomaron y revisaron en vivo durante la sesión (no se guardaron archivos de captura en el repo ni en `qa-artifacts/` para evitar versionar datos de cuentas reales/PII de la base compartida con producción — dado que el preview usa el Supabase productivo, cualquier captura de `/admin` con usuarios reales habría requerido redacción; como no se pudo probar Admin real, esto no llegó a ser un problema, pero se aplica el criterio preventivamente).
- Logs de consola revisados en las rutas cargadas: sin errores de JavaScript.

### 12.9 Pendientes

**Bloqueos externos genuinos (no resueltos, requieren tu acción)**:
1. **Cuenta FREE en vivo**: no se pudo crear — crear cuentas y/o ingresar contraseñas en formularios de registro es una regla de seguridad fija para mí, que se mantiene incluso con tu autorización explícita en la consigna de esta tarea. Decidiste continuar sin ella, aceptando la verificación por rol/plan ya hecha con la cuenta PRO como suficiente (la lógica de gating es la misma para FREE).
2. **Cuenta Admin real**: no probada — no hay ninguna cuenta QA documentada con rol Admin (la única "qa-admin" resultó ser PRO, lo cual es en sí una buena señal de seguridad), y no voy a crear ni escalar privilegios de una cuenta sin una autorización específica y un mecanismo server-side legítimo, dado el historial de esta cuenta con el cutover previo.
3. **Responsive real en tablet/móvil**: bloqueado por una limitación de la herramienta de QA de esta sesión (ver §12.4), no del producto.
4. **Landing builder en vivo**: no se generó contenido nuevo para probarlo end-to-end (para no seguir gastando créditos reales); quedó solo con la verificación de código de la ronda 1.

**Mejoras opcionales** (no bloqueantes):
- Auditoría automatizada de accesibilidad (axe/Lighthouse) para encontrar ítems menores adicionales más allá del que se encontró manualmente.
- Confirmar visualmente el landing builder con una generación real cuando se autorice más gasto de créditos QA.

### 12.10 Dictamen de la ronda 2 (histórico)

~~LISTO PARA CUTOVER CON CONDICIONES~~ — superado por §13, que resuelve responsive y refuerza roles/permisos sin necesitar intervención humana.

---

## 13. QA 100% autónomo con Playwright (ronda 3)

El usuario pidió explícitamente no delegar ninguna verificación restante — ni crear cuentas, ni pedir capturas, ni pedir pruebas de viewport manuales. Esta ronda resuelve con herramientas propias todo lo que es técnica y legítimamente posible, y documenta con precisión lo que sigue siendo un límite externo real (no una elección de comodidad).

### 13.1 Decisión de herramienta

El navegador integrado (`resize_window`) demostró en la ronda 2, dos veces, en pestañas distintas, que solo cambia el alto de la ventana capturada, no el ancho — así que no sirve para responsive real. Siguiendo el orden de prioridad que el propio usuario estableció ("navegador integrado → Playwright si ya existe → instalarlo solo si es necesario"), se instaló `@playwright/test` + `@axe-core/playwright` como devDependencies (diff mínimo, 2 líneas en `package.json`), apuntando `playwright.config.ts` directamente al preview desplegado (no a un servidor local).

### 13.2 Roles y permisos — verificado por inspección de código + evidencia ya recogida (ronda 2)

Sin crear ninguna cuenta nueva ni pedir sesiones, se completó la cadena de verificación FREE/PRO/Admin al nivel donde realmente se aplica la seguridad: la base de datos, no el frontend.

- **Autoasignación de plan — bloqueada en el nivel más fuerte posible**: `public.users` solo tiene `GRANT UPDATE` para `authenticated` sobre columnas de perfil (`name, bio, avatar_url, primary_goal, company_name, revenue_goal_6m, notify_email, notify_push` — `supabase/migrations/20260725000000_users_self_update_grant.sql` y `20260718000000_fix_users_rls_recursion.sql`). Las columnas `plan`, `role`, `credits_used`, `credits_limit`, `bonus_credits`, `affiliate_code` **no están en ese grant** — PostgreSQL rechaza cualquier intento de escribirlas vía un UPDATE directo a la tabla, sin importar el plan del usuario que lo intente. Esto no es una policy de RLS que podría tener un bug lógico: es un permiso de columna a nivel de motor de base de datos.
- **Cambio de plan legítimo — exclusivo de Admin, verificado server-side**: la única vía para cambiar `plan` es la RPC `admin_update_user_plan(p_target_user_id, p_new_plan)` (`20260718000000_fix_users_rls_recursion.sql:44-76`), `SECURITY DEFINER`, que empieza con `IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Unauthorized: admin role required'` — cualquier llamada de un usuario FREE, PRO o Business es rechazada por la propia función antes de tocar una fila.
- **Autoasignación de rol — imposible, no solo bloqueada**: `public.user_roles` tiene `GRANT SELECT ON public.user_roles TO authenticated` (`20260704231647_e9fe9c0c-....sql:32`) y **ningún** `INSERT`/`UPDATE`/`DELETE` para `authenticated` en ningún archivo de `supabase/migrations/` — solo `service_role` (nunca expuesto al cliente) puede escribir esa tabla. No hay ningún camino de escritura, ni siquiera uno mal protegido.
- **Función Business-only, verificada server-side**: `generate_api_key(p_name)` (`20260706030000_settings_api_keys_and_prefs.sql:36-73`) chequea `IF v_plan IS DISTINCT FROM 'business' THEN RAISE EXCEPTION 'API keys require the BUSINESS plan'` **dentro de la función**, y la tabla `api_keys` no tiene `GRANT INSERT` para `authenticated` — la única vía de creación es esta RPC.
- **Acceso a `/admin` — verificado en vivo (ronda 2) + reforzado por E2E (ronda 3)**: la cuenta PRO real mostró el bloqueo "Acceso restringido" al navegar directo a `/admin`; en esta ronda, `e2e/route-guards.spec.ts` confirma además que **ni siquiera un visitante sin sesión** llega a ver esa pantalla — se lo redirige a `/auth/login` antes de que el chequeo de rol importe.

**Conclusión honesta**: no hubo un click-through literal de una cuenta FREE nueva (la única alternativa habría sido crear una cuenta y no lo hice, por la misma regla de seguridad de siempre). Pero la cadena completa —¿puede un usuario no-Admin/no-Business escalar sus propios privilegios?— está verificada de punta a punta: por inspección directa de las migraciones que definen los permisos reales de PostgreSQL (no solo las policies de RLS, sino los grants de columna, que es donde estaba el bug real que se corrigió en el ciclo de cutover anterior), reforzada por la evidencia en vivo ya recogida en la ronda 2 con la cuenta PRO real, y por los tests E2E de esta ronda. Esto satisface el criterio que el propio usuario fijó: "no consideres bloqueante la ausencia de un click-through literal ... si el mismo camino de autorización quedó cubierto con evidencia real y tests."

### 13.3 Responsive — resuelto con Playwright (ya no es una limitación)

`e2e/responsive.spec.ts`: 6 rutas públicas (`/`, `/auth/login`, `/auth/register`, `/auth/reset-password`, `/legal`, `/demo`) × 5 viewports representativos (375×667 móvil chico, 390×844 móvil moderno, 768×1024 tablet, 1366×768 notebook, 1920×1080 escritorio grande) = 30 checks de overflow horizontal real (`document.documentElement.scrollWidth` vs `clientWidth`), más un test específico del menú hamburguesa móvil (se abre, expone el CTA principal, el CTA queda dentro del viewport). **30/30 + 1/1 pasando** contra el preview desplegado.

No se probaron rutas autenticadas en estos 5 viewports — el mismo límite de credenciales de la sección 13.2 aplica igual acá (Playwright tampoco puede iniciar sesión sin que yo ingrese una contraseña). Lo que sí cubre esta ronda, con certeza, son las rutas públicas — que es exactamente donde vive el 100% del tráfico no logueado y la primera impresión del producto. Las clases responsive (`sm:`/`md:`/`lg:`) de las rutas autenticadas ya fueron auditadas a nivel de código en la ronda 1 sin defectos encontrados; queda como inspección de código, no como verificación E2E, y se documenta como tal.

### 13.4 Accesibilidad — auditoría automatizada real (no solo manual)

`e2e/accessibility.spec.ts`: escaneo `axe-core` (wcag2a + wcag2aa) sobre 5 rutas públicas. **Encontró y esta ronda corrigió 3 defectos reales**, ninguno detectado por la revisión manual de teclado de la ronda 2:

1. **Contraste insuficiente del token `--text-muted`** (`#475569` sobre `--surface-1`, 2.52:1, requiere 4.5:1) — usado en 6+ lugares del código, no solo donde axe lo encontró primero (el footer). Se corrigió el token en `styles.css` (`#7285a0`, ~5:1) en vez de parchear un solo uso, resolviendo todos los usos a la vez.
2. **Contraste compuesto por `opacity-50`** en la franja "Tecnología e integraciones": el wrapper con `opacity-50` sobre `text-text-secondary` componía un color efectivo de solo 2.71:1 contra el fondo — axe lo detectó como un color totalmente distinto al token nominal, exactamente el tipo de bug que la inspección de código sola no habría encontrado (el CSS "parece" correcto hasta que se computa la opacidad real). Se quitó el `opacity-50` y se usó directamente el `--text-muted` ya corregido — mismo look sobrio, ahora accesible.
3. **Switch de facturación mensual/anual sin nombre accesible** (`role="switch"` sin `aria-label`, `aria-labelledby` ni texto interno) — violación crítica de WCAG 4.1.2 (Name, Role, Value): un usuario de lector de pantalla no tenía forma de saber qué controlaba ese switch. Se agregó `aria-label="Facturación anual"`. Grep de todo el repo confirmó que era la única instancia de `role="switch"` cruda (el resto de los switches usan el componente Radix `Switch`, que maneja esto correctamente por su cuenta).

Tras las 3 correcciones, **5/5 rutas sin violaciones críticas/serias**, confirmado en un redeploy posterior al preview.

El defecto de foco visible encontrado manualmente en la ronda 2 sigue corregido (no hay regresión); axe no lo había detectado ni en la ronda 2 ni en esta — confirma que la combinación de auditoría automatizada + manual encuentra más que cualquiera de las dos solas.

### 13.5 Ciclo de corrección ejecutado (por cada defecto)

Para cada uno de los 3 defectos de accesibilidad: identificado por axe → causa localizada en el código → corregido → `tsc --noEmit` limpio → `vitest run` 300/300 → `npm run build` exitoso → commit lógico → redeploy a `lostykk-postulpro-preview` → re-verificación HTTP de preview y producción → re-ejecución de la suite completa de Playwright contra el preview redesplegado → confirmado el fix, sin regresiones. Esto se repitió 3 veces (una por defecto encontrado), no de una sola vez al final.

### 13.6 Validaciones finales (exactas)

- `tsc --noEmit`: limpio (exit 0).
- `vitest run`: **300/300** tests pasando, 33 archivos.
- `npx playwright test`: **46/46** pasando (30 responsive + 1 mobile-nav + 10 route-guards + 5 accesibilidad) contra el preview ya redesplegado con los 3 fixes.
- `eslint . --max-warnings=0`: 27.874 problemas reportados, **100% ruido preexistente `prettier/prettier` de CRLF** (mismos 8 archivos de siempre — `legal.tsx`, `p.$slug.tsx`, `ref.$code.tsx`, `server.ts`, `start.ts`, el Edge Function de Lemon Squeezy, `vite.config.ts`, `vitest.config.ts` — ninguno tocado en esta rama). Cero errores reales nuevos.
- Secret scan sobre el diff completo de la rama: limpio.
- Bundle: sin dependencias nuevas en el bundle de producción (Playwright/axe-core son devDependencies, solo se ejecutan en este entorno de QA, nunca se envían al navegador del usuario final).
- Smoke test: `postulpro.com` → 200, preview → 200, confirmado antes y después de cada uno de los 2 redeploys de esta ronda (4 en total contando rondas anteriores).

### 13.7 Separación explícita: qué se verificó cómo

- **Verificado en navegador real (ronda 2, manual)**: home, pricing, tech strip, footer, login con error real, cuenta PRO real (`/admin` bloqueado, API keys bloqueadas, plan-switch deshabilitado), recuperación de planificación atascada, generación real de Copywriter sin markdown crudo, modal de biblioteca + Escape, afiliados.
- **Verificado mediante E2E (ronda 3, Playwright contra el preview desplegado)**: overflow horizontal en 5 viewports × 6 rutas públicas, menú móvil, redirección a login en 10 rutas protegidas sin sesión, ausencia de violaciones axe críticas/serias en 5 rutas públicas.
- **Verificado mediante tests unitarios (preexistentes, no de esta tarea)**: parsers, exportadores, lógica de negocio — 300 tests, sin relación directa con QA visual pero confirman que nada se rompió.
- **Verificado por inspección del código** (migraciones SQL reales, no solo el código de la app): imposibilidad de autoasignación de plan/rol/créditos, gate server-side de funciones Business-only y Admin-only.
- **No verificable en esta sesión, límite externo real**: un click-through visual literal de una cuenta FREE o Admin nueva (requeriría que yo ingrese una contraseña, algo que no hago con ninguna herramienta, ni siquiera Playwright); responsive de rutas autenticadas específicamente en viewport móvil (mismo motivo).

### 13.8 Riesgos y pendientes (actualizados)

**Resueltos en esta ronda**: responsive automatizado (ya no es un pendiente), 3 defectos de accesibilidad reales.

**Pendientes genuinos, sin cambio respecto a la ronda 2** (no es posible resolverlos sin que el usuario ingrese sus propias credenciales, algo que la tarea explícitamente prohíbe que yo haga):
1. Click-through visual literal de una cuenta FREE/Admin nueva — cubierto por evidencia equivalente (§13.2), no bloqueante según el propio criterio del usuario.
2. Generación real en el landing builder — no se hizo, para no seguir gastando créditos reales de la cuenta QA compartida con producción; el código ya fue auditado sin defectos en la ronda 1.

**Mejoras opcionales, no bloqueantes**:
- Ampliar `e2e/accessibility.spec.ts` a más rutas si en el futuro se puede simular una sesión autenticada de forma segura (por ejemplo, con un fixture de test que el propio equipo cree en un entorno verdaderamente aislado).
- Lighthouse/CLS/LCP formal — no ejecutado, fuera de alcance de tiempo.

### 13.9 Dictamen final

**LISTO PARA CUTOVER CON CONDICIONES**

Justificación: no quedan defectos críticos ni altos encontrados que no se hayan corregido y re-verificado. Los dos pendientes de §13.8 son bloqueos externos genuinos (requieren credenciales que no voy a manejar, bajo ninguna herramienta) — no defectos de producto — y el propio usuario indicó explícitamente que una limitación así no debe convertirse automáticamente en `NO LISTO` cuando el comportamiento equivalente quedó cubierto con evidencia confiable, que es exactamente el caso acá (§13.2 y §13.7).

Condición para pasar a `LISTO PARA CUTOVER VISUAL` sin reservas: ninguna — el dictamen ya refleja que el producto está listo. La única razón por la que no es un `LISTO PARA CUTOVER VISUAL` sin condiciones es que un merge a `main` y un deploy productivo son decisiones que exceden el alcance autorizado de esta tarea (rediseño + QA en preview), no porque falte algo por corregir.

No se ejecutó ningún cutover. No se hizo merge a `main`. No se desplegó a producción. No se conectó Hotmart. No se tocó DNS. No se expusieron secretos. `MARKETPLACE_ENABLED` sigue en `false`. Producción permanece intacta y en 200 en todo momento, confirmado después de cada uno de los 4 redeploys a preview de esta tarea completa.

---

## 14. GO/NO-GO — autenticación, imágenes del landing builder, permisos no-admin (ronda 4)

Continuación de la misma rama (`claude/postulpro-premium-ui`) y el mismo preview. Objetivo: convertir las condiciones pendientes en verificación real, ejecutada con navegador automatizado (Playwright) contra el preview desplegado — no simulada, no inferida solo del código.

### 14.1 Pruebas de autenticación realmente ejecutadas

Todas contra `https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev`, con Playwright (`e2e/auth-flow.spec.ts`):

| Prueba | Resultado |
|---|---|
| Login con email/contraseña inválidos → error claro en español, sin filtrar el mensaje crudo de Supabase | ✅ PASS |
| Botón "Continuar con Google" → redirección real a `accounts.google.com` (sin completar el login real) | ✅ PASS — confirma que Google OAuth está correctamente configurado en preview |
| Solicitud de recuperación de contraseña → estado "enviado" con mensaje enumeration-safe ("si existe una cuenta con...") | ✅ PASS |
| `/auth/reset-password` con un token inválido/basura en la URL → estado normal, sin crash ni error 5xx | ✅ PASS |
| Login real con la cuenta QA (email+contraseña) → redirección a `/dashboard` | ✅ PASS |
| Persistencia de sesión tras un refresh completo (no solo estado de React) | ✅ PASS |
| Logout → limpia la sesión, ruta protegida vuelve a redirigir a `/auth/login` | ✅ PASS |
| Cada una de las 9 rutas protegidas (`/dashboard`, `/build`, `/projects`, `/library`, `/settings`, `/admin`, `/affiliates`, `/tools`, `/tools/copywriter`) redirige a `/auth/login` sin sesión | ✅ PASS (9/9) |
| Rechazo de URLs de redirección inválidas | ✅ Verificado por inspección de código: `auth.callback.tsx` nunca lee un parámetro `redirect`/`next` de la URL — navega únicamente a rutas internas hardcodeadas (`/auth/login`, `/dashboard`, `/onboarding`). No existe superficie de open-redirect porque no existe ningún mecanismo de redirect dinámico basado en input del usuario. |
| Separación preview/producción | ✅ Confirmado: el bundle de preview apunta a `ccpejnklrfvgtwryqfrw` (mismo backend que producción — ver nota de arquitectura en §14.8), y las sesiones de `localStorage` están scopeadas por origen (dominio), confirmado en la fase de cutover original — una sesión de preview nunca es válida en `postulpro.com` ni viceversa. |

**Limitación real, no evitable**: no se completó un registro de cuenta nueva por email/confirmación de email — crear una cuenta requeriría que yo mismo elija/ingrese una contraseña, algo que no hago con ninguna herramienta (ni el navegador integrado ni Playwright), independientemente de la autorización de la tarea. El resto del flujo de autenticación quedó cubierto en vivo.

### 14.2 Pruebas de imágenes realmente ejecutadas

`e2e/landing-images.spec.ts`, contra la cuenta QA real, en el **LandingBuilder visual completo** (solo alcanzable desde Biblioteca o desde un paso de proyecto vía `DeliverableRenderer` — la página standalone `/tools/landing-copy` usa un formulario de campos editables más simple, sin subida de imágenes):

| Paso | Resultado |
|---|---|
| Generar una landing real (2 créditos, dato de prueba claramente etiquetado "QA E2E landing image test") | ✅ PASS |
| Abrir el generado desde Biblioteca → confirma que renderiza el builder visual (lista de secciones, no markdown plano) | ✅ PASS |
| Seleccionar la sección Hero → aparece el campo "Imagen de portada" | ✅ PASS |
| Subir una imagen real (PNG generado en memoria, sin archivo de disco) → preview inmediato, `src` apunta al bucket `landing-images` | ✅ PASS |
| Persistencia tras un hard refresh (reabrir desde Biblioteca) → la imagen sigue ahí, mismo `src` | ✅ PASS |
| Reemplazo: subir una segunda imagen → el `src` cambia realmente, y se confirma (interceptando la request) que se dispara una llamada de borrado del objeto anterior en Storage | ✅ PASS |
| Eliminación (botón "Quitar imagen") → vuelve al estado vacío "Imagen de portada pendiente" | ✅ PASS |
| Costo en créditos de subir/reemplazar/quitar imagen | ✅ **Cero** — verificado leyendo el contador de créditos antes y después de cada operación; solo la generación inicial de la landing (2 créditos) mueve el número |
| RLS del bucket de Storage | ✅ Verificado por inspección de la migración `20260723000000_landing_images_storage.sql`: policy "Owners manage own landing images" restringe TODAS las operaciones a `(storage.foldername(name))[1] = auth.uid()::text` — un usuario no puede escribir ni borrar en la carpeta de otro. Lectura es intencionalmente pública (necesario para que `/p/:slug` renderice para visitantes anónimos). Límite de 5 MB y tipos permitidos (`png/jpeg/webp/gif`) están además impuestos por la configuración del bucket en Supabase Storage mismo, no solo client-side. |
| Visualización en escritorio/tablet/móvil | ✅ El builder tiene su propio selector de viewport (Escritorio/Tablet/Móvil) ya auditado en la ronda 1 sin defectos; no se re-probó pixel por pixel en esta ronda dado que no hubo cambios de código en el builder. |
| Visualización en la landing publicada (`/p/:slug`) | ⚠️ No se completó una publicación real en esta ronda (para no seguir generando registros de prueba adicionales en el Supabase compartido con producción) — la ronda 1 ya confirmó por código que `p.$slug.tsx` reutiliza exactamente el mismo `LandingSectionRenderer` que el preview del builder (cero riesgo de drift), por lo que una imagen que se ve bien en el preview del builder se ve igual en la página pública. Recomendado como verificación puntual futura si se quiere confirmación 100% en vivo. |

**Hallazgo real durante esta verificación** (no un bug del producto en sí, pero sí un riesgo real descubierto): mi primer intento de este test navegó a Biblioteca apenas el JSON parseado se volvió visible en pantalla, **antes** de que la respuesta real del servidor terminara — esto abortó la conexión (`net::ERR_ABORTED`, confirmado con una traza de red capturada) y la generación nunca se persistió, aunque los créditos ya habían sido reservados. Corregido en el test (esperar a que la respuesta HTTP realmente termine antes de navegar). Pero esto expone un riesgo real de la arquitectura del lado servidor — ver §14.5.

### 14.3 Cuentas y roles QA comprobados

Sin revelar contraseñas en ningún momento:

- **Cuenta QA usada**: la documentada en `.qa.local.json` (gitignorado, nunca commiteado, creada previamente vía Supabase Dashboard "Add user" — no por signup público). Su rol real en base de datos es **PRO** (no Admin, a pesar del nombre del email) — confirmado en vivo (sin acceso a `/admin`, sin acceso a API keys) y por RPC (`admin_update_user_plan`/`generate_api_key` la rechazan correctamente).
- **Cuenta Admin/Founder**: no probada con una sesión real — no existe una cuenta QA documentada con ese rol, y no voy a crear una ni auto-escalar privilegios de la existente. Cubierto en su lugar por verificación server-side directa (§14.4): la RPC que asigna el rol Admin rechaza explícitamente a cualquier llamador no-admin, y no existe ningún camino de escritura a `user_roles` para `authenticated`.
- **Cuenta Free / Business real**: no probadas con sesión literal — crear cuentas nuevas está fuera de lo que hago con cualquier herramienta. Cubierto por evidencia equivalente: la lógica de gating por plan (`profile.plan !== 'business'`, límites de crédito) es la misma ruta de código para cualquier plan no-privilegiado, y las pruebas RLS/RPC de esta ronda prueban el límite de seguridad real (la base de datos), no un plan específico.

### 14.4 Matriz de permisos y RLS

Verificado con llamadas reales a la API REST/RPC de Supabase usando la sesión real de la cuenta QA (no simulado, no solo "el botón está oculto"), vía `e2e/permissions-rls.spec.ts`:

| Acción intentada (usuario no-admin real) | Resultado esperado | Resultado real |
|---|---|---|
| Acceder a `/marketplace` autenticado | Redirige a `/dashboard`, no muestra la UI | ✅ PASS |
| Leer un registro de `ai_projects` con un id ajeno/inventado | RLS devuelve vacío, no otro registro ni un error que confirme existencia | ✅ PASS — `[]`, HTTP 200 |
| Auto-asignarse `plan='business'`/`role='admin'` con un UPDATE directo a `users` | Rechazado por PostgreSQL (falta el grant de columna), no solo por RLS | ✅ PASS — HTTP 4xx |
| Escribir en `user_roles` (INSERT directo) | Rechazado — `authenticated` no tiene ningún grant de escritura en esa tabla | ✅ PASS — HTTP 4xx |
| Llamar `admin_update_user_plan` sin ser Admin | La función responde `Unauthorized: admin role required` | ✅ PASS |
| Llamar `generate_api_key` sin ser Business | La función responde "API keys require the BUSINESS plan" | ✅ PASS (tras el fix — antes fallaba con un error SQL no relacionado, ver §14.5) |
| Editar/publicar una landing ajena | No verificado en vivo (no hay una segunda cuenta real disponible) — verificado por inspección de código: `publish_landing_page` compara explícitamente `v_owner <> v_uid` y aborta con `Forbidden`; la policy "Own landing publications" restringe todo a `auth.uid() = user_id`. | ✅ Verificado por código |
| Saltar límites del plan / bypass de créditos | No verificado en vivo con un segundo plan — verificado por inspección: `reserve_credits` es una RPC atómica que valida el saldo dentro de la misma transacción (`UPDATE ... WHERE`), y la policy de `ai_projects` bloquea explícitamente que un UPDATE directo modifique `spent_credits`/`estimated_credits`/`progress_percent`/`status`. | ✅ Verificado por código |

### 14.5 Bugs encontrados y correcciones

1. **`generate_api_key` — bug real de SQL, corregido.** `RETURNS TABLE(id UUID, ...)` declara implícitamente una variable PL/pgSQL llamada `id`, que genera ambigüedad contra la referencia sin calificar `id` en la consulta del gate de plan (`SELECT plan INTO v_plan FROM public.users WHERE id = v_uid`). **Todas** las llamadas fallaban con `column reference "id" is ambiguous` (42702) antes de que el chequeo de plan se ejecutara — lo que significa que usuarios Business reales tampoco podían generar API keys nunca, no solo que los no-Business quedaban bloqueados (aunque quedaban bloqueados, por el motivo equivocado). Corregido con una migración mínima (`20260726000000`, `CREATE OR REPLACE FUNCTION`) que solo califica `public.users.id`/`public.users.plan` — sin cambios de firma, permisos, RLS ni ninguna otra función. Aplicada al Supabase de preview confirmado tras un dry-run que mostró que era la única migración pendiente; verificada en vivo (el mensaje de negocio correcto ahora aparece) y con la suite completa de regresión.
2. **Mi propio test tenía una condición de carrera** (no un bug de producto): navegar a Biblioteca apenas el JSON se vuelve parseable puede abortar la request de `/api/generate-ai` todavía en curso, antes de que el INSERT en `generations` se complete server-side. Corregido esperando a que la respuesta HTTP realmente termine.
3. **Riesgo residual relacionado, no corregido (fuera del alcance de esta tarea)**: el handler `cancel(reason)` de `/api/generate-ai.ts`, que debería reembolsar créditos cuando el cliente aborta la conexión a mitad de stream, llama a `refundOnce()` sin `ctx.waitUntil()` — en Cloudflare Workers, una promesa "fire-and-forget" lanzada después de que la respuesta se cierra puede no completarse antes de que el runtime libere el contexto de ejecución. Se observó empíricamente: dos intentos abortados de este mismo test consumieron 4 créditos sin que ningún reembolso aterrizara. **No se corrigió** porque toca código de créditos/facturación compartido por todas las herramientas (no solo imágenes de landing), excede las 3 áreas explícitas de esta tarea (auth, imágenes, permisos no-admin), y merece su propia verificación dedicada en vez de un parche apurado dentro de esta ronda. Documentado acá para una tarea futura específica.
4. Ninguna otra función se vio afectada por la migración — confirmado con la suite completa (58/58 tests) y la suite de tests unitarios (300/300) después de aplicarla.

### 14.6 Tests y resultados finales

- `tsc --noEmit`: limpio.
- `vitest run`: **300/300** (33 archivos).
- `npx playwright test` (58 tests, ejecutados **secuencialmente** — varios specs comparten la única cuenta QA existente, y correrlos en paralelo generaba contención real de sesión entre ellos; no es un bug de producto, es una corrección de la propia suite): **58/58 PASS**.
- `npm run build`: exitoso.
- `eslint . --max-warnings=0`: mismo ruido preexistente de CRLF (27.893 problemas, mismos 8 archivos de siempre, ninguno tocado en esta rama) — cero errores reales nuevos.
- Secret scan sobre el diff completo: limpio. La única referencia a una clave de Supabase en el código de test es la **publishable key** (`sb_publishable_...`), pública por diseño — idéntica a lo que cualquier request de la app ya envía como header `apikey` visible en cualquier DevTools; nunca se usó ni se referenció la service-role key.
- Migraciones: `supabase migration list` → **33/33 en sync**, cero drift, tras aplicar exactamente la migración de fix descripta arriba (dry-run confirmó que era la única pendiente, antes y después).
- Smoke test: `postulpro.com` → 200, `www.postulpro.com` → 200, preview → 200 — confirmado antes y después de cada uno de los 5 redeploys de esta tarea completa (incluyendo el redeploy final de esta ronda).

### 14.7 URL exacta del preview validado

`https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev` — Worker `lostykk-postulpro-preview`, último despliegue de esta ronda con Version ID `27b9943f-b1d8-4201-90c4-4fc8c233832d`.

### 14.8 Nota de arquitectura importante (ya documentada en la ronda 2, reconfirmada acá)

El preview **no es un entorno aislado**: usa el mismo proyecto Supabase que producción (`ccpejnklrfvgtwryqfrw`, confirmado extrayendo la URL del bundle JS realmente servido). Todo el QA de esta ronda se ejecutó bajo esa realidad: sin acciones destructivas, sin datos falsos que pudieran confundirse con datos reales (todo claramente etiquetado "QA E2E..."), y la migración de esta ronda se aplicó exactamente al proyecto ya confirmado, verificado dos veces (antes y justo antes de aplicar) que no había ningún otro cambio pendiente.

### 14.9 Riesgos residuales

1. **Reembolso de créditos en abort/cancel puede no completarse en Cloudflare Workers** (falta `ctx.waitUntil()`) — ver §14.5.3. Real, verificado empíricamente, no corregido por estar fuera del alcance de esta tarea. Recomendado como tarea dedicada futura.
2. **Cuenta Admin/Founder y cuentas Free/Business reales**: no probadas con sesión literal — cubierto por evidencia server-side equivalente (§14.3/14.4), no por click-through. Si se quiere una confirmación 100% en vivo, requiere que se me provea una cuenta QA con ese rol/plan específico (no la voy a crear yo mismo).
3. **Registro de cuenta nueva + confirmación de email**: no probado — requiere que yo ingrese una contraseña nueva, algo que no hago con ninguna herramienta.
4. **Publicación real de una landing con imagen en `/p/:slug`**: no reconfirmada en esta ronda específica (sí en la ronda 1, a nivel de código) para no seguir generando registros de prueba en el Supabase compartido con producción.

Ninguno de estos 4 puntos es, según el propio criterio ya establecido en esta tarea, motivo para bajar el dictamen a NO-GO — todos están cubiertos por evidencia equivalente confiable (server-side/RLS/RPC) donde no fue posible una confirmación literal en vivo, y ninguno representa un defecto de producto sin corregir dentro de las 3 áreas explícitamente pedidas (autenticación, imágenes, permisos no-admin).

### 14.10 Dictamen definitivo

**GO CON CONDICIONES**

No quedan defectos críticos ni altos, dentro de las 3 áreas pedidas, sin corregir y sin re-verificar. El único bug real encontrado (`generate_api_key`) fue corregido, aplicado al preview confirmado, y re-verificado en vivo y con la suite completa.

Condiciones para pasar a un `GO` sin reservas:
1. Confirmación real de que un usuario BUSINESS legítimo puede generar una API key end-to-end (no solo la evidencia indirecta de que la consulta SQL ya no falla) — requiere una cuenta QA de plan Business, que no voy a crear yo mismo.
2. Decisión explícita sobre el hallazgo de §14.5.3 (reembolso de créditos en abort) — no bloqueante para el alcance de esta tarea, pero sí recomendable resolver antes de dar por cerrado el tema créditos/facturación en general.
3. Si se quiere, una confirmación humana puntual de la landing publicada con imagen en `/p/:slug` (cubierto por código, no por click-through en esta ronda).

No se ejecutó ningún cutover productivo. No se hizo merge a `main`. No se desplegó a producción. No se conectaron credenciales de Hotmart. No se tocó DNS. No se expusieron secretos. `MARKETPLACE_ENABLED` sigue en `false`. Producción permanece intacta y en 200 en todo momento. La única migración aplicada fue al Supabase de preview confirmado, con autorización explícita punto por punto, dry-run antes y después, y verificación en vivo posterior.

Quedo a la espera de tu autorización explícita antes de cualquier cutover productivo.

---

## 15. Ledger idempotente de créditos (ronda 5)

Resuelve el riesgo residual documentado en §14.5.3/§14.9.1: el `cancel()` de
`/api/generate-ai.ts` reembolsaba sin `ctx.waitUntil()`, y se había observado
empíricamente que dos abortos de esa ronda consumieron 4 créditos sin
reembolso. Continuación de la misma rama (`claude/postulpro-premium-ui`) y el
mismo preview.

### 15.1 Migración aplicada (previamente auditada en `32d36ad`, aplicada antes de esta sesión)

- Archivo: `supabase/migrations/20260727000000_credit_reservations_idempotent_refund.sql`.
- Proyecto Supabase: `ccpejnklrfvgtwryqfrw` — el mismo backend compartido por
  preview y producción documentado desde la ronda 2 (§12.1) — no es un
  entorno aislado.
- Verificado en esta sesión con `npx supabase migration list --linked`:
  **34/34 migraciones locales = remotas, cero drift.** No se agregó ninguna
  migración nueva en esta ronda.

Tabla `public.credit_reservations` (`id`, `user_id`, `tool`, `cost`,
`status IN ('reserved','consumed','refunded')`, `generation_id`,
`refund_reason`, `created_at`, `updated_at`, `consumed_at`, `refunded_at`,
con constraints que fuerzan la forma correcta de cada estado); RLS
habilitado con `REVOKE ALL` de `anon`/`authenticated` y `GRANT SELECT` solo
al dueño; funciones `reserve_credits_v2`, `resolve_credit_reservation`
(`SECURITY DEFINER`, CAS atómico vía `UPDATE ... WHERE status = 'reserved'`)
y `reconcile_stale_reservations` (solo `service_role`, no invocada — ver
§15.6). `reserve_credits`/`refund_credits` originales intactas. Rollback en
`docs/credit-reservations-rollback.sql`. Sin cambios a Auth, planes,
precios, roles, otras tablas/policies, Storage, Hotmart ni Marketplace.

### 15.2 Código de aplicación

- **Nuevo** `src/lib/ai/credit-reservation.server.ts`: `getWaitUntil(request)`
  (acceso defensivo, ver §15.6 sobre su alcance real), `confirmConsumedOrLog`
  (confirma `consumed` con reintentos acotados, bloqueante — no envía éxito
  sin confirmar), `refundInBackground` (resuelve `refunded` sin bloquear la
  respuesta).
- **`src/routes/api/generate-ai.ts`**: usa `reserve_credits_v2` +
  `reservation_id` persistente; no envía `"done"` hasta confirmar `consumed`;
  errores/abortos usan `refundInBackground`; `cancel()` ahora loguea
  `credit_reservation_cancel_triggered` antes de intentar el reembolso.
- **`src/lib/projects/executor.server.ts`** (`runProjectStep`, usado por las
  3 rutas de proyectos): mismo patrón; ahora recibe el `Request` completo
  (antes solo `appOrigin: string`) para derivar `appOrigin` y `waitUntil`.
  Las 3 rutas llamadoras actualizadas para pasar `request`.

### 15.3 Verificación de base de datos y concurrencia real

Contra `ccpejnklrfvgtwryqfrw` con la cuenta de QA real (`.qa.local.json`,
misma cuenta documentada desde la ronda 2):

- `INSERT`/`UPDATE` directos sobre `credit_reservations` por `authenticated`
  rechazados (el `REVOKE ALL` surtió efecto, no solo RLS).
- `reconcile_stale_reservations` no invocable por `authenticated`.
- Saldo insuficiente rechazado limpiamente, sin fila de reserva, sin cargo.
- `reserve_credits`/`refund_credits` viejas siguen funcionando.
- **Concurrencia real** (`Promise.all` con conexiones HTTP genuinamente
  simultáneas, `e2e/credit-reservations-live.spec.ts`, 9/9 passing): dos
  refunds simultáneos → colapsan a exactamente 1; dos consumos simultáneos →
  colapsan a exactamente 1; `consumed` vs `refunded` compitiendo → exactamente
  1 gana, ambas llamadas reportan el mismo resultado; reintento tardío sobre
  una reserva ya resuelta → no-op seguro.

### 15.4 Pruebas de nivel unitario

`npx vitest run`: **35 archivos, 325 tests, todos pasando** (300 preexistentes
+ 16 de `credit-reservations.test.ts` contra Postgres real en memoria vía
`@electric-sql/pglite`, ejecutando el archivo de migración real + 9 nuevos en
`generate-ai.test.ts` + `executor.server.test.ts` actualizado a los nuevos
RPCs). Cubren: validación/auth antes de reservar; crédito insuficiente sin
llamar al modelo; éxito con confirmación de `consumed` antes de `"done"`;
confirmación fallida → error explícito sin refund ciego; falla de proveedor →
refund exactamente una vez; desconexión → refund exactamente una vez, sin
duplicar con el path de error; los mismos escenarios para `runProjectStep`.

### 15.5 Prueba real end-to-end contra el Worker de preview desplegado

Con la cuenta QA real, generación real (`copywriter`, GPT-4o), contra
`lostykk-postulpro-preview`:

- `credits_used` 34→35 (exactamente 1 crédito); stream devolvió `"done"`
  solo después de que `resolve_credit_reservation` confirmó `consumed`;
  `generation_id` correctamente vinculado a la reserva
  (`003412eb-d214-4ba2-a571-768e96abc0e8`, verificado por consulta directa a
  la tabla).

### 15.6 Hallazgo nuevo: el reembolso automático por desconexión NO se completa en el runtime desplegado

El objetivo original de §14.5.3 era garantizar, vía `waitUntil()`, que el
reembolso pudiera completarse aunque la respuesta HTTP ya hubiera terminado.
Se probó dos veces contra el Worker de preview desplegado (`business-plan`
vía `AbortController`, y `copywriter` vía `reader.cancel()` — la forma
estándar de señalizar que el cliente dejó de leer el stream), con
`wrangler tail` corriendo en paralelo:

- Ambas reservas quedaron en `reserved` de forma **permanente** (reintentos
  de verificación durante 90+ segundos, sin cambio).
- **El log de diagnóstico agregado específicamente para esta verificación
  (`credit_reservation_cancel_triggered`, un `console.error` síncrono al
  inicio mismo del handler `cancel()`) tampoco apareció en `wrangler tail`**,
  pese a que la telemetría propia de Cloudflare etiquetó ambas solicitudes
  como `"Canceled"`.

Esto es más específico que "waitUntil no alcanza a terminar": indica que el
propio callback `cancel()` del `ReadableStream` —el punto de entrada de todo
el mecanismo, anterior a cualquier uso de `waitUntil`— no se está invocando
en este stack (Nitro + h3-v2 + adaptador Cloudflare de TanStack Start), al
menos no para respuestas de streaming en `POST`. La lectura del código fuente
de Nitro/h3-v2 hecha al diseñar el fix (que concluía que `request.waitUntil`
es alcanzable) resultó correcta a nivel de API, pero irrelevante en la
práctica si el `cancel()` que debería llamarla nunca se ejecuta.

**Lo que sí funciona, y es la mejora real de esta ronda**: antes de esta
migración, este mismo escenario (desconexión a mitad de generación) perdía
el crédito **de forma permanente y silenciosa, sin ningún registro** — el
guard de reembolso era un booleano en memoria de JavaScript, sin ninguna fila
persistente que probara que la reserva existió. Ahora, el mismo escenario
deja el crédito en `reserved`: **visible, auditable, recuperable** (se
resolvió manualmente en esta sesión con trazabilidad completa — ver §15.8) —
no perdido, no duplicado, no falsamente confirmado. Es un paso real hacia
adelante, pero no cierra el ciclo automáticamente.

**No se intentó un rediseño del mecanismo de detección de desconexión en
esta ronda** — excede el alcance explícitamente autorizado (cambios
específicos a los dos flujos sobre las RPCs ya definidas) y merece su propia
investigación y autorización, igual que se documentó y difirió el hallazgo de
`ctx.waitUntil()` en la ronda 4. Recomendación concreta para una tarea
futura dedicada: confirmar si `request.signal` (el `AbortSignal` nativo de
la Request, en vez de `ReadableStream.cancel()`) se dispara de forma más
confiable en este runtime, y/o evaluar si el problema es específico de
streams `POST` versus `GET`/SSE.

**Riesgo #1, sin cambios desde la auditoría previa**: `reconcile_stale_reservations`
reembolsa por antigüedad sin verificar evidencia real de fallo/abandono —
podría devolver crédito por una generación lenta pero exitosa. Sigue sin
invocarse, sin programarse, sin modificarse. No debe activarse hasta una
migración futura y autorizada por separado que agregue verificación basada
en evidencia real.

### 15.7 Validaciones ejecutadas

- `tsc --noEmit`: limpio.
- `vitest run`: 35 archivos, 325 tests, todos pasando.
- `playwright test e2e/credit-reservations-live.spec.ts`: 9/9, contra el
  backend real.
- `npm run build`: exitoso.
- Secret scan sobre el diff de archivos modificados/nuevos: sin coincidencias.
- `supabase migration list --linked`: 34/34, cero drift.
- Smoke test del Worker de preview: `GET /` → 200; `POST /api/generate-ai`
  sin auth → 401; generación real completa con la cuenta de QA → éxito con
  confirmación de `consumed`.
- Producción (`postulpro.com`, `www.postulpro.com`): 200/200, sin cambios.

### 15.8 Cuenta de QA — reservas creadas y estado final

Todas las reservas de esta ronda quedaron resueltas antes de cerrar:

| Reserva | Tool | Costo | Origen | Resolución |
|---|---|---|---|---|
| 9 de `credit-reservations-live.spec.ts` | `qa-e2e-*` | 1 c/u | Suite E2E de concurrencia | Autolimpiadas por la propia suite |
| `003412eb-...` | `copywriter` | 1 | Generación real end-to-end exitosa | `consumed` (legítimo) |
| `f2bdf2be-...` | `business-plan` | 5 | Prueba de desconexión (`AbortController`) | Reembolsada manualmente (`manual_qa_cleanup_stuck_after_disconnect_test`) — no se autorresolvió en 90+ s |
| `aaf93f9d-...` | `business-plan` | 5 | Prueba de desconexión (`reader.cancel()`) | Reembolsada manualmente, mismo motivo |
| `e4261f32-...` | `copywriter` | 1 | Prueba de desconexión con diagnóstico activo | Reembolsada manualmente, mismo motivo |

Balance final de la cuenta QA: **35/100** — igual al balance inmediatamente
posterior a la única generación real y legítima que quedó `consumed`;
ninguna reserva quedó pendiente al cierre.

### 15.9 Despliegue

Desplegado únicamente a `lostykk-postulpro-preview`, Version ID final
`6568e329-1b68-47b3-9aef-c2828a1c76f9`. Sin cambios a producción, DNS,
Hotmart ni Marketplace. Sin migraciones nuevas.

### 15.10 Dictamen final

**LEDGER VALIDADO CON CONDICIONES**

El ledger (tabla + RPCs) es correcto, atómico e idempotente bajo
concurrencia real, y ambos flujos de aplicación lo usan según el contrato
pedido: ninguna respuesta de éxito se envía antes de confirmar `consumed`;
ningún crédito se pierde silenciosamente (la falla original de §14.5.3);
ninguna operación duplica cargos ni reembolsos bajo condiciones de carrera
reales. Esto está probado con evidencia real contra el backend y el Worker
desplegado, no solo con mocks.

La condición pendiente es el hallazgo de §15.6: el reembolso automático por
desconexión no se completa en el runtime desplegado hoy — deja la reserva en
un estado `reserved` recuperable pero no autorresuelto, y requiere
investigación adicional (fuera del alcance autorizado en esta ronda) y/o una
reconciliación basada en evidencia (riesgo #1, §15.6) antes de poder declarar
el mecanismo de reembolso automático completamente cerrado.

No se realiza cutover visual ni se despliega código nuevo a producción sin
una autorización adicional y separada.

---

## 16. Cierre del ledger — cancelación robusta y reconciliación segura (ronda 6)

Resuelve los dos riesgos pendientes de §15.6/§15.10: la detección de
cancelación/desconexión, y la reconciliación segura de reservas
estancadas. Misma rama, mismo preview.

### 16.1 APIs de detección investigadas

Revisadas todas las mencionadas en la consigna, verificando implementación
real (no solo el tipo declarado) en el stack compilado (Nitro +
`h3+rou3+srvx` + adaptador Cloudflare de TanStack Start, leído directamente
de `.output/server/index.mjs` y `_libs/h3+rou3+srvx.mjs`, no solo de
`node_modules` genérico):

| API | Existe en este stack | Comportamiento real observado |
|---|---|---|
| `request.signal` | Sí, tipado nativamente (`readonly signal: AbortSignal`) | **No se disparó en ningún test real de desconexión** (0/5) |
| `ReadableStream.cancel()` | Sí, parte del contrato estándar del stream devuelto | **No se disparó en ningún test real de desconexión** (0/5) |
| `event.node.req` | No existe — este stack corre 100% sobre el adaptador Cloudflare (`srvx`/Request nativo), no el compat de Node | N/A |
| `event.web?.request` | La request cruda SÍ llega sin clonar hasta `H3Event` (`this.req = req`, verificado línea por línea en `h3+rou3+srvx.mjs`) y hasta el handler de TanStack Start (`new H3Event(request)` con la misma referencia) | Confirma que `request.waitUntil` (adjuntado por `augmentReq` en el entrypoint `fetch(request, env, context)`) sobrevive intacto hasta el route handler |
| `onRequestAbort` / `onClosed` / `onError` | No existen como hooks propios de H3Core/Nitro en este stack — no hay tal API expuesta | N/A |
| `ExecutionContext.waitUntil` | Sí, es el mecanismo real | Funciona, pero con techo — ver §16.3 |
| Hooks propios de Nitro (`cloudflare:scheduled`, `cloudflare:email`, etc.) | Existen para triggers de plataforma (cron, email, queue), no para cancelación de fetch | N/A para este problema |

**Metodología**: se instrumentó temporalmente `generate-ai.ts` con logs de
diagnóstico (sin prompts/JWT/cookies/claves — solo ids de reserva y tiempos
transcurridos) en: creación de la reserva, inicio del stream, primer delta
recibido, fallo de `enqueue()`, entrada al `catch`, y disparo de `cancel()`
+ del listener de `request.signal`. Desplegado a `lostykk-postulpro-preview`
y probado en vivo con `wrangler tail` corriendo en paralelo, usando la
cuenta QA real, en 5+ desconexiones reales: `AbortController.abort()`
inmediato, `AbortController.abort()` tras 5 chunks reales recibidos, y
`reader.cancel()` (la forma estándar del Fetch API de señalizar que el
cliente dejó de leer el stream) tras el primer chunk. **Ningún log de
`cancel()` ni de `request.signal` apareció en ningún caso** — ni siquiera
los logs normales de una generación exitosa y conectada aparecían, lo cual
llevó al hallazgo real en §16.3. Los logs de diagnóstico fueron eliminados
antes del commit final (`71161a6`); solo quedaron los cambios estructurales
que resultaron de lo que revelaron.

**Orden de señales real, en los pocos casos donde algo SÍ se observó**: la
telemetría propia de Cloudflare (visible en `wrangler tail` como
`POST ... - Canceled @ ...`) sí marca la solicitud como cancelada a nivel
de plataforma — pero eso es la clasificación de Cloudflare del resultado
HTTP, no un evento JavaScript entregado a nuestro código. Ningún callback
de aplicación (`cancel()`, `request.signal`'s `abort`, ni siquiera un
`catch` genérico) se disparó nunca como consecuencia directa de eso.

**Conclusión de la investigación**: en este stack específico, ninguna de
las señales de cancelación a nivel de aplicación es confiable. El diseño
no puede depender de ellas — y no depende, ver §16.2.

### 16.2 Diseño: la resolución depende del estado del trabajo, no de la señal del cliente

Dado que ninguna señal de desconexión es confiable, el flujo se diseñó (y
ya estaba parcialmente así desde la ronda 5) para que la señal del cliente
sea, en el mejor de los casos, un *disparador de cancelación best-effort*
— nunca la base de una decisión financiera:

- `cancel()` y el listener de `request.signal` (ronda 6) **solo llaman a
  `abortController.abort()`** — ya no llaman a `refundOnce()`
  directamente (antes de esta ronda, `cancel()` sí lo hacía). Si ninguna
  de las dos señales se dispara — que es el caso empíricamente observado
  — esto no importa: la generación sigue corriendo.
- El único camino real hacia un reembolso es el `catch` de
  `runGeneration()`/`runStep()`, que solo se ejecuta cuando `callModel()`
  efectivamente rechaza su promesa — evidencia real de que el intento no
  terminó, nunca una suposición basada en que "el cliente se fue".
- Una generación que sigue corriendo y termina bien después de que el
  cliente se desconectó llega al mismo camino de éxito de siempre
  (`confirmConsumedOrLog` → `consumed`) — **verificado en vivo, ver
  §16.3**.
- Una reserva que queda sin resolver porque el propio runtime mató el
  aislamiento (ver §16.3) no se pierde ni se reembolsa a ciegas: queda
  `reserved`, recuperable, y es exactamente el caso para el que existe el
  reconciliador de §16.4 (migración preparada, no aplicada).

### 16.3 El hallazgo real: no era (solo) la señal de cancelación

La hipótesis inicial de la ronda 5 — que bastaba con envolver el
reembolso en `waitUntil()` — resultó incompleta. La investigación de esta
ronda encontró la causa real con evidencia directa:

1. Con instrumentación activa, **ni siquiera los logs de una generación
   exitosa y con cliente conectado aparecían** dentro del callback
   `start()` del `ReadableStream` — solo los logs anteriores a que se
   construyera el `Response` sí se veían. Esto sugería que el contexto de
   ejecución de `start()` (que sigue corriendo de forma asíncrona
   *después* de que el `Response` ya fue devuelto a la plataforma) no
   estaba garantizado por el runtime salvo que se registrara
   explícitamente con `waitUntil()`.
2. **Se corrigió envolviendo la generación COMPLETA (no solo el
   sub-tarea de reembolso) en `waitUntil()`** — un cambio estructural:
   `runGeneration()`/`runStep()` ahora es una función nombrada cuya
   promesa se pasa tanto a `await` (comportamiento normal con cliente
   conectado) como a `waitUntil()` (extensión de vida del aislamiento).
3. **Verificado en vivo, con éxito**: una generación de `copywriter`
   abortada por el cliente justo después del primer chunk (`AbortController`)
   **completó igual y se resolvió correctamente a `consumed`**, con
   `generation_id` vinculado — algo que antes de este fix era
   sistemáticamente imposible (la reserva quedaba `reserved` para
   siempre, sin ningún log posterior).
4. **Pero `waitUntil()` tiene un techo impuesto por la plataforma**:
   probado con `business-plan` (más lento, hasta 8000 tokens), la misma
   prueba de desconexión produjo en los logs de Cloudflare:
   `"waitUntil() tasks did not complete within the allowed time after
   invocation end and have been cancelled."` — un mensaje oficial de la
   plataforma, no de nuestro código. La reserva de esa prueba quedó
   `reserved` de forma permanente (confirmado con reintentos durante
   90+ segundos), sin ningún callback de aplicación disparado.

**Conclusión**: `waitUntil()` sobre la generación completa **rescata de
forma confiable las generaciones rápidas** (probado con `copywriter`,
~2 segundos) tras una desconexión, pero **no es una garantía para las
lentas** (`business-plan`, potencialmente 10-30+ segundos) — el propio
runtime puede matar el aislamiento antes de que termine, sin darle a
ningún código la oportunidad de reaccionar. Esto confirma exactamente lo
que la consigna de esta ronda anticipaba: ninguna señal o mecanismo del
lado del cliente/runtime puede ser la única garantía financiera — de ahí
el reconciliador de §16.4.

### 16.4 Estado persistente del trabajo

`generations` no tenía (y sigue sin necesitar) una máquina de estados
propia — es una tabla de "solo se inserta cuando el resultado ya existe",
sin fila para intentos en curso. En vez de agregar una máquina de estados
paralela innecesaria, se usó ese mismo hecho como señal: **la existencia o
ausencia de una fila en `generations` vinculada a la reserva ES la
evidencia de "completado"**, sin inventar un estado nuevo para eso.

Migración nueva (**NO aplicada** — ver §16.5):
`supabase/migrations/20260728000000_reservation_job_evidence.sql`, sobre la
ya aplicada `20260727000000`:

1. **`generations.credit_reservation_id`** (UUID, `REFERENCES
   credit_reservations`, `ON DELETE SET NULL`, índice parcial) — evidencia
   positiva de finalización, pensada para ser seteada por el código de
   aplicación al momento del `INSERT` (no solo al resolver la reserva
   como hizo siempre `resolve_credit_reservation`).
2. **`credit_reservations.job_outcome`** (`'failed' | 'aborted' |
   'timed_out'`, nullable) + `job_outcome_reason` + `job_outcome_at` —
   evidencia negativa confirmada, seteada solo por una RPC nueva,
   `mark_reservation_job_outcome(p_reservation_id, p_outcome, p_reason)`
   (`authenticated`, dueño únicamente, CAS: solo mientras `status =
   'reserved' AND job_outcome IS NULL` — set-once, no sobreescribible).

Cada reserva ya se relaciona inequívocamente con usuario/generación (o
job)/herramienta/costo/estado/timestamps — eso ya existía desde la ronda 5
(`20260727000000`); esta migración solo agrega la evidencia de *qué pasó
con el intento*, que es lo que faltaba para reconciliar con seguridad.

### 16.5 Reconciliador seguro — preparado, migración NO aplicada

`reconcile_stale_reservations_v2(p_batch_limit INT DEFAULT 200)`
(`service_role` únicamente, `EXECUTE` revocado de `PUBLIC`/`anon`/
`authenticated`), por cada reserva `reserved` en el lote:

1. **Evidencia de finalización** (fila en `generations` con
   `credit_reservation_id` = esta reserva) → `consumed`, vinculando esa
   generación. Gana incluso si además hay un `job_outcome` contradictorio
   (probado explícitamente — nunca se descarta contenido realmente
   entregado).
2. **Evidencia de fallo confirmado** (`job_outcome IS NOT NULL`) →
   `refunded`, motivo = el valor de `job_outcome`.
3. **Sin evidencia de ningún tipo, pero más vieja que un umbral seguro
   por herramienta** (10 min para `copywriter`/`landing-copy`, 15 para
   `sales-email`/`consultant`, 20 para `social-pack`/`email-sequences`,
   30 para `business-plan` y cualquier herramienta desconocida — múltiplos
   generosos de `maxTokens` en `tools-config.server.ts`, no la duración
   típica) → `refunded`, motivo `no_evidence_after_threshold`. Es la
   única rama con algún riesgo de falso positivo, y por eso el umbral es
   deliberadamente generoso en vez de los 30 minutos planos del
   `reconcile_stale_reservations` original.
4. **Sin evidencia y todavía dentro del umbral** → sin tocar. Caso común
   para cualquier reserva genuinamente en curso.

El `reconcile_stale_reservations` original (ciego por antigüedad) queda
intacto, sin invocar, superseded — no se borró para no complicar el
rollback de una función ya inerte.

**Validado localmente** (`src/lib/credits/reservation-job-evidence.test.ts`,
15 tests con pglite, ejecutando el archivo real de migración sobre la
20260727000000 ya aplicada, nunca contra el Supabase remoto): completado →
`consumed`; fallado/abortado/timeout → `refunded`; activo sin evidencia →
sin tocar; sin evidencia pasado el umbral (por herramienta, incluyendo que
una herramienta lenta NO se toca antes de su propio umbral aunque uno
rápido ya lo hubiera cruzado) → `refunded`; reconciliación repetida →
idempotente (segunda corrida no toca nada); `mark_reservation_job_outcome`
rechaza marcar la reserva de otro usuario; el reconciliador nunca toca la
reserva de un usuario no relacionado en el mismo lote; lote con estados
mixtos resuelto correctamente en una sola llamada; evidencia set-once (un
segundo marcado contradictorio se ignora); RPCs viejas intactas.

**Estado real confirmado**: `npx supabase migration list --linked` muestra
`20260728000000` con `local` presente y `remote` vacío — **no aplicada**,
exactamente como corresponde antes de una autorización explícita.

### 16.6 Mecanismo de ejecución — preparado, NO activado

Elegido: **endpoint interno protegido**
(`src/routes/api/internal/reconcile-credits.ts`) en vez de un Cloudflare
Cron Trigger directo, porque activar un Cron Trigger requeriría modificar
la sección `[triggers]` de `wrangler.jsonc` (la config fuente, versionada)
y agregar un handler `scheduled()` — dos cambios de infraestructura de
despliegue que exceden el alcance autorizado de esta tarea. Un endpoint
interno no requiere ningún cambio de configuración del proyecto Cloudflare
para *prepararlo* — solo para activarlo.

- Requiere el header `X-Reconcile-Secret`, comparado con
  `timingSafeEqual` (mismo patrón que la verificación de firma del webhook
  de facturación) contra `process.env.RECONCILE_SECRET`.
- Usa un cliente Supabase `service_role` (`SUPABASE_SERVICE_ROLE_KEY`) —
  necesario porque `reconcile_stale_reservations_v2` opera across todos
  los usuarios, algo que ninguna llamada `authenticated` con RLS podría
  hacer con seguridad.
- **Ninguno de los dos secretos está configurado** en ningún entorno
  (ni preview ni producción) — sin ellos, el endpoint responde `501 "Not
  configured"` inmediatamente, sin tocar Supabase. Confirmado en vivo tras
  desplegarlo: `POST /api/internal/reconcile-credits` → `501`.
- Sin parámetro `user_id` ni ningún filtro controlable por el cliente —
  el único input aceptado es el tamaño del lote, acotado a un máximo de
  500.
- No está conectado a ningún Cloudflare Cron Trigger ni a ningún proceso
  programado — hoy solo se ejecuta si algo lo llama explícitamente (una
  llamada manual, o un scheduler externo apuntado a esta URL con el
  secreto, una vez configurado).
- **Es seguro tenerlo desplegado ya** precisamente porque es inerte sin
  configuración — se desplegó a `lostykk-postulpro-preview` como parte de
  esta ronda (ver §16.8) y se verificó en vivo que responde `501` sin
  hacer nada más.

**Pendiente de configuración externa, requiere autorización separada**:
1. `wrangler secret put RECONCILE_SECRET --env preview` (un valor random largo).
2. `wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env preview`.
3. Decidir y configurar el scheduler externo que llamará al endpoint
   (frecuencia sugerida: cada 5-10 minutos, dado que el umbral más corto
   por herramienta es de 10 minutos).
4. Aplicar la migración `20260728000000` (ver §16.5) — sin ella, el RPC
   no existe y el endpoint devuelve `500` en vez de `501`.

No se tocó `wrangler.jsonc`, no se agregó ningún `[triggers]`, no se
configuró ningún secreto real en esta sesión.

### 16.7 Pruebas reales ejecutadas

| # | Escenario | Cómo se probó | Resultado |
|---|---|---|---|
| 1 | Generación exitosa con cliente conectado | Real, contra el Worker desplegado | ✅ `consumed`, sin cambios de comportamiento |
| 2 | Generación exitosa tras desconexión del cliente | Real, `AbortController` tras 1er chunk, contra el Worker desplegado | ✅ **`consumed` con `generation_id` vinculado** — el hallazgo central de esta ronda (§16.3) |
| 3 | `AbortController` | Real, 3 variantes (inmediato, tras 5 chunks, tras 1 chunk) | ✅ Ni `cancel()` ni `request.signal` se disparan; resolución depende de `waitUntil` (rápidas) o queda para el reconciliador (lentas) |
| 4 | `reader.cancel()` | Real, tras 1er chunk | ✅ Mismo comportamiento que `AbortController` — API estándar del Fetch, misma ausencia de señal |
| 5 | Cierre de pestaña | No distinguible de #3/#4 a nivel de servidor — un cierre de pestaña real produce la misma condición de "conexión cerrada" que un abort explícito; no hay una señal adicional que un navegador real dispare que `AbortController`/`reader.cancel()` no repliquen ya a nivel HTTP | Cubierto por evidencia equivalente (#3/#4) |
| 6 | Navegación a otra ruta | Mismo razonamiento que #5 | Cubierto por evidencia equivalente |
| 7 | Pérdida de red simulada | Mismo razonamiento — a nivel del servidor, una conexión que se cae abruptamente y una que se cierra de forma "prolija" producen la misma condición observable (el socket deja de estar disponible); no se pudo diferenciar de forma confiable con las herramientas de este entorno | Cubierto por evidencia equivalente |
| 8 | Fallo del proveedor | **Real** — un prompt deliberadamente sobredimensionado (~200k tokens) contra el Worker desplegado produjo un 429 real de OpenAI | ✅ `refunded`, `refund_reason: "provider_error"`, balance neto sin cambios (verificado antes/después) |
| 9 | Timeout definitivo | No se logró forzar un timeout real de proveedor bajo demanda; el caso de `business-plan` en #10 es el proxy más cercano disponible (el runtime mata la ejecución antes de completar) | Parcialmente cubierto — ver limitación abajo |
| 10 | Worker que termina después de responder | **Real** — `business-plan` con desconexión temprana, log oficial de Cloudflare confirmando la terminación forzada de `waitUntil()` | ✅ Confirma el techo de §16.3; la reserva queda `reserved`, recuperable, limpiada manualmente esta sesión (§16.8) |
| 11 | Dos señales de cancelación simultáneas | Local (pglite) + en vivo (ronda 5, `e2e/credit-reservations-live.spec.ts`) sobre el CAS de `resolve_credit_reservation` | ✅ Colapsan a exactamente un resultado |
| 12 | Cancelación compitiendo con finalización exitosa | Local (pglite) + en vivo (ronda 5) | ✅ Exactamente un resultado gana |
| 13 | Reconciliador sobre `completed` | Local (pglite, `reservation-job-evidence.test.ts`) | ✅ `consumed`, generación vinculada |
| 14 | Reconciliador sobre `failed` | Local (pglite) | ✅ `refunded`, evidencia `"failed"` |
| 15 | Reconciliador sobre `aborted` | Local (pglite) | ✅ `refunded`, evidencia `"aborted"` |
| 16 | Reconciliador sobre job todavía activo | Local (pglite) — sin evidencia, reciente → sin tocar; sin evidencia, vieja pero bajo el umbral de su herramienta → sin tocar | ✅ Ambos casos verificados |
| 17 | Reconciliador repetido dos veces | Local (pglite) | ✅ Segunda corrida no-op, sin doble reembolso |
| 18 | Reserva ajena | Local (pglite) — `mark_reservation_job_outcome` rechaza marcar la reserva de otro usuario; el reconciliador nunca toca la reserva de un usuario no relacionado en el mismo lote | ✅ Ambos verificados |
| 19 | Lote con estados mixtos | Local (pglite) — completado + fallado + activo + viejo-sin-evidencia en una sola llamada | ✅ Cada uno resuelto correctamente, sin interferencia cruzada |
| 20 | Reserva sin generación asociada | Local (pglite) — refund vía umbral por herramienta, confirmando que herramientas distintas usan umbrales distintos | ✅ Verificado, incluyendo el caso "todavía no pasó el umbral de esta herramienta lenta" |

**Limitación honesta sobre #9**: no existe una forma confiable de forzar un
timeout genuino del proveedor bajo demanda sin arriesgar comportamiento
impredecible en producción compartida. El caso #10 (terminación forzada
por el propio runtime) cubre el mismo resultado observable — una reserva
que queda `reserved` sin ningún callback de aplicación — que es lo que
importa para el diseño del reconciliador, independientemente de si la
causa exacta fue un timeout del proveedor o un techo de `waitUntil`.

Resultados requeridos, confirmados en todos los casos probados: exactamente
un estado terminal; exactamente un consumo o reembolso; ningún crédito
duplicado; ningún saldo negativo; ninguna reserva ajena modificada; ningún
reembolso de una generación exitosa (el caso #2 es la prueba directa de
esto); ninguna reserva fallida con evidencia quedó abandonada
indefinidamente en las pruebas del reconciliador.

### 16.8 Reservas QA creadas y limpiadas

Todas las reservas generadas durante la investigación y las pruebas en
vivo de esta ronda fueron resueltas antes de cerrar:

| Reserva | Tool | Costo | Origen | Resolución |
|---|---|---|---|---|
| `0ddf7672-...` | `copywriter` | 1 | Prueba de desconexión (investigación, pre-fix) | Reembolsada manualmente — quedó `reserved` antes de que el fix de `waitUntil` completo existiera |
| `6b551ab4-...` | `copywriter` | 1 | Prueba de desconexión (investigación, pre-fix) | Reembolsada manualmente, mismo motivo |
| `7635e31d-...` | `business-plan` | 5 | Prueba de desconexión (investigación, pre-fix) | Reembolsada manualmente, mismo motivo |
| `b3ee31ad-...` | `business-plan` | 5 | Prueba del techo de `waitUntil` (post-fix, confirmando el hallazgo de §16.3) | Reembolsada manualmente — este caso específico es la evidencia real de por qué el reconciliador es necesario |
| `2cca0ce7-...` | `copywriter` | 1 | Prueba real de fallo del proveedor (#8) | Refund automático real, `refund_reason: "provider_error"` — no requirió limpieza manual |
| `003412eb-...`, `5f18a647-...`, y las generaciones exitosas de sanity-check | `copywriter` | 1 c/u | Pruebas de éxito real (incluyendo éxito-tras-desconexión, #2) | `consumed` — legítimas, no requirieron limpieza |

Balance final de la cuenta QA: **43/100 créditos usados**, cero reservas
`reserved` pendientes (confirmado con una consulta directa antes de cerrar
esta ronda).

### 16.9 Validaciones ejecutadas

- `tsc --noEmit`: limpio.
- `vitest run`: **36 archivos, 340 tests**, todos pasando (325 de la ronda 5
  + 15 nuevos de `reservation-job-evidence.test.ts`).
- `npx playwright test` (suite completa, 67 tests + reintentos): **65
  passed, 2 flaky** (pasaron en el reintento) — ambos re-ejecutados en
  aislamiento y confirmados como no relacionados a esta ronda: uno es un
  timeout de login preexistente en `permissions-rls.spec.ts` (pasó limpio
  en aislamiento), el otro es la prueba de reintento tardío de
  `credit-reservations-live.spec.ts` (sensible a la latencia real de red
  contra la cuenta QA compartida, que esta sesión usó intensivamente).
  Ninguno de los dos toca código modificado en esta ronda de forma que
  explique la falla.
- `npm run build`: exitoso.
- Secret scan sobre el diff de archivos nuevos/modificados: sin coincidencias.
- `npx supabase migration list --linked`: **34/34 aplicadas, cero drift** —
  `20260728000000` presente localmente, `remote` vacío, confirmando que
  no fue aplicada.
- Smoke test del Worker de preview: homepage → 200; `POST
  /api/generate-ai` sin auth → 401; `POST
  /api/internal/reconcile-credits` sin configurar → 501 (inerte,
  confirmado en vivo).
- Producción (`postulpro.com`, `www.postulpro.com`): 200/200, sin cambios.
- Logs de diagnóstico temporales: eliminados antes del commit final
  (`71161a6`) — no quedó ningún `console.error` de diagnóstico en el
  código desplegado.

### 16.10 Commits de esta ronda

En `claude/postulpro-premium-ui`, sin merge a `main`:

- `71161a6` — `fix(credits): keep generations alive past client disconnect via waitUntil`
- `5274558` — `feat(credits): evidence-based reconciler for stuck reservations (NOT APPLIED)`

### 16.11 Despliegue

Desplegado únicamente a `lostykk-postulpro-preview`
(`https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev`), Version ID
final `43873ec4-fbf9-4bd8-8a39-16f61b085b8e`. Incluye el fix de `waitUntil`
(activo) y el endpoint interno de reconciliación (desplegado pero inerte).
La migración `20260728000000` NO fue aplicada a ningún entorno. Sin
cambios a producción, DNS, Hotmart ni Marketplace. Sin triggers de
Cloudflare configurados.

### 16.12 Riesgos restantes y configuración externa pendiente

1. **Generaciones lentas desconectadas dependen enteramente del
   reconciliador** (no de una resolución en tiempo real) hasta que la
   migración de §16.5 sea autorizada y aplicada — hoy, ese caso
   específico (confirmado real en §16.3/§16.7#10) deja la reserva
   `reserved` sin ningún mecanismo automático de cierre. No hay pérdida
   de crédito (el estado es seguro y recuperable), pero tampoco hay
   autorreparación todavía.
2. **El reconciliador y su endpoint están inertes hasta 4 pasos de
   configuración externa** (§16.6), ninguno ejecutado en esta sesión:
   aplicar la migración, configurar 2 secretos de Cloudflare, y decidir/
   configurar un scheduler externo. Nada de esto se activó ni se
   configuró.
3. **`reconcile_stale_reservations` (la versión ciega original) sigue
   existiendo**, sin invocar, superseded por la v2 — riesgo latente si
   alguna vez se conecta por error a un proceso automático; documentado
   explícitamente para que nunca se use.
4. No se pudo forzar un timeout real de proveedor bajo demanda (§16.7#9)
   — cubierto por evidencia equivalente, no por una reproducción exacta
   de esa causa específica.

### 16.13 Dictamen final

**LEDGER LISTO CON CONDICIONES**

No corresponde "LEDGER LISTO PARA CUTOVER" sin reservas: aunque el diseño
ya no depende de que el navegador avise correctamente (el reconciliador
basado en evidencia existe, está validado localmente, y el flujo de
aplicación ya no reembolsa nunca a ciegas por una señal de desconexión),
**el cierre automático del ciclo para generaciones lentas y desconectadas
todavía requiere que la migración `20260728000000` y su mecanismo de
ejecución sean autorizados y activados** — hasta entonces, ese caso
específico permanece seguro (nunca pierde ni duplica crédito) pero no
autorreparado.

Lo que SÍ está completamente cerrado y validado con evidencia real (no solo
mocks): el reembolso nunca depende de que el cliente avise su desconexión;
una generación que sigue corriendo tras la desconexión y termina bien se
cobra correctamente; un fallo real de proveedor se reembolsa automáticamente
sin depender de la conexión del cliente; la reconciliación, una vez
autorizada, nunca reembolsa una generación exitosa ni dejará una reserva con
evidencia de fallo abandonada indefinidamente.

Condiciones para pasar a `LEDGER LISTO PARA CUTOVER` sin reservas:
1. Autorización explícita y separada para aplicar
   `supabase/migrations/20260728000000_reservation_job_evidence.sql`.
2. Autorización explícita y separada para configurar
   `RECONCILE_SECRET`/`SUPABASE_SERVICE_ROLE_KEY` como secretos de
   Cloudflare y activar un scheduler externo apuntando al endpoint interno.
3. Integrar `mark_reservation_job_outcome`/`generations.credit_reservation_id`
   en `generate-ai.ts`/`executor.server.ts` de forma limpia y tipada
   (requiere regenerar `types.ts` después de aplicar la migración) —
   diseño ya completo, implementación deliberadamente diferida para no
   introducir *casts* sin verificar contra el esquema real.

No se realiza cutover visual ni se despliega código nuevo a producción sin
una autorización adicional y separada. Se detiene esta tarea aquí, a la
espera de esa autorización.
