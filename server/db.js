import pg from 'pg';
export function createDatabase(config){
 const pool=new pg.Pool({connectionString:config.databaseUrl,ssl:config.ssl,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:25000});
 pool.on('error',()=>console.error(JSON.stringify({event:'database_connection_error'})));
 return {query:(...args)=>pool.query(...args),close:()=>pool.end(),
  async lock(id,fn){const c=await pool.connect();let locked=false,destroy=false;try{await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[id]);locked=true;return await fn(c);}finally{if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[id]).catch(()=>{destroy=true;});c.release(destroy);}},
  async transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
}
