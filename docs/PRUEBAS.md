# Verificación de la primera versión

## Ejecutado en esta entrega

14/10/2026, Node.js 24.15.0 en Windows:

- `node --test tests/*.test.js`: **12 aprobadas, 0 fallidas, 3 omitidas**.
- Las 12 pruebas comprueban normalización de texto, origen saliente no atribuido, exclusión de grupos, JID/LID, fechas inválidas, ausencia de ID, envoltorios efímeros, listas, saneamiento de medios, ACK, validación de destinatario y configuración segura.
- `node --check` en todos los módulos `server/` y `scripts/`: sin errores de sintaxis.
- `node scripts/verify-source.js`: JSON de subworkflows, referencias entre nodos, sintaxis de sus Code nodes y controles estáticos del frontend aprobados. No sustituye una importación real en n8n ni un build JSX.
- Las tres pruebas SQL usan PGlite (PostgreSQL WASM) y fueron omitidas por dependencia no instalada. El runner informa explícitamente las omisiones.
- La descarga de dependencias falló por acceso de red restringido; el cache no contenía PGlite. No se ejecutó `npm run build` exitosamente ni se inspeccionó la aplicación renderizada.
- No se creó base de prueba remota, no se envió WhatsApp ni se ejecutó/modificó el bot productivo.

## Después de instalar dependencias

```sh
npm install
npm test
npm run build
```

Las pruebas SQL deben ejecutarse sin omisiones. Usan datos sintéticos en una base local en memoria, nunca una base de pacientes. Verifican deduplicación, orden tardío, aislamiento de instancia, ACK monotónicos, reconciliación de eco, idempotencia, bloqueo humano, reactivación y cuarentena.

PGlite no prueba los advisory locks de PostgreSQL: el adaptador de prueba los omite explícitamente. Hacer la prueba de concurrencia siguiente en un PostgreSQL real aislado, con el pooler por sesión, antes de producción.

## Aceptación en entorno controlado

Usar una instancia/número de prueba propios. No enviar mensajes a pacientes para probar. Configurar una cuenta autorizada y otra sin autorización. Confirmar la versión exacta de Evolution y capturar eventos saneados reales para validar `normalize.js`.

| Caso | Acción | Resultado que debe observarse | Estado |
|---|---|---|---|
| Entrada | Enviar un texto desde el número de prueba | Chat, contenido y fecha correctos; aparece sin recarga | Pendiente |
| Salida del bot | Enviar por gateway con UUID único | Una fila atribuida a bot y texto recibido por el número correcto | Pendiente |
| Salida manual | Cambiar a humana y enviar desde UI | Texto recibido, atribuido a agente; sin respuesta automática posterior | Pendiente |
| Eco | Repetir el webhook del envío manual | Un solo mensaje con el ID original | Pendiente |
| Actualización | Dejar el chat abierto y recibir mensaje | Se actualiza en el siguiente ciclo (3 s más latencias) | Pendiente |
| Historia | Enviar dos eventos con fechas invertidas | Orden por fecha, no por recepción | Pendiente |
| Duplicado | Repetir exactamente un evento | Una fila; no suma no leídos | Pendiente |
| Tardío | Enviar después un evento con hora de ayer | No baja última actividad; aparece al sincronizar y conserva fecha | Pendiente |
| ACK | Enviar READ y luego DELIVERY_ACK | No retrocede de leído a entregado | Pendiente |
| Rechazo | Configurar API key inválida en prueba | Fallo comprensible; no lo marca entregado; nuevo intento explícito | Pendiente |
| Timeout | Simular proveedor que no responde | Queda incierto; mismo UUID no dispara otro envío | Pendiente |
| Humana | Intentar respuesta bot tras confirmar humana | `blocked=true`; Evolution no recibe un nuevo envío | Pendiente |
| Reactivación | Cambiar a automático y enviar evento nuevo | Bot vuelve a responder; no reproduce backlog humano | Pendiente |
| Privacidad | Sin token y con usuario no autorizado | 401 y 403 respectivamente; sin nombres/textos en respuesta | Pendiente |
| Secretos | Inspeccionar bundle y red del navegador | Solo clave pública de Auth; nunca Evolution, DB ni secretos de integración | Pendiente |
| Bot existente | Pruebas de turno, confirmación, recordatorio y secretaria | Comportamiento previo conservado | Pendiente |
| Captura caída | Apagar receptor de copia, manteniendo bot previo | El bot continúa; fallo de captura queda registrado y recuperable | Pendiente |
| Gateway caído | Apagar gateway ya integrado | No hay fallback directo que eluda la pausa; alertar y recuperar | Pendiente |
| LID | Evento sin teléfono y otro con remoteJidAlt válido | Sin envío a un teléfono inferido; mapeo solo con evidencia | Pendiente |
| Móvil | Anchos 375, 760, 1280 px | Lista/chat navegables, enviar y volver accesibles | Pendiente |
| Scroll | Leer historia mientras llegan mensajes | No salta al final; botón permite volver | Pendiente |

## Concurrencia y reinicio

1. Abrir dos solicitudes simultáneas de envío con el mismo UUID: debe haber una sola llamada a Evolution.
2. Iniciar envío bot y pedir modo humano durante la solicitud: el cambio espera el lock; puede completar el envío ya iniciado. Después del cambio confirmado, otro envío bot debe bloquearse.
3. Enviar webhook y ACK mientras el envío manual sigue en curso: no debe haber deadlock, ni duplicación, ni regresión de ACK.
4. Cortar el proceso después de persistir `sending`: al reiniciar pasado el umbral se marca incierto, sin reenvío.
5. Cortar la conexión PostgreSQL después de que Evolution acepte: revisar incertidumbre; no afirmar una garantía exactly-once sin soporte del proveedor.

Registrar fecha, operador, versión del servidor, versión del proyecto y resultado de cada caso antes de habilitar `BOT_GATEWAY_VERIFIED`.
