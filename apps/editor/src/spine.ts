import { type Asset, type Project, type Keyframe, parseProject, sortedBones, worldBones, partCorners, point, transform, restPose, variantPart } from './model.js';
export interface Region { assetId: string; name: string; x: number; y: number; width: number; height: number }
export interface AtlasPage { name: string; width: number; height: number; regions: Region[] }
export interface ExportIssue { level: 'error' | 'warning'; message: string }
const r = (n: number): number => Math.round(n * 1e9) / 1e9;
export const fileStem = (name: string): string => name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'character';
export const regionName = (asset: Asset): string => `image_${asset.id}`;
export const slotName = (id: string): string => `slot_${id}`;
export function usedAssets(p: Project): Asset[] {
  const ids = new Set(p.parts.flatMap(a => [a.assetId, ...(a.variants ?? []).map(v => v.assetId)])); return p.assets.filter(a => ids.has(a.id));
}
export function preflight(p: Project): ExportIssue[] {
  const issues: ExportIssue[] = [];
  try { parseProject(p); } catch (err) { return [{ level: 'error', message: (err as Error).message }]; }
  if (!p.parts.length) issues.push({ level: 'error', message: '画板没有部件，请先导入 PNG。' });
  if (!p.parts.some(a => a.visible && a.opacity > 0)) issues.push({ level: 'error', message: '所有部件都被隐藏了，导出后角色不可见。' });
  for (const a of usedAssets(p)) {
    if (a.width + 8 > 2048 || a.height + 8 > 2048) issues.push({ level: 'error', message: `「${a.name}」超过单页 2048 限制，请先缩小源图片。` });
    if (!a.hasAlpha) issues.push({ level: 'warning', message: `「${a.name}」没有透明区域，请检查是否仍有绿幕或背景。` });
  }
  const fixed = p.parts.filter(a => a.boneId === 'root').length;
  if (fixed) issues.push({ level: 'warning', message: `${fixed} 个部件跟随整体根关节；它们不会跟随其他关节单独活动。` });
  if (!p.clips.some(c => Object.values(c.tracks).some(t => t.length) || Object.values(c.attachments ?? {}).some(t => t.length))) issues.push({ level: 'warning', message: '还没有动作关键帧；导出的是可加载的静态骨架。' });
  issues.push({ level: 'warning', message: '目标是 Spine 3.8 的区域贴图 / FK 子集。Laya、Cocos 工程须选择 3.8 运行库；实际引擎验收仍需执行随包测试。' });
  return issues;
}
const powerOfTwo = (v: number): number => 2 ** Math.ceil(Math.log2(Math.max(64, v)));
/** Deterministic shelf packing, no rotation or trimming. Padding includes 2px extrusion. */
export function packAtlas(assets: Asset[], stem: string, maxSize = 2048): AtlasPage[] {
  if (!assets.length) throw new Error('没有可打包的贴图。');
  const margin = 4, pages: AtlasPage[] = [];
  const sorted = [...assets].sort((a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id));
  let x = margin, y = margin, rowHeight = 0;
  function newPage(): AtlasPage {
    const page: AtlasPage = { name: `${fileStem(stem)}_${pages.length}.png`, width: 64, height: 64, regions: [] };
    pages.push(page); x = margin; y = margin; rowHeight = 0; return page;
  }
  let page = newPage();
  for (const a of sorted) {
    if (a.width + margin * 2 > maxSize || a.height + margin * 2 > maxSize) throw new Error(`贴图过大：${a.name}`);
    if (x + a.width + margin > maxSize) { x = margin; y += rowHeight + margin * 2; rowHeight = 0; }
    if (y + a.height + margin > maxSize) page = newPage();
    if (pages.length > 8) throw new Error('图集超过 8 页，请缩小或减少贴图。');
    page.regions.push({ assetId: a.id, name: regionName(a), x, y, width: a.width, height: a.height });
    page.width = Math.max(page.width, powerOfTwo(x + a.width + margin));
    page.height = Math.max(page.height, powerOfTwo(y + a.height + margin));
    x += a.width + margin * 2; rowHeight = Math.max(rowHeight, a.height);
  }
  return pages;
}
/** Spine 3.8 atlas syntax. Do not add the newer `pma:` header to this legacy format. */
export function atlasText(pages: AtlasPage[]): string {
  return pages.map(page => [page.name, `size: ${page.width},${page.height}`, 'format: RGBA8888', 'filter: Linear,Linear', 'repeat: none',
    ...page.regions.flatMap(a => [a.name, '  rotate: false', `  xy: ${a.x}, ${a.y}`, `  size: ${a.width}, ${a.height}`, `  orig: ${a.width}, ${a.height}`, '  offset: 0, 0', '  index: -1'])].join('\n')).join('\n\n') + '\n';
}
type Frame = { time: number; x?: number; y?: number; angle?: number; curve?: string };
export interface SpineDocument {
  skeleton: { spine: string; x: number; y: number; width: number; height: number; images: string };
  bones: { name: string; parent?: string; x: number; y: number; rotation: number; scaleX: number; scaleY: number; length: number }[];
  slots: { name: string; bone: string; attachment?: string; color: string; blend: string }[];
  skins: { name: string; attachments: Record<string, Record<string, { type: string; path: string; x: number; y: number; rotation: number; scaleX: number; scaleY: number; width: number; height: number }>> }[];
  animations: Record<string, { bones: Record<string, { translate: Frame[]; rotate: Frame[]; scale: Frame[] }>; slots?: Record<string, { attachment: { time: number; name: string | null }[] }> }>;
}
export function exportSpine(p: Project): SpineDocument {
  const errors = preflight(p).filter(v => v.level === 'error');
  if (errors.length) throw new Error(errors.map(v => v.message).join('\n'));
  const worlds = worldBones(p), visible = p.parts.filter(a => a.visible && a.opacity > 0);
  const allPoints = visible.flatMap(a => partCorners(a, p.assets.find(v => v.id === a.assetId)!, worlds));
  const minX = Math.min(...allPoints.map(v => v.x)), maxX = Math.max(...allPoints.map(v => v.x));
  const minY = Math.min(...allPoints.map(v => v.y)), maxY = Math.max(...allPoints.map(v => v.y));
  const doc: SpineDocument = {
    skeleton: { spine: '3.8.99', x: r(minX - p.canvas.originX), y: r(p.canvas.originY - maxY), width: r(maxX - minX), height: r(maxY - minY), images: './images/' },
    bones: sortedBones(p).map(b => ({ name: b.id, ...(b.parentId ? { parent: b.parentId } : {}),
      x: r(b.parentId ? b.x : b.x - p.canvas.originX), y: r(b.parentId ? -b.y : p.canvas.originY - b.y),
      rotation: r(-b.rotation), scaleX: r(b.scale), scaleY: r(b.scale), length: r(b.length) })),
    slots: [], skins: [{ name: 'default', attachments: {} }], animations: {},
  };
  for (const part of [...p.parts].sort((a, b) => a.z - b.z)) {
    const asset = p.assets.find(a => a.id === part.assetId)!;
    const key = regionName(asset), slot = slotName(part.id);
    doc.slots.push({ name: slot, bone: part.boneId, ...(part.visible ? { attachment: key } : {}), color: `ffffff${Math.round(part.opacity * 255).toString(16).padStart(2, '0')}`, blend: 'normal' });
    doc.skins[0].attachments[slot] = {};
    for (const id of ['base', ...(part.variants ?? []).map(v => v.id)]) {
      const { part: a, asset: image } = variantPart(p, part, id);
      const centre = point(transform(a.x, a.y, a.rotation, a.scaleX, a.scaleY), (0.5 - a.pivotX) * image.width, (0.5 - a.pivotY) * image.height);
      const name = id === 'base' ? key : `variant_${id}`;
      doc.skins[0].attachments[slot][name] = { type: 'region', path: regionName(image), x: r(centre.x), y: r(-centre.y), rotation: r(-a.rotation), scaleX: r(a.scaleX), scaleY: r(a.scaleY), width: image.width, height: image.height };
    }
  }
  for (const clip of p.clips) {
    const tracks: SpineDocument['animations'][string]['bones'] = {};
    const source = { ...clip.tracks };
    // A terminal root frame preserves clip duration, even for an otherwise empty clip.
    if (!source.root?.length) source.root = [{ ...restPose(), time: 0, easing: 'linear' }];
    for (const [id, input] of Object.entries(source)) {
      if (!input.length) continue;
      const keys: Keyframe[] = input.map(k => ({ ...k }));
      if (keys[0].time > 0) keys.unshift({ ...restPose(), time: 0, easing: 'step' });
      if (id === 'root' && keys[keys.length - 1].time < clip.duration) keys.push({ ...keys[keys.length - 1], time: clip.duration });
      const common = (k: Keyframe): Frame => ({ time: r(k.time), ...(k.easing === 'step' ? { curve: 'stepped' } : {}) });
      tracks[id] = {
        translate: keys.map(k => ({ ...common(k), x: r(k.x), y: r(-k.y) })),
        rotate: keys.map(k => ({ ...common(k), angle: r(-k.rotation) })),
        scale: keys.map(k => ({ ...common(k), x: r(k.scale), y: r(k.scale) })),
      };
    }
    const slots: NonNullable<SpineDocument['animations'][string]['slots']> = {};
    for (const [partId, keys] of Object.entries(clip.attachments ?? {})) {
      const part = p.parts.find(v => v.id === partId)!;
      slots[slotName(partId)] = { attachment: keys.map(k => ({ time: r(k.time), name: k.variantId === null || !part.visible ? null : k.variantId === 'base' ? regionName(p.assets.find(v => v.id === part.assetId)!) : `variant_${k.variantId}` })) };
    }
    doc.animations[clip.name] = { bones: tracks, ...(Object.keys(slots).length ? { slots } : {}) };
  }
  return doc;
}
