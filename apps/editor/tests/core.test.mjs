import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, cloneProject, parseProject, transform, point, inverse, multiply, worldBones, partCorners, bindPart, movePivot, reparentBone, deleteBone, addBone, sortedBones, restPose, sampleTrack, setKey } from '../dist/model.js';
import { exportSpine, packAtlas, atlasText, usedAssets, preflight } from '../dist/spine.js';
import { writeZip, readZip, textEntry, crc32 } from '../dist/zip.js';
const eps = (a,b,t=1e-5) => assert.ok(Math.abs(a-b)<t, `${a} != ${b}`);
const nearPoints = (a,b) => { assert.equal(a.length,b.length); a.forEach((v,i)=>{eps(v.x,b[i].x);eps(v.y,b[i].y);}); };
function fixture() {
 const p = newProject(); p.assets = [{ id:'face',name:'Face',width:90,height:70,dataUrl:'data:image/png;base64,AAAA',hasAlpha:true }];
 p.bones.push({id:'upper',name:'Upper',parentId:'root',x:25,y:-90,rotation:35,scale:1.2,length:80,locked:false}, {id:'lower',name:'Lower',parentId:'upper',x:70,y:0,rotation:-55,scale:.8,length:60,locked:false});
 p.parts = [{id:'head',name:'Head',assetId:'face',boneId:'root',x:100,y:-120,rotation:20,scaleX:-1.4,scaleY:.85,pivotX:.1,pivotY:.7,z:2,opacity:.8,visible:true,locked:false}];
 return p;
}
const corners = p => partCorners(p.parts[0],p.assets[0],worldBones(p));
test('V0.2 saves embedded images and validates round trip',()=>{const p=fixture();assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))),p);});
test('V0.1 refuses to pretend missing images can be restored',()=>assert.throws(()=>parseProject({version:'0.1'}),/没有保存图片/));
test('affine inverse survives rotated mirrored nonuniform matrices',()=>{const m=transform(10,-25,67,-2,.6);const n=multiply(inverse(m),m);[1,0,0,1,0,0].forEach((v,i)=>eps(n[i],v));});
test('world transforms include parent rotation and scale',()=>{const p=fixture(),m=worldBones(p);nearPoints([point(m.get('lower'),0,0)],[point(m.get('upper'),70,0)]);});
test('binding preserves all corners with mirrored image and off-centre pivot',()=>{const p=fixture(),before=corners(p);bindPart(p,'head','lower');nearPoints(before,corners(p));bindPart(p,'head','upper');nearPoints(before,corners(p));bindPart(p,'head','root');nearPoints(before,corners(p));});
test('pivot relocation does not move artwork',()=>{const p=fixture();bindPart(p,'head','lower');const before=corners(p);movePivot(p,'head',.8,.05);nearPoints(before,corners(p));});
test('reparenting preserves setup world transform',()=>{const p=fixture();bindPart(p,'head','lower');const before=corners(p);reparentBone(p,'lower','root');nearPoints(before,corners(p));});
test('cycle protection rejects parenting under descendants',()=>{const p=fixture();assert.throws(()=>reparentBone(p,'upper','lower'),/子关节/);});
test('deleting a bone reparents children and preserves artwork',()=>{const p=fixture();bindPart(p,'head','lower');const before=corners(p);deleteBone(p,'upper');assert.equal(p.bones.find(b=>b.id==='lower').parentId,'root');nearPoints(before,corners(p));});
test('root cannot be deleted',()=>assert.throws(()=>deleteBone(fixture(),'root'),/根关节/));
test('structural edits protect existing animation',()=>{const p=fixture();setKey(p.clips[0],'lower',1,restPose());assert.throws(()=>reparentBone(p,'lower','root'),/关键帧/);assert.throws(()=>deleteBone(p,'lower'),/清空动作/);});
test('bone drawing converts world coordinates through rotated parent',()=>{const p=fixture();const a={x:80,y:123},b={x:210,y:166};const id=addBone(p,a,b,'lower');const bone=p.bones.find(b=>b.id===id),world=worldBones(p).get(id);nearPoints([point(world,0,0),point(world,bone.length,0)],[a,b]);});
test('animation keys sort, overwrite timestamp and create setup key at zero',()=>{const p=fixture(),c=p.clips[0];setKey(c,'upper',1,{...restPose(),rotation:20});setKey(c,'upper',.5,{...restPose(),rotation:8});setKey(c,'upper',1,{...restPose(),rotation:30});assert.deepEqual(c.tracks.upper.map(k=>k.time),[0,.5,1]);assert.equal(c.tracks.upper[2].rotation,30);});
test('animation interpolation combines offsets and multiplicative scale',()=>{const c=fixture().clips[0];setKey(c,'upper',0,restPose());setKey(c,'upper',2,{x:10,y:-20,rotation:90,scale:2});assert.deepEqual(sampleTrack(c.tracks.upper,1),{x:5,y:-10,rotation:45,scale:1.5});});
test('rotation uses shortest path across 180 degrees',()=>{const keys=[{...restPose(),rotation:170,time:0,easing:'linear'},{...restPose(),rotation:-170,time:2,easing:'linear'}];eps(sampleTrack(keys,1).rotation,180);});
test('stepped interpolation stays at previous pose',()=>{const keys=[{...restPose(),rotation:25,time:0,easing:'step'},{...restPose(),rotation:50,time:1,easing:'linear'}];assert.equal(sampleTrack(keys,.9).rotation,25);});
test('Spine export uses 3.8 skin arrays and real region dimensions',()=>{const s=exportSpine(fixture());assert.equal(s.skeleton.spine,'3.8.99');assert.ok(Array.isArray(s.skins));assert.equal(s.skins[0].attachments.slot_head.image_face.width,90);assert.equal(s.skins[0].attachments.slot_head.image_face.height,70);assert.equal(s.slots[0].bone,'root');});
test('Spine y-up export preserves rendered corners independently',()=>{
 const p=fixture();bindPart(p,'head','lower');const expected=corners(p).map(q=>({x:q.x-p.canvas.originX,y:p.canvas.originY-q.y}));const s=exportSpine(p),map=new Map();
 // Independent Y-up forward kinematics from only the exported data.
 for(const b of s.bones){const rad=b.rotation*Math.PI/180,local=[Math.cos(rad)*b.scaleX,Math.sin(rad)*b.scaleX,-Math.sin(rad)*b.scaleY,Math.cos(rad)*b.scaleY,b.x,b.y];map.set(b.name,b.parent?multiply(map.get(b.parent),local):local);}
 const region=s.skins[0].attachments.slot_head.image_face;
 const m=multiply(map.get(s.slots[0].bone),transform(region.x,region.y,region.rotation,region.scaleX,region.scaleY));
 const actual=[point(m,-45,35),point(m,45,35),point(m,45,-35),point(m,-45,-35)];nearPoints(expected,actual);
});
test('bone animation timelines negate y and rotation, preserve relative scale',()=>{const p=fixture();setKey(p.clips[0],'upper',1,{x:5,y:12,rotation:45,scale:1.25});const t=exportSpine(p).animations.idle.bones.upper;assert.equal(t.translate[1].y,-12);assert.equal(t.rotate[1].angle,-45);assert.equal(t.scale[1].x,1.25);});
test('export always preserves requested duration, including empty clips',()=>{const p=fixture();p.clips[0].duration=3.5;const a=exportSpine(p).animations.idle.bones.root;assert.equal(a.translate.at(-1).time,3.5);});
test('hidden parts keep assets and skin but omit default slot attachment',()=>{const p=fixture();p.parts.push({...p.parts[0],id:'hidden',visible:false});const s=exportSpine(p);assert.equal(s.slots[1].attachment,undefined);assert.ok(s.skins[0].attachments.slot_hidden);});
test('atlas deduplicates reused assets at project boundary',()=>{const p=fixture();p.parts.push({...p.parts[0],id:'copy'});assert.equal(usedAssets(p).length,1);});
test('packing is deterministic and respects bounds and gutters',()=>{const assets=Array.from({length:6},(_,i)=>({...fixture().assets[0],id:`a${i}`,width:80,height:70}));const pages=packAtlas(assets,'test',256);assert.deepEqual(pages,packAtlas([...assets].reverse(),'test',256));for(const p of pages)for(const a of p.regions){assert.ok(a.x>=4&&a.y>=4&&a.x+a.width+4<=p.width&&a.y+a.height+4<=p.height);for(const b of p.regions)if(a!==b)assert.ok(a.x+a.width+4<=b.x||b.x+b.width+4<=a.x||a.y+a.height+4<=b.y||b.y+b.height+4<=a.y);}});
test('oversized regions fail rather than silently clipping',()=>assert.throws(()=>packAtlas([{...fixture().assets[0],width:3000}],'test'),/贴图过大/));
test('legacy atlas syntax contains no unsupported pma header or rotated regions',()=>{const text=atlasText(packAtlas(fixture().assets,'test'));assert.ok(text.includes('size: 90, 70'));assert.ok(!text.includes('pma:'));assert.ok(text.includes('rotate: false'));});
test('preflight catches missing transparency and empty artwork',()=>{const p=fixture();p.assets[0].hasAlpha=false;assert.ok(preflight(p).some(i=>i.message.includes('没有透明')));assert.ok(preflight(newProject()).some(i=>i.level==='error'));});
test('project validation rejects invalid graph, external images and duplicate IDs',()=>{for(const change of [p=>p.bones[1].parentId='lower',p=>p.assets[0].dataUrl='https://example.com/a.png',p=>p.assets[0].dataUrl='data:image/svg+xml;base64,AAAA',p=>p.parts.push({...p.parts[0]}),p=>p.parts[0].scaleX=0,p=>p.bones[1].x=NaN,p=>p.parts[0].assetId='missing']){const p=fixture();change(p);assert.throws(()=>parseProject(p));}});
test('clone snapshots keep independent structural edits',()=>{const a=fixture(),b=cloneProject(a);b.parts[0].x=123;setKey(b.clips[0],'root',1,restPose());assert.notEqual(a.parts[0].x,123);assert.equal(Object.keys(a.clips[0].tracks).length,0);});
test('ZIP writer CRC matches standard test vector',()=>assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926));
test('ZIP STORE roundtrip preserves binary and UTF-8 filenames',async()=>{const entries=[textEntry('说明.txt','透明 PNG'),{name:'images/a.png',bytes:new Uint8Array([0,1,128,255])}];assert.deepEqual(await readZip(writeZip(entries)),entries);});
test('ZIP rejects traversal, duplicate paths and corrupted payloads',async()=>{assert.throws(()=>writeZip([textEntry('../bad','')]),/非法/);assert.throws(()=>writeZip([textEntry('a',''),textEntry('a','')]),/重复/);const b=writeZip([textEntry('a','hello')]);b[31]^=1;await assert.rejects(()=>readZip(b),/校验/);});
test('sort order always places parents before children',()=>{const p=fixture();p.bones.reverse();assert.deepEqual(sortedBones(p).map(b=>b.id),['root','upper','lower']);});

test("reject extreme part scales and reserved animation names",()=>{const p=fixture();p.parts[0].scaleX=1e308;assert.throws(()=>parseProject(p));const q=fixture();q.clips[0].name="__proto__";assert.throws(()=>parseProject(q));});
