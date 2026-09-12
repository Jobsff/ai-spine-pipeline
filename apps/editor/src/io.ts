import { type Project, type Clip, parseProject } from './model.js';
import { loadAsset, drawCharacter } from './images.js';
import { atlasText, exportSpine, fileStem, packAtlas, usedAssets, preflight, regionName } from './spine.js';
import { type ZipEntry, writeZip, textEntry } from './zip.js';
export function download(name: string, data: Blob | Uint8Array | string, type = 'application/octet-stream'): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function saveProject(p: Project): void {
  parseProject(p); download(`${fileStem(p.name)}.project.json`, JSON.stringify(p), 'application/json');
}
export async function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('浏览器无法生成 PNG。')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
export async function exportPNG(p: Project, clip?: Clip, time = 0): Promise<Uint8Array> {
  await Promise.all(usedAssets(p).map(loadAsset));
  const canvas = document.createElement('canvas'); canvas.width = p.canvas.width; canvas.height = p.canvas.height;
  drawCharacter(canvas.getContext('2d')!, p, clip, time); return pngBytes(canvas);
}
export const layaExample = `// LayaAir 3.x: select Spine 3.8 in Project Settings -> Engine Modules first.
// Resource .json, .atlas and .png must remain together. See IMPORT.md for alpha settings.
export async function mountBoneStudio(parent: Laya.Sprite, jsonUrl: string, clip = 'idle'): Promise<Laya.Sprite> {
  await Laya.loader.load(jsonUrl, Laya.Loader.SPINE);
  const node = new Laya.Sprite(); parent.addChild(node);
  const renderer = node.addComponent(Laya.Spine2DRenderNode);
  renderer.source = jsonUrl;
  renderer.skinName = 'default';
  renderer.play(clip, true);
  return node;
}
`;
export const cocosExample = `// Cocos Creator 3.8.x / Spine 3.8. Drag the exported JSON asset onto this component.
import { _decorator, Component, sp } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('BoneStudioPlayer')
export class BoneStudioPlayer extends Component {
  @property(sp.SkeletonData) data: sp.SkeletonData | null = null;
  @property clip = 'idle';
  start(): void {
    if (!this.data) { console.error('Assign exported Spine SkeletonData first.'); return; }
    const skeleton = this.getComponent(sp.Skeleton) || this.addComponent(sp.Skeleton);
    skeleton.skeletonData = this.data;
    skeleton.premultipliedAlpha = false;
    skeleton.setAnimation(0, this.clip, true);
  }
}
`;
export function importGuide(stem: string): string {
  return `# AI Bone Studio 游戏资源包\n\n目标格式：Spine 3.8.99 JSON，区域贴图 / FK / 平移 / 旋转 / 等比骨骼缩放 / 固定层级。\n\n## 必须一起复制\n${stem}.json、${stem}.atlas 和所有 ${stem}_*.png。这些是运行时资源，不是 .spine 编辑器工程。\n.project.json 才是本工具可再次打开的源工程。\n\n## LayaAir 3.x（以 3.3 文档接口为基线）\n1. 项目设置 → 引擎模块 → 2D → Spine 动画：选择 3.8，不要选择 4.x。\n2. 复制资源到 assets 子目录，把 JSON 拖入层级面板，使用 Spine2DRenderNode。\n3. 动态加载 JSON 时必须指定 Laya.Loader.SPINE。不要把 Spine .atlas 当成 Laya 原生 .atlas 单独加载。\n4. 图集 PNG 为 straight alpha。按引擎要求将纹理类型设为 Default，启用 sRGB，不勾选 Premultiply Alpha。\n5. 选择导出动作名循环播放。代码例子见 examples/LayaPlayer.ts。\n\n## Cocos Creator 3.8.x\n1. 将同目录的 JSON / ATLAS / PNG 一起放入 assets 子目录。\n2. 节点添加 sp.Skeleton，把导入的 SkeletonData 拖入组件。\n3. 关闭 premultipliedAlpha；选择动作名播放。代码例子见 examples/CocosPlayer.ts。\n\n## 验收清单（本次未在你的引擎项目里自动执行）\n- 控制台无版本、骨骼、贴图缺失错误。\n- 初始姿势的位置、镜像、旋转与本工具一致。\n- 两个动作循环后无跳变，父关节带动子关节。\n- 白底和深色底均无黑边；手机目标平台再验证一次。\n- 正常释放角色后没有纹理 / 实例泄漏。\n\n## 边界与授权\n没有 IK、网格 / 权重、变形、动态换图和 draw-order 时间轴；不要把版本字段改成 4.x 冒充兼容。\n本工具不包含 Spine Runtime；使用 Laya / Cocos 的 Spine Runtime 仍须满足 Esoteric Software 的授权条款。导出格式本身不授予 Runtime 使用权。\n\n## 参考资料\n- https://layaair.com/3.3/doc-en/IDE/Component/2D/2DRender/Spine2DRenderNode/readme.html\n- https://docs.cocos.com/creator/3.8/manual/en/asset/spine.html\n- https://esotericsoftware.com/spine-json-format\n- https://esotericsoftware.com/spine-runtimes-license\n`;
}
export async function exportBundle(p: Project): Promise<{ bytes: Uint8Array; pages: number; memoryMB: number }> {
  const skeleton = exportSpine(p), assets = usedAssets(p), stem = fileStem(p.name), pages = packAtlas(assets, stem);
  await Promise.all(assets.map(loadAsset));
  const entries: ZipEntry[] = [textEntry(`${stem}.json`, JSON.stringify(skeleton, null, 2)), textEntry(`${stem}.atlas`, atlasText(pages))];
  for (const page of pages) {
    const canvas = document.createElement('canvas'); canvas.width = page.width; canvas.height = page.height;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    for (const a of page.regions) {
      const { image } = await loadAsset(assets.find(v => v.id === a.assetId)!);
      const { x, y, width: w, height: h } = a, e = 2;
      ctx.drawImage(image, x, y);
      ctx.drawImage(image, 0, 0, 1, h, x - e, y, e, h); ctx.drawImage(image, w - 1, 0, 1, h, x + w, y, e, h);
      ctx.drawImage(image, 0, 0, w, 1, x, y - e, w, e); ctx.drawImage(image, 0, h - 1, w, 1, x, y + h, w, e);
      for (const [sx, dx] of [[0, x - e], [w - 1, x + w]]) for (const [sy, dy] of [[0, y - e], [h - 1, y + h]]) ctx.drawImage(image, sx, sy, 1, 1, dx, dy, e, e);
    }
    entries.push({ name: page.name, bytes: await pngBytes(canvas) });
  }
  // Include individual PNGs so skeleton.images is also valid for editor-side import.
  for (const asset of assets) {
    const source = document.createElement('canvas'); source.width = asset.width; source.height = asset.height;
    source.getContext('2d')!.drawImage((await loadAsset(asset)).image, 0, 0);
    entries.push({ name: `images/${regionName(asset)}.png`, bytes: await pngBytes(source) });
  }
  const memoryMB = pages.reduce((s, p) => s + p.width * p.height * 4, 0) / 1048576;
  entries.push(textEntry(`${stem}.project.json`, JSON.stringify(p)), textEntry('IMPORT.md', importGuide(stem)),
    textEntry('examples/LayaPlayer.ts', layaExample), textEntry('examples/CocosPlayer.ts', cocosExample),
    textEntry('asset-map.json', JSON.stringify({ bones: p.bones.map(b => ({ id: b.id, label: b.name })), parts: p.parts.map(a => ({ slot: `slot_${a.id}`, label: a.name, assetId: a.assetId })), pages }, null, 2)),
    textEntry('compatibility.json', JSON.stringify({ exporter: 'ai-bone-studio/0.2.0', format: 'spine-3.8.99-region-fk', alpha: 'straight', schemaPreflight: 'passed', engineIntegrationTest: 'not-run-in-user-project', targetRuntime: '3.8', estimatedTextureMemoryMB: memoryMB, issues: preflight(p) }, null, 2)));
  return { bytes: writeZip(entries), pages: pages.length, memoryMB };
}
export async function exportFrames(p: Project, clip: Clip, fps = 15): Promise<Uint8Array> {
  const count = Math.max(1, Math.ceil(clip.duration * fps));
  if (count > 120 || p.canvas.width * p.canvas.height * count > 100000000) throw new Error('序列帧测试限 120 帧 / 1 亿像素，请缩短动作或缩小画板。');
  await Promise.all(usedAssets(p).map(loadAsset));
  const canvas = document.createElement('canvas'); canvas.width = p.canvas.width; canvas.height = p.canvas.height;
  const ctx = canvas.getContext('2d')!, entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    ctx.clearRect(0, 0, canvas.width, canvas.height); drawCharacter(ctx, p, clip, i / fps);
    entries.push({ name: `frames/frame_${String(i).padStart(4, '0')}.png`, bytes: await pngBytes(canvas) });
  }
  entries.push(textEntry('frames.json', JSON.stringify({ type: 'png-sequence', fps, frameCount: count, duration: clip.duration, width: canvas.width, height: canvas.height, originX: p.canvas.originX, originY: p.canvas.originY, files: entries.map(e => e.name) }, null, 2)),
    textEntry('README.txt', 'PNG 序列帧不是骨骼文件。可在任意引擎内按顺序建立帧动画；不需要 Spine Runtime。本包未生成引擎专有动画 clip。'));
  return writeZip(entries);
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ai-bone-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function autosave(p: Project): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(p, 'latest'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存被中断')); }); } finally { db.close(); }
}
export async function restoreAutosave(): Promise<Project | null> {
  const db = await database();
  try { return await new Promise<Project | null>((resolve, reject) => { const req = db.transaction('projects').objectStore('projects').get('latest'); req.onsuccess = () => { try { resolve(req.result ? parseProject(req.result) : null); } catch (e) { reject(e); } }; req.onerror = () => reject(req.error); }); } finally { db.close(); }
}
