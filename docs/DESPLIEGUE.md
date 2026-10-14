# Despliegue y operación

## Supabase

Crear el proyecto separado autorizado por el usuario en `narvier`. Confirmar costo/cupo en Supabase antes de crearlo. No reutilizar AgendaMica sin una nueva decisión explícita.

Aplicar `migrations/001_initial.sql` una vez desde SQL Editor. La migración es transaccional; una falla no debe dejar un esquema parcial. `npm run migrate` comprueba la existencia de la migración inicial y no la ejecuta dos veces. Las futuras alteraciones deben ser nuevas migraciones versionadas; no editar retrospectivamente la migración ya aplicada.

Crear usuarios desde Auth → Users. Deshabilitar el registro abierto. Insertar en `inbox.agents` el UUID exacto de cada usuario autorizado. Para revocar, `UPDATE inbox.agents SET active=false WHERE user_id='UUID_REAL'`; las rutas comprueban la autorización en cada solicitud.

El rol propietario usado en la primera instalación debe tener acceso al esquema. Como endurecimiento, crear un rol de backend con login por un canal seguro, asignarle acceso SOLO al esquema inbox y las secuencias necesarias, y definir políticas RLS para ese rol en esas tablas. No usar un rol sin políticas con la expectativa de que RLS lo deje pasar. Alternativa operativa mínima: conexión de servidor con el rol propietario protegido por la red y secretos de EasyPanel; nunca distribuirla a los navegadores. No se altera automáticamente el rol `postgres` del proyecto.

Mantener `inbox` fuera de los esquemas expuestos en API Settings. No habilitar políticas `true` para anon/authenticated. No es necesario añadir tablas a Realtime.

## EasyPanel

1. Crear un servicio de aplicación nuevo, por ejemplo `endomec-inbox`, dentro del proyecto del servidor adecuado.
2. Subir este código por la fuente admitida de EasyPanel (repositorio propio o carga de archivos) y seleccionar Dockerfile en la raíz.
3. Configurar **1 réplica** para la primera instalación. El diseño usa locks de PostgreSQL, pero las pruebas con varias réplicas quedan pendientes.
4. Asignar variables de `.env.example`. No guardar `.env` en Git. Generar secretos independientes de 32 bytes aleatorios o más con un gestor de contraseñas.
5. Conexión `DATABASE_URL`: copiar el **Session pooler, puerto 5432** que muestra Supabase. Usar contraseña URL-encoded si contiene caracteres especiales. Mantener `DATABASE_SSL=true`.
6. `APP_ORIGIN` = origen HTTPS exacto de la aplicación, sin rutas. `TRUST_PROXY=1` supone un proxy delante del proceso; ajustar a la topología real, sin usar `true` indiscriminadamente.
7. `EVOLUTION_BASE_URL` = raíz del servicio actual, sin `/manager` y sin doble barra. `EVOLUTION_INSTANCE` = nombre exacto de la instancia Endomec. La API key se configura como secreto del servidor.
8. Mantener `EVOLUTION_SEND_ENABLED=false` y `BOT_GATEWAY_VERIFIED=false` mientras se conecta y verifica la captura.
9. Exponer solo puerto interno **3000** por el proxy HTTPS. La base no requiere un puerto público nuevo del contenedor.
10. Ejecutar build y verificar `/api/health` = 200. El healthcheck no prueba Evolution; prueba que la base/migración esté disponible.
11. Ingresar con la cuenta autorizada. Un usuario Auth no incluido en `inbox.agents` debe recibir 403 al consultar datos.
12. Seguir la integración n8n y las pruebas. Habilitar las variables de envío y coordinación solo después de su validación, y redesplegar.

## Operación diaria

- El panel de configuración muestra última recepción, estado de habilitación y contador de eventos rechazados. No afirmar que WhatsApp está conectado solo porque el backend responde.
- Los logs del backend contienen ID de solicitud, código y estado, sin cuerpos de mensajes, teléfonos, cabeceras o claves.
- `inbox.rejected_events` guarda la representación mínima normalizada de eventos sin ID para revisión autorizada. Contiene texto y datos del chat: aplicar retención y acceso restringido como a las conversaciones.
- No hay recuperación automática de mensajes que nunca llegaron a n8n/Evolution. Los fallos de copia se recuperan reejecutando el subworkflow de captura con el evento original conservado por n8n. Las claves únicas hacen segura la repetición de eventos con ID.
- Al arrancar se convierten envíos `sending` de más de dos minutos en `uncertain`. Si un proceso sigue vivo pero falla el guardado después del envío, revisar el estado antes de reiniciar. No borrar esas filas ni reintentar a ciegas.
- No se implementa un merge automático de identidades LID/teléfono si el proveedor no da un vínculo verificable. Se usa `remoteJidAlt` telefónico cuando existe. Si cambian las identidades, revisar la vinculación antes de enviar.
- Envíos sin ID o timeout no se pueden reconciliar por similitud de texto con certeza. Revisar con el ID real antes de cualquier corrección SQL.

## Actualizar y revertir

Conservar el commit/código, lockfile y variables de cada versión. Hacer respaldo antes de nuevas migraciones. Compilar y probar la versión nueva en un servicio de prueba antes de sustituir la activa. No ejecutar migraciones destructivas desde el arranque del contenedor.

Si falla la captura, desactivar solo su llamada desacoplada y reparar/reprocesar. Si se necesita revertir el gateway, primero cerrar la atención manual y acordar un único estado operativo del bot; restaurar los nodos HTTP desde el backup. Un fallback automático directo a Evolution rompería la pausa y no está implementado.

## Retención

Definir con Endomec cuánto tiempo conservar chats, auditoría, eventos rechazados y ejecuciones n8n. No se borran conversaciones automáticamente en esta primera entrega. Usar backups del proyecto y verificar restauración en un entorno separado antes de adoptar una política de limpieza.
