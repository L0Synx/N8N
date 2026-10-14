export const ranks={SERVER_ACK:1,DELIVERY_ACK:2,READ:3,PLAYED:3,2:1,3:2,4:3,5:3};
export function receiptStatus(value){const rank=ranks[value];return rank?{rank,status:['','sent','delivered','read'][rank]}:null;}
export function recipient(jid){return typeof jid==='string' && /^\d{7,15}@s\.whatsapp\.net$/.test(jid)?jid.split('@')[0]:null;}
export function validJid(jid){return typeof jid==='string'&&/^(\d{7,20})@(s\.whatsapp\.net|lid)$/.test(jid);}
function unpack(message){for(let i=0;i<6;i++){const next=message?.ephemeralMessage?.message||message?.viewOnceMessage?.message||message?.viewOnceMessageV2?.message||message?.documentWithCaptionMessage?.message;if(!next)break;message=next;}return message||{};}
export function normalize(item,now=new Date()){
 const key=item.key||{};
 const rawJid=key.remoteJid||item.remoteJid;
 const jid=rawJid?.endsWith('@lid')&&recipient(key.remoteJidAlt)?key.remoteJidAlt:rawJid;
 if(!validJid(jid))return {ignored:true,reason:'unsupported_chat'};
 const msg=unpack(item.message);
 let body=msg.conversation??msg.extendedTextMessage?.text;
 let kind='text',media=null;
 for(const [field,type] of [['imageMessage','image'],['documentMessage','document'],['audioMessage','audio'],['videoMessage','video'],['stickerMessage','sticker']]) if(msg[field]){
  kind=type;body=msg[field].caption||'';
  // No URLs firmadas, claves de medios ni base64: solo metadatos de presentación.
  media={mime:msg[field].mimetype||null,name:msg[field].fileName||null};break;
 }
 if(body===undefined){body=msg.buttonsResponseMessage?.selectedDisplayText||msg.listResponseMessage?.title||msg.templateButtonReplyMessage?.selectedDisplayText||msg.reactionMessage?.text||'';kind=body?'interaction':'unsupported';}
 const ts=item.messageTimestamp;
 const n=Number(typeof ts==='object'?ts?.low:ts);
 const parsed=typeof ts==='string'&&!/^\d+$/.test(ts)?new Date(ts):new Date(n>1e12?n:n*1000);
 const valid=ts!=null&&Number.isFinite(parsed.getTime())&&parsed.getUTCFullYear()>=2000&&parsed.getTime()<=now.getTime()+86400000;
 return {externalId:typeof key.id==='string'?key.id:null,jid,phone:recipient(jid),name:typeof item.pushName==='string'?item.pushName.slice(0,160):null,
 direction:key.fromMe===true?'out':'in',sender:key.fromMe===true?'external':'patient',body:String(body).slice(0,20000),kind,media,
 occurredAt:(valid?parsed:now).toISOString(),timestampSource:valid?'provider':'received',receipt:receiptStatus(item.status)};
}
