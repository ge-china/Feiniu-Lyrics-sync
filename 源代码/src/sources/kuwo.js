import { httpJson, looksLikeLrc } from '../util.js';

export const id = 'kuwo';
export const label = '酷我音乐（实验性）';

function parseLoose(text) {
  try { return JSON.parse(text); } catch (e) {}
  try { return JSON.parse(String(text).replace(/'/g, '"')); } catch (e) {}
  return null;
}

export async function search(track) {
  const term = [track.title, track.artist].filter(Boolean).join(' ');
  const u = 'http://search.kuwo.cn/r.s?all=' + encodeURIComponent(term) + '&ft=music&itemset=web_2013&client=kt&pn=0&rn=10&rformat=json&encoding=utf8';
  const r = await httpJson(u, {});
  const d = parseLoose(r.text);
  const list = (d && d.abslist) ? d.abslist : [];
  return list.map(function (s) {
    return {
      source: id,
      rid: String(s.MUSICRID || '').replace('MUSIC_', ''),
      title: String(s.SONGNAME || '').replace(/&nbsp;/g, ' '),
      artist: s.ARTIST || '',
      album: s.ALBUM || '',
      duration: Number(s.DURATION || 0),
      lrc: ''
    };
  }).filter(function (x) { return x.rid; });
}

export async function resolve(cand) {
  if (!cand.rid) return '';
  const tries = [
    'https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=' + cand.rid + '&httpsStatus=1',
    'https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=' + cand.rid
  ];
  for (const u of tries) {
    try {
      const l = await httpJson(u, { headers: { referer: 'https://m.kuwo.cn/', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } });
      const lines = (l.json && l.json.data && l.json.data.lrclist) ? l.json.data.lrclist : [];
      if (!lines.length) continue;
      const lrc = lines.map(function (x) {
        const sec = Number(x.time || 0);
        const mm = Math.floor(sec / 60);
        const ss = (sec % 60).toFixed(2);
        return '[' + String(mm).padStart(2, '0') + ':' + (ss < 10 ? '0' + ss : ss) + ']' + (x.lineLyric || '');
      }).join('\n');
      if (looksLikeLrc(lrc)) return lrc;
    } catch (e) {}
  }
  return '';
}
