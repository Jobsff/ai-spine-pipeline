/** Single-process internal gateway. Persistent jobs survive restart; run behind HTTPS. */
import { createServer } from 'node:http';
import { mkdir,readFile,writeFile,rename,readdir,unlink } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobService, lightRecord } from './service.mjs';
export class FileStorage {
 constructor(directory){this.directory=resolve(directory);}
 name(key){if(!/^[a-zA-Z0-9_:\-]+$/.test(key))throw new Error('Invalid storage key');return join(this.directory,encodeURIComponent(key)+'.json');}
 async get(key){try{return JSON.parse(await readFile(this.name(key),'utf8'));}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
 async put(key,value){await mkdir(this.directory,{recursive:true,mode:0o700});const target=this.name(key),temp=target+'.'+crypto.randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,target);}
 async delete(key){try{await unlink(this.name(key));}catch(e){if(e.code!=='ENOENT')throw e;}}
 async list({prefix=''}){await mkdir(this.directory,{recursive:true,mode:0o700});const out=new Map();for(const file of await readdir(this.directory)){if(!file.endsWith('.json'))continue;const key=decodeURIComponent(file.slice(0,-5));if(key.startsWith(prefix)){const v=await this.get(key);if(v!==undefined)out.set(key,key.startsWith('job:')?lightRecord(v):v);}}return out;}
}
export async function startServer(env=process.env){
 if(!env.STUDIO_ACCESS_TOKEN||env.STUDIO_ACCESS_TOKEN.length<32)throw new Error('Set STUDIO_ACCESS_TOKEN to at least 32 random characters before starting.');
 if(!/^(?:[1-9]|[12]\d|30)$/.test(String(env.RETENTION_DAYS||7)))throw new Error('RETENTION_DAYS must be 1..30');
 const store=new FileStorage(env.DATA_DIR||'./data');let timer;
 const service=new JobService(store,env,{schedule:()=>{clearTimeout(timer);timer=setTimeout(()=>service.processOne().catch(()=>console.error('Job processing failed; persisted state requires review.')),20);}});
 await service.recover();
 const server=createServer(async(req,res)=>{
  try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>29*1024*1024){res.writeHead(413,{'content-type':'application/json'});res.end('{"error":"request too large"}');req.destroy();return;}chunks.push(chunk);}
   const body=Buffer.concat(chunks),request=new Request(`http://gateway.local${req.url}`,{method:req.method,headers:req.headers,...(body.length?{body}:{} )});
   const response=await service.handle(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"internal error; no automatic retry"}');}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 await new Promise(resolve=>server.listen(Number(env.PORT||8787),env.HOST||'127.0.0.1',resolve));
 timer=setTimeout(()=>service.processOne().catch(()=>console.error('Job recovery requires review; no automatic retry.')),20);
 console.log(`Bone Studio gateway listening on ${env.HOST||'127.0.0.1'}:${server.address().port}; provider keys are never logged.`);
 const purge=setInterval(()=>service.purge().catch(()=>{}),3600000);purge.unref();return {server,service};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))startServer().catch(e=>{console.error(e.message);process.exitCode=1;});
