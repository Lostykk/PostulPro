# Limpieza del secret accidental en producción — procedimiento, NO ejecutado

Estado: **documentado únicamente**. Nada de este archivo fue ejecutado contra `lostykk-postulpro` (producción) en esta ni en ninguna fase anterior, por instrucción explícita.

## Qué es

Un secret llamado literalmente `PostulPro Preview` existe hoy en el Worker de **producción** (`lostykk-postulpro`), confirmado vía `npx wrangler secret list --config .output/server/wrangler.json` (sin `--env`, es decir, el entorno productivo por defecto). Por su nombre, es evidente que fue creado por error en el Worker equivocado — el nombre describe el entorno preview, no producción.

Según lo informado en una fase anterior (que esta fase no puede re-verificar sin exponer valores): la clave API asociada a este secret ya fue **revocada** del lado del proveedor. Es decir, aunque el secret siga presente en Cloudflare, su valor ya no es válido/utilizable en ningún lado.

## Por qué no se tocó

Instrucción explícita y reiterada en cada fase: no eliminar este secret, no desplegar producción para "limpiarlo", no modificar el Worker `lostykk-postulpro` de ninguna forma. Aunque técnicamente `wrangler secret delete` es una operación de bajo riesgo (borra un valor ya revocado, no rompe nada funcional), sigue siendo una escritura contra el Worker de producción — exactamente el tipo de acción que esta fase tiene prohibido ejecutar sin autorización explícita separada.

## Procedimiento (para cuando se autorice)

1. Confirmar una vez más, inmediatamente antes de actuar, que el secret sigue llamándose `PostulPro Preview` y que la clave sigue revocada del lado del proveedor (Anthropic/OpenAI/quien corresponda) — no asumir que el estado no cambió entre fases.
2. `npx wrangler secret delete "PostulPro Preview" --config .output/server/wrangler.json` (sin `--env` — apunta a producción por diseño; **este es exactamente el comando que no se debe correr sin autorización explícita del usuario en el momento**).
3. Verificar inmediatamente después: `npx wrangler secret list --config .output/server/wrangler.json` ya no debe listar ese nombre.
4. No se requiere ningún redeploy del Worker — `wrangler secret delete` no dispara una nueva versión ni cambia el código en ejecución, solo remueve el binding de secret disponible para futuras invocaciones que lo referencien (y dado que ningún código de la app lee una variable con ese nombre, no hay efecto funcional esperado).
5. Documentar la fecha/hora de eliminación y quién la ejecutó, en este mismo archivo, como registro.

## Riesgo de NO limpiarlo

Bajo, pero no cero: un secret con nombre y contenido confuso en el Worker productivo es ruido operativo (alguien podría asumir erróneamente que "PostulPro Preview" indica que ese Worker sirve tráfico de preview, o intentar usarlo pensando que sigue vigente). No representa una superficie de ataque activa dado que la clave ya está revocada.

## Acción humana concreta

Confirmar explícitamente "sí, borrá el secret `PostulPro Preview` de producción ahora" en un mensaje de chat separado — recién ahí se ejecuta el paso 2 de arriba, nunca antes.
