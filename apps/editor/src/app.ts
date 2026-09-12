import { initPreparation } from './preparation-ui.js';
import { addVariant, blink, setAttachmentKey, sampleAttachment, variantPart, type Clip } from './model.js';
import { type Project, type Part, type Bone, type Pose, type Point, type Matrix, newProject, cloneProject, parseProject, worldBones, partMatrix, partCorners, point, inverse, degrees, clamp, addBone, bindPart, movePivot, reparentBone, deleteBone, hasKeys, setKey, sampleTrack, restPose, uid, sortedBones } from './model.js';
import { addPart, readImage, loadAsset, decoded, pruneCache, demoProject, drawCharacter } from './images.js';
import { preflight, fileStem } from './spine.js';
import { readZip } from './zip.js';
import { download, saveProject, exportBundle, exportPNG, exportFrames, autosave, restoreAutosave } from './io.js';

type Mode = 'assemble' | 'rig' | 'animate' | 'export';
type Tool = 'select' | 'draw' | 'bind' | 'pivot';
type Selection = { kind: 'part' | 'bone'; id: string } | null;
type Drag = { kind: 'part-move' | 'part-rotate' | 'part-scale' | 'bone-move' | 'bone-tip'; id: string; start: Point; before: Project; moved: boolean };
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id); if (!e) throw new Error(`Missing UI element ${id}`); return e as T;
};
const esc = (v: unknown): string => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (v: number): string => String(Math.round(v * 1000) / 1000);
let project = newProject(), selection: Selection = null, mode: Mode = 'assemble', tool: Tool = 'select';
let clipId = project.clips[0].id, time = 0, zoom = 0.75, playing = false, busy = false;
let drag: Drag | null = null, chainStart: Point | null = null, chainParent = 'root', hover: Point | null = null;
let sliderBefore: Project | null = null, savedCandidate: Project | null = null, revision = 0;
let saveTimer = 0, toastTimer = 0;
let expressionPartId = '', alignVariantId = 'base';
const undo: Project[] = [], redo: Project[] = [], canvas = $<HTMLCanvasElement>('board');
const currentClip = () => project.clips.find(c => c.id === clipId) ?? project.clips[0];
const activePart = () => selection?.kind === 'part' ? project.parts.find(p => p.id === selection!.id) : undefined;
const activeBone = (): Bone | undefined => selection?.kind === 'bone' ? project.bones.find(b => b.id === selection!.id) : activePart() ? project.bones.find(b => b.id === activePart()!.boneId) : undefined;
const pose = (id: string, p = project): Pose => sampleTrack((p.clips.find(c => c.id === clipId) ?? p.clips[0])?.tracks[id], time);
function toast(message: string, error = false): void {
  $('status').textContent = message; const box = $('toast'); box.textContent = message; box.classList.toggle('error', error); box.hidden = false;
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => box.hidden = true, error ? 8000 : 4500);
}
function remember(before = project): void { undo.push(cloneProject(before)); if (undo.length > 40) undo.shift(); redo.length = 0; }
function scheduleSave(): void {
  revision++; const v = revision; $('save-state').textContent = '正在保存本地副本…'; window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void autosave(project).then(() => { if (v === revision) $('save-state').textContent = '本地副本已保存'; }).catch(() => { $('save-state').textContent = '本地保存失败，请下载工程'; });
  }, 500);
}
function changed(full = true): void { scheduleSave(); if (full) render(); else draw(); }
function edit(mutator: (p: Project) => void, message?: string): void {
  if (busy) return;
  try { const next = cloneProject(project); mutator(next); remember(); project = next; changed(); if (message) toast(message); }
  catch (e) { toast((e as Error).message, true); render(); }
}
async function job(action: () => Promise<void>): Promise<void> {
  if (busy) return; busy = true; playing = false; document.body.classList.add('loading'); $('status').textContent = '正在处理，请勿关闭页面…';
  try { await action(); } catch (e) { toast((e as Error).message, true); }
  finally { busy = false; document.body.classList.remove('loading'); render(); }
}
function choosePart(id: string): void {
  selection = { kind: 'part', id }; if (mode === 'animate') selection = { kind: 'bone', id: project.parts.find(p => p.id === id)!.boneId }; render();
}
function chooseBone(id: string): void { selection = { kind: 'bone', id }; render(); }
function switchMode(next: Mode): void {
  playing = false; mode = next; tool = 'select'; chainStart = null;
  if (next === 'animate') { if (!currentClip()) { edit(p => p.clips.push({ id: 'idle', name: 'idle', duration: 2, tracks: {} })); clipId = 'idle'; } if (selection?.kind === 'part') selection = { kind: 'bone', id: activePart()!.boneId }; }
  if (next === 'export' && window.innerWidth <= 780) setPane('inspector'); render(); requestAnimationFrame(fit);
}
function setPane(pane: string): void {
  $('studio').dataset.pane = pane;
  document.querySelectorAll<HTMLButtonElement>('[data-pane]').forEach(b => { if (b.tagName === 'BUTTON') b.classList.toggle('active', b.dataset.pane === pane); });
  if (pane === 'canvas') requestAnimationFrame(fit);
}
function fit(): void {
  const box = $('canvas-scroll'); if (!box.clientWidth || !box.clientHeight) return;
  zoom = clamp(Math.min((box.clientWidth - 40) / project.canvas.width, (box.clientHeight - 40) / project.canvas.height), 0.12, 1.25);
  resizeBoard(); draw();
}
function resizeBoard(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, project.canvas.width * project.canvas.height > 4000000 ? 1 : 2);
  if (canvas.width !== Math.round(project.canvas.width * dpr)) canvas.width = Math.round(project.canvas.width * dpr);
  if (canvas.height !== Math.round(project.canvas.height * dpr)) canvas.height = Math.round(project.canvas.height * dpr);
  canvas.style.width = `${project.canvas.width * zoom}px`; canvas.style.height = `${project.canvas.height * zoom}px`;
  const sel = $<HTMLSelectElement>('zoom');
  sel.querySelector('option[data-fit]')?.remove();
  if (![...sel.options].some(o => Number(o.value) === zoom)) { const option = new Option(`${Math.round(zoom * 100)}% · 适合`, String(zoom)); option.dataset.fit = 'true'; sel.add(option); }
  sel.value = String(zoom);
}
function pointer(e: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect(); return { x: (e.clientX - rect.left) * project.canvas.width / rect.width, y: (e.clientY - rect.top) * project.canvas.height / rect.height };
}
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
function rotationHandle(corners: Point[]): Point {
  const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const centre = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
  const l = Math.max(0.0001, distance(top, centre)); return { x: top.x + (top.x - centre.x) / l * 27 / zoom, y: top.y + (top.y - centre.y) / l * 27 / zoom };
}
function draw(): void {
  const ctx = canvas.getContext('2d')!; ctx.setTransform(canvas.width / project.canvas.width, 0, 0, canvas.height / project.canvas.height, 0, 0); ctx.clearRect(0, 0, project.canvas.width, project.canvas.height);
  const clip = previewClip(), worlds = worldBones(project, clip, time);
  ctx.save(); ctx.strokeStyle = '#80849b55'; ctx.lineWidth = 1 / zoom;
  ctx.beginPath(); ctx.moveTo(project.canvas.originX - 12 / zoom, project.canvas.originY); ctx.lineTo(project.canvas.originX + 12 / zoom, project.canvas.originY); ctx.moveTo(project.canvas.originX, project.canvas.originY - 12 / zoom); ctx.lineTo(project.canvas.originX, project.canvas.originY + 12 / zoom); ctx.stroke(); ctx.restore();
  drawCharacter(ctx, project, clip, time);
  if (mode === 'rig' || mode === 'animate') {
    for (const b of sortedBones(project)) {
      const m = worlds.get(b.id)!, a = point(m, 0, 0), end = point(m, b.length, 0), selected = selection?.kind === 'bone' && selection.id === b.id;
      ctx.save(); ctx.strokeStyle = selected ? '#f09b29' : '#238d79'; ctx.fillStyle = selected ? '#ffba4980' : '#64d8b466'; ctx.lineWidth = (selected ? 2.4 : 1.7) / zoom;
      const len = Math.max(1, distance(a, end)), nx = -(end.y - a.y) / len * 5 / zoom, ny = (end.x - a.x) / len * 5 / zoom;
      if (b.length > 0) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + (end.x - a.x) * 0.22 + nx, a.y + (end.y - a.y) * 0.22 + ny); ctx.lineTo(end.x, end.y); ctx.lineTo(a.x + (end.x - a.x) * 0.22 - nx, a.y + (end.y - a.y) * 0.22 - ny); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      for (const p of [a, end]) { ctx.beginPath(); ctx.arc(p.x, p.y, (selected ? 5 : 3.8) / zoom, 0, Math.PI * 2); ctx.fillStyle = '#fbfff1'; ctx.fill(); ctx.stroke(); }
      if (selected) { ctx.font = `${11 / zoom}px system-ui`; ctx.fillStyle = '#563c15'; ctx.fillText(b.name, a.x + 10 / zoom, a.y - 10 / zoom); }
      ctx.restore();
    }
  }
  const selected = activePart();
  if (selected && selected.visible && mode !== 'export') {
    const asset = project.assets.find(a => a.id === selected.assetId)!, corners = partCorners(selected, asset, worlds), handle = rotationHandle(corners);
    ctx.save(); ctx.strokeStyle = '#8061cf'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.7 / zoom;
    ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo((corners[0].x + corners[1].x) / 2, (corners[0].y + corners[1].y) / 2); ctx.lineTo(handle.x, handle.y); ctx.stroke();
    for (const p of [...corners, handle]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4.5 / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    const pivot = point(worlds.get(selected.boneId)!, selected.x, selected.y);
    ctx.strokeStyle = '#dc596f'; ctx.beginPath(); ctx.arc(pivot.x, pivot.y, 5 / zoom, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  if (tool === 'draw' && chainStart) {
    ctx.save(); ctx.strokeStyle = '#c06c23'; ctx.lineWidth = 2 / zoom; ctx.setLineDash([5 / zoom, 4 / zoom]); ctx.beginPath(); ctx.moveTo(chainStart.x, chainStart.y); ctx.lineTo(hover?.x ?? chainStart.x, hover?.y ?? chainStart.y); ctx.stroke(); ctx.restore();
  }
}
function hitPart(at: Point, worlds: Map<string, Matrix>): Part | undefined {
  for (const part of [...project.parts].sort((a, b) => b.z - a.z)) {
    if (!part.visible || part.opacity <= 0) continue;
    const state = sampleAttachment(previewClip(), part.id, time); if (state === null) continue;
    const resolved = variantPart(project, part, state), a = resolved.asset, pos = point(inverse(partMatrix(resolved.part, a, worlds)), at.x, at.y);
    const x = Math.floor(pos.x), y = Math.floor(pos.y), ready = decoded.get(a.id);
    if (x >= 0 && y >= 0 && x < a.width && y < a.height && ready && ready.pixels[(y * a.width + x) * 4 + 3] > 16) return part;
  }
  return undefined;
}
function hitBone(at: Point, worlds: Map<string, Matrix>): { bone: Bone; tip: boolean } | undefined {
  const order = [...project.bones].reverse(); const active = activeBone();
  if (active) { order.splice(order.findIndex(b => b.id === active.id), 1); order.unshift(active); }
  for (const b of order) {
    const m = worlds.get(b.id)!, a = point(m, 0, 0), z = point(m, b.length, 0), threshold = 11 / zoom;
    if (b.length > 0 && distance(at, z) < threshold) return { bone: b, tip: true };
    if (distance(at, a) < threshold) return { bone: b, tip: false };
    const dx = z.x - a.x, dy = z.y - a.y, t = clamp(((at.x - a.x) * dx + (at.y - a.y) * dy) / Math.max(1, dx * dx + dy * dy), 0, 1);
    if (distance(at, { x: a.x + t * dx, y: a.y + t * dy }) < 7 / zoom) return { bone: b, tip: false };
  }
  return undefined;
}
function beginDrag(kind: Drag['kind'], id: string, at: Point, e: PointerEvent): void {
  drag = { kind, id, start: at, before: cloneProject(project), moved: false }; canvas.setPointerCapture(e.pointerId);
}
canvas.addEventListener('pointerdown', e => {
  if (busy || mode === 'export' || e.button > 0) return; e.preventDefault(); playing = false; canvas.focus();
  const at = pointer(e), worlds = worldBones(project, mode === 'animate' ? currentClip() : undefined, time);
  if (tool === 'draw') {
    if (!chainStart) { chainStart = at; hover = at; toast('起点已放好，再点一下肘部或下一个关节。'); draw(); }
    else { let id = ''; edit(p => id = addBone(p, chainStart!, at, chainParent)); if (id) { chainParent = id; chainStart = at; selection = { kind: 'bone', id }; render(); } }
    return;
  }
  if (tool === 'pivot' && activePart()) {
    const part = activePart()!, a = project.assets.find(v => v.id === part.assetId)!, local = point(inverse(partMatrix(part, a, worlds)), at.x, at.y);
    edit(p => movePivot(p, part.id, clamp(local.x / a.width, 0, 1), clamp(local.y / a.height, 0, 1)), '旋转点已调整，图片位置保持不变。'); tool = 'select'; render(); return;
  }
  if (mode === 'rig' || mode === 'animate') {
    const hit = hitBone(at, worlds);
    if (hit) {
      if (tool === 'bind' && activePart()) { edit(p => bindPart(p, activePart()!.id, hit.bone.id), '已绑定：零件保持原位，现在会跟随这个关节。'); tool = 'select'; render(); return; }
      selection = { kind: 'bone', id: hit.bone.id }; render();
      if (!hit.bone.locked) beginDrag(hit.tip ? 'bone-tip' : 'bone-move', hit.bone.id, at, e); return;
    }
    if (tool === 'bind') { toast('请选择绿色关节，或者在属性里选择“跟随哪个关节”。'); return; }
  }
  const part = activePart();
  if (part && !part.locked && mode !== 'animate') {
    const corners = partCorners(part, project.assets.find(a => a.id === part.assetId)!, worlds);
    if (distance(at, rotationHandle(corners)) < 13 / zoom) { beginDrag('part-rotate', part.id, at, e); return; }
    if (distance(at, corners[2]) < 13 / zoom) { beginDrag('part-scale', part.id, at, e); return; }
  }
  const hit = hitPart(at, worlds);
  if (hit) {
    choosePart(hit.id);
    if (mode === 'animate') { const bone = activeBone(); if (bone && !bone.locked) beginDrag('bone-move', bone.id, at, e); }
    else if (!hit.locked) beginDrag('part-move', hit.id, at, e);
  } else { selection = null; render(); }
});
canvas.addEventListener('pointermove', e => {
  const at = pointer(e); hover = at;
  if (!drag) { if (tool === 'draw') draw(); return; }
  if (!drag.moved && distance(at, drag.start) * zoom < 2) return;
  if (!drag.moved) { remember(drag.before); drag.moved = true; }
  const before = drag.before, baseClip = before.clips.find(c => c.id === clipId), worlds = worldBones(before, mode === 'animate' ? baseClip : undefined, time);
  if (drag.kind.startsWith('part')) {
    const initial = before.parts.find(a => a.id === drag!.id)!, target = project.parts.find(a => a.id === drag!.id)!, parent = worlds.get(initial.boneId)!;
    if (drag.kind === 'part-move') {
      const start = point(inverse(parent), drag.start.x, drag.start.y), end = point(inverse(parent), at.x, at.y);
      target.x = initial.x + end.x - start.x; target.y = initial.y + end.y - start.y;
    } else {
      const pivot = point(parent, initial.x, initial.y);
      if (drag.kind === 'part-rotate') target.rotation = initial.rotation + degrees(Math.atan2(at.y - pivot.y, at.x - pivot.x) - Math.atan2(drag.start.y - pivot.y, drag.start.x - pivot.x));
      else { const ratio = clamp(distance(at, pivot) / Math.max(1, distance(drag.start, pivot)), 0.05, 20); target.scaleX = initial.scaleX * ratio; target.scaleY = initial.scaleY * ratio; }
    }
  } else {
    const initial = before.bones.find(b => b.id === drag!.id)!, target = project.bones.find(b => b.id === drag!.id)!;
    const parent = initial.parentId ? worlds.get(initial.parentId)! : [1, 0, 0, 1, 0, 0] as Matrix;
    const local = point(inverse(parent), at.x, at.y), start = point(inverse(parent), drag.start.x, drag.start.y);
    const k = mode === 'animate' ? sampleTrack(baseClip?.tracks[initial.id], time) : restPose();
    if (drag.kind === 'bone-move') { k.x += local.x - start.x; k.y += local.y - start.y; }
    else {
      const dx = local.x - initial.x - k.x, dy = local.y - initial.y - k.y;
      k.rotation = degrees(Math.atan2(dy, dx)) - initial.rotation;
      if (mode !== 'animate') target.length = Math.max(2, Math.hypot(dx, dy) / initial.scale);
    }
    if (mode === 'animate') setKey(currentClip()!, initial.id, time, k);
    else { target.x = initial.x + k.x; target.y = initial.y + k.y; target.rotation = initial.rotation + k.rotation; }
  }
  draw();
});
function finishDrag(cancel = false): void {
  if (drag?.moved) { if (cancel) { project = drag.before; undo.pop(); } changed(); } drag = null; render();
}
canvas.addEventListener('pointerup', () => finishDrag()); canvas.addEventListener('pointercancel', () => finishDrag(true));
canvas.addEventListener('dragover', e => e.preventDefault());
$('canvas-scroll').addEventListener('dragover', e => e.preventDefault());
$('canvas-scroll').addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files.length) void importImages([...e.dataTransfer.files]); });

function field(id: string, label: string, value: number, options = ''): string {
  return `<label class="property"><span>${label}</span><input id="${id}" type="number" value="${num(value)}" step="0.1" ${options}></label>`;
}
function range(id: string, label: string, value: number, min: number, max: number, step: number, unit = ''): string {
  return `<label class="property"><span>${label}<b id="${id}-value">${num(value)}${unit}</b></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}
function renderProperties(): void {
  renderExpressions();
  const holder = $('properties'), part = activePart(), bone = activeBone();
  if (mode === 'export') {
    $('inspector-title').textContent = '导出检查'; const issues = preflight(project), errors = issues.filter(i => i.level === 'error');
    holder.innerHTML = `<h3>把角色带进游戏。</h3><p class="micro">目标：LayaAir 3.x / Cocos Creator 3.8.x。<br>两边工程都要选 Spine 3.8 运行库。</p><div class="metric"><div><b>${project.parts.length}</b><span>零件</span></div><div><b>${project.bones.length}</b><span>关节</span></div><div><b>${project.clips.length}</b><span>动作</span></div></div><div class="checklist"><div class="check-item"><strong>✓</strong> JSON + ATLAS + PNG 一起打包</div><div class="check-item"><strong>✓</strong> 真实尺寸、坐标转换、2px 边缘扩展</div><div class="check-item"><strong>✓</strong> 可再次打开的含图工程 + 接入例子</div></div>${issues.map(i => `<div class="warning ${i.level === 'error' ? 'error' : ''}">${esc(i.message)}</div>`).join('')}<button id="export-spine" class="primary full" ${errors.length ? 'disabled' : ''}>导出 Spine 3.8 资源 ZIP</button><button id="export-png" class="full" ${!project.parts.length ? 'disabled' : ''}>导出初始姿势 · 透明 PNG</button><button id="export-frames" class="full" ${!project.parts.length || !currentClip() ? 'disabled' : ''}>导出当前动作 · PNG 序列帧</button><p class="micro">游戏包不是 .spine 工程；编辑请用 .project.json。序列帧是备用格式，不是骨骼数据。</p><div class="warning">本工具不包含 Spine Runtime。游戏使用对应运行库时，仍需满足其授权条款。尚未在你的实际引擎项目和真机中验收。</div>`;
    return;
  }
  if (part && mode !== 'animate') {
    $('inspector-title').textContent = '零件属性';
    holder.innerHTML = `<label class="property"><span>零件名字</span><input id="part-name" value="${esc(part.name)}" maxlength="120"></label><label class="property"><span>跟随哪个关节</span><select id="part-bind">${sortedBones(project).map(b => `<option value="${b.id}" ${b.id === part.boneId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><div class="property-row">${field('part-x', '位置 X（关节内）', part.x)}${field('part-y', '位置 Y（关节内）', part.y)}</div>${range('part-rotation', '转动', part.rotation, -360, 360, 1, '°')}${range('part-scale', '等比缩放', Math.abs(part.scaleX), 0.05, 4, 0.01)}<div class="button-row"><button id="flip-x">水平镜像</button><button id="flip-y">垂直镜像</button></div><div class="button-row"><button id="layer-up">向前一层</button><button id="layer-down">向后一层</button></div><div class="property-group"><label class="property"><span>旋转点 <b>红色圆点</b></span></label><div class="property-row">${field('pivot-x', '横向 0～1', part.pivotX, 'min="0" max="1" step="0.01"')}${field('pivot-y', '纵向 0～1', part.pivotY, 'min="0" max="1" step="0.01"')}</div><div class="button-row"><button id="pivot-center">居中</button><button id="pivot-top">顶端</button><button id="pivot-click">画布点选</button></div><p class="micro">改旋转点不会让图片跳位。头发通常把旋转点放在发根。</p><button id="joint-for-part" class="full">在旋转点创建关节并绑定</button></div>${range('part-opacity', '不透明度', part.opacity, 0, 1, 0.01)}<div class="button-row"><button id="toggle-lock">${part.locked ? '解锁零件' : '锁定零件'}</button><button id="duplicate-part">复制零件</button><button id="delete-selected" class="danger">删除</button></div><p class="micro">也可拖动紫色顶端圆点旋转，拖右下圆点缩放。锁定后不能移动。</p>`; return;
  }
  if (bone) {
    $('inspector-title').textContent = mode === 'animate' ? '让关节动起来' : '关节属性';
    const k = pose(bone.id), animated = mode === 'animate';
    holder.innerHTML = `<label class="property"><span>关节名字</span><input id="bone-name" value="${esc(bone.name)}" maxlength="120"></label>${animated ? `<div class="help-card"><strong>正在记住 ${num(time)} 秒的姿势</strong>拖动时间条到另一个时刻，再转动关节。播放时会自动连接两个姿势。</div><div class="property-row">${field('pose-x', '平移 X（相对初始）', k.x)}${field('pose-y', '平移 Y（相对初始）', k.y)}</div>${range('pose-rotation', '转动角度', k.rotation, -180, 180, 1, '°')}${range('pose-scale', '等比伸缩', k.scale, 0.2, 2, 0.01)}<div class="button-row"><button id="preset-wave">轻轻摆动</button><button id="preset-breathe">呼吸起伏</button></div><button id="pose-reset" class="full">此刻回到初始姿势</button><p class="micro">模板只作用于当前选中的关节，会替换它在当前动作中的关键帧；其他关节不变。</p>` : `<label class="property"><span>父关节</span><select id="bone-parent" ${bone.id === 'root' || hasKeys(project) ? 'disabled' : ''}>${sortedBones(project).filter(b => b.id !== bone.id).map(b => `<option value="${b.id}" ${b.id === bone.parentId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><div class="property-row">${field('bone-x', '起点 X（父级内）', bone.x)}${field('bone-y', '起点 Y（父级内）', bone.y)}</div>${range('bone-rotation', '初始朝向', bone.rotation, -360, 360, 1, '°')}${field('bone-length', '骨骼长度', bone.length, 'min="0" max="4096"')}${range('bone-scale', '等比缩放', bone.scale, 0.1, 3, 0.01)}<p class="micro">拖起点移动整个骨骼链；拖末端改变长度与朝向。旋转父关节时，子关节和已绑定图片一起跟随。</p><div class="button-row"><button id="toggle-lock">${bone.locked ? '解锁关节' : '锁定关节'}</button><button id="delete-selected" class="danger" ${bone.id === 'root' || hasKeys(project) ? 'disabled' : ''}>删除关节</button></div>${hasKeys(project) ? '<div class="warning">为保护已有动作，修改父级 / 删除关节前需要先保存备份并清空动作。</div><button id="clear-animations" class="full">清空动作关键帧，继续改骨架</button>' : ''}`}`; return;
  }
  $('inspector-title').textContent = '操作向导';
  holder.innerHTML = `<div class="help-card"><strong>${mode === 'rig' ? '先把关节连起来' : mode === 'animate' ? '先选一个关节' : '像拼积木一样拼好角色'}</strong>${mode === 'rig' ? '点“画关节链”，依次点肩膀、肘部、手腕。Esc 或再次点按钮结束。' : mode === 'animate' ? '可以直接点人物，自动选中它跟随的关节。然后用右侧“转动角度”改变姿势。' : '从左边导入零件。拖动图片，右侧微调位置。头发在脸前还是脸后，用“向前 / 向后一层”调整。'}</div><div class="step-card"><b>① 拼好，再绑定</b>给零件选一个关节，绑定时不会跳位。</div><div class="step-card"><b>② 改错了也没关系</b>撤销 / 重做会保存最近 40 次修改。</div><div class="step-card"><b>③ 记得下载工程</b>工程保存包含图片，换电脑也能重新打开。浏览器副本不是永久备份。</div><div class="button-row"><button id="spread-parts">把零件整齐排开</button></div><p class="micro">拆件图集里的坐标不等于角色拼装坐标。本版不会根据 source_bbox 假装自动还原人物。</p>`;
}
function render(): void {
  if (selection?.kind === 'part' && !project.parts.some(a => a.id === selection!.id)) selection = null;
  if (selection?.kind === 'bone' && !project.bones.some(b => b.id === selection!.id)) selection = null;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $<HTMLInputElement>('project-name').value = project.name; $('part-count').textContent = String(project.parts.length);
  $('parts-list').innerHTML = project.parts.length ? [...project.parts].sort((a, b) => b.z - a.z).map(p => `<div class="part-row ${selection?.id === p.id ? 'selected' : ''}" data-part="${p.id}" role="button" tabindex="0" aria-label="选择 ${esc(p.name)}"><div class="thumb"><img src="${project.assets.find(a => a.id === p.assetId)!.dataUrl}" alt=""></div><span class="part-name">${esc(p.name)}</span><div class="row-tools"><button data-visible="${p.id}" title="${p.visible ? '隐藏' : '显示'}">${p.visible ? '◉' : '○'}</button><button data-lock="${p.id}" title="${p.locked ? '解锁' : '锁定'}">${p.locked ? '▣' : '◇'}</button></div></div>`).join('') : '<p class="micro">这里会显示你导入的零件。<br>PNG 的透明背景不会被画进角色。</p>';
  $('bones-list').innerHTML = sortedBones(project).map(b => {
    let depth = 0, parent = b.parentId; while (parent) { depth++; parent = project.bones.find(v => v.id === parent)!.parentId; }
    return `<button class="bone-row ${selection?.kind === 'bone' && selection.id === b.id ? 'selected' : ''}" data-bone="${b.id}" style="padding-left:${8 + depth * 12}px"><i>${b.id === 'root' ? '◎' : '◇'}</i><span>${esc(b.name)}</span></button>`;
  }).join('');
  const hints: Record<Mode, string> = { assemble: '拖动零件拼好角色。紫色顶点旋转，右下角缩放；右侧可精确调整。', rig: '依次点击“肩 → 肘 → 腕”画骨骼链，再给图片选择跟随的关节。根关节控制整体。', animate: '① 选时间　② 选关节　③ 转动或拖动　④ 播放。改动会自动记成关键帧。', export: '按 Spine 3.8 区域贴图 / FK 子集导出。JSON、ATLAS、PNG 必须放在同一目录。' };
  $('mode-hint').textContent = tool === 'draw' ? `画关节链：${chainStart ? '继续点下一个关节；Esc / 再点按钮结束。' : '先点起点，再点末端。'}父级：${project.bones.find(b => b.id === chainParent)?.name ?? '整体'}` : tool === 'bind' ? '绑定模式：已选中零件，请点它应该跟随的绿色关节。' : tool === 'pivot' ? '旋转点模式：在图片上点一下。图片会保持原位，只改变旋转中心。' : hints[mode];
  for (const [id, t] of [['select-tool', 'select'], ['draw-tool', 'draw'], ['bind-tool', 'bind']]) $(id).classList.toggle('selected', tool === t);
  $<HTMLButtonElement>('undo').disabled = !undo.length; $<HTMLButtonElement>('redo').disabled = !redo.length;
  $('empty-state').hidden = project.parts.length > 0 || tool === 'draw' || mode !== 'assemble';
  $('timeline').hidden = mode !== 'animate';
  $<HTMLSelectElement>('clip').innerHTML = project.clips.map(c => `<option value="${c.id}" ${c.id === currentClip()?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const clip = currentClip();
  if (clip) { $<HTMLInputElement>('duration').value = num(clip.duration); $<HTMLInputElement>('time').max = String(clip.duration); $('time-end').textContent = `${clip.duration.toFixed(2)} s`; }
  updateTimeUI(); renderProperties(); resizeBoard(); draw();
}
function updateTimeUI(): void {
  $('play').textContent = playing ? 'Ⅱ 暂停' : '▶ 播放'; $<HTMLInputElement>('time').value = String(time); $('time-label').textContent = `${time.toFixed(2)} s`;
  const b = activeBone(), clip = currentClip(), keys = b && clip ? clip.tracks[b.id] ?? [] : [];
  $('keys').innerHTML = keys.map(k => `<button class="key ${Math.abs(k.time - time) < 0.02 ? 'on' : ''}" data-time="${k.time}" style="left:${k.time / clip!.duration * 100}%" title="${k.time.toFixed(2)} 秒">◆</button>`).join('');
  $('track-label').textContent = b ? `${b.name} · ${keys.length} 个姿势` : '选择关节后，转动它就会记住姿势。';
  $<HTMLButtonElement>('add-key').disabled = !b || !clip; $<HTMLButtonElement>('delete-key').disabled = !keys.some(k => Math.abs(k.time - time) < 0.02);
}

function mutateProperty(p: Project, id: string, value: string): void {
  const part = selection?.kind === 'part' ? p.parts.find(a => a.id === selection!.id) : undefined;
  const bone = selection?.kind === 'bone' ? p.bones.find(b => b.id === selection!.id) : undefined;
  if (id === 'part-name' && part) { part.name = value.trim() || part.name; return; }
  if (id === 'bone-name' && bone) { bone.name = value.trim() || bone.name; return; }
  if (id === 'part-bind' && part) { bindPart(p, part.id, value); return; }
  if (id === 'bone-parent' && bone) { reparentBone(p, bone.id, value); return; }
  const n = Number(value); if (!Number.isFinite(n) || value.trim() === '') throw new Error('请输入有效的数字。');
  if (part) {
    if (part.locked) throw new Error('请先解锁零件。');
    switch (id) {
      case 'part-x': part.x = clamp(n, -10000, 10000); break;
      case 'part-y': part.y = clamp(n, -10000, 10000); break;
      case 'part-rotation': part.rotation = n; break;
      case 'part-scale': { const ratio = clamp(n, 0.05, 4) / Math.abs(part.scaleX); part.scaleX *= ratio; part.scaleY *= ratio; break; }
      case 'part-opacity': part.opacity = clamp(n, 0, 1); break;
      case 'pivot-x': movePivot(p, part.id, clamp(n, 0, 1), part.pivotY); break;
      case 'pivot-y': movePivot(p, part.id, part.pivotX, clamp(n, 0, 1)); break;
    }
  }
  if (bone) {
    if (bone.locked) throw new Error('请先解锁关节。');
    if (id.startsWith('pose-')) {
      const c = p.clips.find(c => c.id === clipId) ?? p.clips[0]; if (!c) return;
      const k = sampleTrack(c.tracks[bone.id], time);
      if (id === 'pose-x') k.x = clamp(n, -10000, 10000); if (id === 'pose-y') k.y = clamp(n, -10000, 10000);
      if (id === 'pose-rotation') k.rotation = n; if (id === 'pose-scale') k.scale = clamp(n, 0.1, 10);
      setKey(c, bone.id, time, k);
    } else {
      if (id === 'bone-x') bone.x = clamp(n, -10000, 10000); if (id === 'bone-y') bone.y = clamp(n, -10000, 10000);
      if (id === 'bone-rotation') bone.rotation = n; if (id === 'bone-scale') bone.scale = clamp(n, 0.1, 10); if (id === 'bone-length') bone.length = clamp(n, 0, 4096);
    }
  }
}
$('properties').addEventListener('input', e => {
  const input = e.target as HTMLInputElement; if (input.type !== 'range' || busy) return;
  try { if (!sliderBefore) sliderBefore = cloneProject(project); playing = false; mutateProperty(project, input.id, input.value); const label = document.getElementById(`${input.id}-value`); if (label) label.textContent = num(Number(input.value)); draw(); }
  catch (err) { if (sliderBefore) project = sliderBefore; sliderBefore = null; toast((err as Error).message, true); render(); }
});
$('properties').addEventListener('change', e => {
  const input = e.target as HTMLInputElement;
  if (input.type === 'range') { if (sliderBefore) { remember(sliderBefore); sliderBefore = null; changed(); } }
  else edit(p => mutateProperty(p, input.id, input.value));
});
function deleteSelection(): void {
  if (mode === 'animate' || mode === 'export') { toast('请回到拼装或关节步骤删除；动作中用“删除此帧”。'); return; }
  if (!selection) return;
  const chosen = selection;
  edit(p => {
    if (chosen.kind === 'bone') { if (p.bones.find(b => b.id === chosen.id)!.locked) throw new Error('请先解锁关节。'); deleteBone(p, chosen.id); }
    else { if (p.parts.find(a => a.id === chosen.id)!.locked) throw new Error('请先解锁零件。'); p.parts = p.parts.filter(a => a.id !== chosen.id); for(const c of p.clips) if(c.attachments) delete c.attachments[chosen.id]; }
  });
}
function reorder(direction: number): void {
  const selected = activePart(); if (!selected) return;
  edit(p => { const order = [...p.parts].sort((a, b) => a.z - b.z), i = order.findIndex(a => a.id === selected.id), next = clamp(i + direction, 0, order.length - 1); [order[i], order[next]] = [order[next], order[i]]; order.forEach((a, i) => a.z = i); });
}
$('properties').addEventListener('click', e => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || busy) return;
  const part = activePart(), bone = activeBone();
  switch (button.id) {
    case 'export-spine': void job(async () => { const out = await exportBundle(project); download(`${fileStem(project.name)}-spine38.zip`, out.bytes, 'application/zip'); toast(`已导出 ${out.pages} 页图集，解压贴图约 ${out.memoryMB.toFixed(1)}MB。请按包内 IMPORT.md 在引擎验收。`); }); break;
    case 'export-png': void job(async () => { download(`${fileStem(project.name)}-setup.png`, await exportPNG(project), 'image/png'); toast('已导出真正带 Alpha 的初始姿势 PNG。'); }); break;
    case 'export-frames': void job(async () => { if (currentClip()) { download(`${fileStem(project.name)}-${fileStem(currentClip()!.name)}-frames.zip`, await exportFrames(project, currentClip()!), 'application/zip'); toast('已导出 15fps 透明 PNG 序列帧。'); } }); break;
    case 'delete-selected': deleteSelection(); break;
    case 'flip-x': if (part) edit(p => { if (part.locked) throw new Error('请先解锁。'); p.parts.find(a => a.id === part.id)!.scaleX *= -1; }); break;
    case 'flip-y': if (part) edit(p => { if (part.locked) throw new Error('请先解锁。'); p.parts.find(a => a.id === part.id)!.scaleY *= -1; }); break;
    case 'layer-up': reorder(1); break; case 'layer-down': reorder(-1); break;
    case 'toggle-lock': edit(p => { const a = part ? p.parts.find(v => v.id === part.id)! : p.bones.find(v => v.id === bone!.id)!; a.locked = !a.locked; }); break;
    case 'duplicate-part': if (part) edit(p => { const copy = { ...part, id: uid('part'), name: `${part.name} 副本`, x: part.x + 15, y: part.y + 15, z: Math.max(...p.parts.map(a => a.z)) + 1 }; p.parts.push(copy); selection = { kind: 'part', id: copy.id }; }); break;
    case 'pivot-center': if (part) edit(p => movePivot(p, part.id, 0.5, 0.5)); break;
    case 'pivot-top': if (part) edit(p => movePivot(p, part.id, 0.5, 0)); break;
    case 'pivot-click': if (part) { tool = 'pivot'; setPane('canvas'); render(); } break;
    case 'joint-for-part': if (part) {
      edit(p => { const worlds = worldBones(p), at = point(worlds.get(part.boneId)!, part.x, part.y), id = addBone(p, at, { x: at.x + 55, y: at.y }, part.boneId); p.bones.find(b => b.id === id)!.name = `${part.name}关节`; bindPart(p, part.id, id); selection = { kind: 'bone', id }; }); mode = 'rig'; render(); break;
    } break;
    case 'preset-wave': case 'preset-breathe': if (bone && currentClip()) {
      if (currentClip()!.tracks[bone.id]?.length && !confirm('这会替换当前关节在此动作中的关键帧，其他关节不变。继续？')) break;
      const breathe = button.id === 'preset-breathe';
      edit(p => { const c = p.clips.find(v => v.id === currentClip()!.id)!; c.tracks[bone.id] = []; for (const [fraction, value] of (breathe ? [[0, 0], [0.5, 1], [1, 0]] : [[0, 0], [0.25, -1], [0.75, 1], [1, 0]])) setKey(c, bone.id, c.duration * fraction, { x: 0, y: breathe ? -4 * value : 0, rotation: breathe ? 0 : 12 * value, scale: breathe ? 1 + 0.02 * value : 1 }); }, '模板已生成，点击播放看看。'); break;
    } break;
    case 'pose-reset': if (bone && currentClip()) edit(p => setKey(p.clips.find(c => c.id === currentClip()!.id)!, bone.id, time, restPose())); break;
    case 'clear-animations': if (confirm('会清空全部动作关键帧，但保留骨架和零件。建议先下载工程备份；也可以撤销。继续？')) edit(p => p.clips.forEach(c => { c.tracks = {}; c.attachments = {}; })); break;
    case 'spread-parts': if (hasKeys(project)) { toast('已有动画。请新建工程导入零件后使用排开功能。'); break; }
      edit(p => { p.parts.forEach((a, i) => { bindPart(p, a.id, 'root'); const root = p.bones.find(b => b.id === 'root')!; if (root.rotation !== 0 || root.scale !== 1) throw new Error('请先把根关节转动归零、缩放归 1。'); const asset = p.assets.find(v => v.id === a.assetId)!; a.x = 140 + (i % 3) * 250 - root.x; a.y = 130 + Math.floor(i / 3) * 190 - root.y; a.rotation = 0; a.scaleX = a.scaleY = Math.min(1, 160 / Math.max(asset.width, asset.height)); }); }, '已按三列排开；大图仅缩放显示，未改动源图片。'); break;
  }
});

async function replaceProject(p: Project): Promise<void> {
  const checked = parseProject(p); await Promise.all(checked.assets.map(loadAsset));
  remember(); project = checked; selection = null; clipId = project.clips[0]?.id ?? ''; time = 0; playing = false; tool = 'select'; chainStart = null;
  pruneCache(project); $('resume').hidden = true; changed(); setPane('canvas'); requestAnimationFrame(fit);
}
async function importImages(files: File[]): Promise<void> {
  await job(async () => {
    let blobs: { file: Blob; name: string }[] = [];
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) {
        const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
        const source = entries.filter(e => /(^|\/)parts\/[^/]+\.(png|webp)$/i.test(e.name));
        const selected = source.length ? source : entries.filter(e => /\.(png|webp)$/i.test(e.name) && !/(^|\/)(atlas|source)\//i.test(e.name));
        blobs.push(...selected.map(e => ({ file: new Blob([e.bytes], { type: /\.webp$/i.test(e.name) ? 'image/webp' : 'image/png' }), name: e.name.split('/').pop()! })));
      } else if (/\.(png|webp)$/i.test(file.name)) blobs.push({ file, name: file.name });
    }
    if (!blobs.length) throw new Error('没有找到 PNG/WebP 零件。工程 ZIP 请用“打开工程”。');
    if (project.assets.length + blobs.length > 256) throw new Error('一次工程最多 256 张素材。');
    const assets = []; for (const b of blobs) assets.push(await readImage(b.file, b.name));
    const next = cloneProject(project); assets.forEach((a, i) => addPart(next, a, { x: project.canvas.width / 2 + i * 8, y: project.canvas.height / 2 + i * 8 }));
    parseProject(next); remember(); project = next; mode = 'assemble'; selection = { kind: 'part', id: project.parts[project.parts.length - 1].id }; changed(); setPane('canvas'); requestAnimationFrame(fit);
    toast(`已导入 ${assets.length} 个零件。源图集坐标只用于裁切，不会被误当作角色坐标。`);
  });
}
function demo(): void { void job(async () => { if (project.parts.length && !confirm('打开练习角色会替换当前画板。当前工程可撤销恢复；建议先保存。继续？')) return; await replaceProject(await demoProject()); mode = 'animate'; selection = { kind: 'bone', id: 'lower_right' }; render(); fit(); toast('练习角色已打开：点播放看挥手，点右前臂试试转动。'); }); }
for (const id of ['import', 'empty-import']) $(id).onclick = () => $<HTMLInputElement>('image-input').click();
for (const id of ['demo', 'empty-demo']) $(id).onclick = demo;
$('open').onclick = () => $<HTMLInputElement>('project-input').click();
$('save').onclick = () => { try { saveProject(project); toast('工程已下载，包含全部图片、关节和动作。'); } catch (e) { toast((e as Error).message, true); } };
$('new').onclick = () => { if (project.parts.length && !confirm('新建空工程？当前内容可撤销恢复，建议先保存。')) return; void job(async () => { await replaceProject(newProject()); mode = 'assemble'; }); };
$('go-export').onclick = () => switchMode('export');
$<HTMLInputElement>('image-input').onchange = e => { const input = e.target as HTMLInputElement; if (input.files) void importImages([...input.files]); input.value = ''; };
$<HTMLInputElement>('project-input').onchange = e => {
  const input = e.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
  void job(async () => {
    if (file.size > 120 * 1024 * 1024) throw new Error('工程文件过大。');
    let text: string;
    if (/\.zip$/i.test(file.name)) { const entries = await readZip(new Uint8Array(await file.arrayBuffer())); const entry = entries.find(e => /\.project\.json$/i.test(e.name)); if (!entry) throw new Error('ZIP 内没有 .project.json；零件包请用“导入 PNG / 部件 ZIP”。'); text = new TextDecoder().decode(entry.bytes); }
    else text = await file.text();
    const p = parseProject(JSON.parse(text));
    if (project.parts.length && !confirm('打开工程会替换当前画板。可撤销恢复。继续？')) return;
    await replaceProject(p); toast(`已还原「${p.name}」：${p.parts.length} 个零件、${p.bones.length} 个关节。`);
  });
};
$('project-name').onchange = e => edit(p => p.name = (e.target as HTMLInputElement).value.trim().slice(0, 80) || 'my-character');
$('parts-list').addEventListener('click', e => {
  const target = e.target as HTMLElement, visible = target.closest<HTMLElement>('[data-visible]'), lock = target.closest<HTMLElement>('[data-lock]'), row = target.closest<HTMLElement>('[data-part]');
  if (visible) edit(p => { const a = p.parts.find(v => v.id === visible.dataset.visible)!; a.visible = !a.visible; });
  else if (lock) edit(p => { const a = p.parts.find(v => v.id === lock.dataset.lock)!; a.locked = !a.locked; });
  else if (row) choosePart(row.dataset.part!);
});
$('parts-list').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { const row = (e.target as HTMLElement).closest<HTMLElement>('[data-part]'); if (row) { e.preventDefault(); choosePart(row.dataset.part!); } } });
$('bones-list').addEventListener('click', e => { const row = (e.target as HTMLElement).closest<HTMLElement>('[data-bone]'); if (row) chooseBone(row.dataset.bone!); });
$('clear-selection').onclick = () => chooseBone('root');
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) button.onclick = () => switchMode(button.dataset.mode as Mode);
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-pane]')) button.onclick = () => setPane(button.dataset.pane!);
$('select-tool').onclick = () => { tool = 'select'; chainStart = null; render(); };
$('draw-tool').onclick = () => { if (tool === 'draw') { tool = 'select'; chainStart = null; } else { mode = 'rig'; tool = 'draw'; chainStart = null; chainParent = activeBone()?.id ?? 'root'; } render(); };
$('bind-tool').onclick = () => { if (!activePart()) { toast('先在部件库中选中一个图片零件。'); return; } mode = 'rig'; tool = 'bind'; chainStart = null; render(); };
$('fit').onclick = fit;
$<HTMLSelectElement>('zoom').onchange = e => { zoom = Number((e.target as HTMLSelectElement).value) || zoom; resizeBoard(); draw(); };
function historyMove(back: boolean): void {
  if (busy || drag) return; const source = back ? undo : redo, target = back ? redo : undo; const previous = source.pop(); if (!previous) return;
  target.push(cloneProject(project)); project = previous; playing = false; selection = null;
  if (!project.clips.some(c => c.id === clipId)) clipId = project.clips[0]?.id ?? '';
  time = Math.min(time, currentClip()?.duration ?? 0); void Promise.all(project.assets.map(loadAsset)).then(draw); changed();
}
$('undo').onclick = () => historyMove(true); $('redo').onclick = () => historyMove(false);
$('play').onclick = () => { if (!currentClip()) return; if (time >= currentClip()!.duration) time = 0; playing = !playing; updateTimeUI(); renderProperties(); };
$<HTMLInputElement>('time').oninput = e => { time = Number((e.target as HTMLInputElement).value); playing = false; updateTimeUI(); renderProperties(); draw(); };
$('keys').addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLElement>('[data-time]'); if (button) { time = Number(button.dataset.time); playing = false; updateTimeUI(); renderProperties(); draw(); } });
$<HTMLSelectElement>('clip').onchange = e => { clipId = (e.target as HTMLSelectElement).value; time = 0; playing = false; render(); };
$('duration').onchange = e => edit(p => { const c = p.clips.find(c => c.id === currentClip()!.id)!; const n = Number((e.target as HTMLInputElement).value); const last = Math.max(0, ...Object.values(c.tracks).flat().map(k => k.time), ...Object.values(c.attachments ?? {}).flat().map(k => k.time)); if (!Number.isFinite(n) || n < Math.max(0.1, last) || n > 60) throw new Error(`时长不能短于最后的关键帧（${last} 秒），且最多 60 秒。`); c.duration = n; time = Math.min(time, n); });
$('add-clip').onclick = () => { const name = prompt('给新动作起个名字（游戏里会用到）', 'wave'); if (!name?.trim()) return; edit(p => { if (p.clips.some(c => c.name === name.trim())) throw new Error('动作名字不能重复。'); const id = uid('clip'); p.clips.push({ id, name: name.trim().slice(0, 80), duration: 2, tracks: {} }); clipId = id; time = 0; }); };
$('delete-clip').onclick = () => { if (!currentClip() || !confirm('删除当前动作？可以撤销。')) return; const id = currentClip()!.id; edit(p => { p.clips = p.clips.filter(c => c.id !== id); if (!p.clips.length) p.clips.push({ id: 'idle', name: 'idle', duration: 2, tracks: {} }); clipId = p.clips[0].id; time = 0; }); };
$('add-key').onclick = () => { const b = activeBone(), c = currentClip(); if (b && c) edit(p => setKey(p.clips.find(v => v.id === c.id)!, b.id, time, pose(b.id))); };
$('delete-key').onclick = () => { const b = activeBone(), c = currentClip(); if (b && c) edit(p => { const clip = p.clips.find(v => v.id === c.id)!; clip.tracks[b.id] = (clip.tracks[b.id] ?? []).filter(k => Math.abs(k.time - time) >= 0.02); }); };
$('restore').onclick = () => { if (savedCandidate) void job(async () => { await replaceProject(savedCandidate!); toast('上次工程已恢复。'); }); };
$('dismiss-resume').onclick = () => $('resume').hidden = true;
window.addEventListener('keydown', e => {
  if (busy || document.querySelector('dialog[open]')) return;
  const input = e.target as HTMLElement; if (['INPUT', 'SELECT', 'TEXTAREA'].includes(input.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('save').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); historyMove(!e.shiftKey); }
  if (e.key === 'Escape') { if (drag) finishDrag(true); tool = 'select'; chainStart = null; playing = false; render(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
  if (e.code === 'Space' && mode === 'animate') { e.preventDefault(); $('play').click(); }
  const arrows: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
  const delta = arrows[e.key];
  if (delta && selection && mode !== 'export') { e.preventDefault(); const amount = e.shiftKey ? 10 : 1;
    edit(p => { const part = activePart(); if (part) { if (part.locked) return; const a = p.parts.find(v => v.id === part.id)!; const parent = worldBones(p).get(a.boneId)!, zero = point(inverse(parent), 0, 0), step = point(inverse(parent), delta.x * amount, delta.y * amount); a.x += step.x - zero.x; a.y += step.y - zero.y; }
      else { const b = activeBone(); if (!b || b.locked) return; if (mode === 'animate') { const k = pose(b.id); k.x += delta.x * amount; k.y += delta.y * amount; setKey(p.clips.find(c => c.id === currentClip()!.id)!, b.id, time, k); } else { const a = p.bones.find(v => v.id === b.id)!; a.x += delta.x * amount; a.y += delta.y * amount; } }
    });
  }
});
window.addEventListener('resize', fit);
let previousFrame = performance.now();
function frame(now: number): void {
  const delta = Math.min((now - previousFrame) / 1000, 0.1); previousFrame = now;
  if (playing && currentClip()) { time = (time + delta) % currentClip()!.duration; draw(); updateTimeUI(); }
  requestAnimationFrame(frame);
}
render(); requestAnimationFrame(() => { fit(); requestAnimationFrame(frame); });
void restoreAutosave().then(p => { if (p && revision === 0) { savedCandidate = p; $('resume').hidden = false; } }).catch(() => { $('save-state').textContent = '本地存储不可用，请下载工程'; });

// V0.3 preparation remains optional and stores its own source revisions.
const preparation = initPreparation({ notice: toast, importAssets: async assets => {
  if(busy) throw new Error('画板正在处理，请稍后再导入。');
  const next = cloneProject(project);
  for(const [i,a] of assets.entries()) {
    await loadAsset(a); const id = addPart(next, a, {x:140+(i%3)*240,y:130+Math.floor(i/3)*180});
    const part = next.parts.find(p=>p.id===id)!; part.scaleX = part.scaleY = Math.min(1,160/Math.max(a.width,a.height));
  }
  parseProject(next); remember(); project=next;mode='assemble';selection=null;changed();setPane('canvas');requestAnimationFrame(fit);
  toast('已导入确认的透明零件。先拼装；闭眼等替换图可以在“表情换图”里归入同一个部件。');
} });
$('prepare').onclick = preparation.open;
$('empty-prepare').onclick = preparation.open;
function expressionPart(): Part | undefined {
  if(activePart()) expressionPartId=activePart()!.id;
  if(!project.parts.some(p=>p.id===expressionPartId)) expressionPartId=project.parts.find(p=>/eye|眼/.test(p.name))?.id??project.parts[0]?.id??'';
  return project.parts.find(p=>p.id===expressionPartId);
}
function previewClip(): Clip | undefined {
  if(mode==='animate')return currentClip();
  const part=project.parts.find(p=>p.id===expressionPartId);
  if(mode==='assemble' && alignVariantId!=='base' && part?.variants?.some(v=>v.id===alignVariantId))return {id:'preview',name:'preview',duration:60,tracks:{},attachments:{[part.id]:[{time:0,variantId:alignVariantId}]}};
  return undefined;
}
function renderExpressions(): void {
  const holder=$('expressions'); if(!holder)return;
  holder.hidden=!project.parts.length||!['assemble','animate'].includes(mode); if(holder.hidden)return;
  const part=expressionPart()!;
  if(alignVariantId!=='base'&&!part.variants?.some(v=>v.id===alignVariantId))alignVariantId='base';
  const state=mode==='animate'?sampleAttachment(currentClip(),part.id,time):alignVariantId;
  const variant=part.variants?.find(v=>v.id===state);
  holder.innerHTML=`<h3>表情换图 <small>V0.3</small></h3><label class="property"><span>眼睛 / 嘴巴等部件</span><select id="expr-part">${project.parts.map(p=>`<option value="${p.id}" ${p.id===part.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label class="property"><span>${mode==='animate'?'此刻显示（改变即记帧）':'对齐预览（不改变初始图）'}</span><select id="expr-state"><option value="base" ${state==='base'?'selected':''}>初始图片</option>${(part.variants??[]).map(v=>`<option value="${v.id}" ${state===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}${mode==='animate'?`<option value="hidden" ${state===null?'selected':''}>隐藏此部件</option>`:''}</select></label>${variant?`<div class="property-row">${field('expr-x','替换图对齐 X',variant.x)}${field('expr-y','替换图对齐 Y',variant.y)}</div>${field('expr-scale','替换图等比缩放',variant.scaleX,'min="0.01" max="10" step="0.01"')}<button id="expr-remove-variant" class="danger full">删除此替换图（关联帧一同删除）</button>`:''}<details><summary>加入闭眼 / 嘴型替换图片</summary><select id="expr-source"><option value="">选择画板里已导入的另一零件</option>${project.parts.filter(p=>p.id!==part.id).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button id="expr-add-existing" class="full">将这个零件收为替换图片</button><button id="expr-add-file" class="full">或上传替换 PNG / WebP</button></details>${mode==='animate'?`<div class="button-row"><button id="expr-blink" ${part.variants?.length?'':'disabled'}>生成眨眼</button><button id="expr-delete-key">删除此刻换图帧</button></div><div class="expression-keys">${(currentClip()?.attachments?.[part.id]??[]).map(k=>`<button data-expr-time="${k.time}">${num(k.time)}s · ${k.variantId==='base'?'初始':k.variantId===null?'隐藏':esc(part.variants?.find(v=>v.id===k.variantId)?.name)}</button>`).join('')}</div>`:''}<p class="micro">同一个部件在不同时间换图片，位置和骨骼保持不变。先对齐睁眼 / 闭眼；透明画布尺寸不同也能微调。换图轨道会写入 Spine 导出。</p>`;
}
$('expressions').addEventListener('change',e=>{
  const input=e.target as HTMLInputElement,part=expressionPart();if(!part)return;
  if(input.id==='expr-part'){expressionPartId=input.value;selection=null;alignVariantId='base';renderExpressions();draw();return;}
  if(input.id==='expr-state'){
    if(mode==='animate'){playing=false;edit(p=>setAttachmentKey(p.clips.find(c=>c.id===currentClip()!.id)!,p.parts.find(a=>a.id===part.id)!,time,input.value==='hidden'?null:input.value));}
    else{alignVariantId=input.value;renderExpressions();draw();}return;
  }
  if(['expr-x','expr-y','expr-scale'].includes(input.id)){
    const id=mode==='animate'?sampleAttachment(currentClip(),part.id,time):alignVariantId;
    edit(p=>{const v=p.parts.find(a=>a.id===part.id)!.variants?.find(v=>v.id===id);if(!v)return;const n=Number(input.value);if(!Number.isFinite(n))throw new Error('数值无效。');if(input.id==='expr-x')v.x=clamp(n,-10000,10000);else if(input.id==='expr-y')v.y=clamp(n,-10000,10000);else v.scaleX=v.scaleY=clamp(n,.01,10);});
  }
});
$('expressions').addEventListener('click',e=>{
  const button=(e.target as HTMLElement).closest<HTMLButtonElement>('button'),part=expressionPart();if(!button||!part)return;
  if(button.dataset.exprTime){time=Number(button.dataset.exprTime);playing=false;render();return;}
  if(button.id==='expr-add-file'){$<HTMLInputElement>('variant-input').click();return;}
  if(button.id==='expr-add-existing'){
    const source=project.parts.find(p=>p.id===$<HTMLSelectElement>('expr-source').value);if(!source)return;
    if(!confirm('将该零件的图片加入替换列表，并从画板移走独立零件？旧工程可撤销恢复，源图片仍保留。'))return;
    edit(p=>{alignVariantId=addVariant(p,part.id,source.assetId,source.name);p.parts=p.parts.filter(a=>a.id!==source.id);for(const c of p.clips)if(c.attachments)delete c.attachments[source.id];},'已加入替换图，请先调整对齐；制作动作时改变显示状态。');return;
  }
  if(button.id==='expr-remove-variant'){
    const id=mode==='animate'?sampleAttachment(currentClip(),part.id,time):alignVariantId;if(!id||id==='base'||!confirm('删除替换图及引用它的换图帧？可撤销。'))return;
    edit(p=>{p.parts.find(a=>a.id===part.id)!.variants=p.parts.find(a=>a.id===part.id)!.variants!.filter(v=>v.id!==id);for(const c of p.clips)if(c.attachments?.[part.id])c.attachments[part.id]=c.attachments[part.id].filter(k=>k.variantId!==id);alignVariantId='base';});return;
  }
  if(button.id==='expr-blink'){
    const id=sampleAttachment(currentClip(),part.id,time);const variant=part.variants?.find(v=>v.id===id)??part.variants?.find(v=>/closed|闭/.test(v.name))??part.variants?.[0];if(!variant||!currentClip())return;
    if(!confirm(`使用「${variant.name}」作为闭眼图片，替换该部件当前动作的换图帧？`))return;
    edit(p=>blink(p,p.clips.find(c=>c.id===currentClip()!.id)!,part.id,variant.id),'眨眼轨道已生成，点击播放。');return;
  }
  if(button.id==='expr-delete-key'&&currentClip())edit(p=>{const c=p.clips.find(c=>c.id===currentClip()!.id)!;if(c.attachments?.[part.id])c.attachments[part.id]=c.attachments[part.id].filter(k=>Math.abs(k.time-time)>.02);});
});
$<HTMLInputElement>('variant-input').onchange=e=>{
 const input=e.target as HTMLInputElement,file=input.files?.[0],part=expressionPart();input.value='';if(!file||!part)return;
 void job(async()=>{const asset=await readImage(file,file.name),next=cloneProject(project);next.assets.push(asset);alignVariantId=addVariant(next,part.id,asset.id,asset.name);parseProject(next);remember();project=next;changed();toast('已加入替换图。在拼装模式预览对齐；在动作模式记住显示状态。');});
};
