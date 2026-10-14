# Auditoría de infraestructura · 14/10/2026

## Verificado

- El espacio de trabajo no contenía un proyecto anterior ni configuración del servidor.
- Supabase conectado: organización `narvier`, proyecto existente `AgendaMica`, estado `ACTIVE_HEALTHY`. El usuario eligió **un proyecto nuevo**, no modificar AgendaMica.
- La herramienta de consulta de costo de Supabase devolvió `UNAVAILABLE`; no se creó ningún proyecto ni se ejecutó SQL en AgendaMica.
- Se accedió al listado real de n8n en el navegador. La carpeta **Endomec V3** mostraba 18 workflows. También existen carpetas Endomec anteriores; no se puede asumir que están inactivas.
- Se abrió, en modo inspección, **ENDOMEC v3 - BOT ENDOMEC**. Mostraba estado Published, `Webhook1` activo y otro nodo `Webhook` desactivado. No se abrió la configuración ni se verificó el path efectivo.
- El canvas del workflow principal muestra: `IF Pausa humana`, `IF No esta pausado`, `Consultar si el bot esta habilitado`, `Bot habilitado?`, `Reservar mensaje una vez` (PostgreSQL), `Restituir mensaje reservado`, `Detectar mensajes viejos` y `Notificacion Whatsapp1` (POST).
- El workflow principal llama a los subworkflows **WF Menu**, **WF Sacar Turno**, **WF Consultas**, **WF Ubicacion / Horarios**, **WF Secretaria Notificacion** y **Procesar Confirmacion Recordatorio**. Hay envíos potenciales fuera de la entrada principal; es necesario inventariarlos.
- El listado incluye además **Enviar Recordatorios**, **Pendientes Confirmacion**, **Mantenimiento programado**, **WF Reprogramar turno**, **WF Secretaria**, **Errores**, **Operaciones SOOL**, **Sesion SOOL** y **Bot Config**.
- Se intentó exportar el workflow principal mediante Download. La operación de descarga no devolvió un archivo confirmado; no se analiza ni se afirma haber obtenido ese JSON.
- No se editó, publicó, activó, desactivó ni ejecutó ningún workflow.

## Pendiente antes de conectar producción

| Dato | Cómo verificarlo | Motivo |
|---|---|---|
| Imagen/tag/digest real de Evolution | EasyPanel → servicio Evolution | El texto del usuario menciona 2.4.0; no basta para identificar build y contrato |
| Webhook de Endomec y eventos habilitados | Configuración de la instancia, sin reemplazar URL | Capturar entrada, salida y estados |
| Payload entrante, saliente y ACK | Ejecución controlada con número propio; eliminar secretos | Validar el adaptador y las variantes de JID/LID |
| URLs y métodos de cada envío | Exportar todos los workflows candidatos | Identificar texto, listas, botones, medios y alertas |
| Pausa humana ya existente | Leer condiciones y tabla utilizada por ambos IF | Evitar dos fuentes de estado independientes |
| API de envío de texto instalada | HTTP Request existente + prueba controlada | Verificar `/message/sendText/{instance}` y `{number,text}` en el servidor real |
| Capacidad/puertos/red de EasyPanel | Panel del servidor | Crear un servicio sin desplazar los existentes |
| Autorizados a ver chats | Usuarios de Endomec | Dar de alta cuentas concretas |

## Decisiones provisionales

1. Un servicio Node sirve el frontend y la API en el mismo origen; PostgreSQL y Auth viven en Supabase.
2. Ingesta compatible con los eventos documentados de Evolution v2, aislada por nombre de instancia. No se asume que el webhook actual emite todos esos eventos.
3. Captura desacoplada de n8n. Sin sustitución del webhook productivo ni fan-out en el camino crítico.
4. Gateway de texto con bloqueo por conversación. Los endpoints de otros tipos de mensaje no se inventan: deben verificarse antes de extender el adaptador y activar la toma de atención humana para el bot completo.
5. PostgreSQL por sesión para los bloqueos. No se usa el pooler en modo transacción.
6. La configuración de pausa se mantiene cerrada hasta coordinar la pausa existente de n8n con la nueva. `BOT_GATEWAY_VERIFIED` no es un detector automático: es una habilitación de operador después de completar la auditoría.

## Fuentes consultadas

- Documentación de Supabase, `auth.getUser`: https://supabase.com/docs/reference/javascript/auth-getuser
- Eventos de Evolution: https://github.com/evolution-foundation/evolution-docs/blob/main/docs/02-Configuration/Webhooks.md
- Releases del proveedor: https://github.com/evolution-foundation/evolution-api/releases
- Se localizaron reportes de usuarios sobre sendText 2.4.0; no se toman como certificación del contrato de la instancia instalada.

La documentación pública orienta el adaptador; la compatibilidad exacta sigue dependiendo de los payloads y la versión instalados en Endomec.
