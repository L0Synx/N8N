# Integración con Evolution y n8n

## Antes de conectar

Exportar los workflows que puedan enviar mensajes de Endomec y guardar un backup privado. El bot principal ya tiene lógica de pausa: inspeccionar `IF Pausa humana` e `IF No esta pausado` y la tabla que consultan antes de conectarla con este estado.

```sh
npm run audit:workflows -- /ruta/exports
```

El script imprime nombres y tipos de nodos candidatos sin imprimir URLs ni secretos. No sustituye la revisión de expresiones, subworkflows o nodos Code.

## 1. Capturar sin interrumpir el bot

Importar `integrations/n8n-capturar-evento.json`. Es un subworkflow **nuevo**, no una modificación de un workflow existente.

- Configurar variable n8n `ENDOMEC_INBOX_URL` con el origen HTTPS del inbox. Si tu instalación no permite variables de proyecto, editar solo la URL del nodo HTTP.
- Crear una credencial de tipo **Header Auth**: nombre de cabecera `Authorization`, valor `Bearer VALOR_DE_WEBHOOK_SECRET`. Seleccionarla en el HTTP Request. No pegar secretos en el código del nodo.
- El trigger admite el objeto completo del webhook o directamente `{event,instance,data}`. El preparador elimina cabeceras y secretos de nivel superior.
- En el workflow que recibe los eventos, añadir una llamada al subworkflow de captura **antes de filtros que descartan fromMe, estados o eventos atrasados**, pero sin reemplazar el Webhook actual. Configurar **Wait for Sub-Workflow Completion = off** y **On Error = Continue**, verificando los nombres concretos en tu versión de n8n.
- No confiar en que una segunda rama se ejecute en paralelo. El desacople lo da la opción de no esperar al subworkflow.
- Probar con el backend apagado: el procesamiento habitual debe continuar. El subworkflow conserva el resultado de captura para revisar fallos. Guardar ejecuciones suficientes para reintentar y cuidar su retención: contienen conversaciones.

El backend recibe POST `/api/integrations/evolution`, con `Authorization: Bearer WEBHOOK_SECRET` y JSON:

```json
{"instance":"NOMBRE_EXACTO_CONFIGURADO","event":"messages.upsert","data":{"key":{"id":"ID_REAL_DEL_PROVEEDOR","remoteJid":"NUMERO_REAL@s.whatsapp.net","fromMe":false},"message":{"conversation":"CONTENIDO_REAL"},"messageTimestamp":0}}
```

Es una descripción del contrato, no un evento para mandar a producción. Enviar el timestamp original, no `0`. El adaptador admite texto extendido, respuestas de listas/botones, envoltorios efímeros y metadatos multimedia. Comparar primero con los eventos reales de tu versión.

## 2. Cubrir todas las salidas

Verificar en Evolution qué destino recibe `MESSAGES_UPSERT`, `SEND_MESSAGE` y `MESSAGES_UPDATE`. No cambiar la URL del webhook productivo por la del inbox. Si ya llegan a n8n, copiarlos en la entrada antes de descartarlos. Si no llegan, revisar las opciones de eventos conservando el destino existente y validar en una instancia de prueba.

No se da por hecho que Evolution tenga dos webhooks independientes por instancia. No configurar un webhook global que mezcle otros negocios. El filtro de instancia del backend es obligatorio aunque el mecanismo de copia sea compartido.

Los mensajes con `fromMe=true` se guardan como origen externo mientras no exista evidencia de bot/agente. Para atribuir bot y garantizar pausa, los envíos de texto deben pasar por el gateway.

## 3. Gateway de texto

Importar `integrations/n8n-enviar-texto.json`. Configurar URL y una credencial Header Auth distinta: `Authorization: Bearer BOT_GATEWAY_SECRET`.

Entrada del subworkflow:

```json
{"jid":"NUMERO_REAL@s.whatsapp.net","text":"TEXTO_ORIGINAL","requestId":"UUID_UNICO_Y_PERSISTENTE_PARA_ESTE_ENVIO"}
```

`requestId` debe ser un UUID generado una vez y conservado con la tarea de envío. No regenerarlo cuando se reintenta el mismo envío o cuando se pierde la respuesta HTTP. Un UUID distinto representa un envío distinto. El servidor rechaza reutilizarlo con otro contenido/chat/remitente.

Endpoint: POST `/api/integrations/bot/send-text`. El backend guarda el intento y llama a Evolution con POST `/message/sendText/{instance}` y `{number,text}`. Ese contrato debe validarse contra el HTTP Request que funciona en la instancia instalada antes de habilitar `EVOLUTION_SEND_ENABLED`.

Resultados:

| Resultado | Qué hacer en n8n |
|---|---|
| `blocked=true` | No enviar: conversación humana o pausada. Finalizar esa respuesta, sin fallback |
| `status=accepted/sent/delivered/read` | Registrar resultado; no reenviar |
| `status=uncertain/sending` | No reenviar ni usar otro UUID. Revisar la entrega real |
| `status=failed` / HTTP 502 | Rechazo confirmado; reparar causa y aprobar un nuevo intento con UUID nuevo |
| Error de conexión al gateway | Reintentar con el mismo UUID; nunca enviar directamente a Evolution como fallback |

La respuesta del gateway es el registro del inbox; **no reemplaza de forma transparente el JSON de Evolution**. Revisar los nodos siguientes si usan `key.id`, `status` u otros campos del HTTP anterior. El ID original, cuando se conoce, está en `external_id`.

Un nodo de envío que maneja listas, botones, audio o imágenes no puede cambiarse por este gateway de texto sin perder su comportamiento. Para esos tipos hay que validar el contrato real y extender el adaptador manteniendo el mismo bloqueo; hasta entonces no habilitar `BOT_GATEWAY_VERIFIED` para el bot completo.

## 4. Coordinar pausa existente

Además del control justo antes del envío, puede consultarse GET `/api/integrations/bot/state?jid=...` con la credencial del gateway antes de iniciar la lógica conversacional. Su `maySend` es orientativo: **una consulta separada seguida de un envío directo tiene una carrera**, por eso no sustituye el gateway.

Durante `human`/`paused`, capturar todos los mensajes entrantes pero evitar avanzar el estado conversacional del bot, ejecutar consultas SOOL o programar nuevas respuestas. Esto requiere adaptar el filtro existente del workflow principal después de conocer su condición y tabla. Al volver a `automatic`, atender mensajes nuevos; no reproducir automáticamente los acumulados durante la atención humana. Si el flujo actual queda a mitad de un turno, definir si se conserva o reinicia en la lógica existente; el inbox no borra estados de n8n.

Cuando todos los puntos de envío estén inventariados y coordinados, marcar `BOT_GATEWAY_VERIFIED=true` en el backend. Esto habilita los controles de la UI. Una etiqueta visual nunca sustituye esta integración.

## 5. Recuperación

- Repetir un evento con ID no crea un segundo mensaje.
- Si la copia falla, conservar la ejecución original y volver a ejecutar solo el subworkflow de captura, no la operación de turno ni el envío al paciente.
- Eventos sin ID quedan en `inbox.rejected_events`; el endpoint devuelve `rejected>0` para que la ejecución sea detectable. Revisar el adaptador antes de reprocesarlos.
- Si el evento nunca llegó a n8n, la captura no puede recuperarlo. Consultar disponibilidad real del historial de Evolution antes de planificar un backfill.
- No registrar `apikey`, Authorization, cookies de SOOL ni credenciales en alertas.

## Disponibilidad y garantía

La captura desacoplada puede fallar sin frenar el bot existente. Una vez que el envío pasa por un gateway central, su caída suspende nuevos envíos: es la contrapartida necesaria para hacer cumplir el estado de atención. La primera entrega no promete simultáneamente bypass del CRM y pausa absoluta. Las operaciones en curso pueden completar un envío iniciado antes de la pausa; las posteriores quedan bloqueadas.
