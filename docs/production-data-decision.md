# Decisión de datos: qué hacer con el Supabase anterior

Estado: **BLOQUEADO en un gate humano** — esta sesión no tiene, y no intentó obtener, acceso al proyecto Supabase anterior. No es un olvido: es el resultado esperado de auditar sin tocar producción ni pedir credenciales de una organización distinta.

## Lo que se confirmó esta fase

- El CLI de Supabase autenticado en esta sesión (`npx supabase projects list`) solo ve **un** proyecto: `ccpejnklrfvgtwryqfrw` ("PostulPro", creado 2026-07-12, `sa-east-1`) — el proyecto **nuevo**, usado por preview.
- El proyecto anterior (el que usa `postulpro.com` en producción hoy) pertenece a una organización distinta, no visible desde esta cuenta. Esto ya se había documentado en `docs/production-cutover-runbook.md` sección B en una fase anterior; sigue siendo cierto.
- No se buscó, pidió, ni infirió ninguna credencial para acceder a él. Per las reglas de esta fase, ese es exactamente el comportamiento correcto ante este gate.

## Las tres preguntas que solo puede responder alguien con acceso al proyecto anterior

1. ¿Cuántas filas reales hay en `auth.users` hoy en producción (no de prueba)?
2. ¿Hay suscripciones o compras activas en Lemon Squeezy Live Mode ligadas a esos usuarios?
3. ¿Hay generaciones/proyectos que un usuario real esperaría seguir viendo después del corte, o relaciones de afiliados con comisiones pendientes de pago?

Sin estas respuestas, ninguno de los tres escenarios de abajo se puede elegir con confianza — son mutuamente excluyentes y la elección correcta depende enteramente de esas cifras.

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

No hay evidencia suficiente para recomendar A, B o C — eso requeriría exactamente los datos que este gate bloquea. Lo que sí se puede afirmar con la información disponible: todo el trabajo de esta fase (Auth, billing, Storage, delete-account, CSP) se construyó y probó asumiendo el Escenario C como base técnica — es el camino de menor fricción si la respuesta termina siendo "no hay usuarios reales que preservar".

**Próxima acción humana concreta:** alguien con acceso a la organización del Supabase anterior debe correr un conteo simple (`SELECT count(*) FROM auth.users`, y el mismo cruce contra `subscriptions`/`purchases` si esas tablas existen ahí) y traer esas tres cifras. Con eso, esta decisión pasa de BLOQUEADA a tomable en minutos.
