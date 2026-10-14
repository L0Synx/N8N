import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const trigger=name=>({parameters:{inputSource:'passthrough'},id:randomUUID(),name,type:'n8n-nodes-base.executeWorkflowTrigger',typeVersion:1.1,position:[0,0]});
const http=(name,path,jsonBody,capture=false)=>({parameters:{method:'POST',url:`={{ $vars.ENDOMEC_INBOX_URL + '${path}' }}`,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody,options:{timeout:capture?5000:25000}},id:randomUUID(),name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[480,0],...(capture?{onError:'continueRegularOutput',alwaysOutputData:true}:{})});
const code=(name,jsCode,position=[240,0])=>({parameters:{jsCode},id:randomUUID(),name,type:'n8n-nodes-base.code',typeVersion:2,position});
const workflow=(name,nodes)=>({name,nodes,connections:Object.fromEntries(nodes.slice(0,-1).map((n,i)=>[n.name,{main:[[{node:nodes[i+1].name,type:'main',index:0}]]}])),settings:{executionOrder:'v1'},active:false,pinData:{},tags:[]});
const capture=workflow('ENDOMEC INBOX - Capturar evento (CONFIGURAR)',[
 trigger('Recibir evento'),
 code('Seleccionar evento',`return $input.all().map(item => { const e = item.json.body || item.json; if (!e.instance || !e.event || !e.data) throw new Error('Faltan instance/event/data del webhook original'); return { json: { instance: e.instance, event: e.event, data: e.data } }; });`),
 http('Copiar al Inbox - seleccionar credencial WEBHOOK','/api/integrations/evolution','={{ $json }}',true),
 code('Resultado de captura',`return $input.all().map((item, i) => ({ json: { captured: !item.json.error && !(item.json.rejected > 0), result: item.json.error ? 'capture_failed' : item.json, originalItemIndex: i } }));`,[720,0])
]);
const send=workflow('ENDOMEC INBOX - Enviar texto (CONFIGURAR)',[
 trigger('Recibir envio'),
 code('Validar contrato',`return $input.all().map(item => { const { jid, text, requestId } = item.json; if (!/^\\d{7,15}@s\\.whatsapp\\.net$/.test(jid || '')) throw new Error('Se necesita el JID telefonico real'); if (!text || typeof text !== 'string') throw new Error('Falta texto'); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId || '')) throw new Error('Falta UUID persistente para este envio'); return { json: { jid, text, requestId } }; });`),
 http('Enviar via Inbox - seleccionar credencial BOT','/api/integrations/bot/send-text','={{ $json }}'),
 code('Validar resultado sin reenviar',`return $input.all().map(item => { const r = item.json; if (r.blocked) return { json: { ...r, inboxOutcome: 'blocked_do_not_send' } }; if (r.status === 'uncertain' || r.status === 'sending') return { json: { ...r, inboxOutcome: 'review_do_not_retry' } }; return { json: { ...r, inboxOutcome: r.status === 'failed' ? 'failed' : 'accepted' } }; });`,[720,0])
]);
await mkdir(new URL('../integrations/',import.meta.url),{recursive:true});
await writeFile(new URL('../integrations/n8n-capturar-evento.json',import.meta.url),JSON.stringify(capture,null,2)+'\n');
await writeFile(new URL('../integrations/n8n-enviar-texto.json',import.meta.url),JSON.stringify(send,null,2)+'\n');
console.log('Subworkflows generados sin credenciales ni activación.');
