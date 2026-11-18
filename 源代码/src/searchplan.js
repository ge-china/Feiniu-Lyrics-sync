import path from 'node:path';
import { norm } from './util.js';

let Converter = null;
try {
  const mod = await import('opencc-js');
  Converter = mod.Converter({ from: 'cn', to: 'tw' });
} catch (e) {
  Converter = null;
}

// 去掉括号内容（含中英文括号）
export function stripBrackets(s) {
  return String(s || '')
    .replace(/[\(\（\[\【][^\)\）\]\】]*[\)\）\]\】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 去掉常见副标题/修饰
export function stripSubtitle(s) {
  return String(s || '')
    .replace(/\s*[-–—]\s*(live|remaster(ed)?|acoustic|ost|主题曲|插曲|片尾曲|片头曲|特别版|重制版|现场版|演唱会版).*$/i, '')
    .replace(/\s*(live|remastered|acoustic version|instrumental)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toTraditional(s) {
  if (!Converter) return '';
  try { return Converter(String(s || '')); } catch (e) { return ''; }
}

// 从文件名解析出的原始串（去编号、去扩展名）
export function rawFromFilename(file) {
  const base = path.basename(file, path.extname(file));
  return base.replace(/^\s*\d{1,3}[\s._\-]+/, '').trim();
}

/**
 * 生成检索阶梯 L1..L7
 * track = { title, artist, album, duration, file }
 */
export function buildQueries(track) {
  const t = String(track.title || '').trim();
  const a = String(track.artist || '').trim();
  const al = String(track.album || '').trim();
  const raw = rawFromFilename(track.file || '');
  const out = [];
  const seen = new Set();
  const push = (level, title, artist, album, note) => {
    if (!title) return;
    const key = (norm(title) + '|' + norm(artist || '') + '|' + norm(album || ''));
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ level: level, title: title, artist: artist || '', album: album || '', note: note || '' });
  };

  push('L1', t, a, al, '歌名+歌手');
  push('L2', stripBrackets(t), stripBrackets(a), '', '去括号后');

  const t6 = toTraditional(t);
  const a6 = toTraditional(a);
  push('L6', t6 || t, a6 || a, '', '繁简互转');

  push('L3', t, a, al, '歌名+专辑');
  push('L7', stripSubtitle(t), a, '', '去副标题');
  push('L4', t, '', '', '仅歌名');
  if (raw && norm(raw) !== norm(t)) push('L5', raw, '', '', '文件名原文');

  return out;
}
