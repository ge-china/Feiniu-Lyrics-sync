import { httpJson } from './util.js';
import { stripBrackets, stripSubtitle } from './searchplan.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------- 网易云 ----------
const NE_H = { referer: 'https://music.163.com/', cookie: 'appver=2.0.2; os=pc' };

async function netease(term, track) {
  const q = new URLSearchParams({ s: term, type: '1', limit: '5', offset: '0' });
  const s = await httpJson('https://music.163.com/api/search/get/web?' + q.toString(), { headers: NE_H });
  const songs = (s.json && s.json.result && s.json.result.songs) || [];
  if (!songs.length) return [];
  const ids = songs.slice(0, 4).map(function (x) { return x.id; });
  const d = await httpJson('https://music.163.com/api/song/detail?ids=[' + ids.join(',') + ']', { headers: NE_H });
  const list = (d.json && d.json.songs) || [];
  const out = [];
  for (const song of list) {
    const album = song.album || {};
    if (!album.picUrl) continue;
    out.push({
      source: 'netease',
      url: album.picUrl + '?param=600y600',
      title: song.name || '',
      artist: (song.artists || []).map(function (a) { return a.name; }).join('/'),
      album: album.name || '',
      duration: Math.round((song.duration || 0) / 1000),
      key: 'netease:' + song.id
    });
  }
  return out;
}

// ---------- QQ音乐 ----------
async function qq(term) {
  const u = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=' + encodeURIComponent(term) + '&format=json&n=6&p=1&new_json=1';
  const r = await httpJson(u, { headers: { referer: 'https://y.qq.com/' } });
  const list = (r.json && r.json.data && r.json.data.song && r.json.data.song.list) || [];
  const out = [];
  for (const s of list) {
    const album = s.album || {};
    if (!album.mid) continue;
    out.push({
      source: 'qq',
      url: 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + album.mid + '.jpg',
      title: s.name || '',
      artist: (s.singer || []).map(function (x) { return x.name; }).join('/'),
      album: album.name || '',
      duration: s.interval || 0,
      key: 'qq:' + album.mid
    });
  }
  return out;
}

// ---------- 酷狗 ----------
async function kugou(term) {
  const u = 'http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=' + encodeURIComponent(term) + '&page=1&pagesize=6';
  const r = await httpJson(u, {});
  const info = (r.json && r.json.data && r.json.data.info) || [];
  const seen = new Set();
  const out = [];
  for (const s of info) {
    if (!s.album_id || seen.has(s.album_id)) continue;
    seen.add(s.album_id);
    try {
      const a = await httpJson('http://mobilecdn.kugou.com/api/v3/album/info?albumid=' + s.album_id, {});
      const img = a.json && a.json.data ? (a.json.data.imgurl || a.json.data.img_url) : '';
      if (!img) continue;
      out.push({
        source: 'kugou',
        url: String(img).replace('{size}', '480'),
        title: s.songname || '',
        artist: s.singername || '',
        album: s.album_name || '',
        duration: Number(s.duration || 0),
        key: 'kugou:' + s.album_id
      });
    } catch (e) {}
    if (out.length >= 4) break;
  }
  return out;
}

const PROVIDERS = { netease: netease, qq: qq, kugou: kugou };

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise(function (_, rej) { setTimeout(function () { rej(new Error(label + ' 超时')); }, ms); })
  ]);
}

/**
 * 搜索封面候选
 * track = { title, artist, album, duration }
 */
export async function searchCovers(track, cfg, log) {
  const t = String(track.title || '').trim();
  const a = String(track.artist || '').trim();
  if (!t) return [];

  const terms = [t + ' ' + a].filter(Boolean);
  const alt = stripBrackets(t);
  if (alt && alt !== t) terms.push(alt + ' ' + stripBrackets(a));
  const alt2 = stripSubtitle(t);
  if (alt2 && alt2 !== t) terms.push(alt2 + ' ' + a);

  const timeout = Number(cfg.sourceTimeoutMs) || 15000;
  const enabled = (cfg.sources || {});
  const all = [];
  const seen = new Set();
  const seenKeys = new Set();

  for (const term of terms.slice(0, 2)) {
    const jobs = [];
    for (const id of Object.keys(PROVIDERS)) {
      if (enabled[id] === false) continue;
      jobs.push({ id: id, run: PROVIDERS[id](term, track) });
    }
    const results = await Promise.all(jobs.map(async function (job) {
      try {
        const list = await withTimeout(job.run, timeout, job.id);
        return list || [];
      } catch (e) {
        if (log) log('    ' + job.id + ' 封面失败：' + e.message);
        return [];
      }
    }));
    for (const list of results) {
      for (const c of list) {
        if (seenKeys.has(c.key)) continue;
        seenKeys.add(c.key);
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        all.push(c);
      }
    }
    if (all.length >= 8) break;
  }
  return all;
}

const ALLOW_HOSTS = ['.126.net', '.gtimg.cn', '.kugou.com', '.qq.com', '.music.163.com'];

export function isAllowedImageUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return ALLOW_HOSTS.some(function (h) { return u.hostname.endsWith(h.replace(/^./, '')) || u.hostname.endsWith(h); });
  } catch (e) { return false; }
}

export async function fetchImage(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://music.163.com/' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const type = r.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1024) throw new Error('图片过小');
  return { buf: buf, type: type };
}
