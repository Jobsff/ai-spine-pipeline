import { profiles, publicProfiles, parseDataImage, generateImage, ProviderError } from './providers.mjs';
export const VERSION='0.3.0';
function setting(value, fallback, min, max){const n=Number(value||fallback);if(!Number.isInteger(n)||n<min||n>max)throw new Error('服务端任务限额或超时配置无效。');return n;}
export function lightRecord(value){const {images,reference,prompt,...rest}=value;return rest;}
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
export async function fingerprint(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function authorize(request,env){
 const origin=request.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);
 if(origin&&!allowed.includes(origin))return {error:json({error:'不允许此网站访问网关。'},403)};
 const headers=origin?{'access-control-allow-origin':origin,'vary':'Origin','access-control-allow-methods':'GET,POST,DELETE,OPTIONS','access-control-allow-headers':'Authorization,Content-Type','access-control-max-age':'600'}:{};
 if(request.method==='OPTIONS')return {error:new Response(null,{status:204,headers})};
 const secret=env.STUDIO_ACCESS_TOKEN;if(!secret||secret.length<32)return {error:json({error:'服务端访问口令未安全配置。'},503,headers)};
 const supplied=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
 if(supplied.length>512)return {error:json({error:'访问口令无效。'},401,headers)};
 // Hashes are fixed length. Do not use prefix or substring matching for secrets.
 const a=await fingerprint(secret),b=await fingerprint(supplied);let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 if(diff)return {error:json({error:'访问口令无效。'},401,headers)};
 return {headers};
}
async function readBody(request){
 if(!request.headers.get('content-type')?.includes('application/json'))throw new Error('请求必须为 JSON。');
 if(Number(request.headers.get('content-length'))>29*1024*1024)throw new Error('请求过大。');
 const reader=request.body?.getReader();if(!reader)throw new Error('缺少请求内容。');let n=0;const chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>29*1024*1024){await reader.cancel();throw new Error('请求过大。');}chunks.push(value);}
 const bytes=new Uint8Array(n);let offset=0;for(const v of chunks){bytes.set(v,offset);offset+=v.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export function validateTask(input,available){
 if(!input||Array.isArray(input)||typeof input!=='object')throw new Error('任务格式无效。');
 const allowed=['requestId','kind','provider','prompt','reference','color','confirmed'];if(Object.keys(input).some(k=>!allowed.includes(k)))throw new Error('任务含不允许的字段。上游参数与密钥只能由管理员设置。');
 if(!/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId)||!['character','parts'].includes(input.kind)||input.confirmed!==true)throw new Error('必须确认付费调用，并使用有效的任务编号。');
 const profile=available.find(p=>p.id===input.provider);if(!profile)throw new Error('图片服务尚未配置。');
 if(typeof input.prompt!=='string'||input.prompt.trim().length<3||input.prompt.length>24000)throw new Error('提示词长度为 3～24000 字符。');
 if(!/^#[a-f0-9]{6}$/i.test(input.color))throw new Error('必须指定有效的高对比度纯色背景。');
 if(input.reference)parseDataImage(input.reference);
 if(input.kind==='parts'&&!input.reference)throw new Error('部件图生图不能缺少参考角色。');
 if(input.reference&&!profile.edit)throw new Error('此服务未启用图片编辑。');
 return {requestId:input.requestId,kind:input.kind,provider:input.provider,prompt:input.prompt,reference:input.reference||null,color:input.color};
}
export class JobService {
 constructor(storage,env,{fetcher=fetch,schedule=()=>{},clock=()=>Date.now()}={}){this.storage=storage;this.env=env;this.daily=setting(env.MAX_JOBS_PER_DAY,30,1,1000);this.retention=setting(env.RETENTION_DAYS,7,1,30);this.timeout=setting(env.UPSTREAM_TIMEOUT_MS,180000,1000,300000);this.profiles=profiles(env);this.fetcher=fetcher;this.schedule=schedule;this.clock=clock;this.serial=Promise.resolve();this.working=false;}
 async locked(fn){const prior=this.serial;let done;this.serial=new Promise(r=>done=r);await prior;try{return await fn();}finally{done();}}
 async recover(){const list=await this.storage.list({prefix:'job:'});for(const [key,summary] of list)if(summary.status==='running'){const j=await this.storage.get(key);if(!j)continue;if(j.status!=='running'){await this.storage.put(key,j);continue;}j.status='unknown';j.error='服务在上游执行时重启，结果未知。没有再次请求供应商。';j.reference=null;j.prompt=null;await this.storage.put(key,j);}await this.purge();}
 async purge(){const ttl=this.retention*86400000;for(const [key,j] of await this.storage.list({prefix:'job:'}))if(this.clock()-Date.parse(j.createdAt)>ttl&&!['queued','running'].includes(j.status)){await this.storage.put(`gone:${j.id}`,{fingerprint:j.fingerprint,createdAt:j.createdAt});await this.storage.delete(key);}for(const [key,v] of await this.storage.list({prefix:'gone:'}))if(this.clock()-Date.parse(v.createdAt)>30*86400000)await this.storage.delete(key);for(const [key] of await this.storage.list({prefix:'quota:'}))if(this.clock()-Date.parse(key.slice(6))>32*86400000)await this.storage.delete(key);}
 summary(j){return {id:j.id,requestId:j.requestId,kind:j.kind,provider:j.provider,status:j.status,createdAt:j.createdAt,error:j.error??null,cost:j.cost??null};}
 async handle(request){const auth=await authorize(request,this.env);if(auth.error)return auth.error;const send=(v,status=200)=>json(v,status,auth.headers);
 try{
  const path=new URL(request.url).pathname.replace(/\/$/,'')||'/';
  if(request.method==='GET'&&path==='/capabilities')return send({version:VERSION,backgroundPolicy:'chroma-only',providers:publicProfiles(this.profiles),retentionDays:this.retention,priceEstimate:null});
  if(request.method==='GET'&&path==='/jobs'){await this.purge();const jobs=[...(await this.storage.list({prefix:'job:'})).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return send({jobs:jobs.map(j=>this.summary(j))});}
  if(request.method==='POST'&&path==='/jobs'){
   const task=validateTask(await readBody(request),this.profiles),hash=await fingerprint(JSON.stringify(task));
   return await this.locked(async()=>{
    const existing=await this.storage.get(`job:${task.requestId}`),gone=await this.storage.get(`gone:${task.requestId}`);
    if(existing){if(existing.fingerprint!==hash)return send({error:'同一任务编号不能用于不同输入。'},409);return send({job:this.summary(existing),deduplicated:true});}
    if(gone)return send({error:'此任务已删除，不会以同一编号再次生成。'},410);
    const list=await this.storage.list({prefix:'job:'}),dailyKey=`quota:${new Date(this.clock()).toISOString().slice(0,10)}`,count=Number(await this.storage.get(dailyKey)||0);
    if(list.size>=200||[...list.values()].filter(j=>['queued','running'].includes(j.status)).length>=10||count>=this.daily)return send({error:'达到任务数量或每日调用上限。'},429);
    const job={...task,id:task.requestId,fingerprint:hash,status:'queued',createdAt:new Date(this.clock()).toISOString(),cost:null};
    // Quota is reserved before the job. A crash may count one unused request, never grant free retries.
    await this.storage.put(dailyKey,count+1);await this.storage.put(`job:${job.id}`,job);this.schedule();return send({job:this.summary(job)},202);
   });
  }
  const match=/^\/jobs\/([a-zA-Z0-9_-]{8,80})$/.exec(path);
  if(match){const key=`job:${match[1]}`,j=await this.storage.get(key);if(!j)return send({error:'任务不存在或已过保存期限。'},404);
   if(request.method==='GET')return send({...this.summary(j),images:j.status==='succeeded'?j.images:undefined,usage:j.usage??null});
   if(request.method==='DELETE')return await this.locked(async()=>{const current=await this.storage.get(key);if(!current)return send({error:'任务不存在。'},404);if(['queued','running'].includes(current.status))return send({error:'执行中的任务不能删除；中断不能保证供应商不计费。请等待结果后删除。'},409);await this.storage.put(`gone:${current.id}`,{fingerprint:current.fingerprint,createdAt:current.createdAt});await this.storage.delete(key);return send({deleted:true});});
  }
  return send({error:'接口不存在。'},404);
 }catch(e){return send({error:e instanceof SyntaxError?'请求 JSON 无效。':e.message||'请求无效。'},400);}}
 async processOne(){
  if(this.working)return;this.working=true;
  try{const jobs=[...(await this.storage.list({prefix:'job:'})).values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),selected=jobs.find(j=>j.status==='queued');if(!selected)return;const j=await this.storage.get(`job:${selected.id}`);
   // R2 writes may succeed before the small metadata index. Never replay from a stale index.
   if(!j)return;if(j.status!=='queued'){await this.storage.put(`job:${j.id}`,j);return;}
   j.status='running';await this.storage.put(`job:${j.id}`,j);
   try{const p=this.profiles.find(p=>p.id===j.provider);if(!p)throw new ProviderError('服务配置已改变，请管理员检查。');const result=await generateImage(p,j,this.fetcher,this.timeout);Object.assign(j,result,{status:'succeeded'});}
   catch(e){j.status=e instanceof ProviderError&&!e.uncertain?'failed':'unknown';j.error=e instanceof ProviderError?e.message:'处理结果未知，请管理员核对上游；未自动重试。';}
   j.finishedAt=new Date(this.clock()).toISOString();j.reference=null;j.prompt=null;await this.storage.put(`job:${j.id}`,j);
  }finally{this.working=false;const remaining=[...(await this.storage.list({prefix:'job:'})).values()].some(j=>j.status==='queued');if(remaining)this.schedule();}
 }
}
