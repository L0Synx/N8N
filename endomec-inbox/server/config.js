import { readFileSync } from 'node:fs';
export function loadConfig(env=process.env) {
 const required=['DATABASE_URL','SUPABASE_URL','SUPABASE_ANON_KEY','EVOLUTION_BASE_URL','EVOLUTION_API_KEY','EVOLUTION_INSTANCE','WEBHOOK_SECRET','BOT_GATEWAY_SECRET','APP_ORIGIN'];
 const missing=required.filter(k=>!env[k]);
 if(missing.length) throw new Error(`Faltan variables: ${missing.join(', ')}`);
 for(const key of ['WEBHOOK_SECRET','BOT_GATEWAY_SECRET']) if(env[key].length<32) throw new Error(`${key} requiere 32 caracteres como mínimo`);
 if(env.WEBHOOK_SECRET===env.BOT_GATEWAY_SECRET) throw new Error('Usar secretos distintos para webhook y gateway');
 for(const key of ['SUPABASE_URL','EVOLUTION_BASE_URL','APP_ORIGIN']) {
  const u=new URL(env[key]);
  if(env.NODE_ENV==='production' && u.protocol!=='https:') throw new Error(`${key} requiere HTTPS`);
 }
 return {port:Number(env.PORT||3000), origin:new URL(env.APP_ORIGIN).origin,
  databaseUrl:env.DATABASE_URL, ssl:env.DATABASE_SSL==='false'?false:{rejectUnauthorized:true,...(env.DATABASE_CA_FILE?{ca:readFileSync(env.DATABASE_CA_FILE,'utf8')}:{})},
  supabaseUrl:env.SUPABASE_URL.replace(/\/$/,''),anonKey:env.SUPABASE_ANON_KEY,
  evolutionUrl:env.EVOLUTION_BASE_URL.replace(/\/+$/,''),evolutionKey:env.EVOLUTION_API_KEY,instance:env.EVOLUTION_INSTANCE,
  webhookSecret:env.WEBHOOK_SECRET,botSecret:env.BOT_GATEWAY_SECRET,
  gatewayVerified:env.BOT_GATEWAY_VERIFIED==='true',sendEnabled:env.EVOLUTION_SEND_ENABLED==='true',trustProxy:Number(env.TRUST_PROXY||0)};
}
