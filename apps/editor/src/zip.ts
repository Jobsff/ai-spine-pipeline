/** Small ZIP codec. Writes STORE (PNGs are already compressed). Reads STORE/DEFLATE.
 * No third-party browser code. ZIP64, encrypted archives and symlinks are unsupported.
 */
export interface ZipEntry { name: string; bytes: Uint8Array }
const encoder = new TextEncoder(), decoder = new TextDecoder();
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
export function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u16 = (d: DataView, o: number, n: number): void => d.setUint16(o, n, true);
const u32 = (d: DataView, o: number, n: number): void => d.setUint32(o, n, true);
export function safePath(name: string): boolean {
  return name.length > 0 && name.length < 500 && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !name.includes(':') && !name.split('/').some(p => p === '..' || p === '.');
}
export function writeZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length > 10000) throw new Error('ZIP 文件数量过多。');
  const names = entries.map(e => encoder.encode(e.name));
  if (entries.some(e => !safePath(e.name)) || new Set(entries.map(e => e.name)).size !== entries.length) throw new Error('ZIP 路径非法或重复。');
  const localSize = entries.reduce((s, e, i) => s + 30 + names[i].length + e.bytes.length, 0);
  const dirSize = entries.reduce((s, _, i) => s + 46 + names[i].length, 0);
  if (localSize + dirSize > 256 * 1024 * 1024) throw new Error('导出包超过 256MB，请减少图片或动画帧数。');
  const out = new Uint8Array(localSize + dirSize + 22), d = new DataView(out.buffer);
  let pos = 0, dir = localSize;
  entries.forEach((e, i) => {
    const n = names[i], crc = crc32(e.bytes);
    u32(d, pos, 0x04034b50); u16(d, pos + 4, 20); u16(d, pos + 6, 0x800);
    u16(d, pos + 12, 33); u32(d, pos + 14, crc); u32(d, pos + 18, e.bytes.length); u32(d, pos + 22, e.bytes.length); u16(d, pos + 26, n.length);
    out.set(n, pos + 30); out.set(e.bytes, pos + 30 + n.length);
    u32(d, dir, 0x02014b50); u16(d, dir + 4, 20); u16(d, dir + 6, 20); u16(d, dir + 8, 0x800);
    u16(d, dir + 14, 33); u32(d, dir + 16, crc); u32(d, dir + 20, e.bytes.length); u32(d, dir + 24, e.bytes.length); u16(d, dir + 28, n.length); u32(d, dir + 42, pos);
    out.set(n, dir + 46); pos += 30 + n.length + e.bytes.length; dir += 46 + n.length;
  });
  u32(d, dir, 0x06054b50); u16(d, dir + 8, entries.length); u16(d, dir + 10, entries.length); u32(d, dir + 12, dirSize); u32(d, dir + 16, localSize);
  return out;
}
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  if (bytes.length > 100 * 1024 * 1024) throw new Error('导入 ZIP 不能超过 100MB。');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (d.getUint32(i, true) === 0x06054b50 && i + 22 + d.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0 || d.getUint16(end + 4, true) !== 0 || d.getUint16(end + 6, true) !== 0) throw new Error('ZIP 损坏或属于不支持的分卷格式。');
  const count = d.getUint16(end + 10, true), entries: ZipEntry[] = [], names = new Set<string>();
  let pos = d.getUint32(end + 16, true), total = 0;
  if (count > 1024 || count === 0xffff) throw new Error('ZIP 文件过多或使用了不支持的 ZIP64。');
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || d.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP 目录损坏。');
    const flag = d.getUint16(pos + 8, true), method = d.getUint16(pos + 10, true), crc = d.getUint32(pos + 16, true);
    const packed = d.getUint32(pos + 20, true), size = d.getUint32(pos + 24, true);
    const nl = d.getUint16(pos + 28, true), el = d.getUint16(pos + 30, true), cl = d.getUint16(pos + 32, true), offset = d.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nl)); pos += 46 + nl + el + cl;
    if (!safePath(name) || names.has(name) || flag & 1 || ![0, 8].includes(method)) throw new Error('ZIP 含非法路径、重复文件、加密内容或不支持的压缩方式。'); names.add(name);
    total += size;
    if (size > 64 * 1024 * 1024 || total > 150 * 1024 * 1024) throw new Error('ZIP 解压数据过大。');
    if (offset + 30 > bytes.length || d.getUint32(offset, true) !== 0x04034b50) throw new Error('ZIP 文件头损坏。');
    const start = offset + 30 + d.getUint16(offset + 26, true) + d.getUint16(offset + 28, true);
    if (start + packed > bytes.length) throw new Error('ZIP 数据越界。');
    if (name.endsWith('/')) continue;
    const raw = bytes.slice(start, start + packed);
    let content: Uint8Array;
    if (method === 0) content = raw;
    else {
      let stream: DecompressionStream;
      try { stream = new DecompressionStream('deflate-raw'); } catch { throw new Error('当前浏览器不支持解压此 ZIP，请先解压后多选 PNG 导入。'); }
      const reader = new Blob([raw]).stream().pipeThrough(stream).getReader(), chunks: Uint8Array[] = [];
      let actual = 0;
      while (true) {
        const next = await reader.read(); if (next.done) break;
        actual += next.value.length;
        if (actual > size) { await reader.cancel(); throw new Error('ZIP 解压尺寸与声明不符。'); }
        chunks.push(next.value);
      }
      content = new Uint8Array(actual); let at = 0; for (const c of chunks) { content.set(c, at); at += c.length; }
    }
    if (content.length !== size || crc32(content) !== crc) throw new Error(`ZIP 校验失败：${name}`);
    entries.push({ name, bytes: content });
  }
  return entries;
}
export const textEntry = (name: string, text: string): ZipEntry => ({ name, bytes: encoder.encode(text) });
