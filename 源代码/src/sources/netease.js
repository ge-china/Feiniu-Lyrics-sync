import { httpJson, looksLikeLrc } from '../util.js';

export const id = 'netease';
export const label = '网易云音乐';

const H = { referer: 'https://music.163.com/', origin: 'https://music.163.com', cookie: 'appver=2.0.2; os=pc' };

// 第一阶段：只搜候选，不取歌词
export async function search(track) {
  const term = [track.title, track.artist].filter(Boolean).join(' ');
  const q = new URLSearchParams({ s: term, type: '1', limit: '10', offset: '0' });
  const r = await httpJson('https://music.163.com/api/search/get/web?' + q.toString(), { headers: H });
  const songs = (r.json && r.json.result && r.json.result.songs) ? r.json.result.songs : [];
  return songs.map(function (s) {
    const artists = (s.artists || s.ar || []).map(function (a) { return a.name; }).join('/');
    return {
      source: id,
      rid: s.id,
      title: s.name || '',
      artist: artists,
      album: (s.album && s.album.name) || '',
      duration: Math.round((s.duration || 0) / 1000),
      lrc: ''
    };
  });
}

// 第二阶段：按候选取歌词
export async function resolve(cand) {
  if (!cand.rid) return '';
  const l = await httpJson('https://music.163.com/api/song/lyric?id=' + cand.rid + '&lv=-1&kv=-1&tv=-1', { headers: H });
  const txt = (l.json && l.json.lrc && l.json.lrc.lyric) ? l.json.lrc.lyric : '';
  return looksLikeLrc(txt) ? txt : '';
}
