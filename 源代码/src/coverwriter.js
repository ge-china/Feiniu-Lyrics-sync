import fs from 'node:fs/promises';
import path from 'node:path';
import { File, Picture, ByteVector } from 'node-taglib-sharp';

export function coverCandidates(file) {
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  const dir = path.dirname(file);
  return [
    base + '.jpg',
    base + '.jpeg',
    base + '.png',
    base + '.webp',
    path.join(dir, 'cover.jpg'),
    path.join(dir, 'folder.jpg'),
    path.join(dir, 'Cover.jpg')
  ];
}

export async function findCover(file) {
  for (const c of coverCandidates(file)) {
    try { await fs.access(c); return c; } catch (e) {}
  }
  return '';
}

function extOf(type) {
  if (/png/i.test(type)) return '.png';
  if (/webp/i.test(type)) return '.webp';
  return '.jpg';
}

export async function writeCoverSidecar(file, buf, type) {
  const ext = extOf(type);
  const target = file.slice(0, file.length - path.extname(file).length) + ext;
  await fs.writeFile(target, buf);
  return target;
}

export async function writeCoverEmbedded(file, buf) {
  let f = null;
  try {
    f = File.createFromPath(file);
    const pic = Picture.fromData(ByteVector.fromByteArray(buf));
    const existing = f.tag.pictures || [];
    f.tag.pictures = existing.length ? existing : [pic];
    if (existing.length) {
      f.tag.pictures = [pic];
    }
    f.save();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (f) { try { f.dispose(); } catch (e) {} }
  }
}
