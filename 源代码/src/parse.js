import path from 'node:path';

// 优先用内嵌标签，缺失时从文件名/目录名推断
export function fromPath(filePath, common) {
  const c = common || {};
  const out = {};

  let artist = '';
  if (c.artist) artist = String(c.artist);
  else if (Array.isArray(c.artists) && c.artists.length) {
    artist = c.artists.map(function (a) { return typeof a === 'string' ? a : (a && a.name) || ''; }).filter(Boolean).join('/');
  }

  out.title = c.title ? String(c.title).trim() : '';
  out.artist = String(artist || '').trim();
  out.album = c.album ? String(c.album).trim() : '';

  if (!out.title || !out.artist) {
    const base = path.basename(filePath, path.extname(filePath));
    let name = base.replace(/^\s*\d{1,3}[\s._\-]+/, '').trim();
    const parts = name.split(/\s+[-\u2013\u2014]\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length >= 2) {
      if (!out.artist) out.artist = parts[0];
      if (!out.title) out.title = parts.slice(1).join(' - ');
    } else if (!out.title) {
      out.title = name;
    }
  }

  if (!out.title) out.title = path.basename(filePath, path.extname(filePath));
  return out;
}
