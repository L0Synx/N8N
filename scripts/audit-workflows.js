import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const directory=process.argv[2];
if(!directory){console.error('Uso: npm run audit:workflows -- /ruta/a/exportaciones-n8n');process.exit(1);}
for(const file of (await readdir(directory)).filter(f=>f.endsWith('.json'))){
 try{const data=JSON.parse(await readFile(join(directory,file),'utf8'));for(const wf of Array.isArray(data)?data:[data]){
  const found=(wf.nodes||[]).filter(n=>/webhook|httpRequest|evolution|executeWorkflow/i.test(n.type)||/sendText|sendMedia|sendAudio|sendButtons|sendList|evolution/i.test(JSON.stringify(n.parameters)));
  console.log(JSON.stringify({file,workflow:wf.name||'(sin nombre)',nodes:found.map(n=>({name:n.name,type:n.type,disabled:!!n.disabled,kind:/webhook/i.test(n.type)?'entrada':/send|evolution/i.test(JSON.stringify(n.parameters))?'posible_envio':'revisar'}))}));
 }}catch{console.error(JSON.stringify({file,error:'No se pudo analizar'}));}
}
