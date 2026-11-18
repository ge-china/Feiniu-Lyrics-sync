import { httpJson, looksLikeLrc } from '../util.js';

export const id = 'qq';
export const label = 'QQ音乐';

const H1 = { referer: 'https://y.qq.com/' };
const H2 = { referer: 'https://y.qq.com/portal/player.html' };

function cleanLyric(raw) {
  let t = String(raw || '');
  if (!/\[/.test(t) && /^[A-Za-z0-9+/=\s]+$/.test(t)) {
    try { t = Buffer.from(t, 'base64').toString('utf8'); } catch (e) {}
  }
  return t.replace(/&#58;/g, ':').replace(/&#10;/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export async function search(track) {
  const term = [track.title, track.artist].filter(Boolean).join(' ');
  const u = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=' + encodeURIComponent(term) + '&format=json&n=8&p=1&new_json=1';
  const r = await httpJson(u, { headers: H1 });
  const list = (r.json && r.json.data && r.json.data.song && r.json.data.song.list) ? r.json.data.song.list : [];
  return list.map(function (s) {
    return {
      source: id,
      mid: s.mid || (s.file && s.file.media_mid) || '',
      title: s.name || '',
      artist: (s.singer || []).map(function (x) { return x.name; }).join('/'),
      album: (s.album && s.album.name) || '',
      duration: s.interval || 0,
      lrc: ''
    };
  }).filter(function (x) { return x.mid; });
}

export async function resolve(cand) {
  if (!cand.mid) return '';
  const l = await httpJson('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=' + cand.mid + '&format=json&nobase64=1&g_tk=5381', { headers: H2 });
  const txt = cleanLyric(l.json && l.json.lyric);
  return looksLikeLrc(txt) ? txt : '';
}
