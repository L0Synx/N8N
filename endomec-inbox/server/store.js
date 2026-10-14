import { createHash } from 'node:crypto';
import { normalize, receiptStatus, validJid, recipient } from './normalize.js';
export async function ensureConversation(q,instance,jid,name=null){
 const {rows:[contact]}=await q.query(`INSERT INTO inbox.contacts(jid,phone,name) VALUES($1,$2,$3)
 ON CONFLICT(jid) DO UPDATE SET name=COALESCE(EXCLUDED.name,inbox.contacts.name),phone=COALESCE(EXCLUDED.phone,inbox.contacts.phone) RETURNING *`,[jid,recipient(jid),name]);
 const {rows:[conversation]}=await q.query(`INSERT INTO inbox.conversations(contact_id,instance) VALUES($1,$2)
 ON CONFLICT(contact_id) DO UPDATE SET contact_id=EXCLUDED.contact_id RETURNING *`,[contact.id,instance]);
 return conversation;
}
async function touch(q,conversationId,at){
 await q.query(`UPDATE inbox.conversations SET last_message_at=GREATEST(last_message_at,$2::timestamptz),updated_at=now() WHERE id=$1`,[conversationId,at]);
 await q.query(`UPDATE inbox.contacts SET last_activity=GREATEST(last_activity,$2::timestamptz) WHERE id=(SELECT contact_id FROM inbox.conversations WHERE id=$1)`,[conversationId,at]);
}
export async function ingest(db,config,payload){
 if(payload.instance!==config.instance)return {ignored:1,reason:'other_instance'};
 const event=String(payload.event||'').toLowerCase().replaceAll('_','.');
 if(!['messages.upsert','send.message','messages.update'].includes(event))return {ignored:1,reason:'unsupported_event'};
 const items=Array.isArray(payload.data)?payload.data:[payload.data];
 if(items.length>200)throw Object.assign(new Error('Máximo 200 eventos por solicitud'),{status:413});
 let saved=0,rejected=0,ignored=0;
 for(const item of items){
  if(!item||typeof item!=='object'){ignored++;continue;}
  const normalized=event==='messages.update'?null:normalize(item);
  // Crear la conversación fuera de la transacción evita invertir el orden de locks
  // entre ingesta y envíos (advisory -> filas) y mantiene el webhook reintentable.
  const conversation=normalized&&!normalized.ignored&&normalized.externalId?await ensureConversation(db,config.instance,normalized.jid,normalized.direction==='in'?normalized.name:null):null;
  await db.transaction(async q=>{
   if(event==='messages.update'){
    const jid=item.key?.remoteJid||item.remoteJid;const id=item.key?.id||item.keyId;const receipt=receiptStatus(item.update?.status??item.status);
    if(!validJid(jid)||!id||!receipt){ignored++;return;}
    await q.query(`INSERT INTO inbox.receipts(jid,external_id,status,rank) VALUES($1,$2,$3,$4)
     ON CONFLICT(jid,external_id) DO UPDATE SET status=CASE WHEN EXCLUDED.rank>inbox.receipts.rank THEN EXCLUDED.status ELSE inbox.receipts.status END,rank=GREATEST(inbox.receipts.rank,EXCLUDED.rank),updated_at=now()`,[jid,id,receipt.status,receipt.rank]);
    await q.query(`UPDATE inbox.messages m SET status=$3,status_rank=$4 FROM inbox.conversations c,inbox.contacts p
     WHERE m.conversation_id=c.id AND c.contact_id=p.id AND p.jid=$1 AND m.external_id=$2 AND m.direction='out' AND m.status_rank<$4`,[jid,id,receipt.status,receipt.rank]);
    saved++;return;
   }
   const m=normalized;
   if(m.ignored){ignored++;return;}
   if(!m.externalId){
    // Huella de diagnóstico, nunca se presenta como ID original del proveedor.
    const fingerprint=createHash('sha256').update(JSON.stringify({...m,occurredAt:m.timestampSource==='received'?null:m.occurredAt})).digest('hex');
    await q.query(`INSERT INTO inbox.rejected_events(reason,fingerprint,normalized) VALUES('missing_message_id',$1,$2) ON CONFLICT DO NOTHING`,[fingerprint,JSON.stringify(m)]);
    rejected++;return;
   }
   const c=conversation;
   await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[c.id]);
   const {rows:[pendingReceipt]}=await q.query('SELECT * FROM inbox.receipts WHERE jid=$1 AND external_id=$2',[m.jid,m.externalId]);
   const receipt=pendingReceipt?.rank>(m.receipt?.rank||0)?pendingReceipt:m.receipt;
   const status=m.direction==='in'?'received':receipt?.status||'accepted';
   await q.query(`INSERT INTO inbox.messages(conversation_id,external_id,direction,sender,body,kind,occurred_at,timestamp_source,status,status_rank,media)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(conversation_id,external_id,direction) DO UPDATE
    SET status=CASE WHEN EXCLUDED.status_rank>inbox.messages.status_rank THEN EXCLUDED.status ELSE inbox.messages.status END,
    status_rank=GREATEST(inbox.messages.status_rank,EXCLUDED.status_rank)`,
    [c.id,m.externalId,m.direction,m.sender,m.body,m.kind,m.occurredAt,m.timestampSource,status,m.direction==='out'?(receipt?.rank||0):0,JSON.stringify(m.media)]);
   await touch(q,c.id,m.occurredAt);saved++;
  });
 }
 await db.query(`UPDATE inbox.integration_health SET last_event_at=now(),rejected_count=rejected_count+$1 WHERE id=1`,[rejected]);
 return {saved,rejected,ignored};
}
export async function listConversations(db,userId,search='',offset=0){
 return (await db.query(`SELECT c.*,p.name,p.phone,p.jid,m.body AS last_body,m.kind AS last_kind,m.direction AS last_direction,
 (SELECT count(*)::int FROM inbox.messages u WHERE u.conversation_id=c.id AND u.direction='in' AND NOT EXISTS(SELECT 1 FROM inbox.message_reads r WHERE r.message_id=u.id AND r.user_id=$1)) AS unread
 FROM inbox.conversations c JOIN inbox.contacts p ON p.id=c.contact_id
 LEFT JOIN LATERAL (SELECT body,kind,direction FROM inbox.messages WHERE conversation_id=c.id ORDER BY occurred_at DESC,seq DESC LIMIT 1) m ON true
 WHERE ($2='' OR COALESCE(p.name,'') ILIKE '%'||$2||'%' OR COALESCE(p.phone,'') ILIKE '%'||$2||'%')
 ORDER BY c.last_message_at DESC NULLS LAST,c.id LIMIT 60 OFFSET $3`,[userId,search,offset])).rows;
}
export async function messages(db,id,before){
 const params=[id];let where='';
 if(before){params.push(before.at,before.seq);where='AND (occurred_at,seq)<($2::timestamptz,$3::bigint)';}
 return (await db.query(`SELECT * FROM inbox.messages WHERE conversation_id=$1 ${where} ORDER BY occurred_at DESC,seq DESC LIMIT 60`,params)).rows.reverse();
}
export async function syncMessages(db,id,afterSeq,knownIds){
 // El cursor de recepción (no la hora del paciente) incluye eventos tardíos.
 const {rows:fresh}=await db.query('SELECT * FROM inbox.messages WHERE conversation_id=$1 AND seq>$2 ORDER BY seq LIMIT 200',[id,afterSeq]);
 const {rows:known}=await db.query('SELECT * FROM inbox.messages WHERE conversation_id=$1 AND id=ANY($2::uuid[])',[id,knownIds]);
 return {items:[...new Map([...known,...fresh].map(m=>[m.id,m])).values()],afterSeq:fresh.length?String(fresh[fresh.length-1].seq):String(afterSeq),hasMore:fresh.length===200};
}
export async function setMode(db,config,id,mode,userId){
 if(!config.gatewayVerified)throw Object.assign(new Error('Primero hay que verificar la integración de todos los envíos del bot.'),{status:409});
 return db.lock(id,async q=>{
  const {rows:[row]}=await q.query('UPDATE inbox.conversations SET mode=$2,updated_at=now() WHERE id=$1 RETURNING *',[id,mode]);
  if(!row)throw Object.assign(new Error('Conversación inexistente'),{status:404});
  await q.query(`INSERT INTO inbox.audit_log(user_id,conversation_id,action,details) VALUES($1,$2,'mode_change',$3)`,[userId,id,JSON.stringify({mode})]);
  return row;
 });
}
export {touch};
