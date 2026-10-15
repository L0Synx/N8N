import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { createApp } from './app.js';

let db;
let server;

try {
  const config = loadConfig();

  db = createDatabase(config);

  // Verificar la conexión y que la migración inicial exista.
  await db.query(
    "SELECT version FROM inbox.schema_migrations WHERE version = '001_initial'"
  );

  // Si el proceso se interrumpió durante un envío, no reenviar
  // automáticamente. El estado queda pendiente de reconciliación.
  await db.query(`
    UPDATE inbox.messages
    SET status = 'uncertain',
        error_code = 'PROCESS_INTERRUPTED'
    WHERE status = 'sending'
      AND received_at < now() - interval '2 minutes'
  `);

  server = createApp(db, config).listen(
    config.port,
    '0.0.0.0',
    () => {
      console.log(
        JSON.stringify({
          event: 'server_ready',
          port: config.port
        })
      );
    }
  );

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(async () => {
        try {
          await db.close();
          process.exit(0);
        } catch (error) {
          console.error('Error cerrando la base de datos:', error.message);
          process.exit(1);
        }
      });

      setTimeout(() => process.exit(1), 20000).unref();
    });
  }
} catch (error) {
  console.error('No se pudo iniciar Endomec Inbox.');
  console.error('Tipo de error:', error?.name ?? 'desconocido');
  console.error('Código:', error?.code ?? 'sin código');
  console.error('Detalle:', error?.message ?? 'sin detalle');

  // Mostrar el stack para poder localizar el archivo y la línea.
  if (error?.stack) {
    console.error(error.stack);
  }

  process.exitCode = 1;

  if (db) {
    try {
      await db.close();
    } catch (closeError) {
      console.error(
        'Error cerrando la base de datos:',
        closeError?.message ?? 'desconocido'
      );
    }
  }
}
