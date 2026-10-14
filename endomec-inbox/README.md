# Endomec Inbox · Narvier

Aplicación privada para supervisar WhatsApp y responder manualmente. Código para desplegar en **Hostinger/EasyPanel**, con **React + Vite**, **un backend Node/Express**, **PostgreSQL de Supabase** y **Supabase Auth**. No requiere Redis, un CRM externo ni Supabase Realtime.

## Estado de esta entrega

Se implementaron interfaz, servidor, autenticación/autorización, esquema SQL, recepción de eventos, envío de texto, reconciliación, control de atención y archivos para despliegue. **No está desplegada ni conectada al WhatsApp productivo.** No se creó el proyecto nuevo de Supabase: se confirmó la organización `narvier`, pero su conector no ofreció la operación de consulta de costo necesaria para crearlo. AgendaMica no fue modificada.

Se ejecutaron 12 pruebas locales de normalización/configuración y la comprobación de sintaxis del backend. Tres pruebas PostgreSQL quedaron pendientes porque el entorno no pudo descargar dependencias de npm. No se ejecutaron compilación de React, pruebas visuales, integración HTTP, pruebas de concurrencia PostgreSQL ni pruebas con WhatsApp real. **No considerar validada en producción antes de completar `docs/PRUEBAS.md`.**

## Empezar

1. Crear un proyecto **Endomec Inbox** en la organización **narvier** de Supabase. Revisar el costo mostrado antes de confirmar. Preferir São Paulo si está disponible. Guardar la contraseña de PostgreSQL en el gestor de secretos.
2. En **SQL Editor → New query**, ejecutar `migrations/001_initial.sql`. Se crea únicamente el esquema `inbox` y no se modifica `public`.
3. En **Authentication → Users**, crear la cuenta del operador mediante el panel. Desactivar registro público en la configuración de Auth. No hace falta habilitar usuarios anónimos.
4. Copiar el UUID de ese usuario y autorizarlo:

   ```sql
   INSERT INTO inbox.agents(user_id,display_name)
   VALUES ('REEMPLAZAR_POR_UUID_REAL','Equipo Endomec');
   ```

5. Obtener **Project URL** y la clave **publishable/anon**. No usar `service_role` en el navegador. La clave pública sirve solo para Auth; los datos del inbox no se exponen por la API pública.
6. Configurar las variables de `.env.example` en EasyPanel. Usar el **Session pooler**, puerto 5432, desde **Connect**. El pooler de transacciones 6543 no es compatible con los bloqueos por conversación utilizados para el envío.
7. Desplegar usando `Dockerfile` y puerto interno **3000**. Asignar un dominio HTTPS y poner ese origen exacto en `APP_ORIGIN`. No activar CORS permisivo.
8. Seguir `docs/INTEGRACION_N8N.md`. Validar primero con una instancia y un número de prueba propios.

## Desarrollo

Node.js 22 o superior. Las dependencias se instalan desde npm:

```sh
npm install
npm test
npm run build
# Configurar .env con los valores del servidor, sin publicarlos.
npm run migrate
npm start
```

El Dockerfile usa `npm ci` si existe `package-lock.json`; mientras no haya lockfile instala con `npm install`. **Generar y conservar el lockfile tras la primera instalación exitosa** para fijar la versión exacta de todas las dependencias. No se incluye un lockfile inventado.

Para desarrollo en dos terminales:

```sh
npm run dev:server
npm run dev
```

En desarrollo, usar `NODE_ENV=development` y `APP_ORIGIN=http://localhost:5173` (o el origen exacto indicado por Vite). `DATABASE_SSL=false` solo corresponde a PostgreSQL local de prueba. Para Supabase mantener TLS con verificación de certificado; si hace falta, montar su CA y configurar `DATABASE_CA_FILE`.

## Archivos

| Ruta | Función |
|---|---|
| `src/main.jsx`, `src/style.css` | Interfaz adaptable, login, conversaciones, historial, estados y envío |
| `server/app.js` | API, autorización, origen permitido, límites y rutas |
| `server/store.js` | Ingesta, deduplicación, historial y sincronización |
| `server/send.js` | Envío idempotente y coordinación del bot |
| `server/normalize.js` | Adaptación explícita de eventos de Evolution |
| `migrations/001_initial.sql` | Tablas, índices, RLS y esquema aislado |
| `integrations/n8n-capturar-evento.json` | Subworkflow de captura para importar y configurar |
| `integrations/n8n-enviar-texto.json` | Subworkflow de envío de texto mediante el gateway |
| `scripts/audit-workflows.js` | Inventario de candidatos a entrada/salida en exports de n8n |
| `docs/AUDITORIA.md` | Hechos verificados y pendientes de la infraestructura |
| `docs/INTEGRACION_N8N.md` | Integración por etapas, control de pausa y recuperación |
| `docs/DESPLIEGUE.md` | EasyPanel, seguridad y operación |
| `docs/PRUEBAS.md` | Casos locales y aceptación con un número de prueba |

## Comportamiento

- Solo acepta eventos cuyo `instance` coincide exactamente con `EVOLUTION_INSTANCE`.
- Reconoce `messages.upsert`, `send.message` y `messages.update`, también en mayúsculas con guion bajo.
- Deduplica por conversación + ID original + dirección. No inventa IDs externos; eventos sin ID quedan en cuarentena saneada.
- El historial se ordena por hora del proveedor. Si falta o no es válida, marca la hora como recepción con un asterisco. El cursor de sincronización usa secuencia de recepción para incluir mensajes tardíos.
- Una respuesta HTTP exitosa de Evolution significa **aceptado**, no entregado. Entrega y lectura necesitan ACK reales. Los estados no retroceden por eventos atrasados.
- Un mensaje saliente observado sin procedencia verificable aparece como **Enviado desde WhatsApp**. `fromMe=true` por sí solo no distingue secretaria y bot. Los envíos por el gateway se atribuyen al bot; los de la interfaz, al agente.
- La interfaz consulta cambios cada 3 segundos y conversaciones cada 5 segundos. Esta alternativa sencilla evita otra conexión persistente y políticas Realtime. No es una garantía de latencia de WhatsApp: depende de la llegada real del webhook.
- El primer historial disponible comienza con los eventos capturados. No se promete recuperar conversaciones anteriores.
- Se guardan metadatos mínimos de multimedia, sin descargar archivos, guardar media keys ni abrir URLs arbitrarias. La primera versión envía texto.

## Envíos y pausa

`EVOLUTION_SEND_ENABLED=false` bloquea envíos hasta validar la conexión. `BOT_GATEWAY_VERIFIED=false` mantiene deshabilitado el control humano hasta verificar los puntos de salida del bot. Estas restricciones son operativas y se aplican en el servidor, no solo en la interfaz.

Los estados `automatic`, `human` y `paused` viven en PostgreSQL. El gateway comprueba ese estado inmediatamente antes de enviar. El envío y los cambios de modo comparten un bloqueo de sesión PostgreSQL por conversación. Un envío que ya salió antes de pedir la pausa puede completarse; la pausa espera su resultado o el timeout. Una vez confirmado el cambio, el gateway no inicia nuevos envíos automáticos.

Un CRM caído no bloquea la rama de **captura** si se integra como subworkflow desacoplado. En cambio, el gateway de **envío** es una dependencia necesaria para una pausa fiable: si está caído, no hay envío automático nuevo. No existe un fallback directo a Evolution porque ignoraría la pausa. Este límite y el procedimiento de rollback están documentados.

Si Evolution devuelve timeout o error ambiguo, el mensaje queda `uncertain`. No se reenvía automáticamente. El mismo `requestId` recupera el resultado anterior. Un rechazo explícito permite un nuevo intento desde la interfaz. No se puede prometer exactamente un envío ante una caída entre la aceptación del proveedor y el guardado de su ID si el proveedor no ofrece idempotencia; estos casos requieren verificar WhatsApp y reconciliar manualmente.

## Seguridad

Todos los endpoints de conversaciones comprueban el token en Supabase Auth y exigen un usuario activo en `inbox.agents`. Los webhooks y el gateway usan secretos diferentes en `Authorization: Bearer ...`. La API key de Evolution y la conexión PostgreSQL solo existen en el servidor. El esquema `inbox` tiene RLS habilitado sin políticas públicas y permisos revocados a PUBLIC; mantenerlo fuera de los esquemas expuestos de Supabase. El backend usa conexión privada PostgreSQL. Ver `docs/DESPLIEGUE.md` para limitar el rol de conexión.

No hay datos ficticios de pacientes, semillas de producción ni credenciales incorporadas. Los únicos datos sintéticos están en las pruebas.
