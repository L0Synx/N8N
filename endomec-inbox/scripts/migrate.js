import {readFile} from 'node:fs/promises';
import {loadConfig} from '../server/config.js';
import {createDatabase} from '../server/db.js';
const db=createDatabase(loadConfig());
try{
 const exists=await db.query("SELECT to_regclass('inbox.schema_migrations') AS present");
 if(exists.rows[0].present)console.log('La migración inicial ya está aplicada.');
 else{await db.query(await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));console.log('Migración 001 aplicada.');}
}catch{console.error('No se pudo aplicar la migración. Verificá conexión, permisos y estado del esquema.');process.exitCode=1;}finally{await db.close();}
