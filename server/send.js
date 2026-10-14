import {recipient} from './normalize.js';
import {touch} from './store.js';
function fail(message,status=409){throw Object.assign(new Error(message),{status});}
export async function sendText(db,config,{conversationId,requestId,text,sender,agentId=null},fetcher=fetch){
 if(!config.sendEnabled)fail('Envíos deshabilitados hasta validar la conexión de Evolution.');
 if(sender==='agent'&&!config.gatewayVerified)fail('La atención manual requiere verificar el control del bot.');
 return db.lock(conversationId,async q=>{
  const {rows:[c]}=await q.query(`SELECT c.*,p.jid FROM inbox.conversations c JOIN inbox.contacts p ON p.id=c.contact_id WHERE c.id=$1`,[conversationId]);
  if(!c||c.instance!==config.instance)fail('Conversación inexistente',404);
  const {rows:[existing]}=await q.query('SELECT * FROM inbox.messages WHERE request_id=$1',[requestId]);
  if(existing){
   if(existing.conversation_id!==conversationId||existing.body!==text||existing.sender!==sender||existing.agent_id!==agentId)fail('La clave de envío ya pertenece a otra solicitud.');
   return existing;
  }
  if(sender==='bot'&&c.mode!=='automatic')return {blocked:true,reason:c.mode};
  if(sender==='agent'&&c.mode!=='human')fail('Seleccioná Atención humana antes de enviar.');
  const number=recipient(c.jid);if(!number)fail('Este contacto todavía no tiene un número verificado.');
  const {rows:[pending]}=await q.query(`INSERT INTO inbox.messages(conversation_id,direction,sender,agent_id,body,occurred_at,timestamp_source,status,request_id)
   VALUES($1,'out',$2,$3,$4,now(),'local','sending',$5) RETURNING *`,[conversationId,sender,agentId,text,requestId]);
  await touch(q,conversationId,pending.occurred_at);
  let result,status='uncertain',code=null;
  try{
   const response=await fetcher(`${config.evolutionUrl}/message/sendText/${encodeURIComponent(config.instance)}`,{
    method:'POST',redirect:'error',headers:{'Content-Type':'application/json',apikey:config.evolutionKey},
    body:JSON.stringify({number,text}),signal:AbortSignal.timeout(15000)});
   // Rechazos explícitos previos al envío permiten un nuevo intento. 408/429/5xx son ambiguos.
   if(!response.ok){code=`EVOLUTION_HTTP_${response.status}`;status=[400,401,403,404,422].includes(response.status)?'failed':'uncertain';}
   else {result=await response.json();status=result?.key?.id?'accepted':'uncertain';code=status==='uncertain'?'MISSING_PROVIDER_ID':null;}
  }catch{code='EVOLUTION_CONNECTION_UNCERTAIN';}
  await q.query('BEGIN');
  try{
   const externalId=typeof result?.key?.id==='string'?result.key.id:null;
   if(externalId){
    // Si el webhook llegó antes, se fusiona en la fila local conservando su estado confirmado.
    const {rows:[echo]}=await q.query(`DELETE FROM inbox.messages WHERE conversation_id=$1 AND external_id=$2 AND direction='out' AND id<>$3 RETURNING *`,[conversationId,externalId,pending.id]);
    const {rows:[receipt]}=await q.query('SELECT * FROM inbox.receipts WHERE jid=$1 AND external_id=$2',[c.jid,externalId]);
    const confirmed=(receipt?.rank||0)>(echo?.status_rank||0)?{status:receipt.status,status_rank:receipt.rank}:echo;
    await q.query(`UPDATE inbox.messages SET external_id=$2,status=$3,status_rank=$4,error_code=NULL WHERE id=$1`,[pending.id,externalId,confirmed?.status_rank?confirmed.status:'accepted',confirmed?.status_rank||0]);
   }else await q.query('UPDATE inbox.messages SET status=$2,error_code=$3 WHERE id=$1',[pending.id,status,code]);
   await q.query(`INSERT INTO inbox.audit_log(user_id,conversation_id,action,details) VALUES($1,$2,'send_result',$3)`,[agentId,conversationId,JSON.stringify({messageId:pending.id,status})]);
   await q.query('COMMIT');
  }catch(e){await q.query('ROLLBACK');throw e;}
  return (await q.query('SELECT * FROM inbox.messages WHERE id=$1',[pending.id])).rows[0];
 });
}
