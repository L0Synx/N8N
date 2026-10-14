import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {ingest,listConversations,messages,setMode,syncMessages} from '../server/store.js';
import {sendText} from '../server/send.js';
// PostgreSQL WASM local. Las pruebas de locks concurrentes requieren PostgreSQL real;
// este adaptador omite únicamente advisory locks (no soportados por PGlite).
let PGlite;try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
const config={instance:'Endomec',gatewayVerified:true,sendEnabled:true,evolutionUrl:'https://provider.invalid',evolutionKey:'test-only'};
const jid='5493510000000@s.whatsapp.net';
function event(id,text='hola',extra={}){return {instance:'Endomec',event:'messages.upsert',data:{key:{id,remoteJid:jid,fromMe:false},message:{conversation:text},messageTimestamp:1792015200,...extra}};}
async function fixture(){const pg=new PGlite();await pg.exec(await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));const query=async(sql,params=[])=>sql.includes('pg_advisory_')?{rows:[]}:pg.query(sql,params);const db={query,transaction:fn=>pg.transaction(tx=>fn({query:(sql,p=[])=>sql.includes('pg_advisory_')?{rows:[]}:tx.query(sql,p)})),lock:(_id,fn)=>fn({query})};return {db,close:()=>pg.close()};}
test('SQL: duplicados, eventos tardíos, instancias aisladas y recibos monotónicos',{skip:!PGlite&&'PGlite no instalado'},async()=>{const {db,close}=await fixture();try{
 await ingest(db,config,event('A'));await ingest(db,config,event('A'));await ingest(db,config,{...event('B'),instance:'Other'});
 assert.equal((await db.query('SELECT count(*)::int n FROM inbox.messages')).rows[0].n,1);
 await ingest(db,config,event('OLD','tardío',{messageTimestamp:1791928800}));
 const {rows:[c]}=await db.query('SELECT * FROM inbox.conversations');const timeline=await messages(db,c.id);assert.deepEqual(timeline.map(m=>m.external_id),['OLD','A']);
 const sync=await syncMessages(db,c.id,'1',[]);assert.equal(sync.items[0].external_id,'OLD');
 await ingest(db,config,{instance:'Endomec',event:'messages.update',data:{keyId:'OUT',remoteJid:jid,status:'READ'}});
 await ingest(db,config,event('OUT','saliente',{key:{id:'OUT',remoteJid:jid,fromMe:true}}));
 await ingest(db,config,{instance:'Endomec',event:'messages.update',data:{keyId:'OUT',remoteJid:jid,status:'DELIVERY_ACK'}});
 assert.equal((await db.query("SELECT status FROM inbox.messages WHERE external_id='OUT'")).rows[0].status,'read');
 }finally{await close();}});
test('SQL: envío idempotente, eco, control humano y error incierto',{skip:!PGlite&&'PGlite no instalado'},async()=>{const {db,close}=await fixture();try{
 await ingest(db,config,event('A'));const {rows:[c]}=await db.query('SELECT * FROM inbox.conversations');const agent=randomUUID();await db.query("INSERT INTO inbox.agents(user_id,display_name) VALUES($1,'Prueba')",[agent]);
 await setMode(db,config,c.id,'human',agent);let calls=0;const fetcher=async()=>{calls++;return {ok:true,json:async()=>({key:{id:`SEND-ID-${calls}`},status:'PENDING'})};};
 const input={conversationId:c.id,requestId:randomUUID(),text:'Respuesta de prueba',sender:'agent',agentId:agent};
 const first=await sendText(db,config,input,fetcher);assert.equal(first.status,'accepted');assert.equal((await sendText(db,config,input,fetcher)).id,first.id);assert.equal(calls,1);
 await ingest(db,config,event('SEND-ID-1',input.text,{key:{id:'SEND-ID-1',remoteJid:jid,fromMe:true}}));
 assert.equal((await db.query("SELECT count(*)::int n FROM inbox.messages WHERE external_id='SEND-ID-1'")).rows[0].n,1);
 assert.equal((await sendText(db,config,{...input,requestId:randomUUID(),sender:'bot',agentId:null},fetcher)).blocked,true);assert.equal(calls,1);
 const uncertainInput={...input,requestId:randomUUID(),text:'Respuesta incierta'};const uncertain=await sendText(db,config,uncertainInput,async()=>{throw Error('timeout');});assert.equal(uncertain.status,'uncertain');await sendText(db,config,uncertainInput,fetcher);assert.equal(calls,1);
 await setMode(db,config,c.id,'automatic',agent);assert.equal((await sendText(db,config,{...input,requestId:randomUUID(),sender:'bot',agentId:null},fetcher)).status,'accepted');
 const list=await listConversations(db,agent);assert.equal(list[0].unread,1);
 }finally{await close();}});
test('SQL: evento sin ID queda en cuarentena sin credenciales',{skip:!PGlite&&'PGlite no instalado'},async()=>{const {db,close}=await fixture();try{const e=event(null);e.apikey='no-guardar';await ingest(db,config,e);await ingest(db,config,e);assert.equal((await db.query('SELECT count(*)::int n FROM inbox.messages')).rows[0].n,0);const {rows}=await db.query('SELECT * FROM inbox.rejected_events');assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes('no-guardar'));}finally{await close();}});
