import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {z} from 'zod';
import {ingest,listConversations,messages,syncMessages,setMode,ensureConversation} from './store.js';
import {sendText} from './send.js';
import {recipient} from './normalize.js';
const uuid=z.string().uuid();
const sendSchema=z.object({conversationId:uuid,requestId:uuid,text:z.string().trim().min(1).max(4096)});
function secretGuard(secret){return (req,res,next)=>{const got=Buffer.from(req.get('authorization')?.replace(/^Bearer /,'')||'');const expected=Buffer.from(secret);if(got.length!==expected.length||!timingSafeEqual(got,expected))return res.status(401).json({error:'No autorizado'});next();};}
export function createApp(db,config,{fetcher=fetch}={}){
 const app=express();app.disable('x-powered-by');if(config.trustProxy)app.set('trust proxy',config.trustProxy);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],connectSrc:["'self'",config.supabaseUrl],imgSrc:["'self'",'data:'],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
 app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');req.requestId=randomUUID();next();});
 app.use(express.json({limit:'1mb'}));
 app.get('/api/health',async(req,res)=>{try{await db.query('SELECT version FROM inbox.schema_migrations LIMIT 1');res.json({ok:true});}catch{res.status(503).json({ok:false});}});
 app.get('/api/config',(req,res)=>res.json({supabaseUrl:config.supabaseUrl,anonKey:config.anonKey}));
 const integrationLimit=rateLimit({windowMs:60000,limit:600,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiadas solicitudes; reintentar con espera.'}});
 app.post('/api/integrations/evolution',integrationLimit,secretGuard(config.webhookSecret),async(req,res)=>{
  const body=z.object({instance:z.string(),event:z.string(),data:z.union([z.record(z.string(),z.unknown()),z.array(z.record(z.string(),z.unknown()))])}).parse(req.body);
  const result=await ingest(db,config,body);res.json(result);
 });
 app.post('/api/integrations/bot/send-text',integrationLimit,secretGuard(config.botSecret),async(req,res)=>{
  const body=z.object({jid:z.string().refine(v=>!!recipient(v)),requestId:uuid,text:z.string().trim().min(1).max(4096)}).parse(req.body);
  const c=await ensureConversation(db,config.instance,body.jid);
  const result=await sendText(db,config,{conversationId:c.id,requestId:body.requestId,text:body.text,sender:'bot'},fetcher);
  res.status(result.status==='failed'?502:200).json(result);
 });
 app.get('/api/integrations/bot/state',integrationLimit,secretGuard(config.botSecret),async(req,res)=>{
  const jid=z.string().refine(v=>!!recipient(v)).parse(req.query.jid);
  const {rows:[c]}=await db.query('SELECT c.mode FROM inbox.conversations c JOIN inbox.contacts p ON c.contact_id=p.id WHERE p.jid=$1',[jid]);
  res.json({mode:c?.mode||'automatic',maySend:!c||c.mode==='automatic',advisoryOnly:true});
 });
 app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiadas solicitudes; esperá un minuto.'}}));
 app.use('/api',async(req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method)&&req.get('origin')!==config.origin)return res.status(403).json({error:'Origen no autorizado'});
  const token=req.get('authorization');if(!token?.startsWith('Bearer '))return res.status(401).json({error:'Iniciá sesión para continuar.'});
  let response;try{response=await fetcher(`${config.supabaseUrl}/auth/v1/user`,{headers:{Authorization:token,apikey:config.anonKey},signal:AbortSignal.timeout(8000)});}catch{return res.status(503).json({error:'No se pudo verificar la sesión. Reintentá.'});}
  if(!response.ok)return res.status(401).json({error:'La sesión venció. Volvé a ingresar.'});
  const user=await response.json();if(!uuid.safeParse(user.id).success)return res.status(401).json({error:'Sesión inválida.'});
  const {rows:[agent]}=await db.query('SELECT * FROM inbox.agents WHERE user_id=$1 AND active=true',[user.id]);
  if(!agent)return res.status(403).json({error:'Tu cuenta no está autorizada para Endomec.'});req.agent=agent;next();
 });
 app.get('/api/me',async(req,res)=>res.json({agent:req.agent,gatewayVerified:config.gatewayVerified,sendEnabled:config.sendEnabled,instance:config.instance,integration:(await db.query('SELECT * FROM inbox.integration_health WHERE id=1')).rows[0]}));
 app.get('/api/conversations',async(req,res)=>{
  const search=z.string().max(100).parse(req.query.search||'');const offset=z.coerce.number().int().min(0).max(100000).parse(req.query.offset||0);
  const rows=await listConversations(db,req.agent.user_id,search,offset);res.json({items:rows,hasMore:rows.length===60});
 });
 app.get('/api/conversations/:id/messages',async(req,res)=>{
  const id=uuid.parse(req.params.id);let before;
  if(req.query.beforeAt)before={at:z.iso.datetime({offset:true}).parse(req.query.beforeAt),seq:z.string().regex(/^\d+$/).parse(req.query.beforeSeq)};
  const afterSeq=(await db.query('SELECT COALESCE(max(seq),0)::text seq FROM inbox.messages WHERE conversation_id=$1',[id])).rows[0].seq;
  const items=await messages(db,id,before);res.json({items,hasMore:items.length===60,afterSeq});
 });
 app.post('/api/conversations/:id/sync',async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const body=z.object({afterSeq:z.string().regex(/^\d+$/),knownIds:z.array(uuid).max(500)}).parse(req.body);
  res.json(await syncMessages(db,id,body.afterSeq,body.knownIds));
 });
 app.post('/api/conversations/:id/read',async(req,res)=>{
  const id=uuid.parse(req.params.id),ids=z.array(uuid).max(500).parse(req.body.ids);
  await db.query(`INSERT INTO inbox.message_reads(message_id,user_id)
   SELECT id,$2 FROM inbox.messages WHERE conversation_id=$1 AND id=ANY($3::uuid[]) AND direction='in'
   ON CONFLICT DO NOTHING`,[id,req.agent.user_id,ids]);res.json({ok:true});
 });
 app.patch('/api/conversations/:id/mode',async(req,res)=>res.json(await setMode(db,config,uuid.parse(req.params.id),z.enum(['automatic','human','paused']).parse(req.body.mode),req.agent.user_id)));
 app.post('/api/messages',async(req,res)=>res.json(await sendText(db,config,{...sendSchema.parse(req.body),sender:'agent',agentId:req.agent.user_id},fetcher)));
 // Un reintento explícito SOLO para rechazo confirmado. Nuevo UUID en servidor;
 // enlazado al intento previo mediante clave determinista guardada en auditoría no es necesario:
 // el cliente mantiene un requestId por intento, incluso si se pierde la respuesta HTTP.
 app.use('/api',(req,res)=>res.status(404).json({error:'Ruta inexistente'}));
 app.use(express.static(resolve('dist'),{index:false,cacheControl:false}));
 app.get('/{*path}',(req,res)=>res.sendFile(resolve('dist/index.html')));
 app.use((err,req,res,next)=>{
  const validation=err instanceof z.ZodError;const status=validation?400:err.status||500;
  console.error(JSON.stringify({event:'request_error',requestId:req.requestId,status,code:validation?'VALIDATION_ERROR':'REQUEST_FAILED'}));
  res.status(status).json({error:validation?'Los datos enviados no son válidos.':status<500?err.message:'No se pudo completar la operación. Reintentá en unos instantes.',requestId:req.requestId});
 });return app;
}
