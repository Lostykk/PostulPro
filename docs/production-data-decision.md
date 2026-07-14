# Decisión de datos: qué hacer con el Supabase anterior

Estado: **RESUELTO — Escenario C recomendado con alta confianza.** El gate humano que bloqueaba esta decisión en fases anteriores ("sin acceso al proyecto Supabase anterior, pertenece a otra organización") ya no aplica: se encontró y verificó un canal de acceso legítimo distinto, y con él se auditó en modo solo lectura el único dato de mayor riesgo (la suscripción activa).

## El gate de acceso, resuelto

El proyecto Supabase anterior (ref `irawszhupzujzmicooyp`, confirmado como el que usa `postulpro.com` hoy vía el bundle JS público de producción) **no** está en una organización de Supabase inaccesible — es la base de datos gestionada por un proyecto de **Lovable Cloud** (`postulpro-genesis`, id `17b179e4-38d0-4fee-bf70-f155aae5983d`) que sí pertenece a la cuenta del usuario, verificado comparando su `supabase/config.toml` interno contra el ref de producción (coincidencia exacta). El acceso es vía el servidor MCP de Lovable (`plugin:lovable:lovable`, `query_database`), no vía Supabase CLI/dashboard directo — por eso no aparecía en `npx supabase projects list`.

## Inventario real (agregados, sin PII, 2026-07-13)

`auth.users`: 4 (2 `email`, 2 `google`, todos confirmados, altas entre 2026-07-04 y 2026-07-08 — una ventana de 4 días, consistente con pruebas internas previas a cualquier lanzamiento público). `public.users`: 4. `ai_projects`: 0. `generations`: 2. `subscriptions`: 3 (1 activa, 1 expirada, 1 reembolsada). `purchases`/orders: 0. `affiliate_referrals`/`affiliate_clicks`: 0. `reviews`: 0. 18 tablas, 20 funciones/RPCs, 3 buckets de Storage, solo 3 migraciones aplicadas (vs. 16-18 en el proyecto nuevo — le faltan los fixes de seguridad/billing de fases posteriores).

## La suscripción activa: auditada y clasificada

La única fila con riesgo real de ser un cliente pagando (`subscriptions.status = 'active'`, plan `pro`, `provider_subscription_id` terminado en `...191`) fue verificada cruzando Supabase (solo agregados/columnas no-PII) contra el dashboard de Lemon Squeezy (sesión del usuario, solo lectura, sin cancelar/modificar nada). Tres señales independientes, todas apuntando al mismo veredicto:

1. **Las 3 suscripciones de esta tienda pertenecen al mismo cliente**, con nombre literal de cuenta de prueba (contiene "QA Test") y email que coincide con el del propio equipo (mismo dominio que el autor de los commits de este repo) — no un cliente externo.
2. **El medio de pago es la tarjeta de prueba estándar de la industria** (terminada en `4242`, la tarjeta de test universal de Stripe/Lemon Squeezy) — nunca una tarjeta real.
3. **La tienda de Lemon Squeezy no tiene Live Mode aprobado todavía** ("Your application has been received and will be reviewed", confirmado en vivo en el dashboard) — es técnicamente imposible que haya procesado un cobro real.

Adicionalmente, el registro de `lemon_squeezy_events` para esta suscripción muestra el ciclo de vida completo (creada → cancelada → reanudada → pausada → despausada → pago fallido → pago exitoso → reembolsada) comprimido en días — el patrón de alguien probando cada rama del webhook, no el de un cliente real.

**Veredicto: PRUEBA/QA CONFIRMADA (no Escenario A).** No se individualizaron los otros 3 usuarios de `auth.users` (no fue necesario ni se intentó, para no exponer PII sin motivo) pero el contexto es consistente: 0 filas en `ai_projects`, `purchases`, `affiliate_*` y `reviews` para los 4 usuarios combinados, ventana de altas de 4 días, y el producto no había tenido lanzamiento público en ese momento según el historial de este repo.

---

## Escenario A — Migración completa

**Cuándo aplica:** hay usuarios reales activos, con suscripciones pagas y/o generaciones que perderían si no se migran.

**Qué implica:**
- Exportar `auth.users` preservando UUIDs. Los password hashes de GoTrue no son portables 1:1 entre proyectos Supabase — la ruta realista es recrear usuarios vía Admin API con `email_confirm: true` y forzar un flujo de "set new password" (el fix de esta fase a `/auth/reset-password` hace que ese flujo ahora funcione de punta a punta).
- Migrar `public.users` y toda tabla dependiente por el mismo UUID, verificando foreign keys tabla por tabla.
- Migrar Storage objeto por objeto (no solo metadata).
- Reconciliar suscripciones de Lemon Squeezy: la fuente de verdad de una suscripción activa es Lemon Squeezy mismo (`getSubscription()`), no la tabla local — antes de migrar, confirmar que el `provider_subscription_id` de cada usuario sigue siendo válido en Lemon Squeezy Live Mode.
- Downtime estimado: proporcional al volumen real; requiere una ventana de mantenimiento anunciada.
- Riesgo principal: cualquier fila que se pierda o quede mal enlazada es percibida por un usuario real como "perdí mi cuenta/mis compras" — el listón de corrección es mucho más alto que en preview.

## Escenario B — Migración selectiva

**Cuándo aplica:** hay algunos usuarios reales (ej. el equipo, unos pocos early adopters) pero el grueso de las filas en el proyecto anterior es de prueba, spam de signups, o cuentas nunca activadas.

**Qué implica:**
- Filtrar primero: definir un criterio objetivo ("tiene al menos una suscripción paga o una generación completada en los últimos N días") antes de tocar nada.
- Migrar solo esas filas con el mismo procedimiento que el Escenario A, pero a menor escala — el riesgo por fila es el mismo, el volumen es menor.
- Todo lo que no califica se **descarta** (no se migra, no se borra del proyecto anterior — ese proyecto no se toca en esta fase bajo ninguna circunstancia).
- Requiere el mismo criterio de éxito que A: conteo de filas origen vs. destino, verificado, no asumido.

## Escenario C — Relanzamiento limpio (sin migración)

**Cuándo aplica:** cero usuarios reales, o los que hay están dispuestos a recrear su cuenta (ej. es el equipo interno, o el producto nunca tuvo tráfico real más allá de QA).

**Qué implica:**
- El corte se simplifica a promover el proyecto Supabase nuevo (ya con 20 migraciones aplicadas y en uso en preview) directamente a producción — sin ETL, sin mapeo de UUIDs, sin downtime relacionado a datos.
- Es el escenario que el estado actual del repo asume implícitamente (todo el trabajo de esta fase — RLS, Storage, billing, delete-account — se hizo contra el proyecto nuevo, tratándolo como si fuera a ser el de producción).
- Sigue siendo necesario decidir qué pasa con las filas ya existentes en el proyecto anterior (¿se archivan, se eliminan tras un período de gracia, se dejan inertes?) — esa decisión no es técnica, es del dueño del producto.

---

## Recomendación de esta sesión

**Escenario C — Relanzamiento limpio.** Con el hallazgo de que la única suscripción activa es una prueba interna (tarjeta 4242, cuenta "QA Test", Live Mode nunca aprobado) y cero filas en `ai_projects`/`purchases`/`affiliate_*`/`reviews`, no hay evidencia de ningún cliente real ni dato de negocio que preservar. Esto coincide con lo que todo el trabajo de esta fase (Auth, billing, Storage, delete-account, CSP) ya asumía técnicamente: promover el proyecto Supabase nuevo (`ccpejnklrfvgtwryqfrw`) directamente a producción, sin ETL ni mapeo de UUIDs.

**Acción humana que queda:** el dueño del producto decide qué hacer con las filas del proyecto anterior (archivar, borrar tras un período de gracia, o dejarlas inertes) — es una decisión de higiene, no un bloqueante técnico. Ninguna acción sobre ese proyecto se ejecutó ni se recomienda ejecutar en esta fase.
