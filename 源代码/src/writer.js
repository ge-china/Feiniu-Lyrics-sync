import fs from 'node:fs/promises';
import path from 'node:path';

export function sidecarPath(file) {
  const ext = path.extname(file);
  return file.slice(0, file.length - ext.length) + '.lrc';
}

export async function writeLrc(lrcPath, text, opts) {
  const o = opts || {};
  let existed = false;
  try { await fs.access(lrcPath); existed = true; } catch (e) {}
  if (existed && o.force !== true) return { written: false, reason: 'exists' };
  if (existed && o.force === true && o.backupDir) {
    try {
      await fs.copyFile(lrcPath, path.join(o.backupDir, path.basename(lrcPath) + '.' + Date.now() + '.bak'));
    } catch (e) {}
  }
  const body = String(text).replace(/\r\n/g, '\n').replace(/\uFEFF/g, '').trim() + '\n';
  await fs.mkdir(path.dirname(lrcPath), { recursive: true });
  await fs.writeFile(lrcPath, body, 'utf8');
  return { written: true, bytes: Buffer.byteLength(body, 'utf8') };
}
