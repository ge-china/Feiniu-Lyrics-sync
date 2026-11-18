import path from 'node:path';
import fs from 'node:fs/promises';
import { File } from 'node-taglib-sharp';

export async function writeEmbedded(filePath, lrcText, opts) {
  const o = opts || {};
  if (o.backupDir) {
    try {
      const dest = path.join(o.backupDir, path.basename(filePath) + '.' + Date.now() + '.bak');
      await fs.copyFile(filePath, dest);
    } catch (e) {}
  }
  let file = null;
  try {
    file = File.createFromPath(filePath);
    file.tag.lyrics = String(lrcText).replace(/\r\n/g, '\n');
    file.save();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (file) { try { file.dispose(); } catch (e) {} }
  }
}


export async function clearEmbedded(filePath, opts) {
  const o = opts || {};
  if (o.backupDir) {
    try {
      const dest = path.join(o.backupDir, path.basename(filePath) + '.' + Date.now() + '.bak');
      await fs.copyFile(filePath, dest);
    } catch (e) {}
  }
  let file = null;
  try {
    file = File.createFromPath(filePath);
    file.tag.lyrics = '';
    file.save();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (file) { try { file.dispose(); } catch (e) {} }
  }
}
