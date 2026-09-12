import { uid } from './model.js';
import { type Rect, type KeyOptions } from './chroma.js';
export interface PartSpec { id:string; label:string; group:string; instruction:string }
export type Purpose = 'head'|'idle'|'game';
export const HEAD: PartSpec[] = [
 ['face_base','干净脸底','无眼睛、眉毛、嘴巴、头发，保留脸型、肤色和耳朵'],
 ['hair_back','后发','完整后脑头发，补全被脸遮挡的区域'],
 ['bangs','刘海','只画额头前刘海，不重复包含两侧长发'],
 ['side_hair_L','角色左侧发','角色自身左侧（正面图的画面右侧），发根补足隐藏覆盖'],
 ['side_hair_R','角色右侧发','角色自身右侧（正面图的画面左侧），发根补足隐藏覆盖'],
 ['eyebrow_L','角色左眉','单独一条角色自身左侧眉毛，不带皮肤底'],
 ['eyebrow_R','角色右眉','单独一条角色自身右侧眉毛，不带皮肤底'],
 ['eye_L_open','角色左眼·睁开','单独左侧睁眼，虹膜眼白睫毛在同一部件中，不带脸皮'],
 ['eye_R_open','角色右眼·睁开','单独右侧睁眼，虹膜眼白睫毛在同一部件中，不带脸皮'],
 ['eye_L_closed','角色左眼·闭合','与左侧睁眼匹配的闭合眼线，不带脸皮'],
 ['eye_R_closed','角色右眼·闭合','与右侧睁眼匹配的闭合眼线，不带脸皮'],
 ['mouth_smile','微笑嘴型','单独微笑嘴线，不带脸皮，不生成其他嘴型'],
].map(([id,label,instruction],i)=>({id,label,instruction,group:i<5?'头部结构':'表情'}));
const BODY: PartSpec[]=[['torso','躯干','保留服装，补全手臂遮挡区域'],['cape_back','后披风','完整后层'],['skirt','裙摆','完整下摆，可围绕腰部轻摆'],...['L','R'].flatMap(s=>[
 [`upper_arm_${s}`,`${s==='L'?'左':'右'}上臂`, '肩部与肘部额外补全，供关节旋转覆盖'],
 [`forearm_${s}`,`${s==='L'?'左':'右'}前臂`, '肘部与袖口隐藏区域补全'],
 [`hand_${s}`,`${s==='L'?'左':'右'}手`, '完整手掌，补全被袖口遮住的手腕'],
 [`leg_${s}`,`${s==='L'?'左':'右'}腿`, '补全伸入裙摆的隐藏区域'],
 [`shoe_${s}`,`${s==='L'?'左':'右'}鞋`, '完整鞋和隐藏踝部'],
])].map(([id,label,instruction])=>({id,label,instruction,group:'身体'}));
export function specsFor(purposes: Purpose[]): PartSpec[] {
 const all=purposes.some(p=>p!=='head')?[...HEAD,...BODY]:HEAD;
 return [...new Map(all.map(a=>[a.id,{...a}])).values()];
}
export interface CharacterVersion {id:string; name:string; image:string; width:number; height:number; adopted:boolean; description:string; createdAt:string; parentId?:string}
export interface Sheet { id:string; name:string; image:string; width:number; height:number; roleId:string|null; color:string; createdAt:string }
export type CandidateStatus='review'|'approved'|'repair'|'archived';
export interface Candidate {id:string; name:string; semanticId:string; sheetId:string; image:string; width:number; height:number; bounds:Rect; status:CandidateStatus; key:KeyOptions; keyVersion:string; warnings:string[]; imported:boolean; maskEdited:boolean}
export interface JobRef {id:string; requestId:string; kind:'character'|'parts'; provider:string; roleId:string|null; specIds:string[]; color:string; imported:boolean; status:string; createdAt:string}
export interface Preparation {
 format:'ai-bone-preparation'; version:'0.3'; name:string; description:string; view:string; purposes:Purpose[]; specs:PartSpec[];
 characters:CharacterVersion[]; activeCharacter:string|null; sheets:Sheet[]; activeSheet:string|null; candidates:Candidate[]; jobs:JobRef[]; color:string;
}
export function newPreparation():Preparation{return {format:'ai-bone-preparation',version:'0.3',name:'my-character',description:'两头身 Q 版女魔法师，银紫色头发、深蓝色服装，清楚的轮廓，简洁配饰。',view:'正面',purposes:['head'],specs:specsFor(['head']),characters:[],activeCharacter:null,sheets:[],activeSheet:null,candidates:[],jobs:[],color:'#00ff00'};}
export function partsPrompt(state:Preparation, ids=state.specs.map(s=>s.id)):string {
 const selected=state.specs.filter(s=>ids.includes(s.id));if(!selected.length)throw new Error('请先选择需要生成的部件。');
 return `这是游戏骨骼动画部件工程素材，不是概念展示板。严格沿用参考角色的身份、配色、画风和比例，视图：${state.view}。\n仅生成以下 ${selected.length} 个部件，按从左到右、从上到下的顺序分格排布（格线不可见）。部件之间保持足够空隙，不接触，大小保持同一角色比例。\n${selected.map((s,i)=>`${i+1}. ${s.id}：${s.label}；${s.instruction}`).join('\n')}\n背景必须是全画布均匀、不透明的纯色 ${state.color}。不要透明背景，不要棋盘格，不要渐变、文字、编号、线框、场景、外部投影、发光溢出、法杖、小猫和额外部件。保留素材自身明暗。部件内不要使用背景色作为装饰。旋转部位需补画被遮挡像素，不能只按当前可见边缘切断；重叠量按目标动作复核。\n每格只放一个清单部件；闭眼、嘴型不带脸底；前发不重复画侧发。输出一张多部件素材图，禁止再画完整人物。`;
}
export function characterPrompt(state:Preparation):string{return `设计一个可用于 2D 骨骼动画的原创游戏角色。需求：${state.description}\n${state.view}单一视图，完整轮廓，手臂与身体稍微分开，避免交叉遮挡。人物定稿素材，不要文字或排版，不要宠物、法杖和额外人物。服装与配饰简洁，保持后续易拆件。`;}
export function addCharacter(state:Preparation,image:string,width:number,height:number,name:string,parentId?:string):string {
 if(state.characters.length>=20)throw new Error('一个准备工程最多保存 20 个角色版本，请另存新工程。');
 const id=uid('character');state.characters.push({id,name,image,width,height,adopted:false,description:state.description,createdAt:new Date().toISOString(),...(parentId?{parentId}:{})});state.activeCharacter=id;return id;
}
export function approveCandidate(state:Preparation,id:string):void {
 const c=state.candidates.find(c=>c.id===id);if(!c)throw new Error('候选部件不存在。');
 if(!c.semanticId||!state.specs.some(s=>s.id===c.semanticId))throw new Error('先指定这个候选对应清单中的哪个部件。');
 if(state.candidates.some(v=>v.id!==id&&v.semanticId===c.semanticId&&v.status==='approved'))throw new Error('这个部件已有已确认版本。先将旧版归档，再确认新版；旧图不会自动覆盖。');
 c.status='approved';
}
export function coverage(state:Preparation):{missing:PartSpec[];duplicates:string[];approved:number}{
 const approved=state.candidates.filter(c=>c.status==='approved'),count=new Map<string,number>();approved.forEach(c=>count.set(c.semanticId,(count.get(c.semanticId)??0)+1));
 return {missing:state.specs.filter(s=>!count.has(s.id)),duplicates:[...count].filter(([,n])=>n>1).map(([id])=>id),approved:approved.length};
}
/** Explicitly reconstruct known fields. Gateway credentials/unknown data can never enter an exported workspace. */
export function parsePreparation(input:unknown):Preparation {
 const d=input as Preparation;
 if(!d||d.format!=='ai-bone-preparation'||d.version!=='0.3')throw new Error('这不是 V0.3 角色准备工程。');
 const text=(v:unknown,max=10000):string=>{if(typeof v!=='string'||v.length>max)throw new Error('准备工程文本无效。');return v;};
 const id=(v:unknown):string=>{const s=text(v,80);if(!/^[a-zA-Z0-9_-]+$/.test(s)||['__proto__','constructor','prototype'].includes(s))throw new Error('准备工程编号无效。');return s;};
 const list=<T>(v:unknown,max:number):T[]=>{if(!Array.isArray(v)||v.length>max)throw new Error('准备工程集合过大或缺失。');return v;};
 const dim=(v:unknown):number=>{if(!Number.isInteger(v)||Number(v)<1||Number(v)>8192)throw new Error('准备工程图片尺寸无效。');return Number(v);};
 let total=0;const image=(v:unknown):string=>{const s=text(v,30*1024*1024);total+=s.length;if(total>100*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s))throw new Error('准备工程必须内嵌 PNG，总量不超过 100MB。');return s;};
 const color=(v:unknown):string=>{const s=text(v,7);if(!/^#[0-9a-f]{6}$/i.test(s))throw new Error('背景色无效。');return s;};
 const purposes=list<Purpose>(d.purposes,3);if(!purposes.length||purposes.some(v=>!['head','idle','game'].includes(v)))throw new Error('用途无效。');
 const p:Preparation={format:d.format,version:d.version,name:text(d.name,100),description:text(d.description),view:text(d.view,100),purposes:[...purposes],color:color(d.color),activeCharacter:d.activeCharacter===null?null:id(d.activeCharacter),activeSheet:d.activeSheet===null?null:id(d.activeSheet),specs:list<PartSpec>(d.specs,100).map(s=>({id:id(s.id),label:text(s.label,120),group:text(s.group,120),instruction:text(s.instruction,2000)})),characters:list<CharacterVersion>(d.characters,20).map(v=>({id:id(v.id),name:text(v.name,120),image:image(v.image),width:dim(v.width),height:dim(v.height),adopted:v.adopted===true,description:text(v.description),createdAt:text(v.createdAt,100),...(v.parentId?{parentId:id(v.parentId)}:{})})),sheets:list<Sheet>(d.sheets,30).map(v=>({id:id(v.id),name:text(v.name,120),image:image(v.image),width:dim(v.width),height:dim(v.height),color:color(v.color),roleId:v.roleId===null?null:id(v.roleId),createdAt:text(v.createdAt,100)})),candidates:[],jobs:[]};
 for(const c of list<Candidate>(d.candidates,256)){
  if(!['review','approved','repair','archived'].includes(c.status)||!c.bounds||!['x','y','width','height'].every(k=>Number.isInteger(c.bounds[k as keyof Rect])&&c.bounds[k as keyof Rect]>=0)||c.bounds.width<1||c.bounds.height<1||!c.key||!Array.isArray(c.key.color)||c.key.color.length!==3||c.key.color.some(n=>!Number.isFinite(n)||n<0||n>255)||!Number.isFinite(c.key.inner)||!Number.isFinite(c.key.outer)||c.key.inner<0||c.key.outer<=c.key.inner||c.key.outer>400)throw new Error('候选元数据无效。');
  p.candidates.push({id:id(c.id),name:text(c.name,120),semanticId:c.semanticId===''?'':id(c.semanticId),sheetId:id(c.sheetId),image:image(c.image),width:dim(c.width),height:dim(c.height),bounds:{x:c.bounds.x,y:c.bounds.y,width:c.bounds.width,height:c.bounds.height},status:c.status,key:{color:[...c.key.color],inner:c.key.inner,outer:c.key.outer,despill:c.key.despill===true},keyVersion:text(c.keyVersion,100),warnings:list<string>(c.warnings,30).map(v=>text(v,2000)),imported:c.imported===true,maskEdited:c.maskEdited===true});
 }
 p.jobs=list<JobRef>(d.jobs,200).map(v=>{if(!['character','parts'].includes(v.kind))throw new Error('任务类型无效。');return {id:id(v.id),requestId:id(v.requestId),kind:v.kind,provider:id(v.provider),roleId:v.roleId===null?null:id(v.roleId),specIds:list<string>(v.specIds,100).map(id),color:color(v.color),imported:v.imported===true,status:text(v.status,100),createdAt:text(v.createdAt,100)};});
 for(const collection of [p.characters,p.sheets,p.candidates,p.specs,p.jobs])if(new Set(collection.map(v=>v.id)).size!==collection.length)throw new Error('准备工程含重复编号。');
 if(p.activeCharacter&&!p.characters.some(c=>c.id===p.activeCharacter)||p.activeSheet&&!p.sheets.some(c=>c.id===p.activeSheet)||p.candidates.some(c=>!p.sheets.some(s=>s.id===c.sheetId)))throw new Error('准备工程引用了丢失的原图。');
 for(const v of [...p.characters,...p.sheets,...p.candidates])if(v.width*v.height>16777216)throw new Error('图片像素数量超过限制。');
 for(const c of p.candidates){const sheet=p.sheets.find(s=>s.id===c.sheetId)!;if(c.bounds.x+c.bounds.width>sheet.width||c.bounds.y+c.bounds.height>sheet.height)throw new Error('候选裁切位置超出原图。');}
 if(coverage(p).duplicates.length)throw new Error('工程含重复的已确认语义部件，请修正状态后导入。');
 return p;
}
