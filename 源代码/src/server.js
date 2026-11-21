import http from 'node:http';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, backupDir, userSourceDir, dataDir, APP_TITLE, APP_NAME, APP_AUTHOR, APP_EMAIL, APP_REPO } from './config.js';
import { loadLibrary, saveLibrary, patchTrack, flushLibrary, stats } from './store.js';
import { scanLibrary, sidecarOf, checkWritable, findExistingLyric } from './scanner.js';
import { searchCovers, fetchImage, isAllowedImageUrl, isAmbiguousCover } from './covers.js';
import { loadCoverPending, addCoverPending, removeCoverPending, loadCoverChoices, rememberCoverChoice } from './coverqueue.js';
import { writeCoverSidecar, writeCoverEmbedded, findCover } from './coverwriter.js';
import { score as matchScore } from './match.js';
import { resolveBest, listSources, loadUserSources, builtins, isAmbiguous, choiceKey, candidateId } from './sources/index.js';
import { loadPending, addPending, removePending, clearPending, loadChoices, rememberChoice } from './queue.js';
import { writeLrc } from './writer.js';
import { writeEmbedded, clearEmbedded } from './tagwriter.js';
import { getSharedFolders } from './fnas.js';
import { getJob, startJob, updateJob, logLine, finishJob, requestStop, shouldStop } from './job.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.PORT || 0);

let cfg = loadConfig();
let userSources = {};
let autoTimer = null;

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (pkg.version) return pkg.version;
  } catch (e) {}
  try {
    const mf = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
    const m = mf.match(/"version"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  } catch (e) {}
  return '';
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve) {
    let d = '';
    req.on('data', function (c) { d += c; if (d.length > 2e6) req.destroy(); });
    req.on('end', function () { let o = {}; try { o = JSON.parse(d || '{}'); } catch (e) {} resolve(o); });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const p = path.join(WEB, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
  if (!p.startsWith(WEB)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const buf = await fsp.readFile(p);
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}

const INSTRUMENTAL = /(伴奏|纯音乐|instrumental|karaoke|off vocal|カラオケ)/i;

function withHeader(track, lrc) {
  const text = String(lrc || '');
  if (/\[ti:[^\]]*\]/i.test(text.slice(0, 200))) return text;
  const head = ['[ti:' + (track.title || '') + ']', '[ar:' + (track.artist || '') + ']'];
  if (track.album) head.push('[al:' + track.album + ']');
  head.push('[by:musicTB]', '[offset:0]', '');
  return head.join('\n') + text;
}

async function runScan(root) {
  startJob('scan', 0);
  logLine('开始扫描：' + root);
  try {
    const tracks = await scanLibrary(root, {
      shouldStop: shouldStop,
      onProgress: function (i, total, f) { updateJob({ done: i, total: total, current: f }); }
    });
    const w = await checkWritable(root);
    saveLibrary({ updatedAt: Date.now(), root: root, tracks: tracks, writable: w.writable, writeError: w.error || '' });
    const miss = tracks.filter(function (t) { return !t.hasLyrics; }).length;
    const have = tracks.length - miss;
    logLine('扫描完成：共 ' + tracks.length + ' 首，已有歌词 ' + have + ' 首，缺歌词 ' + miss + ' 首');
    if (!w.writable) logLine('警告：当前应用对目录没有写权限（' + (w.error || '') + '），歌词无法写入。请在应用设置里为该目录授权。');
    updateJob({ ok: have, fail: 0 });
    finishJob('扫描完成：共 ' + tracks.length + ' 首，已有歌词 ' + have + '，缺歌词 ' + miss);
  } catch (e) {
    logLine('扫描失败：' + e.message);
    finishJob('扫描失败：' + e.message);
  }
}

async function writeCandidate(track, cand, score) {
  const lrc = withHeader(track, cand.lrc);
  const mode = cfg.writeMode || 'lrc';
  let written = false;
  let err = '';

  if (mode === 'lrc' || mode === 'both') {
    try {
      const w = await writeLrc(sidecarOf(track.file), lrc, { force: !cfg.keepExisting, backupDir: backupDir });
      if (w.written) written = true;
    } catch (e) {
      err = (e.code === 'EACCES' || e.code === 'EPERM') ? '没有写入权限（需要为该目录授权）' : e.message;
      patchTrack(track.file, { status: 'noperm', error: err, lastTry: Date.now() });
      return { ok: false, reason: 'noperm', error: err };
    }
  }
  if (mode === 'embed' || mode === 'both') {
    const e = await writeEmbedded(track.file, lrc, { backupDir: cfg.backupBeforeEmbed ? backupDir : '' });
    if (e.ok) written = true; else err = e.error || '';
  }

  patchTrack(track.file, {
    status: written ? 'done' : 'skip',
    source: cand.source,
    score: score,
    lastTry: Date.now(),
    hasLyrics: written || track.hasLyrics,
    error: err
  });
  return { ok: written, reason: written ? 'written' : 'skip', source: cand.source, score: score };
}

function toPendingItem(track, result) {
  const cands = (result.ranked || []).slice(0, 5).map(function (r) {
    return {
      source: r.cand.source,
      title: r.cand.title,
      artist: r.cand.artist,
      album: r.cand.album,
      duration: r.cand.duration,
      score: r.score,
      lrc: r.cand.lrc,
      key: candidateId(r.cand)
    };
  });
  return {
    file: track.file,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    level: result.level,
    createdAt: Date.now(),
    candidates: cands
  };
}

async function processOne(track) {
  if (cfg.skipInstrumental && INSTRUMENTAL.test(track.title || '')) {
    patchTrack(track.file, { status: 'skipped', lastTry: Date.now() });
    return { ok: false, reason: 'instrumental' };
  }
  const memory = loadChoices();
  const r = await resolveBest(track, cfg, userSources, logLine, memory);
  const best = r && r.best;
  if (!best) {
    patchTrack(track.file, { status: 'nomatch', lastTry: Date.now(), lastScore: 0 });
    return { ok: false, reason: 'nomatch', score: 0 };
  }

  const mode = cfg.downloadMode || 'ask';
  if (mode === 'manual') {
    addPending(toPendingItem(track, r));
    patchTrack(track.file, { status: 'pending', lastTry: Date.now(), lastScore: best.score });
    return { ok: false, reason: 'pending', score: best.score };
  }
  if (mode === 'ask' && (!r.accepted || isAmbiguous(r.ranked, cfg))) {
    addPending(toPendingItem(track, r));
    patchTrack(track.file, { status: 'pending', lastTry: Date.now(), lastScore: best.score });
    return { ok: false, reason: 'pending', score: best.score };
  }

  const res = await writeCandidate(track, best.cand, best.score);
  if (res.ok) rememberChoice(track, best.cand, candidateId(best.cand));
  return res;
}


async function writeCoverTo(track, cand) {
  const mode = cfg.coverMode || 'sidecar';
  let sidecar = '';
  let embed = false;
  let err = '';
  try {
    const img = await fetchImage(cand.url);
    if (mode === 'sidecar' || mode === 'both') {
      sidecar = await writeCoverSidecar(track.file, img.buf, img.type);
    }
    if (mode === 'embed' || mode === 'both') {
      const r2 = await writeCoverEmbedded(track.file, img.buf);
      embed = r2.ok;
      if (!r2.ok) err = r2.error || '';
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const ok = !!sidecar || embed;
  if (ok) {
    patchTrack(track.file, { hasCover: true, coverPath: sidecar || undefined, coverSource: cand.source, lastTry: Date.now() });
    rememberCoverChoice(track, cand);
  }
  return { ok: ok, sidecar: sidecar, embed: embed, error: err };
}

function toCoverPending(track, ranked) {
  return {
    file: track.file,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    createdAt: Date.now(),
    candidates: ranked.slice(0, 6).map(function (r) {
      return { url: r.cand.url, source: r.cand.source, title: r.cand.title, artist: r.cand.artist, album: r.cand.album, duration: r.cand.duration, score: r.score };
    })
  };
}

async function runCoverSync(overwrite) {
  const lib = loadLibrary();
  let todo = lib.tracks.slice();
  if (!overwrite) todo = todo.filter(function (t) { return !t.hasCover; });
  startJob('cover', todo.length);
  logLine('开始匹配封面：待处理 ' + todo.length + ' 首');

  const minScore = Number(cfg.coverMinScore) || 50;
  const choices = loadCoverChoices();
  const limit = Math.max(1, Math.min(4, Number(cfg.concurrency) || 2));
  let idx = 0;

  async function worker() {
    while (idx < todo.length) {
      if (shouldStop()) return;
      const t = todo[idx++];
      updateJob({ current: (t.artist ? t.artist + ' - ' : '') + t.title });
      try {
        const list = await searchCovers(t, cfg, logLine);
        let ranked = list.map(function (c) { return { cand: c, score: matchScore(t, c) }; })
          .sort(function (a, b) { return b.score - a.score; });

        const memKey = (t.artist || '') + '|' + (t.title || '');
        const mem = choices[memKey];
        if (mem && mem.url) {
          for (const r of ranked) if (r.cand.url === mem.url) r.score += 50;
          ranked.sort(function (a, b) { return b.score - a.score; });
        }

        const best = ranked[0];
        const ambiguous = cfg.coverAskAmbiguous !== false && isAmbiguousCover(ranked, t);

        if (!best || best.score < minScore) {
          patchTrack(t.file, { coverStatus: 'nomatch', lastTry: Date.now() });
          logLine('  未找到合适封面（' + (best ? best.score : 0) + '）');
        } else if (ambiguous) {
          addCoverPending(toCoverPending(t, ranked));
          patchTrack(t.file, { coverStatus: 'pending', lastTry: Date.now() });
          logLine('  有多个候选，待确认');
        } else {
          const w = await writeCoverTo(t, best.cand);
          logLine(w.ok ? '  已写入封面（' + best.cand.source + ' ' + best.score + '）' : '  写入失败：' + (w.error || ''));
        }
      } catch (e) {
        logLine('  出错：' + e.message);
      }
      const j = getJob();
      updateJob({ done: j.done + 1, ok: j.ok + 1, fail: j.fail });
      if (cfg.requestDelayMs) await new Promise(function (r) { setTimeout(r, Number(cfg.requestDelayMs)); });
    }
  }

  const workers = [];
  for (let i = 0; i < limit; i++) workers.push(worker());
  await Promise.all(workers);
  flushLibrary();
  const pend = loadCoverPending().length;
  finishJob('封面匹配结束：处理 ' + getJob().done + ' 首' + (pend ? '，待确认 ' + pend + ' 首' : ''));
}

async function runFill(onlyMissing) {
  const lib = loadLibrary();
  let todo = lib.tracks.slice();
  if (onlyMissing !== false) todo = todo.filter(function (t) { return !t.hasLyrics && t.status !== 'skipped'; });
  startJob('fill', todo.length);
  logLine('开始补全：待处理 ' + todo.length + ' 首');

  const limit = Math.max(1, Math.min(6, Number(cfg.concurrency) || 2));
  let idx = 0;

  async function worker() {
    while (idx < todo.length) {
      if (shouldStop()) return;
      const t = todo[idx++];
      updateJob({ current: (t.artist ? t.artist + ' - ' : '') + t.title });
      let res;
      try { res = await processOne(t); }
      catch (e) { res = { ok: false, reason: 'error' }; logLine('  出错：' + e.message); }

      const j = getJob();
      updateJob({ done: j.done + 1, ok: j.ok + (res.ok ? 1 : 0), fail: j.fail + (res.ok ? 0 : 1) });
      logLine(res.ok ? '  已写入（' + res.source + ' ' + res.score + '）' : '  未写入（' + res.reason + (res.score ? ' ' + res.score : '') + '）');
      if (cfg.requestDelayMs) await new Promise(function (r) { setTimeout(r, Number(cfg.requestDelayMs)); });
    }
  }

  const workers = [];
  for (let i = 0; i < limit; i++) workers.push(worker());
  await Promise.all(workers);
  flushLibrary();
  const j = getJob();
  const pendingCount = loadPending().length;
  logLine('补全结束：成功 ' + j.ok + '，失败 ' + j.fail + (pendingCount ? '，待确认 ' + pendingCount + ' 首' : ''));
  finishJob('补全结束：成功 ' + j.ok + '，失败 ' + j.fail + (pendingCount ? '，待确认 ' + pendingCount + ' 首' : ''));
}

export function scheduleAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (!cfg.autoEnabled) return;
  const ms = Math.max(5, Number(cfg.autoIntervalMinutes) || 1440) * 60000;
  autoTimer = setInterval(function () {
    if (getJob().running) return;
    if (!cfg.libraryRoot) return;
    runFill(true);
  }, ms);
}

async function handleApi(req, res, u) {
  const p = u.pathname;

  if (p === '/api/state' && req.method === 'GET') {
    userSources = await loadUserSources(userSourceDir);
    return json(res, 200, {
      app: {
        name: APP_NAME,
        title: APP_TITLE,
        version: readVersion(),
        author: APP_AUTHOR,
        email: APP_EMAIL,
        repo: APP_REPO
      },
      config: cfg,
      stats: stats(),
      job: getJob(),
      sources: listSources().concat(Object.keys(userSources).map(function (k) {
        return { id: k, label: userSources[k].label, builtin: false };
      })),
      dataDir: dataDir,
      pendingCount: loadPending().length,
      coverPendingCount: loadCoverPending().length,
      runtime: { fnos: !!process.env.TRIM_API_TOKEN, node: process.version }
    });
  }

  if (p === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    cfg = Object.assign(cfg, body);
    cfg.sources = Object.assign({}, cfg.sources, body.sources || {});
    saveConfig(cfg);
    scheduleAuto();
    return json(res, 200, { ok: true, config: cfg });
  }

  if (p === '/api/scan' && req.method === 'POST') {
    const body = await readBody(req);
    const root = (body.root || cfg.libraryRoot || '').trim();
    if (!root) return json(res, 400, { ok: false, error: '未设置音乐目录' });
    cfg.libraryRoot = root; saveConfig(cfg);
    if (getJob().running) return json(res, 409, { ok: false, error: '已有任务在运行' });
    runScan(root);
    return json(res, 202, { ok: true });
  }

  if (p === '/api/sync' && req.method === 'POST') {
    if (getJob().running) return json(res, 409, { ok: false, error: '已有任务在运行' });
    const body = await readBody(req);
    runFill(body.all === true ? false : true);
    return json(res, 202, { ok: true });
  }

  if (p === '/api/job/stop' && req.method === 'POST') {
    requestStop();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/job' && req.method === 'GET') return json(res, 200, getJob());

  if (p === '/api/library' && req.method === 'GET') {
    const lib = loadLibrary();
    const filter = u.searchParams.get('filter') || 'all';
    const q = (u.searchParams.get('q') || '').toLowerCase();
    let list = lib.tracks;
    if (filter === 'missing') list = list.filter(function (t) { return !t.hasLyrics; });
    if (filter === 'done') list = list.filter(function (t) { return t.hasLyrics; });
    if (filter === 'nomatch') list = list.filter(function (t) { return t.status === 'nomatch'; });
    if (q) list = list.filter(function (t) { return ((t.title || '') + ' ' + (t.artist || '') + ' ' + (t.album || '') + ' ' + (t.file || '')).toLowerCase().indexOf(q) !== -1; });
    const offset = Number(u.searchParams.get('offset') || 0);
    const limit = Number(u.searchParams.get('limit') || 200);
    return json(res, 200, { total: list.length, offset: offset, items: list.slice(offset, offset + limit) });
  }

  if (p === '/api/search' && req.method === 'POST') {
    const body = await readBody(req);
    const track = { title: body.title || '', artist: body.artist || '', duration: Number(body.duration || 0) };
    if (!track.title) return json(res, 400, { ok: false, error: '缺少歌名' });
    const lines = [];
    const r = await resolveBest(track, cfg, userSources, function (l) { lines.push(l); }, loadChoices());
    const items = (r && r.ranked ? r.ranked : []).map(function (x) {
      return {
        score: x.score,
        source: x.cand.source,
        title: x.cand.title,
        artist: x.cand.artist,
        album: x.cand.album,
        duration: x.cand.duration,
        lrc: x.cand.lrc,
        key: candidateId(x.cand)
      };
    });
    return json(res, 200, { ok: true, count: items.length, items: items, level: r ? r.level : '', accepted: !!(r && r.accepted), log: lines });
  }

  if (p === '/api/apply' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.file || !body.lrc) return json(res, 400, { ok: false, error: '参数不足' });
    const mode = body.mode || cfg.writeMode || 'lrc';
    const track = (loadLibrary().tracks || []).find(function (t) { return t.file === body.file; }) || {};
    const lrc = withHeader(track, body.lrc);
    let okLrc = false, okEmbed = false, err = '';
    if (mode === 'lrc' || mode === 'both') {
      const w = await writeLrc(sidecarOf(body.file), lrc, { force: true, backupDir: backupDir });
      okLrc = w.written;
    }
    if (mode === 'embed' || mode === 'both') {
      const e = await writeEmbedded(body.file, lrc, { backupDir: cfg.backupBeforeEmbed ? backupDir : '' });
      okEmbed = e.ok; if (!e.ok) err = e.error;
    }
    const ok = okLrc || okEmbed;
    if (ok) patchTrack(body.file, { hasLyrics: true, status: 'done', source: body.source || 'manual', score: body.score || 0, lastTry: Date.now(), error: '' });
    flushLibrary();
    return json(res, 200, { ok: ok, lrc: okLrc, embed: okEmbed, error: err });
  }


  if (p === '/api/delete-lyrics' && req.method === 'POST') {
    const body = await readBody(req);
    const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : []);
    if (!files.length) return json(res, 400, { ok: false, error: '没有选中歌曲' });
    const scope = body.mode || cfg.writeMode || 'lrc';
    const results = [];

    for (const f of files) {
      const item = { file: f, lrc: false, embed: false, error: '' };
      const sc = sidecarOf(f);

      if (scope === 'lrc' || scope === 'both') {
        try {
          await fsp.unlink(sc);
          item.lrc = true;
        } catch (e) {
          if (e.code !== 'ENOENT') item.error = e.message;
        }
      }

      if (scope === 'embed' || scope === 'both') {
        const r = await clearEmbedded(f, { backupDir: cfg.backupBeforeEmbed ? backupDir : '' });
        item.embed = r.ok;
        if (!r.ok) item.error = r.error || '';
      }

      // 删完后重新检测真实状态
      let hasSidecar = false;
      try { await fsp.access(sc); hasSidecar = true; } catch (e) {}
      let hasEmbedded = false;
      try {
        const mm = await import('music-metadata');
        const meta = await mm.parseFile(f, { skipCovers: true });
        const raw = (meta.common && (meta.common.lyrics || meta.common.lyric)) || '';
        const txt = Array.isArray(raw)
          ? raw.map(function (x) { return (x && (x.text || x.value)) || ''; }).join('')
          : String(raw);
        hasEmbedded = txt.replace(/\s/g, '').length > 10;
      } catch (e) {}

      patchTrack(f, {
        hasSidecar: hasSidecar,
        hasEmbedded: hasEmbedded,
        hasLyrics: hasSidecar || hasEmbedded,
        status: (hasSidecar || hasEmbedded) ? 'ok' : 'missing',
        source: (hasSidecar || hasEmbedded) ? 'kept' : '',
        error: item.error || ''
      });
      results.push(item);
    }

    flushLibrary();
    const done = results.filter(function (r) { return r.lrc || r.embed; }).length;
    return json(res, 200, { ok: true, done: done, total: results.length, results: results });
  }




  if (p === '/api/cover/sync' && req.method === 'POST') {
    if (getJob().running) return json(res, 409, { ok: false, error: '已有任务在运行' });
    const body = await readBody(req);
    runCoverSync(body.overwrite === true);
    return json(res, 202, { ok: true });
  }

  if (p === '/api/cover/pending' && req.method === 'GET') {
    const list = loadCoverPending();
    return json(res, 200, { ok: true, count: list.length, items: list });
  }

  if (p === '/api/cover/choose' && req.method === 'POST') {
    const body = await readBody(req);
    const list = loadCoverPending();
    const item = list.find(function (x2) { return x2.file === body.file; });
    if (!item) return json(res, 404, { ok: false, error: '待确认项不存在' });
    const cand = (item.candidates || [])[body.index || 0];
    if (!cand) return json(res, 400, { ok: false, error: '候选不存在' });
    const track = (loadLibrary().tracks || []).find(function (t) { return t.file === item.file; }) || item;
    const r2 = await writeCoverTo(track, cand);
    if (r2.ok) removeCoverPending(item.file);
    flushLibrary();
    return json(res, 200, r2);
  }

  if (p === '/api/cover/skip' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.file) { removeCoverPending(body.file); patchTrack(body.file, { coverStatus: 'skipped' }); }
    flushLibrary();
    return json(res, 200, { ok: true, count: loadCoverPending().length });
  }

  if (p === '/api/cover/auto-all' && req.method === 'POST') {
    const list = loadCoverPending().slice();
    let done = 0;
    for (const item of list) {
      const cand = (item.candidates || [])[0];
      if (!cand) { removeCoverPending(item.file); continue; }
      const track = (loadLibrary().tracks || []).find(function (t) { return t.file === item.file; }) || item;
      const r2 = await writeCoverTo(track, cand);
      if (r2.ok) done++;
      removeCoverPending(item.file);
    }
    flushLibrary();
    return json(res, 200, { ok: true, done: done, remaining: loadCoverPending().length });
  }

  if (p === '/api/cover/search' && req.method === 'POST') {
    const body = await readBody(req);
    const track = { title: body.title || '', artist: body.artist || '', album: body.album || '', duration: Number(body.duration || 0) };
    if (!track.title) return json(res, 400, { ok: false, error: '缺少歌名' });
    const lines = [];
    const list = await searchCovers(track, cfg, function (l) { lines.push(l); });
    const items = list.map(function (c) {
      return {
        source: c.source,
        url: c.url,
        proxy: '/api/cover-proxy?u=' + encodeURIComponent(c.url),
        title: c.title,
        artist: c.artist,
        album: c.album,
        duration: c.duration,
        score: matchScore(track, c),
        key: c.key
      };
    }).sort(function (a, b) { return b.score - a.score; });
    return json(res, 200, { ok: true, count: items.length, items: items, log: lines });
  }

  if (p === '/api/cover-proxy' && req.method === 'GET') {
    const imgUrl = u.searchParams.get('u') || '';
    if (!isAllowedImageUrl(imgUrl)) { res.writeHead(403); return res.end('forbidden'); }
    try {
      const img = await fetchImage(imgUrl);
      res.writeHead(200, { 'content-type': img.type, 'cache-control': 'public, max-age=86400' });
      return res.end(img.buf);
    } catch (e) {
      res.writeHead(502); return res.end('fetch failed');
    }
  }

  if (p === '/api/cover/apply' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.file || !body.url) return json(res, 400, { ok: false, error: '参数不足' });
    if (!isAllowedImageUrl(body.url)) return json(res, 400, { ok: false, error: '不支持的图片来源' });
    const mode = body.mode || cfg.coverMode || 'sidecar';
    let sidecar = '';
    let embed = false;
    let err = '';
    try {
      const img = await fetchImage(body.url);
      if (mode === 'sidecar' || mode === 'both') {
        sidecar = await writeCoverSidecar(body.file, img.buf, img.type);
      }
      if (mode === 'embed' || mode === 'both') {
        const r2 = await writeCoverEmbedded(body.file, img.buf);
        embed = r2.ok;
        if (!r2.ok) err = r2.error || '';
      }
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
    const ok = !!sidecar || embed;
    if (ok) patchTrack(body.file, { hasCover: true, coverPath: sidecar || undefined, coverSource: body.source || '', lastTry: Date.now() });
    flushLibrary();
    return json(res, 200, { ok: ok, sidecar: sidecar, embed: embed, error: err });
  }

  if (p === '/api/pending' && req.method === 'GET') {
    const list = loadPending();
    return json(res, 200, { ok: true, count: list.length, items: list });
  }

  if (p === '/api/pending/choose' && req.method === 'POST') {
    const body = await readBody(req);
    const list = loadPending();
    const item = list.find(function (x) { return x.file === body.file; });
    if (!item) return json(res, 404, { ok: false, error: '待确认项不存在' });
    const cand = (item.candidates || [])[body.index || 0];
    if (!cand) return json(res, 400, { ok: false, error: '候选不存在' });
    const track = (loadLibrary().tracks || []).find(function (t) { return t.file === item.file; }) || item;
    const res2 = await writeCandidate(track, cand, cand.score || 0);
    if (res2.ok) {
      rememberChoice(track, cand, cand.key);
      removePending(item.file);
    }
    flushLibrary();
    return json(res, 200, res2);
  }

  if (p === '/api/pending/skip' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.file) { removePending(body.file); patchTrack(body.file, { status: 'skipped' }); }
    flushLibrary();
    return json(res, 200, { ok: true, count: loadPending().length });
  }

  if (p === '/api/pending/auto-all' && req.method === 'POST') {
    const list = loadPending().slice();
    let done = 0;
    for (const item of list) {
      const cand = (item.candidates || [])[0];
      if (!cand) { removePending(item.file); continue; }
      const track = (loadLibrary().tracks || []).find(function (t) { return t.file === item.file; }) || item;
      const r2 = await writeCandidate(track, cand, cand.score || 0);
      if (r2.ok) { rememberChoice(track, cand, cand.key); done++; }
      removePending(item.file);
    }
    flushLibrary();
    return json(res, 200, { ok: true, done: done, remaining: loadPending().length });
  }

  if (p === '/api/test-sources' && req.method === 'GET') {
    const probeTrack = { title: u.searchParams.get('title') || '晴天', artist: u.searchParams.get('artist') || '周杰伦', duration: 0 };
    const results = [];
    for (const id of Object.keys(builtins)) {
      if (cfg.sources && cfg.sources[id] === false) { results.push({ id: id, label: builtins[id].label, enabled: false }); continue; }
      const t0 = Date.now();
      try {
        const list = await Promise.race([
          Promise.resolve(builtins[id].search(probeTrack)),
          new Promise(function (_, rej) { setTimeout(function () { rej(new Error('超时 12s')); }, 12000); })
        ]);
        results.push({ id: id, label: builtins[id].label, enabled: true, ok: true, count: (list || []).length, ms: Date.now() - t0 });
      } catch (e) {
        results.push({ id: id, label: builtins[id].label, enabled: true, ok: false, error: e.message, ms: Date.now() - t0 });
      }
    }
    userSources = await loadUserSources(userSourceDir);
    for (const k of Object.keys(userSources)) {
      const t0 = Date.now();
      try {
        const list = await userSources[k].search(probeTrack);
        results.push({ id: k, label: userSources[k].label, enabled: true, ok: true, count: (list || []).length, ms: Date.now() - t0, user: true });
      } catch (e) {
        results.push({ id: k, label: userSources[k].label, enabled: true, ok: false, error: e.message, ms: Date.now() - t0, user: true });
      }
    }
    return json(res, 200, { ok: true, probe: probeTrack, results: results });
  }

  if (p === '/api/authorized-paths' && req.method === 'GET') {
    return json(res, 200, await getSharedFolders(APP_NAME));
  }

  if (p === '/api/source-template' && req.method === 'GET') {
    const tpl = [
      "// musicTB 自定义歌词源（文件名即 id）",
      "export const id = 'my-source';",
      "export const label = '我的源';",
      "",
      "// track = { title, artist, duration }",
      "// 返回 [{ title, artist, album, duration, lrc }]，lrc 必须带 [mm:ss.xx] 时间轴",
      "export async function search(track) {",
      "  return [];",
      "}",
      ""
    ].join('\n');
    return json(res, 200, { ok: true, template: tpl, dir: userSourceDir });
  }

  return json(res, 404, { ok: false, error: 'not found' });
}

// fnOS 统一网关会把请求原样带上前缀（/app/musictb/...），这里剥掉
const GATEWAY_PREFIX = '/app/' + APP_NAME;

function normalizePath(p) {
  if (p === GATEWAY_PREFIX) return '/';
  if (p.indexOf(GATEWAY_PREFIX + '/') === 0) return p.slice(GATEWAY_PREFIX.length);
  return p;
}

const handler = async function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  const rawPath = u.pathname;
  if (rawPath === GATEWAY_PREFIX) {
    res.writeHead(302, { location: GATEWAY_PREFIX + '/' });
    return res.end();
  }
  const p = normalizePath(rawPath);
  try {
    if (p.startsWith('/api/')) {
      const uu = new URL(p + (u.search || ''), 'http://localhost');
      return await handleApi(req, res, uu);
    }
    return await serveStatic(res, p);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
};

const tcpServer = http.createServer(handler);
tcpServer.listen(PORT, function () {
  const actual = tcpServer.address().port;
  try { fs.writeFileSync(path.join(dataDir, 'port.txt'), String(actual), 'utf8'); } catch (e) {}
  console.log(APP_TITLE + ' 已启动：http://127.0.0.1:' + actual + '（端口由系统分配）');
  console.log('数据目录：' + dataDir + '  fnOS=' + (!!process.env.TRIM_API_TOKEN));
  scheduleAuto();
});

// fnOS 统一网关：监听 target/app.sock
const sockPath = process.env.TRIM_APPDEST ? path.join(process.env.TRIM_APPDEST, 'app.sock') : '';
if (sockPath) {
  try { fs.unlinkSync(sockPath); } catch (e) {}
  const sockServer = http.createServer(handler);
  sockServer.on('error', function (e) { console.log('网关 socket 监听失败：' + e.message); });
  sockServer.listen(sockPath, function () {
    try { fs.chmodSync(sockPath, 0o666); } catch (e) {}
    console.log('网关 socket 已监听：' + sockPath);
  });
}
