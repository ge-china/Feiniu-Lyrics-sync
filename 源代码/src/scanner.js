import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { fromPath } from './parse.js';
import { loadLibrary } from './store.js';

const AUDIO = new Set(['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ape', '.ogg', '.opus', '.wma', '.dsf', '.dff', '.aiff', '.aif']);

export function sidecarOf(file) {
  const ext = path.extname(file);
  return file.slice(0, file.length - ext.length) + '.lrc';
}

// 兼容多种歌词文件命名：同名 .lrc / .LRC / 双扩展名（song.flac.lrc）
export function lyricCandidates(file) {
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  return [
    base + '.lrc',
    base + '.LRC',
    file + '.lrc',
    base + '.Lrc'
  ];
}

export async function findExistingLyric(file) {
  for (const c of lyricCandidates(file)) {
    try { await fs.access(c); return c; } catch (e) {}
  }
  return '';
}

async function exists(p) {
  try { await fs.access(p); return true; } catch (e) { return false; }
}

async function walk(dir, out, depth) {
  if (depth > 12) return;
  let ents;
  try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === '@eaDir') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (AUDIO.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
}

export async function checkWritable(dir) {
  const probe = path.join(dir, '.musictb_write_test_' + Date.now());
  try {
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.unlink(probe);
    return { writable: true };
  } catch (e) {
    return { writable: false, error: e.code || e.message };
  }
}

export async function scanLibrary(root, opts) {
  const o = opts || {};
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : function () {};
  const prev = loadLibrary();
  const prevMap = new Map();
  for (const t of prev.tracks) prevMap.set(t.file, t);

  const files = [];
  await walk(root, files, 0);
  const out = [];
  let i = 0;

  for (const f of files) {
    i++;
    if (o.shouldStop && o.shouldStop()) break;
    let st = null;
    try { st = await fs.stat(f); } catch (e) {}

    const old = prevMap.get(f);
    if (old && st && old.size === st.size && old.mtimeMs === st.mtimeMs) {
      out.push(old);
      if (i % 20 === 0) onProgress(i, files.length, f);
      continue;
    }

    let meta = null;
    try { meta = await parseFile(f, { skipCovers: true, duration: true }); } catch (e) {}
    const common = (meta && meta.common) || {};
    const tags = fromPath(f, common);
    const rawLyrics = common.lyrics || common.lyric || '';
    const lyricText = function (x) {
      if (!x) return '';
      if (Array.isArray(x)) return x.map(lyricText).join('\n');
      if (typeof x === 'object') return String(x.text || x.value || '');
      return String(x);
    };
    const hasEmbedded = lyricText(rawLyrics).replace(/\s/g, '').length > 10;
    const existingLyric = await findExistingLyric(f);
    const hasSidecar = !!existingLyric;

    out.push({
      file: f,
      size: st ? st.size : 0,
      mtimeMs: st ? st.mtimeMs : 0,
      title: tags.title,
      artist: tags.artist,
      album: tags.album,
      duration: (meta && meta.format && meta.format.duration) ? Math.round(meta.format.duration) : 0,
      format: (meta && meta.format && meta.format.container) || '',
      hasEmbedded: hasEmbedded,
      hasSidecar: hasSidecar,
      lyricPath: existingLyric || '',
      hasLyrics: hasEmbedded || hasSidecar,
      status: (hasEmbedded || hasSidecar) ? 'ok' : 'missing'
    });

    if (i % 10 === 0) onProgress(i, files.length, f);
  }

  onProgress(files.length, files.length, '');
  return out;
}
