/** Provider adapters. Secrets never leave the server; no automatic retries. */
export class ProviderError extends Error {
  constructor(message, uncertain = false) { super(message); this.uncertain = uncertain; }
}
export function secureBase(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port && url.port !== '443' || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|\d+\.\d+\.\d+\.\d+$)/i.test(url.hostname)) throw new Error('上游必须是管理员配置的可信 HTTPS 域名，不接受 IP、凭据或查询参数。');
  return url.href.replace(/\/$/, '');
}
export function profiles(env) {
  const result = [];
  for (const [id, prefix, label, type, defaultBase] of [
    ['openai','OPENAI','OpenAI 图片','openai','https://api.openai.com/v1'],
    ['gemini','GEMINI','Gemini 原生 generateContent','gemini','https://generativelanguage.googleapis.com/v1beta'],
    ['compatible','COMPAT','经管理员配置的兼容服务','openai',null],
  ]) {
    const key=env[`${prefix}_API_KEY`],model=env[`${prefix}_MODEL`];
    if (!key || !model) continue;
    if (!/^[a-zA-Z0-9_.:/-]{1,150}$/.test(model)) throw new Error(`${prefix}_MODEL 无效`);
    const base=secureBase(env[`${prefix}_BASE_URL`] || defaultBase || '');
    result.push({id,label,type,base,key,model,generate:true,edit:id!=='compatible'||env.COMPAT_EDIT_ENABLED==='true',
      opaque:id==='openai'||env[`${prefix}_OPAQUE_PARAMETER`]==='true',
      outputFormat:id==='openai', responseFormat:id==='compatible'&&env.COMPAT_B64_RESPONSE==='true',
      imageHosts:(env.IMAGE_DOWNLOAD_HOSTS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean)});
  }
  return result;
}
export function publicProfiles(items){return items.map(({id,label,model,generate,edit})=>({id,label,model,generate,edit}));}
export function parseDataImage(value, maxBytes=20*1024*1024) {
  if(typeof value!=='string'||value.length>Math.ceil(maxBytes*4/3)+200)throw new Error('图片过大或格式无效。');
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[2].length%4!==0)throw new Error('只接受内嵌 PNG/JPEG/WebP，不接受 URL、SVG 或文件路径。');
  let raw;try{raw=atob(match[2]);}catch{throw new Error('图片 Base64 无效。');}
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,
    jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,
    webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(bytes.length>maxBytes||!(match[1]==='image/png'&&png||match[1]==='image/jpeg'&&jpeg||match[1]==='image/webp'&&webp))throw new Error('图片内容与 MIME 类型不符。');
  if(png&&bytes.length>=24){const view=new DataView(bytes.buffer),w=view.getUint32(16),h=view.getUint32(20);if(w*h>16777216||!w||!h)throw new Error('PNG 超过像素限制。');}
  return {mime:match[1],base64:match[2],bytes};
}
export function buildRequest(profile, task) {
  const editing=!!task.reference;
  if(editing&&!profile.edit)throw new ProviderError('此配置没有启用图片编辑，不会退化为文生图。');
  let prompt=task.prompt;
  if(task.kind==='parts'){
    if(!task.reference||!/^#[a-f0-9]{6}$/i.test(task.color))throw new ProviderError('部件任务必须有参考图与纯色背景。');
    prompt+=`\n强制输出规范：所有空白处必须是不透明、完全均匀的纯色 ${task.color}。禁止透明、棋盘格、渐变、编号、文字、边框、场景与外部投影；只画清单零件，分开排列。`;
  }
  if(profile.type==='gemini'){
    const parts=[{text:prompt}];if(editing){const r=parseDataImage(task.reference);parts.push({inlineData:{mimeType:r.mime,data:r.base64}});}
    return {url:`${profile.base}/models/${encodeURIComponent(profile.model)}:generateContent`,options:{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':profile.key},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE']}})}};
  }
  if(editing){const image=parseDataImage(task.reference),form=new FormData();form.set('model',profile.model);form.set('prompt',prompt);form.set('n','1');form.append('image[]',new Blob([image.bytes],{type:image.mime}),'reference.'+(image.mime.split('/')[1]));if(profile.opaque)form.set('background','opaque');if(profile.outputFormat)form.set('output_format','png');if(profile.responseFormat)form.set('response_format','b64_json');
    return {url:`${profile.base}/images/edits`,options:{method:'POST',headers:{Authorization:`Bearer ${profile.key}`},body:form}};
  }
  return {url:`${profile.base}/images/generations`,options:{method:'POST',headers:{Authorization:`Bearer ${profile.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:profile.model,prompt,n:1,...(profile.opaque?{background:'opaque'}:{}),...(profile.outputFormat?{output_format:'png'}:{}),...(profile.responseFormat?{response_format:'b64_json'}:{})})}};
}
async function limitedBytes(response,max=30*1024*1024){
 if(Number(response.headers.get('content-length'))>max)throw new ProviderError('供应商返回内容超过大小限制。',true);
 const reader=response.body?.getReader();if(!reader)throw new ProviderError('供应商返回了空内容。',true);
 const chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new ProviderError('供应商返回内容超过大小限制。',true);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.length;}return bytes;
}
const toBase64=bytes=>{let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(raw);};
async function downloadImage(profile,url,fetcher,signal){
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port&&parsed.port!=='443'||!profile.imageHosts.includes(parsed.hostname.toLowerCase()))throw new ProviderError('返回了图片 URL，但域名不在管理员的 IMAGE_DOWNLOAD_HOSTS 白名单。请联系管理员；不要盲目重新生图。',true);
 const r=await fetcher(parsed.href,{signal,redirect:'error'});if(!r.ok)throw new ProviderError('图片下载失败；上游可能已经计费。',true);
 const mime=r.headers.get('content-type')?.split(';')[0],bytes=await limitedBytes(r,20*1024*1024);return `data:${mime};base64,${toBase64(bytes)}`;
}
export async function generateImage(profile,task,fetcher=fetch,timeoutMs=180000){
 const request=buildRequest(profile,task),signal=AbortSignal.timeout(timeoutMs);
 let response;
 try{response=await fetcher(request.url,{...request.options,signal,redirect:'error'});}
 catch{throw new ProviderError('上游连接中断或超时，结果未知。不会自动重试；请核对服务商任务/账单。',true);}
 if(!response.ok){const status=response.status;const known=status>=400&&status<500;throw new ProviderError(status===401||status===403?'供应商鉴权或权限失败，请管理员检查配置。':status===429?'供应商限流或额度不足；未自动重试。':`供应商返回 HTTP ${status}。未自动重试。`,!known);}
 let data;try{data=JSON.parse(new TextDecoder().decode(await limitedBytes(response)));}catch(e){if(e instanceof ProviderError)throw e;throw new ProviderError('上游返回不是有效图片响应；可能已计费。',true);}
 let urls=[];
 if(profile.type==='gemini'){
  if(data.promptFeedback?.blockReason)throw new ProviderError('供应商未接受此图片请求，请调整合规需求。');
  const candidate=data.candidates?.[0];
  if(candidate?.finishReason&&['SAFETY','IMAGE_SAFETY','BLOCKLIST','PROHIBITED_CONTENT'].includes(candidate.finishReason))throw new ProviderError('供应商拒绝了此图片请求。');
  for(const p of candidate?.content?.parts??[]){if(p.thought)continue;const d=p.inlineData??p.inline_data;if(d?.data)urls.push(`data:${d.mimeType??d.mime_type};base64,${d.data}`);}
 }else{
  for(const image of data.data??[]){if(image.b64_json)urls.push(`data:image/${data.output_format||'png'};base64,${image.b64_json}`);else if(image.url)urls.push(await downloadImage(profile,image.url,fetcher,signal));}
 }
 if(!urls.length||urls.length>4||urls.reduce((n,s)=>n+s.length,0)>22*1024*1024)throw new ProviderError('未收到可用的图片输出（或数量异常）。结果未知，不自动再次生成。',true);
 const images=urls.map(dataUrl=>{try{parseDataImage(dataUrl);}catch{throw new ProviderError('返回的图片格式或尺寸不合格。请保留任务编号联系服务商。',true);}return {dataUrl};});
 const u=data.usage??data.usageMetadata??{};const usage={};for(const [key,value] of Object.entries(u))if(typeof value==='number'&&Number.isFinite(value))usage[key]=value;
 return {images,usage,cost:null,providerRequestId:response.headers.get('x-request-id')?.slice(0,120)??null};
}
