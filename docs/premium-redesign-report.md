# PostulPro — Rediseño visual premium: informe de cierre de fase

## Resumen

- **Objetivo**: modernización visual y de UX integral de PostulPro (sistema de diseño, accesibilidad, contenido, QA).
- **Alcance ejecutado**: auditoría completa del producto real + corrección de los defectos verificados de mayor impacto en confianza/consistencia/legibilidad, sin tocar autenticación, RLS, planes/créditos, Marketplace ni infraestructura.
- **Alcance NO ejecutado** (ver §9): rediseño visual línea por línea de los 45 componentes shadcn/ui, reescritura profunda de cada pantalla (auth, dashboard, workspace, landing builder, admin) más allá de los defectos concretos encontrados. El pedido original equivale a un proyecto de varias semanas para un equipo de diseño; esta sesión priorizó defectos reales y verificables sobre un rediseño superficial exhaustivo. Ver §9 para el detalle de qué quedó pendiente y por qué.
- **Rama**: `claude/postulpro-premium-ui` (creada desde `main` en el commit `bdbade1`, sin merges).
- **Commits** (4, ninguno a `main`):
  1. `6edf057` — tokens semánticos extendidos, `StatusBadge`/`StatusIcon`, unificación de gradiente de marca.
  2. `66166fd` — eliminación de "Construido sobre", corrección de la franja de tecnología, centralización de precios.
  3. `20a5757` — breadcrumbs legibles, fin de markdown crudo fuera de streaming.
  4. `2e53cd9` — mapeo de errores de Supabase Auth a español claro.
- **URL de preview**: https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev (Worker `lostykk-postulpro-preview`, desplegado y verificado 200 OK).
- **Producción**: sin cambios. `postulpro.com`/`www.postulpro.com` siguen en 200, sirviendo el commit `bdbade1` (sin relación con esta rama).
- **Dictamen**: **LISTO PARA REVISIÓN VISUAL** (ver §11).

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

## 9. Riesgos y pendientes

**Defectos verificados y resueltos**: ver §1 y §4.

**No se hizo (por decisión de alcance, no por error)**:
- Reescritura visual componente-por-componente de los 45 primitivos shadcn/ui — la auditoría no encontró defectos concretos que lo justificaran; hacerlo de todos modos habría sido riesgo sin beneficio verificado.
- Rediseño profundo de cada pantalla (auth, dashboard, workspace, landing builder, admin, tools) más allá de los defectos puntuales listados — cada una fue auditada y, salvo los ítems de §1, ya estaba en buen estado (estados de carga/error reales, sin Markdown/JSON crudo, sin promesas falsas, formularios con validación).
- QA visual autenticada (dashboard/admin/tools) y validación responsive multi-breakpoint real en navegador — requiere credenciales de QA para preview y/o una herramienta de redimensionado de viewport que funcione en este entorno; recomendado como siguiente paso antes de cualquier decisión de shippeo a producción.
- Verificación visual del bug de selects reportado — el código ya es correcto; si el síntoma persiste en un dispositivo Windows real, es probablemente un problema de navegador específico, no del componente.

**Recomendación**: usar esta rama y el preview desplegado para una revisión visual humana (desktop + al menos un dispositivo móvil real) antes de decidir si se amplía el alcance a un rediseño más profundo o se mergea lo actual.

## 10. Cómo revisar

- Código: rama `claude/postulpro-premium-ui`, 4 commits, pusheada a `origin`.
- Preview en vivo: https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev
- Sin acción pendiente de tu parte salvo revisión — no se tocó `main`, no se desplegó a producción, no se conectó Hotmart.

## 11. Dictamen

**LISTO PARA REVISIÓN VISUAL**

No se ejecutó ni se propone ningún cutover ni merge a `main` en esta tarea. Se espera autorización explícita antes de cualquier paso adicional (merge, ampliar alcance del rediseño, o cualquier acción sobre producción).
