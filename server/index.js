import {loadConfig} from './config.js';
import {createDatabase} from './db.js';
import {createApp} from './app.js';
let db;
try{
 const config=loadConfig();db=createDatabase(config);
 await db.query("SELECT version FROM inbox.schema_migrations WHERE version='001_initial'");
 // Un proceso interrumpido pudo haber enviado sin registrar la respuesta.
 // No reenvíe automáticamente. Conserva el requestId para reintentos idempotentes.
 await db.query("UPDATE inbox.messages SET status='uncertain',error_code='PROCESS_INTERRUPTED' WHERE status='sending' AND received_at<now()-interval '2 minutes'");
 const server=createApp(db,config).listen(config.port,'0.0.0.0',()=>console.log(JSON.stringify({event:'server_ready',port:config.port})));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(async()=>{await db.close();process.exit(0);});setTimeout(()=>process.exit(1),20000).unref();});
}catch(e){console.error('No se pudo iniciar Endomec Inbox. Revisá variables, conexión TLS y migraciones.');if(!db)console.error(e.message);process.exitCode=1;await db?.close();}
