/** Authoring coordinates: pixels, X right, Y down, clockwise degrees. */
export interface Asset {
  id: string; name: string; width: number; height: number;
  dataUrl: string; hasAlpha: boolean;
}
export interface Bone {
  id: string; name: string; parentId: string | null;
  x: number; y: number; rotation: number; scale: number; length: number; locked: boolean;
}
export interface AttachmentVariant {
  id: string; name: string; assetId: string; x: number; y: number;
  scaleX: number; scaleY: number; pivotX: number; pivotY: number;
}
export interface AttachmentKey { time: number; variantId: string | null }
export interface Part {
  id: string; name: string; assetId: string; boneId: string;
  x: number; y: number; rotation: number; scaleX: number; scaleY: number;
  pivotX: number; pivotY: number; z: number; opacity: number; visible: boolean; locked: boolean;
  variants?: AttachmentVariant[];
}
/** Animation values are offsets from setup, except scale which is a multiplier. */
export interface Pose { x: number; y: number; rotation: number; scale: number }
export interface Keyframe extends Pose { time: number; easing: 'linear' | 'step' }
export interface Clip { id: string; name: string; duration: number; tracks: Record<string, Keyframe[]>; attachments?: Record<string, AttachmentKey[]> }
export interface Project {
  format: 'ai-bone-studio'; version: '0.3'; name: string;
  canvas: { width: number; height: number; originX: number; originY: number };
  assets: Asset[]; parts: Part[]; bones: Bone[]; clips: Clip[];
}
export type Matrix = [number, number, number, number, number, number];
export type Point = { x: number; y: number };
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export const restPose = (): Pose => ({ x: 0, y: 0, rotation: 0, scale: 1 });
export const uid = (prefix: string): string => `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(12)), v => v.toString(16).padStart(2, '0')).join('')}`;
export const radians = (n: number): number => n * Math.PI / 180;
export const degrees = (n: number): number => n * 180 / Math.PI;
export const normalizeAngle = (n: number): number => ((n + 180) % 360 + 360) % 360 - 180;
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function newProject(): Project {
  return {
    format: 'ai-bone-studio', version: '0.3', name: 'my-character',
    canvas: { width: 800, height: 720, originX: 400, originY: 570 },
    assets: [], parts: [],
    bones: [{ id: 'root', name: '整体 / 根关节', parentId: null, x: 400, y: 570, rotation: 0, scale: 1, length: 0, locked: false }],
    clips: [{ id: 'idle', name: 'idle', duration: 2, tracks: {} }],
  };
}

/** Keep immutable image strings shared between undo snapshots. */
export function cloneProject(p: Project): Project {
  return { ...p, canvas: { ...p.canvas }, assets: p.assets.map(a => ({ ...a })),
    parts: p.parts.map(a => ({ ...a, ...(a.variants ? { variants: a.variants.map(v => ({ ...v })) } : {}) })), bones: p.bones.map(b => ({ ...b })),
    clips: p.clips.map(c => ({ ...c, ...(c.attachments ? { attachments: Object.fromEntries(Object.entries(c.attachments).map(([id, keys]) => [id, keys.map(k => ({ ...k }))])) } : {}), tracks: Object.fromEntries(Object.entries(c.tracks).map(([id, keys]) => [id, keys.map(k => ({ ...k }))])) })) };
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function transform(x: number, y: number, rotation = 0, sx = 1, sy = sx): Matrix {
  const c = Math.cos(radians(rotation)), s = Math.sin(radians(rotation));
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
}
export function point(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
export function inverse(m: Matrix): Matrix {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-10) throw new Error('变换不可逆：缩放不能为 0。');
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}

export function sortedBones(p: Pick<Project, 'bones'>): Bone[] {
  const all = new Map(p.bones.map(b => [b.id, b]));
  const result: Bone[] = [], visiting = new Set<string>(), done = new Set<string>();
  function visit(b: Bone): void {
    if (done.has(b.id)) return;
    if (visiting.has(b.id)) throw new Error('骨骼父子关系出现循环。');
    visiting.add(b.id);
    if (b.parentId !== null) {
      const parent = all.get(b.parentId);
      if (!parent) throw new Error(`关节「${b.name}」缺少父关节。`);
      visit(parent);
    }
    visiting.delete(b.id); done.add(b.id); result.push(b);
  }
  p.bones.forEach(visit); return result;
}

export function sampleTrack(keys: Keyframe[] | undefined, time: number): Pose {
  if (!keys?.length || time < keys[0].time) return restPose();
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].time <= time) i++;
  const a = keys[i], b = keys[i + 1];
  if (!b || a.easing === 'step') return { x: a.x, y: a.y, rotation: a.rotation, scale: a.scale };
  const t = clamp((time - a.time) / (b.time - a.time), 0, 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    rotation: a.rotation + normalizeAngle(b.rotation - a.rotation) * t,
    scale: a.scale + (b.scale - a.scale) * t };
}
export function worldBones(p: Project, clip?: Clip, time = 0): Map<string, Matrix> {
  const result = new Map<string, Matrix>();
  for (const b of sortedBones(p)) {
    const k = clip ? sampleTrack(clip.tracks[b.id], time) : restPose();
    const local = transform(b.x + k.x, b.y + k.y, b.rotation + k.rotation, b.scale * k.scale);
    result.set(b.id, multiply(b.parentId ? result.get(b.parentId)! : identity, local));
  }
  return result;
}
export function partMatrix(part: Part, asset: Asset, bones: Map<string, Matrix>): Matrix {
  const b = bones.get(part.boneId);
  if (!b) throw new Error(`部件「${part.name}」未找到关节。`);
  return multiply(multiply(b, transform(part.x, part.y, part.rotation, part.scaleX, part.scaleY)),
    transform(-part.pivotX * asset.width, -part.pivotY * asset.height));
}
export function partCorners(part: Part, asset: Asset, bones: Map<string, Matrix>): Point[] {
  const m = partMatrix(part, asset, bones);
  return [point(m, 0, 0), point(m, asset.width, 0), point(m, asset.width, asset.height), point(m, 0, asset.height)];
}

/** Single-bone rigid binding; preserve exact setup world transform, including mirrored parts. */
export function bindPart(p: Project, partId: string, boneId: string): void {
  const part = p.parts.find(a => a.id === partId);
  if (!part || !p.bones.some(b => b.id === boneId)) throw new Error('请选择有效的部件和关节。');
  const worlds = worldBones(p), old = worlds.get(part.boneId)!, next = worlds.get(boneId)!;
  const worldPivot = point(old, part.x, part.y);
  const local = point(inverse(next), worldPivot.x, worldPivot.y);
  part.x = local.x; part.y = local.y;
  part.rotation += degrees(Math.atan2(old[1], old[0]) - Math.atan2(next[1], next[0]));
  const ratio = Math.hypot(old[0], old[1]) / Math.hypot(next[0], next[1]);
  part.scaleX *= ratio; part.scaleY *= ratio; part.boneId = boneId;
}
export function movePivot(p: Project, partId: string, px: number, py: number): void {
  const part = p.parts.find(a => a.id === partId)!;
  const asset = p.assets.find(a => a.id === part.assetId)!;
  const delta = point(transform(0, 0, part.rotation, part.scaleX, part.scaleY),
    (px - part.pivotX) * asset.width, (py - part.pivotY) * asset.height);
  for(const v of part.variants ?? []) { v.x -= (px-part.pivotX)*asset.width; v.y -= (py-part.pivotY)*asset.height; }
  part.x += delta.x; part.y += delta.y; part.pivotX = px; part.pivotY = py;
}
export function hasKeys(p: Project): boolean { return p.clips.some(c => Object.values(c.tracks).some(k => k.length > 0)); }
export function reparentBone(p: Project, id: string, parentId: string): void {
  if (id === 'root' || id === parentId) throw new Error('根关节不能改父级，也不能把自己设为父级。');
  if (hasKeys(p)) throw new Error('已有动作关键帧。请先保存备份并清空动作，再修改骨骼层级，避免动画变形。');
  const b = p.bones.find(v => v.id === id), parent = p.bones.find(v => v.id === parentId);
  if (!b || !parent) throw new Error('关节不存在。');
  let current: Bone | undefined = parent;
  while (current) { if (current.id === id) throw new Error('不能把子关节设为父关节。'); current = p.bones.find(v => v.id === current!.parentId); }
  const worlds = worldBones(p), local = multiply(inverse(worlds.get(parentId)!), worlds.get(id)!);
  b.x = local[4]; b.y = local[5]; b.rotation = degrees(Math.atan2(local[1], local[0]));
  b.scale = Math.hypot(local[0], local[1]); b.parentId = parentId;
}
export function deleteBone(p: Project, id: string): void {
  if (id === 'root') throw new Error('不能删除整体根关节。');
  if (hasKeys(p)) throw new Error('请先保存备份并清空动作，再删除关节。');
  const b = p.bones.find(v => v.id === id);
  if (!b) return;
  for (const part of p.parts.filter(v => v.boneId === id)) bindPart(p, part.id, b.parentId!);
  for (const child of p.bones.filter(v => v.parentId === id)) reparentBone(p, child.id, b.parentId!);
  p.bones = p.bones.filter(v => v.id !== id);
}
export function addBone(p: Project, start: Point, end: Point, parentId = 'root'): string {
  const parent = worldBones(p).get(parentId);
  if (!parent) throw new Error('父关节不存在。');
  const a = point(inverse(parent), start.x, start.y), z = point(inverse(parent), end.x, end.y);
  if (Math.hypot(z.x - a.x, z.y - a.y) < 2) throw new Error('两个关节点太近，请拉开一点。');
  const id = uid('bone');
  p.bones.push({ id, name: `关节 ${p.bones.length}`, parentId, x: a.x, y: a.y,
    rotation: degrees(Math.atan2(z.y - a.y, z.x - a.x)), scale: 1,
    length: Math.hypot(z.x - a.x, z.y - a.y), locked: false });
  return id;
}
export function setKey(clip: Clip, boneId: string, time: number, pose: Pose, easing: Keyframe['easing'] = 'linear'): void {
  const t = Math.round(clamp(time, 0, clip.duration) * 10000) / 10000;
  const keys = clip.tracks[boneId] ?? [];
  const next = keys.filter(k => Math.abs(k.time - t) > 0.0001);
  if (t > 0 && !next.some(k => k.time === 0)) next.push({ ...restPose(), time: 0, easing: 'linear' });
  next.push({ ...pose, time: t, easing }); next.sort((a, b) => a.time - b.time);
  clip.tracks[boneId] = next;
}

function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function finite(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }
function string(v: unknown): v is string { return typeof v === 'string' && v.length > 0 && v.length < 200; }
function list(v: unknown): v is unknown[] { return Array.isArray(v) && v.length <= 512; }
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function checkId(v: unknown): asserts v is string { requireValue(typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v), '工程 ID 不合法。'); }
function unique(items: { id: string }[], name: string): void { requireValue(new Set(items.map(v => v.id)).size === items.length, `${name}有重复 ID。`); }

/** Reject broken or external-resource projects before loading pixels or evaluating transforms. */
export function parseProject(data: unknown): Project {
  requireValue(object(data), '这不是工程文件。');
  if (data.version === '0.1') throw new Error('V0.1 工程没有保存图片，不能完整还原。请重新导入原 PNG，在本版本重新保存。');
  requireValue(data.format === 'ai-bone-studio' && (data.version === '0.2' || data.version === '0.3'), '仅支持 AI Bone Studio V0.2 / V0.3 工程；Spine JSON 是游戏资源，不是编辑工程。');
  requireValue(string(data.name) && object(data.canvas), '工程名称或画板信息缺失。');
  const c = data.canvas;
  requireValue(finite(c.width) && finite(c.height) && Number.isInteger(c.width) && Number.isInteger(c.height) && c.width >= 64 && c.height >= 64 && c.width <= 4096 && c.height <= 4096 && finite(c.originX) && finite(c.originY), '画板尺寸必须为 64～4096 像素。');
  requireValue(list(data.assets) && list(data.parts) && list(data.bones) && list(data.clips), '工程集合无效或超过 512 项。');
  let encodedSize = 0;
  for (const a of data.assets) {
    requireValue(object(a), '素材信息无效。'); checkId(a.id);
    requireValue(string(a.name) && finite(a.width) && finite(a.height) && Number.isInteger(a.width) && Number.isInteger(a.height) && a.width > 0 && a.height > 0 && a.width <= 8192 && a.height <= 8192 && a.width * a.height <= 16777216, '素材尺寸无效或过大。');
    requireValue(typeof a.dataUrl === 'string' && /^data:image\/(png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(a.dataUrl), '工程只能包含内嵌 PNG/WebP 图片，不能包含脚本、SVG 或外链。');
    encodedSize += a.dataUrl.length; requireValue(encodedSize <= 100 * 1024 * 1024, '工程图片超过 100MB，请拆成多个角色。');
    requireValue(typeof a.hasAlpha === 'boolean', '素材透明度标记无效。');
  }
  for (const b of data.bones) {
    requireValue(object(b), '关节数据无效。'); checkId(b.id);
    if (b.parentId !== null) checkId(b.parentId);
    requireValue(string(b.name) && ['x', 'y', 'rotation', 'scale', 'length'].every(k => finite(b[k])) && (b.scale as number) >= 0.001 && (b.scale as number) <= 1000 && (b.length as number) >= 0 && typeof b.locked === 'boolean', '关节数值无效。');
  }
  for (const a of data.parts) {
    requireValue(object(a), '部件数据无效。'); checkId(a.id); checkId(a.assetId); checkId(a.boneId);
    requireValue(string(a.name) && ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'pivotX', 'pivotY', 'z', 'opacity'].every(k => finite(a[k])) && Math.abs(a.scaleX as number) >= 0.001 && Math.abs(a.scaleY as number) >= 0.001 && Math.abs(a.scaleX as number) <= 1000 && Math.abs(a.scaleY as number) <= 1000 && (a.pivotX as number) >= 0 && (a.pivotX as number) <= 1 && (a.pivotY as number) >= 0 && (a.pivotY as number) <= 1 && (a.opacity as number) >= 0 && (a.opacity as number) <= 1 && typeof a.visible === 'boolean' && typeof a.locked === 'boolean', '部件变换数值无效。');
  }
  const names = new Set<string>();
  for (const clip of data.clips) {
    requireValue(object(clip), '动作信息无效。'); checkId(clip.id);
    requireValue(string(clip.name) && !['__proto__', 'constructor', 'prototype'].includes(clip.name) && !names.has(clip.name) && finite(clip.duration) && clip.duration >= 0.1 && clip.duration <= 60 && object(clip.tracks), '动作名必须唯一，时长为 0.1～60 秒。'); names.add(clip.name);
    requireValue(Object.keys(clip.tracks).length <= 512, '动作轨道过多。');
    for (const [id, keys] of Object.entries(clip.tracks)) {
      checkId(id); requireValue(Array.isArray(keys) && keys.length <= 3600, '关键帧过多或格式错误。');
      let last = -1;
      for (const k of keys) {
        requireValue(object(k) && ['time', 'x', 'y', 'rotation', 'scale'].every(v => finite(k[v])) && (k.time as number) > last && (k.time as number) >= 0 && (k.time as number) <= clip.duration && (k.scale as number) >= 0.001 && (k.easing === 'linear' || k.easing === 'step'), '关键帧必须按时间排列、无重复且在动作时长内。'); last = k.time as number;
      }
    }
  }
  const p = { ...data, version: '0.3' } as unknown as Project;
  for (const part of p.parts) {
    if (part.variants !== undefined) {
      requireValue(list(part.variants) && part.variants.length <= 32, '替换图最多 32 项。');
      unique(part.variants, '替换图');
      for (const v of part.variants) {
        requireValue(object(v), '替换图格式无效。'); checkId(v.id); checkId(v.assetId);
        requireValue(v.id !== 'base' && string(v.name) && p.assets.some(a => a.id === v.assetId), '替换图名称或图片引用无效。');
        requireValue(['x','y','scaleX','scaleY','pivotX','pivotY'].every(k => finite(v[k])), '替换图对齐数值无效。');
        requireValue(Math.abs(v.scaleX) >= .001 && Math.abs(v.scaleY) >= .001 && Math.abs(v.scaleX) <= 100 && Math.abs(v.scaleY) <= 100 && Math.abs(v.x) < 100000 && Math.abs(v.y) < 100000 && v.pivotX >= 0 && v.pivotX <= 1 && v.pivotY >= 0 && v.pivotY <= 1, '替换图对齐范围无效。');
      }
    }
  }
  for (const clip of p.clips) {
    if (clip.attachments === undefined) continue;
    requireValue(object(clip.attachments) && Object.keys(clip.attachments).length <= 512, '换图轨道格式无效。');
    for (const [partId, keys] of Object.entries(clip.attachments)) {
      checkId(partId); const part = p.parts.find(a => a.id === partId);
      requireValue(part && Array.isArray(keys) && keys.length <= 3600, '换图轨道引用丢失的部件或过长。');
      let last = -1;
      for (const k of keys) {
        requireValue(object(k) && finite(k.time) && k.time > last && k.time >= 0 && k.time <= clip.duration, '换图帧必须按时间排列、在动作内且无重复。');
        requireValue(k.variantId === null || k.variantId === 'base' || part.variants?.some(v => v.id === k.variantId), '换图帧引用不存在的替换图。'); last = k.time;
      }
    }
  }
  unique(p.assets, '素材'); unique(p.parts, '部件'); unique(p.bones, '关节'); unique(p.clips, '动作');
  requireValue(p.bones.length > 0 && p.bones.filter(b => b.parentId === null).length === 1 && p.bones.some(b => b.id === 'root' && b.parentId === null), '工程必须恰好有一个 root 根关节。');
  sortedBones(p);
  for (const a of p.parts) requireValue(p.assets.some(v => v.id === a.assetId) && p.bones.some(v => v.id === a.boneId), '部件引用了丢失的图片或关节。');
  for (const clip of p.clips) for (const id of Object.keys(clip.tracks)) requireValue(p.bones.some(b => b.id === id), '动作引用了丢失的关节。');
  // Catch overflow from extreme transforms before they reach Canvas or a game engine.
  const worlds = worldBones(p);
  for (const m of worlds.values()) requireValue(m.every(v => Number.isFinite(v) && Math.abs(v) <= 1e9), '骨架世界变换超出安全范围。');
  for (const a of p.parts) requireValue(partCorners(a, p.assets.find(v => v.id === a.assetId)!, worlds).every(v => Number.isFinite(v.x) && Number.isFinite(v.y) && Math.abs(v.x) <= 1e9 && Math.abs(v.y) <= 1e9), '部件世界变换超出安全范围。');
  for (const a of p.parts) for (const v of a.variants ?? []) {const q=variantPart(p,a,v.id);requireValue(partCorners(q.part,q.asset,worlds).every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&Math.abs(v.x)<=1e9&&Math.abs(v.y)<=1e9),'替换图世界变换超出安全范围。');}
  // Only editor fields leave the importer. Unexpected credentials/provider config
  // in a hand-edited document must not be copied into project exports.
  const clean: Project = {
    format: 'ai-bone-studio', version: '0.3', name: p.name,
    canvas: { width:p.canvas.width,height:p.canvas.height,originX:p.canvas.originX,originY:p.canvas.originY },
    assets: p.assets.map(({id,name,width,height,dataUrl,hasAlpha})=>({id,name,width,height,dataUrl,hasAlpha})),
    bones: p.bones.map(({id,name,parentId,x,y,rotation,scale,length,locked})=>({id,name,parentId,x,y,rotation,scale,length,locked})),
    parts: p.parts.map(({id,name,assetId,boneId,x,y,rotation,scaleX,scaleY,pivotX,pivotY,z,opacity,visible,locked,variants})=>({
      id,name,assetId,boneId,x,y,rotation,scaleX,scaleY,pivotX,pivotY,z,opacity,visible,locked,
      ...(variants?{variants:variants.map(({id,name,assetId,x,y,scaleX,scaleY,pivotX,pivotY})=>({id,name,assetId,x,y,scaleX,scaleY,pivotX,pivotY}))}:{})
    })),
    clips: p.clips.map(({id,name,duration,tracks,attachments})=>({id,name,duration,
      tracks:Object.fromEntries(Object.entries(tracks).map(([id,keys])=>[id,keys.map(({time,x,y,rotation,scale,easing})=>({time,x,y,rotation,scale,easing}))])),
      ...(attachments?{attachments:Object.fromEntries(Object.entries(attachments).map(([id,keys])=>[id,keys.map(({time,variantId})=>({time,variantId}))]))}:{})
    }))
  };
  return clean;
}

/** Discrete attachment state. 'base' is the setup image; null hides the slot. */
export function sampleAttachment(clip: Clip | undefined, partId: string, time: number): string | null {
  let state: string | null = 'base';
  for (const key of clip?.attachments?.[partId] ?? []) { if (key.time > time) break; state = key.variantId; }
  return state;
}
export function setAttachmentKey(clip: Clip, part: Part, time: number, variantId: string | null): void {
  if (!Number.isFinite(time) || time < 0 || time > clip.duration) throw new Error('换图时间超出动作时长。');
  if (variantId !== null && variantId !== 'base' && !part.variants?.some(v => v.id === variantId)) throw new Error('替换图片不存在。');
  clip.attachments ??= {};
  const keys = (clip.attachments[part.id] ?? []).filter(k => Math.abs(k.time - time) > .00001);
  keys.push({ time, variantId }); keys.sort((a,b) => a.time - b.time); clip.attachments[part.id] = keys;
}
export function variantPart(p: Project, part: Part, variantId: string): { part: Part; asset: Asset } {
  if (variantId === 'base') return { part, asset: p.assets.find(a => a.id === part.assetId)! };
  const v = part.variants?.find(v => v.id === variantId);
  if (!v) throw new Error('替换图片不存在。');
  const delta = point(transform(0, 0, part.rotation, part.scaleX, part.scaleY), v.x, v.y);
  return { part: { ...part, assetId: v.assetId, x: part.x + delta.x, y: part.y + delta.y,
    scaleX: part.scaleX * v.scaleX, scaleY: part.scaleY * v.scaleY, pivotX: v.pivotX, pivotY: v.pivotY }, asset: p.assets.find(a => a.id === v.assetId)! };
}
export function addVariant(p: Project, partId: string, assetId: string, name: string): string {
  const part = p.parts.find(a => a.id === partId);
  if (!part || !p.assets.some(a => a.id === assetId)) throw new Error('请选择部件与图片。');
  const id = uid('variant'); part.variants ??= [];
  if (part.variants.length >= 32) throw new Error('一个部件最多 32 个替换图。');
  part.variants.push({ id, name: name.slice(0,120) || '替换图', assetId, x: 0, y: 0, scaleX: 1, scaleY: 1, pivotX: .5, pivotY: .5 }); return id;
}
export function blink(p: Project, clip: Clip, partId: string, closedId: string): void {
  const part = p.parts.find(a => a.id === partId); if (!part) throw new Error('请先选择眼睛部件。');
  clip.attachments ??= {}; clip.attachments[partId] = [];
  for (const [f, id] of [[0,'base'],[.42,closedId],[.5,'base'],[1,'base']] as [number,string][]) setAttachmentKey(clip, part, clip.duration * f, id);
}
