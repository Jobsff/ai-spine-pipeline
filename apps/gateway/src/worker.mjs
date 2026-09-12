/** Cloudflare Durable Object implementation of the same tested service contract. */
import { JobService, authorize, lightRecord } from './service.mjs';
// Durable Object KV values are small; image payloads live only in a private R2 bucket.
export class R2JobStorage {
 constructor(kv,bucket){this.kv=kv;this.bucket=bucket;}
 async get(key){const record=await this.kv.get(key);if(!record||!key.startsWith('job:'))return record;const obj=await this.bucket.get(`jobs/${key.slice(4)}.json`);if(!obj)throw new Error('任务数据缺失，请管理员检查；不会重新发起上游调用。');return obj.json();}
 async put(key,value){if(!key.startsWith('job:'))return this.kv.put(key,value);await this.bucket.put(`jobs/${key.slice(4)}.json`,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});await this.kv.put(key,lightRecord(value));}
 async delete(key){if(key.startsWith('job:'))await this.bucket.delete(`jobs/${key.slice(4)}.json`);await this.kv.delete(key);}
 list(options){return this.kv.list(options);}
}
export class GenerationQueue {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.service=new JobService(new R2JobStorage(ctx.storage,env.JOB_IMAGES),env,{schedule:()=>{void ctx.storage.setAlarm(Date.now()+1000);}});ctx.blockConcurrencyWhile(async()=>{await this.service.recover();await ctx.storage.setAlarm(Date.now()+1000);});}
 fetch(request){return this.service.handle(request);}
 async alarm(){await this.service.processOne();await this.service.purge();const queued=[...(await this.service.storage.list({prefix:'job:'})).values()].some(v=>v.status==='queued');await this.ctx.storage.setAlarm(Date.now()+(queued?1000:3600000));}
}
export default {async fetch(request,env){const auth=await authorize(request,env);if(auth.error)return auth.error;const id=env.GENERATION_QUEUE.idFromName('internal-studio');return env.GENERATION_QUEUE.get(id).fetch(request);}};
