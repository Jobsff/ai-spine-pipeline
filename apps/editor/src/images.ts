import { type Asset, type Project, type Clip, type Part, type Point, newProject, uid, addBone, bindPart, setKey, restPose, worldBones, partMatrix, sampleAttachment, variantPart } from './model.js';
export interface CachedImage { image: HTMLImageElement; pixels: Uint8ClampedArray }
const cache = new Map<string, Promise<CachedImage>>();
export const decoded = new Map<string, CachedImage>();
export function loadAsset(asset: Asset): Promise<CachedImage> {
  let pending = cache.get(asset.dataUrl);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height) throw new Error(`「${asset.name}」记录尺寸与实际图片不符。`);
          const canvas = document.createElement('canvas'); canvas.width = asset.width; canvas.height = asset.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
          resolve({ image, pixels: ctx.getImageData(0, 0, asset.width, asset.height).data });
        } catch (e) { reject(e); }
      };
      image.onerror = () => reject(new Error(`图片不能解码：${asset.name}`)); image.src = asset.dataUrl;
    });
    cache.set(asset.dataUrl, pending);
  }
  return pending.then(value => {
    if (value.image.naturalWidth !== asset.width || value.image.naturalHeight !== asset.height) throw new Error(`「${asset.name}」尺寸不一致。`);
    decoded.set(asset.id, value); return value;
  });
}
export function pruneCache(p: Project): void {
  const ids = new Set(p.assets.map(a => a.id)), urls = new Set(p.assets.map(a => a.dataUrl));
  for (const id of decoded.keys()) if (!ids.has(id)) decoded.delete(id);
  for (const key of cache.keys()) if (!urls.has(key)) cache.delete(key);
}
export async function readImage(file: Blob, name: string): Promise<Asset> {
  if (file.size > 20 * 1024 * 1024) throw new Error(`「${name}」超过 20MB，请先缩小图片。`);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('读取图片失败。')); reader.readAsDataURL(file);
  });
  if (!/^data:image\/(png|webp);base64,/.test(dataUrl)) throw new Error('请使用 PNG 或 WebP，不支持 SVG / JPEG。');
  const image = new Image(); image.src = dataUrl; await image.decode();
  if (image.width > 8192 || image.height > 8192 || image.width * image.height > 16777216) throw new Error('图片像素过大，请使用 4096×4096 以下素材。');
  const asset: Asset = { id: uid('asset'), name: name.replace(/\.[^.]+$/, '').slice(0, 180) || '部件', dataUrl, width: image.width, height: image.height, hasAlpha: false };
  const c = await loadAsset(asset);
  for (let i = 3; i < c.pixels.length; i += 4) if (c.pixels[i] < 255) { asset.hasAlpha = true; break; }
  return asset;
}
export function drawCharacter(ctx: CanvasRenderingContext2D, p: Project, clip?: Clip, time = 0): void {
  const bones = worldBones(p, clip, time);
  for (const part of [...p.parts].sort((a, b) => a.z - b.z)) {
    if (!part.visible || part.opacity <= 0) continue;
    const state = sampleAttachment(clip, part.id, time); if (state === null) continue;
    const resolved = variantPart(p, part, state), asset = resolved.asset, ready = decoded.get(asset.id);
    if (!ready) continue;
    ctx.save(); ctx.transform(...partMatrix(resolved.part, asset, bones)); ctx.globalAlpha = part.opacity;
    ctx.drawImage(ready.image, 0, 0); ctx.restore();
  }
}
export function addPart(p: Project, asset: Asset, position?: Point): string {
  if (!p.assets.some(a => a.id === asset.id)) p.assets.push(asset);
  const root = p.bones.find(b => b.id === 'root')!;
  const id = uid('part');
  const part: Part = { id, name: asset.name, assetId: asset.id, boneId: 'root',
    x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
    pivotX: 0.5, pivotY: 0.5, z: p.parts.length ? Math.max(...p.parts.map(a => a.z)) + 1 : 0,
    opacity: 1, visible: true, locked: false };
  // Root is allowed to rotate/scale; compute inverse rather than assuming origin-only.
  const angle = -root.rotation * Math.PI / 180, dx = (position?.x ?? p.canvas.width / 2) - root.x, dy = (position?.y ?? p.canvas.height / 2) - root.y;
  part.x = (dx * Math.cos(angle) - dy * Math.sin(angle)) / root.scale;
  part.y = (dx * Math.sin(angle) + dy * Math.cos(angle)) / root.scale;
  part.rotation = -root.rotation; part.scaleX = part.scaleY = 1 / root.scale;
  p.parts.push(part); return id;
}
function demoAsset(name: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Asset {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!; paint(ctx);
  return { id: uid('asset'), name, width: w, height: h, dataUrl: canvas.toDataURL('image/png'), hasAlpha: true };
}
function pill(ctx: CanvasRenderingContext2D, w: number, h: number, fill: string, stroke = '#2b335d'): void {
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(3, 3, w - 6, h - 6, Math.min(w, h) / 2 - 4); ctx.fill(); ctx.stroke();
}
/** Original geometric practice puppet, generated locally; not derived from Spine examples. */
export async function demoProject(): Promise<Project> {
  const p = newProject(); p.name = 'hello-puppet';
  const makeBone = (id: string, name: string, a: Point, b: Point, parent = 'root'): void => {
    const generated = addBone(p, a, b, parent), bone = p.bones.find(x => x.id === generated)!; bone.id = id; bone.name = name;
  };
  makeBone('body', '身体', { x: 400, y: 480 }, { x: 400, y: 350 });
  makeBone('head', '头部', { x: 400, y: 350 }, { x: 400, y: 235 }, 'body');
  makeBone('upper_left', '左上臂（画面左）', { x: 342, y: 386 }, { x: 296, y: 440 }, 'body');
  makeBone('lower_left', '左前臂', { x: 296, y: 440 }, { x: 286, y: 502 }, 'upper_left');
  makeBone('upper_right', '右上臂（画面右）', { x: 458, y: 386 }, { x: 504, y: 440 }, 'body');
  makeBone('lower_right', '右前臂 · 试试挥手', { x: 504, y: 440 }, { x: 557, y: 410 }, 'upper_right');
  makeBone('leg_left', '左腿', { x: 372, y: 475 }, { x: 370, y: 557 });
  makeBone('leg_right', '右腿', { x: 428, y: 475 }, { x: 430, y: 557 });
  const put = (asset: Asset, at: Point, bone: string, rotation = 0): void => {
    const id = addPart(p, asset, at); p.parts.find(a => a.id === id)!.rotation = rotation; bindPart(p, id, bone);
  };
  for (const [bone, start, end] of [
    ['leg_left', { x: 372, y: 475 }, { x: 370, y: 557 }], ['leg_right', { x: 428, y: 475 }, { x: 430, y: 557 }],
    ['upper_left', { x: 342, y: 386 }, { x: 296, y: 440 }], ['lower_left', { x: 296, y: 440 }, { x: 286, y: 502 }],
    ['upper_right', { x: 458, y: 386 }, { x: 504, y: 440 }], ['lower_right', { x: 504, y: 440 }, { x: 557, y: 410 }],
  ] as [string, Point, Point][]) {
    const w = Math.round(Math.hypot(end.x - start.x, end.y - start.y)) + 24;
    put(demoAsset(p.bones.find(b => b.id === bone)!.name, w, 40, c => pill(c, w, 40, bone.startsWith('leg') ? '#7774ce' : '#a99af2')), { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, bone, Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI);
  }
  put(demoAsset('身体外衣', 136, 145, c => { pill(c, 136, 145, '#8077dc'); c.fillStyle = '#ffd788'; c.beginPath(); c.arc(68, 65, 15, 0, Math.PI * 2); c.fill(); }), { x: 400, y: 422 }, 'body');
  put(demoAsset('脸底 · 不含五官', 186, 164, c => pill(c, 186, 164, '#ffe2d2')), { x: 400, y: 274 }, 'head');
  put(demoAsset('眼睛', 104, 40, c => { c.fillStyle = '#493f73'; for (const x of [22, 82]) { c.beginPath(); c.ellipse(x, 22, 9, 14, 0, 0, Math.PI * 2); c.fill(); } }), { x: 400, y: 277 }, 'head');
  put(demoAsset('微笑', 50, 24, c => { c.strokeStyle = '#754560'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.arc(25, 4, 14, 0.15, Math.PI - 0.15); c.stroke(); }), { x: 400, y: 315 }, 'head');
  put(demoAsset('练习帽子', 220, 120, c => { c.fillStyle = '#6e61b2'; c.strokeStyle = '#363254'; c.lineWidth = 4; c.beginPath(); c.moveTo(28, 89); c.lineTo(130, 9); c.quadraticCurveTo(139, 1, 152, 16); c.lineTo(184, 93); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#8d7bd2'; c.beginPath(); c.ellipse(110, 95, 103, 18, -0.08, 0, Math.PI * 2); c.fill(); c.stroke(); c.fillStyle = '#ffdd8e'; c.beginPath(); c.arc(136, 60, 11, 0, Math.PI * 2); c.fill(); }), { x: 400, y: 185 }, 'head');
  for (const [position, bone] of [[{ x: 286, y: 504 }, 'lower_left'], [{ x: 560, y: 408 }, 'lower_right']] as [Point, string][]) put(demoAsset('手掌', 44, 48, c => pill(c, 44, 48, '#ffe2d2')), position, bone);
  const clip = p.clips[0];
  for (const [time, rotation] of [[0, 0], [0.5, -40], [1, 12], [1.5, -40], [2, 0]]) setKey(clip, 'lower_right', time, { ...restPose(), rotation });
  setKey(clip, 'body', 0, restPose()); setKey(clip, 'body', 1, { ...restPose(), y: -5 }); setKey(clip, 'body', 2, restPose());
  await Promise.all(p.assets.map(loadAsset)); return p;
}
