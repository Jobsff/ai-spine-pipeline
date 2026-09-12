/** Pure, deterministic chroma-key pipeline. No model-generated alpha branch. */
export type RGB = [number, number, number];
export interface Raster { width: number; height: number; data: Uint8ClampedArray }
export interface Rect { x: number; y: number; width: number; height: number }
export interface KeyOptions { color: RGB; inner: number; outer: number; despill: boolean }
export interface BackgroundReport { requested: RGB; measured: RGB; uniformity: number; difference: number; opaque: boolean; warnings: string[] }
export const KEY_VERSION = 'chroma-distance-unmix/2';
export function hexRGB(hex: string): RGB {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error('背景色必须是 #RRGGBB。');
  return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)) as RGB;
}
export const rgbHex = (rgb: RGB): string => '#' + rgb.map(n => Math.round(n).toString(16).padStart(2,'0')).join('');
const dist = (a: RGB,b: RGB): number => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const bounded = (n: number,lo: number,hi: number): number => Math.max(lo,Math.min(hi,n));
function validate(a: Raster): void {
  if (!Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < 1 || a.height < 1 || a.width*a.height > 16777216 || a.data.length !== a.width*a.height*4) throw new Error('图片像素尺寸无效或超过 1600 万像素。');
}
export function backgroundReport(a: Raster, requested: RGB): BackgroundReport {
  validate(a); const samples: RGB[] = [], histogram = new Map<string,{n:number; rgb:RGB}>();
  const stride = Math.max(1,Math.floor((a.width+a.height)/1800)); let opaque = true;
  const take = (x: number,y: number): void => { const i=(y*a.width+x)*4, rgb=[a.data[i],a.data[i+1],a.data[i+2]] as RGB;
    if(a.data[i+3]<250) opaque=false; samples.push(rgb); const key=rgb.map(v=>Math.floor(v/8)).join(','); const bin=histogram.get(key)??{n:0,rgb:[0,0,0]}; bin.n++; rgb.forEach((v,j)=>bin.rgb[j]+=v); histogram.set(key,bin); };
  for(let x=0;x<a.width;x+=stride){take(x,0);take(x,a.height-1);}
  for(let y=0;y<a.height;y+=stride){take(0,y);take(a.width-1,y);}
  const winner=[...histogram.values()].sort((a,b)=>b.n-a.n)[0];
  const measured=winner.rgb.map(v=>Math.round(v/winner.n)) as RGB;
  const uniformity=samples.filter(v=>dist(v,measured)<28).length/samples.length, difference=dist(requested,measured), warnings:string[]=[];
  if(uniformity<.95) warnings.push('边框背景不够均匀或有部件触边；先检查原图，不要直接全量确认。');
  if(difference>45) warnings.push('实测背景与指定颜色不同。可采用实测颜色，但须检查主体是否撞色。');
  if(!opaque) warnings.push('源图边框存在透明像素。AI 部件必须提供不透明纯色原图；外部透明零件请直接导入。');
  return {requested,measured,uniformity,difference,opaque,warnings};
}
/** Recommend a color with a large lower-percentile distance to sampled artwork. Not an automatic safety guarantee. */
export function recommendColor(a: Raster): RGB {
  validate(a); const candidates: RGB[]=[[0,255,0],[255,0,255],[0,128,255],[255,255,0],[0,255,255]];
  let best=candidates[0],score=-1;
  for(const c of candidates){ const distances:number[]=[];
    for(let i=0;i<a.data.length;i+=4*Math.max(1,Math.floor(a.width*a.height/3000))) if(a.data[i+3]>128) distances.push(dist([a.data[i],a.data[i+1],a.data[i+2]],c));
    distances.sort((a,b)=>a-b); const s=distances[Math.floor(distances.length*.02)]??0;
    if(s>score){score=s;best=c;}
  } return best;
}
/** Distance matte, same-hue background rejection and locally fitted foreground unmix.
 * The pure-color source is retained for manual restoration; matching subject colors
 * cannot be recovered reliably from color alone. No machine-generated alpha path.
 */
export function keyRaster(source: Raster, options: KeyOptions): Raster {
  validate(source); const {color: bg,inner,outer}=options;
  if(!Number.isFinite(inner)||!Number.isFinite(outer)||inner<0||outer<=inner||outer>400||bg.length!==3||bg.some(v=>!Number.isFinite(v)||v<0||v>255)) throw new Error('抠图容差无效。');
  const w=source.width,h=source.height,n=w*h,rgba=new Uint8ClampedArray(source.data),distance=new Float32Array(n),trusted=new Uint8Array(n),near=new Uint8Array(n);
  const avg=(bg[0]+bg[1]+bg[2])/3,cb=bg.map(v=>v-avg),bn=Math.hypot(...cb);
  near.fill(100);
  for(let p=0;p<n;p++){
    const i=p*4,d=Math.hypot(rgba[i]-bg[0],rgba[i+1]-bg[1],rgba[i+2]-bg[2]);distance[p]=d;
    const mean=(rgba[i]+rgba[i+1]+rgba[i+2])/3,cr=rgba[i]-mean,cg=rgba[i+1]-mean,cc=rgba[i+2]-mean,cn=Math.hypot(cr,cg,cc);
    const cosine=bn>10&&cn>1?(cr*cb[0]+cg*cb[1]+cc*cb[2])/(bn*cn):0;
    // Dark green/magenta compression or lighting remnants remain key-colored.
    const keyHue=bn>10&&cn>16&&cosine>.985;
    rgba[i+3]=keyHue?0:Math.round(bounded((d-inner)/(outer-inner),0,1)*source.data[i+3]);
    if(d>Math.max(outer+30,150)&&source.data[i+3]>250&&(cosine<.55||cn<12)){trusted[p]=1;near[p]=0;}
  }
  if(options.despill){
    // Linear-time proximity pass avoids scanning a 7x7 window across an entire sheet.
    for(let p=0;p<n;p++){if(p%w)near[p]=Math.min(near[p],near[p-1]+1);if(p>=w)near[p]=Math.min(near[p],near[p-w]+1);}
    for(let p=n-1;p>=0;p--){if(p%w<w-1)near[p]=Math.min(near[p],near[p+1]+1);if(p<n-w)near[p]=Math.min(near[p],near[p+w]+1);}
    for(let p=0;p<n;p++){
      const i=p*4;if(trusted[p]||distance[p]<=inner||near[p]>7||source.data[i+3]===0)continue;
      const x=p%w,y=Math.floor(p/w);let chosen=-1,alpha=0,best=Infinity;
      for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const q=yy*w+xx;if(!trusted[q])continue;
        const f=q*4;let dot=0,norm=0;for(let c=0;c<3;c++){const v=source.data[f+c]-bg[c];dot+=(source.data[i+c]-bg[c])*v;norm+=v*v;}
        const a=bounded(dot/Math.max(1,norm),0,1);let error=0;
        for(let c=0;c<3;c++)error+=(source.data[i+c]-(a*source.data[f+c]+(1-a)*bg[c]))**2;
        const score=error+4*(dx*dx+dy*dy);if(error<=1800&&score<best){best=score;chosen=q;alpha=a;}
      }
      if(chosen<0)continue;if(alpha<.02){rgba[i+3]=0;continue;}
      rgba[i+3]=Math.round(alpha*source.data[i+3]);
      for(let c=0;c<3;c++)rgba[i+c]=bounded((source.data[i+c]-(1-alpha)*bg[c])/alpha,0,255);
    }
  }
  for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]===0)rgba[i]=rgba[i+1]=rgba[i+2]=0;
  return {width:w,height:h,data:rgba};
}
/** Connected regions are proposals, never semantic parts. Small islands may need manual grouping. */
export function componentRects(a: Raster, minPixels=6): Rect[] {
  validate(a); const seen=new Uint8Array(a.width*a.height),queue=new Int32Array(a.width*a.height),result:Rect[]=[];
  for(let p=0;p<seen.length;p++){
    if(seen[p]||a.data[p*4+3]<24)continue;
    let tail=1,head=0,count=0,x0=a.width,y0=a.height,x1=0,y1=0;queue[0]=p;seen[p]=1;
    while(head<tail){const q=queue[head++],x=q%a.width,y=Math.floor(q/a.width);count++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=a.width||yy>=a.height)continue;const k=yy*a.width+xx;if(!seen[k]&&a.data[k*4+3]>=24){seen[k]=1;queue[tail++]=k;}}
    }
    if(count>=minPixels)result.push({x:x0,y:y0,width:x1-x0+1,height:y1-y0+1});
    if(result.length>512)throw new Error('检测到超过 512 个区域，背景可能没有抠除干净。请调容差或使用网格/手工框选。');
  }
  result.sort((a,b)=>a.y-b.y||a.x-b.x);return result;
}
export function validRect(a: Raster, rect: Rect): Rect {
  const x=bounded(Math.floor(rect.x),0,a.width-1),y=bounded(Math.floor(rect.y),0,a.height-1);
  return {x,y,width:bounded(Math.ceil(rect.width),1,a.width-x),height:bounded(Math.ceil(rect.height),1,a.height-y)};
}
export function cropRaster(a: Raster, raw: Rect, padding=8): { image: Raster; bounds: Rect } {
  validate(a);if(!Object.values(raw).every(Number.isFinite)||padding<0||padding>64)throw new Error('裁切范围无效。');const box=validRect(a,raw);
  let x0=box.x+box.width,y0=box.y+box.height,x1=-1,y1=-1;
  for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++)if(a.data[(y*a.width+x)*4+3]>0){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  if(x1<0)throw new Error('这个范围没有前景像素。');
  const width=x1-x0+1+padding*2,height=y1-y0+1+padding*2,data=new Uint8ClampedArray(width*height*4);
  for(let y=y0;y<=y1;y++){const start=(y*a.width+x0)*4;data.set(a.data.subarray(start,start+(x1-x0+1)*4),((y-y0+padding)*width+padding)*4);}
  return {image:{width,height,data},bounds:{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1}};
}
export function brushMask(target: Raster, original: Raster, x: number,y: number,radius: number,restore: boolean): void {
  if(target.width!==original.width||target.height!==original.height||![x,y,radius].every(Number.isFinite)||radius<=0||radius>128)throw new Error('蒙版画笔参数无效。');
  for(let yy=Math.max(0,Math.floor(y-radius));yy<=Math.min(target.height-1,Math.ceil(y+radius));yy++)for(let xx=Math.max(0,Math.floor(x-radius));xx<=Math.min(target.width-1,Math.ceil(x+radius));xx++){
    if((xx-x)**2+(yy-y)**2>radius**2)continue;const i=(yy*target.width+xx)*4;
    if(restore)target.data.set(original.data.subarray(i,i+4),i);else target.data.fill(0,i,i+4);
  }
}
export function alphaStats(a: Raster): { foreground:number; transparent:number; soft:number; touchesEdge:boolean } {
  validate(a);let foreground=0,transparent=0,soft=0,touchesEdge=false;
  for(let p=0;p<a.width*a.height;p++){const v=a.data[p*4+3];if(v===0)transparent++;else{foreground++;if(v<255)soft++;const x=p%a.width,y=Math.floor(p/a.width);if(x===0||y===0||x===a.width-1||y===a.height-1)touchesEdge=true;}}
  return {foreground,transparent,soft,touchesEdge};
}
