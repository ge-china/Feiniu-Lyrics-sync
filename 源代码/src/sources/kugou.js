import { httpJson, looksLikeLrc } from '../util.js';

export const id = 'kugou';
export const label = '酷狗音乐';

export async function search(track) {
  const term = [track.title, track.artist].filter(Boolean).join(' ');
  const u = 'http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=' + encodeURIComponent(term) + '&page=1&pagesize=8';
  const r = await httpJson(u, {});
  const info = (r.json && r.json.data && r.json.data.info) ? r.json.data.info : [];
  return info.map(function (s) {
    return {
      source: id,
      hash: s.hash || '',
      title: s.songname || '',
      artist: s.singername || '',
      album: s.album_name || '',
      duration: Math.round((s.duration || 0)),
      lrc: ''
    };
  }).filter(function (x) { return x.hash; });
}

export async function resolve(cand) {
  if (!cand.hash) return '';
  const c = await httpJson('https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=&hash=' + cand.hash, {});
  const cd = (c.json && c.json.candidates) ? c.json.candidates[0] : null;
  if (!cd) return '';
  const d = await httpJson('https://lyrics.kugou.com/download?ver=1&client=pc&id=' + cd.id + '&accesskey=' + cd.accesskey + '&fmt=lrc&charset=utf8', {});
  const b64 = (d.json && d.json.content) ? d.json.content : '';
  const lrc = b64 ? Buffer.from(b64, 'base64').toString('utf8') : '';
  return looksLikeLrc(lrc) ? lrc : '';
}
