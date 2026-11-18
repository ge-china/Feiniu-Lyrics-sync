import { httpJson, looksLikeLrc } from '../util.js';

export const id = 'lrclib';
export const label = 'LRCLIB（免费开放库）';
export const slow = true;

// LRCLIB 搜索即返回歌词，resolve 直接复用
export async function search(track) {
  const q = new URLSearchParams();
  q.set('track_name', track.title || '');
  if (track.artist) q.set('artist_name', track.artist);
  const r = await httpJson('https://lrclib.net/api/search?' + q.toString(), { headers: { accept: 'application/json' } });
  const arr = Array.isArray(r.json) ? r.json : [];
  return arr.map(function (x) {
    return {
      source: id,
      title: x.trackName || '',
      artist: x.artistName || '',
      album: x.albumName || '',
      duration: x.duration || 0,
      lrc: x.syncedLyrics || ''
    };
  }).filter(function (x) { return looksLikeLrc(x.lrc); });
}

export async function resolve(cand) { return cand.lrc || ''; }
